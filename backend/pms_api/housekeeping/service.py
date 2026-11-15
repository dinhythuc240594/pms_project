"""Shared daily-plan intents; the caller holds the normal tenant mutation lock."""

from collections import Counter

from flask import current_app, g
from sqlalchemy import select

from ..bookings.models import Reservation, ReservationRoom
from ..catalog.models import PhysicalRoom
from ..core_models import User
from ..extensions import db
from ..pricing.engine import business_date
from ..security import GLOBAL_ROLES, ApiError, audit, set_context
from ..subscriptions import enforce_entitlements, lock_tenant
from .models import HousekeepingLog, HousekeepingShift, HousekeepingTask

OPEN_TASKS = {"pending", "in_progress", "inspection"}


def work_log(event, *, task=None, room=None, details=None, entity_type=None, entity_id=None):
    details = details or {}
    db.session.add(
        HousekeepingLog(
            tenant_id=g.tenant.id,
            task_id=task.id if task else None,
            room_id=room.id if room else task.room_id if task else None,
            user_id=g.user.id,
            event=event,
            details=details,
        )
    )
    audit(
        event,
        entity_type or ("housekeeping_task" if task else "room"),
        entity_id or (task.id if task else room.number),
        details,
    )


def add_task(room, day, kind, source_key, reservation_id=None):
    existing = db.session.scalar(
        select(HousekeepingTask).where(
            HousekeepingTask.tenant_id == room.tenant_id,
            HousekeepingTask.source_key == source_key,
        )
    )
    if existing:
        return existing, False
    row = HousekeepingTask(
        tenant_id=room.tenant_id,
        room_id=room.id,
        date=day,
        kind=kind,
        source_key=source_key,
        reservation_id=reservation_id,
        room_revision=room.housekeeping_revision,
    )
    db.session.add(row)
    db.session.flush()
    work_log(
        "housekeeping.task_created",
        task=row,
        room=room,
        details={"kind": kind, "date": day.isoformat()},
    )
    return row, True


def planned_room_ids(tenant_id, day, rooms):
    return {
        task.room_id
        for task in db.session.scalars(
            select(HousekeepingTask).where(
                HousekeepingTask.tenant_id == tenant_id,
                HousekeepingTask.date == day,
                HousekeepingTask.room_id.in_(rooms),
            )
        )
        if task.room_revision == rooms[task.room_id].housekeeping_revision
    }


def generate_day_plan(tenant_id, day, *, log_empty=True, room_ids=None):
    # Match checkout lock order: reservation references before rooms.
    stays = db.session.execute(
        select(ReservationRoom, Reservation)
        .join(
            Reservation,
            (Reservation.id == ReservationRoom.reservation_id)
            & (Reservation.tenant_id == ReservationRoom.tenant_id),
        )
        .where(
            ReservationRoom.tenant_id == tenant_id,
            Reservation.status.in_({"CONFIRMED", "IN_HOUSE", "CHECKED_OUT"}),
            Reservation.check_in <= day,
            Reservation.check_out >= day,
        )
        .order_by(Reservation.id)
        .with_for_update(read=True, key_share=True, of=Reservation)
    ).all()
    room_query = select(PhysicalRoom).where(
        PhysicalRoom.tenant_id == tenant_id, PhysicalRoom.active.is_(True)
    )
    if room_ids is not None:
        room_query = room_query.where(PhysicalRoom.id.in_(room_ids))
    rooms = list(
        db.session.scalars(
            room_query.order_by(PhysicalRoom.number)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    )
    room_map = {row.id: row for row in rooms}
    planned = planned_room_ids(tenant_id, day, room_map) if room_ids is not None else set()
    created, covered = 0, set(planned)
    for link, stay in stays:
        room = room_map.get(link.room_id)
        if not room or room.condition == "maintenance" or room.id in planned:
            continue
        if stay.check_out == day:
            kind = "departure"
        elif stay.check_in == day and stay.status != "CHECKED_OUT":
            kind = "arrival"
        elif stay.check_in < day < stay.check_out and stay.status == "IN_HOUSE":
            kind = "stayover"
        else:
            continue
        # Checkout and daily-plan retries refer to one immutable intent.
        source = (
            f"checkout:{stay.id}:{room.id}"
            if stay.status == "CHECKED_OUT" and stay.check_out == day
            else f"plan:{day}:{kind}:{stay.id}:{room.id}"
        )
        _, added = add_task(room, day, kind, source, stay.id)
        created += added
        covered.add(room.id)
    open_rooms = set(
        db.session.scalars(
            select(HousekeepingTask.room_id).where(
                HousekeepingTask.tenant_id == tenant_id,
                HousekeepingTask.status.in_(OPEN_TASKS),
            )
        )
    )
    for room in rooms:
        if room.id not in covered and room.id not in open_rooms and room.condition == "dirty":
            _, added = add_task(room, day, "dirty", f"dirty:{room.id}:{room.housekeeping_revision}")
            created += added
    if room_ids is not None:
        # Explicit room selection is a daily cleaning intent, even without a booking or dirty flag.
        planned = planned_room_ids(tenant_id, day, room_map)
        for room in rooms:
            if room.id not in planned and room.condition not in {"maintenance", "inspection"}:
                _, added = add_task(
                    room, day, "dirty", f"selected:{day}:{room.id}:{room.housekeeping_revision}"
                )
                created += added
    if created or log_empty:
        work_log(
            "housekeeping.plan_generated",
            entity_type="housekeeping_plan",
            entity_id=day.isoformat(),
            details={"date": day.isoformat(), "created": created},
        )
    return created, room_map


def assign_day_plan(tenant_id, day, rooms, staff_ids, total_loads, *, shift_choices=None):
    """Fill pending assignments, preserving existing work and using the day's lightest load."""
    if not staff_ids:
        return 0
    tasks = list(
        db.session.scalars(
            select(HousekeepingTask)
            .where(HousekeepingTask.tenant_id == tenant_id, HousekeepingTask.date == day)
            .order_by(HousekeepingTask.room_id, HousekeepingTask.kind, HousekeepingTask.id)
            .with_for_update()
        )
    )
    loads = Counter(task.staff_id for task in tasks if task.status in OPEN_TASKS)
    for staff_id in staff_ids:
        total_loads[staff_id] += loads[staff_id]
    shifts = {}
    for shift in db.session.scalars(
        select(HousekeepingShift)
        .where(
            HousekeepingShift.tenant_id == tenant_id,
            HousekeepingShift.date == day,
            HousekeepingShift.staff_id.in_(staff_ids),
            HousekeepingShift.active.is_(True),
        )
        .order_by(HousekeepingShift.start_time, HousekeepingShift.id)
    ):
        shifts.setdefault(shift.staff_id, shift.id)
    # An explicit null means no linked shift; omitted participants keep automatic selection.
    shifts.update(shift_choices or {})
    order = {staff_id: index for index, staff_id in enumerate(staff_ids)}
    assigned = 0
    for task in tasks:
        room = rooms.get(task.room_id)
        if (
            task.staff_id is not None
            or task.status != "pending"
            or not room
            or room.condition in {"maintenance", "inspection"}
            or task.room_revision != room.housekeeping_revision
        ):
            continue
        staff_id = min(staff_ids, key=lambda key: (loads[key], total_loads[key], order[key]))
        task.staff_id, task.shift_id = staff_id, shifts.get(staff_id)
        task.revision += 1
        loads[staff_id] += 1
        total_loads[staff_id] += 1
        assigned += 1
        work_log(
            "housekeeping.task_assigned",
            task=task,
            room=room,
            details={
                "fromStaffId": None,
                "staffId": staff_id,
                "shiftId": task.shift_id,
                "automatic": True,
            },
        )
    db.session.flush()
    return assigned


def process_day_plan(tenant_id, actor_id):
    """Generate scheduled work in a service context, never a user's PMS session."""
    with (
        current_app.app_context(),
        current_app.test_request_context("/api/_housekeeping_worker", method="POST"),
    ):
        try:
            set_context(tenant_id=tenant_id, is_service=True)
            g.tenant = lock_tenant(tenant_id)
            user = db.session.scalar(
                select(User)
                .where(User.id == actor_id)
                .with_for_update(read=True)
                .execution_options(populate_existing=True)
            )
            if not user or not user.active or user.global_role not in GLOBAL_ROLES:
                raise ApiError(
                    403, "housekeeping_actor_revoked", "Housekeeping worker actor is unavailable."
                )
            g.user, g.role = user, "HOTEL_OWNER"
            set_context(user.id, tenant_id, is_service=True)
            if g.tenant.status != "active":
                db.session.rollback()
                return 0
            try:
                enforce_entitlements("housekeeping.write")
            except ApiError:
                db.session.rollback()
                return 0
            created, _ = generate_day_plan(tenant_id, business_date(g.tenant), log_empty=False)
            db.session.commit()
            return created
        except Exception:
            db.session.rollback()
            raise
