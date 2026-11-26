"""Persisted housekeeping work, assignment and inspection within the request transaction."""

import re
from calendar import monthrange
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from flask import g, request
from sqlalchemy import select

from common import CommonMethodView, RequestData, ValueFormatter

from ..bookings.models import Reservation
from ..catalog.models import PhysicalRoom
from ..catalog.routes import bool_value, parse_date, text_value
from ..core_models import TenantUser, User, uid, utcnow
from ..extensions import db
from ..security import ApiError, audit, payload, require_tenant
from ..validation import phone_value
from .models import HousekeepingLog, HousekeepingShift, HousekeepingStaff, HousekeepingTask
from .service import OPEN_TASKS, add_task, assign_day_plan, generate_day_plan, work_log


def local_date():
    return datetime.now(ZoneInfo(g.tenant.settings.get("timezone", "Asia/Ho_Chi_Minh"))).date()


def iso(value):
    return ValueFormatter.iso(value)


def manager_only():
    if g.role not in {"HOTEL_OWNER", "FRONT_DESK"}:
        raise ApiError(403, "forbidden", "Chỉ quản lý hoặc lễ tân được điều phối buồng phòng.")


def known_fields(data, allowed):
    if set(data) - set(allowed):
        raise ApiError(422, "invalid_input", "Nội dung chứa trường không được hỗ trợ.")


def shift_times(start, end):
    if any(
        not isinstance(v, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", v)
        for v in (start, end)
    ):
        raise ApiError(422, "invalid_shift", "Giờ ca phải theo HH:MM.")
    first, last = time.fromisoformat(start), time.fromisoformat(end)
    if first >= last:
        raise ApiError(
            422, "invalid_shift", "Giờ kết thúc ca phải sau giờ bắt đầu trong cùng ngày."
        )
    return first, last


def revision_value(data, task):
    revision = data.get("revision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
        raise ApiError(422, "revision_required", "Cần phiên bản công việc hiện tại.")
    if revision != task.revision:
        raise ApiError(409, "stale_task", "Công việc đã đổi. Vui lòng tải lại trước khi thao tác.")


def staff_json(row):
    return {
        "id": row.id,
        "name": row.name,
        "phone": row.phone,
        "userId": row.user_id,
        "active": row.active,
    }


def shift_json(row):
    return {
        "id": row.id,
        "staffId": row.staff_id,
        "date": iso(row.date),
        "startTime": row.start_time.strftime("%H:%M"),
        "endTime": row.end_time.strftime("%H:%M"),
        "note": row.note,
        "active": row.active,
    }


def task_json(row, rooms=None):
    room = (
        rooms.get(row.room_id) if rooms is not None else db.session.get(PhysicalRoom, row.room_id)
    )
    return {
        "id": row.id,
        "roomId": row.room_id,
        "room": room.number if room else "",
        "date": iso(row.date),
        "kind": row.kind,
        "source": "manual" if row.source_key.startswith("manual:") else "automatic",
        "bookingId": row.reservation_id,
        "staffId": row.staff_id,
        "shiftId": row.shift_id,
        "status": row.status,
        "note": row.note,
        "revision": row.revision,
        "createdAt": iso(row.created_at),
        "startedAt": iso(row.started_at),
        "completedAt": iso(row.completed_at),
    }


def member_link(tenant_id, user_id):
    if user_id is None:
        return
    user_id = text_value(user_id, "Tài khoản", 40)
    user = db.session.scalar(
        select(User).where(User.id == user_id, User.active.is_(True)).with_for_update(read=True)
    )
    member = db.session.scalar(
        select(TenantUser).where(
            TenantUser.tenant_id == tenant_id,
            TenantUser.user_id == user_id,
            TenantUser.active.is_(True),
            TenantUser.role == "HOUSEKEEPING",
        )
    )
    if not user or not member:
        raise ApiError(
            422,
            "invalid_staff_user",
            "Tài khoản phải là thành viên buồng phòng đang hoạt động của khách sạn.",
        )


def find_staff(tenant_id, staff_id, *, active=False, locked=False):
    staff_id = text_value(staff_id, "Mã nhân viên", 40)
    statement = select(HousekeepingStaff).where(
        HousekeepingStaff.tenant_id == tenant_id, HousekeepingStaff.id == staff_id
    )
    if active:
        statement = statement.where(HousekeepingStaff.active.is_(True))
    if locked:
        statement = statement.with_for_update(read=True).execution_options(populate_existing=True)
    row = db.session.scalar(statement)
    if not row:
        raise ApiError(404, "not_found", "Không tìm thấy nhân viên buồng phòng.")
    if active:
        member_link(tenant_id, row.user_id)
    return row


def staff_values(tenant_id, data, row=None):
    known_fields(data, {"name", "phone", "userId", "active"})
    row = row or HousekeepingStaff(tenant_id=tenant_id)
    row.name = text_value(data.get("name", row.name), "Tên nhân viên", 160)
    row.phone = phone_value(
        text_value(data.get("phone", row.phone or ""), "Điện thoại", 40, empty=True)
    )
    user_id = data.get("userId", row.user_id)
    active = bool_value(data.get("active", row.active if row.active is not None else True))
    if user_id is not None:
        user_id = text_value(user_id, "Tài khoản", 40)
        if active or user_id != row.user_id:
            member_link(tenant_id, user_id)
    if (
        row.id
        and (not active or user_id != row.user_id)
        and db.session.scalar(
            select(HousekeepingTask.id)
            .where(
                HousekeepingTask.tenant_id == tenant_id,
                HousekeepingTask.staff_id == row.id,
                HousekeepingTask.status.in_(OPEN_TASKS),
            )
            .limit(1)
        )
    ):
        raise ApiError(
            409,
            "staff_busy",
            "Cần chuyển công việc đang mở trước khi ngừng hoặc đổi tài khoản nhân viên.",
        )
    row.user_id, row.active = user_id, active
    db.session.add(row)
    db.session.flush()
    work_log(
        "housekeeping.staff_updated",
        entity_type="housekeeping_staff",
        entity_id=row.id,
        details={"active": row.active, "userId": row.user_id},
    )
    return row


def own_staff_ids(tenant_id):
    return select(HousekeepingStaff.id).where(
        HousekeepingStaff.tenant_id == tenant_id,
        HousekeepingStaff.user_id == g.user.id,
        HousekeepingStaff.active.is_(True),
    )


def calendar_range():
    """Optional inclusive start/exclusive end, shared by task and shift calendars."""
    start_value, end_value = RequestData.date_range()
    if start_value is None and end_value is None:
        return None
    if "date" in request.args:
        raise ApiError(422, "invalid_range", "Chỉ chọn ngày hoặc khoảng ngày.")
    start, end = parse_date(start_value), parse_date(end_value)
    if not 1 <= (end - start).days <= 31:
        raise ApiError(422, "invalid_range", "Khoảng lịch phải từ 1 đến 31 ngày.")
    return start, end


class ListStaffView(CommonMethodView):
    @staticmethod
    @require_tenant("housekeeping.view")
    def dispatch_request(tenant_id):
        statement = select(HousekeepingStaff).where(HousekeepingStaff.tenant_id == tenant_id)
        if g.role == "HOUSEKEEPING":
            statement = statement.where(HousekeepingStaff.id.in_(own_staff_ids(tenant_id)))
        return {
            "staff": [
                staff_json(row)
                for row in db.session.scalars(statement.order_by(HousekeepingStaff.name))
            ]
        }


class CreateStaffView(CommonMethodView):
    @staticmethod
    @require_tenant("housekeeping.write")
    def dispatch_request(tenant_id):
        manager_only()
        return staff_json(staff_values(tenant_id, payload())), 201


class UpdateStaffView(CommonMethodView):
    @staticmethod
    @require_tenant("housekeeping.write")
    def dispatch_request(tenant_id, staff_id):
        manager_only()
        row = db.session.scalar(
            select(HousekeepingStaff)
            .where(
                HousekeepingStaff.tenant_id == tenant_id,
                HousekeepingStaff.id == staff_id,
            )
            .with_for_update()
        )
        if not row:
            raise ApiError(404, "not_found", "Không tìm thấy nhân viên buồng phòng.")
        return staff_json(staff_values(tenant_id, payload(), row))


def shift_values(tenant_id, data, row=None):
    known_fields(data, {"staffId", "date", "startTime", "endTime", "note", "active"})
    row = row or HousekeepingShift(tenant_id=tenant_id)
    staff_id = text_value(data.get("staffId", row.staff_id), "Mã nhân viên", 40)
    active = bool_value(data.get("active", row.active if row.active is not None else True))
    find_staff(tenant_id, staff_id, active=active, locked=True)
    day = parse_date(data.get("date", row.date))
    start, end = shift_times(
        data.get("startTime", row.start_time.strftime("%H:%M") if row.start_time else None),
        data.get("endTime", row.end_time.strftime("%H:%M") if row.end_time else None),
    )
    if (
        row.id
        and (
            staff_id != row.staff_id
            or day != row.date
            or not active
            or start != row.start_time
            or end != row.end_time
        )
        and db.session.scalar(
            select(HousekeepingTask.id)
            .where(
                HousekeepingTask.tenant_id == tenant_id,
                HousekeepingTask.shift_id == row.id,
                HousekeepingTask.status.in_(OPEN_TASKS),
            )
            .limit(1)
        )
    ):
        raise ApiError(409, "shift_busy", "Ca còn công việc đang mở; cần chuyển công việc trước.")
    if active and db.session.scalar(
        select(HousekeepingShift.id)
        .where(
            HousekeepingShift.tenant_id == tenant_id,
            HousekeepingShift.staff_id == staff_id,
            HousekeepingShift.date == day,
            HousekeepingShift.active.is_(True),
            HousekeepingShift.start_time < end,
            HousekeepingShift.end_time > start,
            HousekeepingShift.id != (row.id or ""),
        )
        .limit(1)
    ):
        raise ApiError(409, "shift_overlap", "Ca làm việc bị chồng giờ.")
    row.staff_id, row.date, row.start_time, row.end_time, row.active = (
        staff_id,
        day,
        start,
        end,
        active,
    )
    row.note = text_value(data.get("note", row.note or ""), "Ghi chú", 500, empty=True)
    db.session.add(row)
    db.session.flush()
    work_log(
        "housekeeping.shift_updated",
        entity_type="housekeeping_shift",
        entity_id=row.id,
        details={"staffId": staff_id, "date": iso(day), "active": active},
    )
    return row


class ListShiftsView(CommonMethodView):
    @staticmethod
    @require_tenant("housekeeping.view")
    def dispatch_request(tenant_id):
        statement = select(HousekeepingShift).where(HousekeepingShift.tenant_id == tenant_id)
        window = calendar_range()
        if window:
            statement = statement.where(
                HousekeepingShift.date >= window[0], HousekeepingShift.date < window[1]
            )
        if "date" in request.args:
            statement = statement.where(HousekeepingShift.date == parse_date(request.args["date"]))
        if g.role == "HOUSEKEEPING":
            statement = statement.where(HousekeepingShift.staff_id.in_(own_staff_ids(tenant_id)))
        statement = statement.order_by(HousekeepingShift.date.desc(), HousekeepingShift.start_time)
        if not window:
            statement = statement.limit(500)
        return {"shifts": [shift_json(row) for row in db.session.scalars(statement)]}


def shift_creation_dates(value, period="day"):
    if not isinstance(period, str) or period not in {"day", "week", "month"}:
        raise ApiError(422, "invalid_shift_period", "Chọn tạo ca cho 1 ngày, 7 ngày hoặc 1 tháng.")
    day = parse_date(value)
    count = 1 if period == "day" else 7
    if period == "month":
        next_month = day.month % 12 + 1
        next_year = day.year + (day.month == 12)
        count = (
            monthrange(day.year, day.month)[1]
            - day.day
            + min(day.day, monthrange(next_year, next_month)[1])
        )
    try:
        return [day + timedelta(days=index) for index in range(count)]
    except OverflowError:
        raise ApiError(
            422, "invalid_shift_period", "Khoảng tạo ca vượt giới hạn ngày hỗ trợ."
        ) from None


def create_shifts(tenant_id, data):
    known_fields(data, {"staffId", "date", "startTime", "endTime", "note", "active", "period"})
    period = data.get("period", "day")
    days = shift_creation_dates(data.get("date"), period)
    values = {key: value for key, value in data.items() if key != "period"}
    rows = []
    for day in days:
        try:
            rows.append(shift_values(tenant_id, {**values, "date": day.isoformat()}))
        except ApiError as error:
            if period != "day" and error.code == "shift_overlap":
                raise ApiError(
                    409,
                    "shift_overlap",
                    {
                        "$i18n": "hk.shiftOverlapDate",
                        "values": {"date": day.isoformat()},
                    },
                    {"date": day.isoformat()},
                ) from None
            raise
    if period == "day":
        return shift_json(rows[0])
    return {
        "date": days[0].isoformat(),
        "throughDate": days[-1].isoformat(),
        "created": len(rows),
        "shifts": [shift_json(row) for row in rows],
    }


class CreateShiftView(CommonMethodView):
    @staticmethod
    @require_tenant("housekeeping.write")
    def dispatch_request(tenant_id):
        manager_only()
        return create_shifts(tenant_id, payload()), 201


class UpdateShiftView(CommonMethodView):
    @staticmethod
    @require_tenant("housekeeping.write")
    def dispatch_request(tenant_id, shift_id):
        manager_only()
        row = db.session.scalar(
            select(HousekeepingShift)
            .where(
                HousekeepingShift.tenant_id == tenant_id,
                HousekeepingShift.id == shift_id,
            )
            .with_for_update()
        )
        if not row:
            raise ApiError(404, "not_found", "Không tìm thấy ca làm việc.")
        return shift_json(shift_values(tenant_id, payload(), row))


def task_rows(tenant_id, day=None, window=None):
    statement = select(HousekeepingTask).where(HousekeepingTask.tenant_id == tenant_id)
    if day is not None:
        statement = statement.where(HousekeepingTask.date == day)
    if window:
        statement = statement.where(
            HousekeepingTask.date >= window[0], HousekeepingTask.date < window[1]
        )
    if getattr(g, "role", None) == "HOUSEKEEPING":
        statement = statement.where(HousekeepingTask.staff_id.in_(own_staff_ids(tenant_id)))
    statement = statement.order_by(HousekeepingTask.date.desc(), HousekeepingTask.created_at.desc())
    if not window:
        statement = statement.limit(500)
    return list(db.session.scalars(statement))


class ListTasksView(CommonMethodView):
    @staticmethod
    @require_tenant("housekeeping.view")
    def dispatch_request(tenant_id):
        window = calendar_range()
        day = (
            None
            if window
            else parse_date(request.args["date"])
            if "date" in request.args
            else local_date()
        )
        rooms = {
            row.id: row
            for row in db.session.scalars(
                select(PhysicalRoom).where(PhysicalRoom.tenant_id == tenant_id)
            )
        }
        return {
            "date": iso(day),
            "tasks": [task_json(row, rooms) for row in task_rows(tenant_id, day, window)],
        }


def plan_generation_values(data):
    known_fields(data, {"date", "dates", "staffIds", "dayPlans"})
    if "dates" in data:
        values = data["dates"]
        if "date" in data or not isinstance(values, list) or not 1 <= len(values) <= 31:
            raise ApiError(422, "invalid_plan_dates", "Chọn từ 1 đến 31 ngày trong một lần tạo.")
        days = sorted(parse_date(value) for value in values)
        if len(set(days)) != len(days) or (days[-1] - days[0]).days >= 31:
            raise ApiError(
                422, "invalid_plan_dates", "Các ngày phải khác nhau và nằm trong khoảng 31 ngày."
            )
    else:
        days = [parse_date(data.get("date"))]
    staff_ids = data.get("staffIds", [])
    if not isinstance(staff_ids, list) or len(staff_ids) > 100:
        raise ApiError(422, "invalid_plan_staff", "Chọn tối đa 100 nhân viên mỗi lần tạo.")
    staff_ids = [text_value(value, "Mã nhân viên", 40) for value in staff_ids]
    if len(set(staff_ids)) != len(staff_ids):
        raise ApiError(422, "invalid_plan_staff", "Danh sách nhân viên không được trùng lặp.")
    return days, staff_ids


def plan_day_values(data, days, staff_ids):
    values = data.get("dayPlans", [])
    if not isinstance(values, list) or len(values) > len(days):
        raise ApiError(422, "invalid_day_plan", "Cấu hình theo ngày không hợp lệ.")
    plans = {}
    for value in values:
        if not isinstance(value, dict):
            raise ApiError(422, "invalid_day_plan", "Cấu hình theo ngày không hợp lệ.")
        known_fields(value, {"date", "roomIds", "shifts"})
        day = parse_date(value.get("date"))
        if day not in days or day in plans:
            raise ApiError(
                422, "invalid_day_plan", "Cấu hình phải thuộc ngày đã chọn và không trùng ngày."
            )
        room_ids = value.get("roomIds")
        if room_ids is not None:
            if not isinstance(room_ids, list) or not 1 <= len(room_ids) <= 500:
                raise ApiError(422, "invalid_plan_rooms", "Chọn từ 1 đến 500 phòng cho mỗi ngày.")
            room_ids = [text_value(item, "Mã phòng", 40) for item in room_ids]
            if len(set(room_ids)) != len(room_ids):
                raise ApiError(
                    422, "invalid_plan_rooms", "Danh sách phòng trong ngày không được trùng lặp."
                )
        selections = value.get("shifts", [])
        if not isinstance(selections, list) or len(selections) > len(staff_ids):
            raise ApiError(422, "invalid_plan_shifts", "Lựa chọn ca làm việc không hợp lệ.")
        shifts = {}
        for selection in selections:
            if not isinstance(selection, dict):
                raise ApiError(422, "invalid_plan_shifts", "Lựa chọn ca làm việc không hợp lệ.")
            known_fields(selection, {"staffId", "shiftId"})
            staff_id = text_value(selection.get("staffId"), "Mã nhân viên", 40)
            if staff_id not in staff_ids or staff_id in shifts or "shiftId" not in selection:
                raise ApiError(
                    422,
                    "invalid_plan_shifts",
                    "Ca phải thuộc nhân viên đã chọn và không trùng nhân viên.",
                )
            shift_id = selection["shiftId"]
            shifts[staff_id] = text_value(shift_id, "Mã ca", 40) if shift_id is not None else None
        plans[day] = {"room_ids": room_ids, "shifts": shifts}
    return plans


def validate_plan_days(tenant_id, plans):
    room_ids = {key for plan in plans.values() for key in plan["room_ids"] or []}
    if room_ids:
        rooms = list(
            db.session.scalars(
                select(PhysicalRoom).where(
                    PhysicalRoom.tenant_id == tenant_id, PhysicalRoom.id.in_(room_ids)
                )
            )
        )
        if len(rooms) != len(room_ids) or any(not row.active for row in rooms):
            raise ApiError(404, "not_found", "Không tìm thấy phòng đang hoạt động.")
        if any(row.condition in {"maintenance", "inspection"} for row in rooms):
            raise ApiError(
                409, "room_unavailable", "Không thể tạo việc cho phòng bảo trì hoặc chờ kiểm tra."
            )
    shift_ids = {
        key for plan in plans.values() for key in plan["shifts"].values() if key is not None
    }
    if shift_ids:
        shifts = {
            row.id: row
            for row in db.session.scalars(
                select(HousekeepingShift).where(
                    HousekeepingShift.tenant_id == tenant_id, HousekeepingShift.id.in_(shift_ids)
                )
            )
        }
        for day, plan in plans.items():
            for staff_id, shift_id in plan["shifts"].items():
                if shift_id is None:
                    continue
                shift = shifts.get(shift_id)
                if not shift or not shift.active or shift.date != day or shift.staff_id != staff_id:
                    raise ApiError(
                        422,
                        "invalid_shift",
                        "Ca phải thuộc nhân viên, cùng ngày và đang hoạt động.",
                    )


class GeneratePlanView(CommonMethodView):
    @staticmethod
    @require_tenant("housekeeping.write")
    def dispatch_request(tenant_id):
        manager_only()
        data = payload()
        days, staff_ids = plan_generation_values(data)
        plans = plan_day_values(data, days, staff_ids)
        # Validate every participant before creating any work in this transaction.
        for staff_id in sorted(staff_ids):
            find_staff(tenant_id, staff_id, active=True, locked=True)
        validate_plan_days(tenant_id, plans)
        summaries, total_loads = [], dict.fromkeys(staff_ids, 0)
        for day in days:
            plan = plans.get(day, {"room_ids": None, "shifts": {}})
            options = {"room_ids": plan["room_ids"]} if plan["room_ids"] is not None else {}
            created, room_map = generate_day_plan(tenant_id, day, **options)
            assigned = assign_day_plan(
                tenant_id, day, room_map, staff_ids, total_loads, shift_choices=plan["shifts"]
            )
            summaries.append({"date": iso(day), "created": created, "assigned": assigned})
        result = {
            "date": iso(days[0]),
            "dates": [iso(day) for day in days],
            "created": sum(row["created"] for row in summaries),
            "assigned": sum(row["assigned"] for row in summaries),
            "days": summaries,
        }
        # Batch callers only need counts; retain the legacy single-day task response.
        if "dates" not in data:
            if plans.get(days[0], {}).get("room_ids") is not None:
                room_map = {
                    room.id: room
                    for room in db.session.scalars(
                        select(PhysicalRoom).where(PhysicalRoom.tenant_id == tenant_id)
                    )
                }
            result["tasks"] = [task_json(row, room_map) for row in task_rows(tenant_id, days[0])]
        return result, 201


def assignment_values(tenant_id, day, staff_id, shift_id):
    if staff_id is not None:
        staff_id = text_value(staff_id, "Mã nhân viên", 40)
        find_staff(tenant_id, staff_id, active=True, locked=True)
    elif shift_id is not None:
        raise ApiError(422, "invalid_shift", "Ca phải được gắn với nhân viên.")
    if shift_id is not None:
        shift_id = text_value(shift_id, "Mã ca", 40)
        shift = db.session.scalar(
            select(HousekeepingShift)
            .where(
                HousekeepingShift.tenant_id == tenant_id,
                HousekeepingShift.id == shift_id,
                HousekeepingShift.staff_id == staff_id,
                HousekeepingShift.date == day,
                HousekeepingShift.active.is_(True),
            )
            .with_for_update(read=True)
        )
        if not shift:
            raise ApiError(
                422, "invalid_shift", "Ca phải thuộc nhân viên, cùng ngày và đang hoạt động."
            )
    return staff_id, shift_id


class CreateManualTaskView(CommonMethodView):
    @staticmethod
    @require_tenant("housekeeping.write")
    def dispatch_request(tenant_id):
        manager_only()
        data = payload()
        known_fields(data, {"date", "room", "note", "staffId", "shiftId"})
        day = parse_date(data.get("date"))
        number = text_value(data.get("room"), "Phòng", 40)
        room = db.session.scalar(
            select(PhysicalRoom)
            .where(
                PhysicalRoom.tenant_id == tenant_id,
                PhysicalRoom.number == number,
                PhysicalRoom.active.is_(True),
            )
            .with_for_update()
        )
        if not room:
            raise ApiError(404, "not_found", "Không tìm thấy phòng đang hoạt động.")
        if room.condition in {"maintenance", "inspection"}:
            raise ApiError(409, "room_unavailable", "Phòng đang bảo trì hoặc chờ kiểm tra.")
        if db.session.scalar(
            select(HousekeepingTask.id)
            .where(
                HousekeepingTask.tenant_id == tenant_id,
                HousekeepingTask.room_id == room.id,
                HousekeepingTask.date == day,
                HousekeepingTask.status.in_(OPEN_TASKS),
            )
            .limit(1)
        ):
            raise ApiError(
                409,
                "task_exists",
                "Phòng đã có công việc đang mở trong ngày; hãy dùng công việc đó.",
            )
        note = text_value(data.get("note", ""), "Ghi chú", 1000, empty=True)
        staff_id, shift_id = assignment_values(
            tenant_id, day, data.get("staffId"), data.get("shiftId")
        )
        task, _ = add_task(room, day, "dirty", f"manual:{uid()}")
        task.note = note
        task.staff_id, task.shift_id = staff_id, shift_id
        if staff_id:
            work_log(
                "housekeeping.task_assigned",
                task=task,
                room=room,
                details={"fromStaffId": None, "staffId": staff_id, "shiftId": shift_id},
            )
        db.session.flush()
        return task_json(task), 201


def find_task_locked(tenant_id, task_id):
    task = db.session.scalar(
        select(HousekeepingTask).where(
            HousekeepingTask.tenant_id == tenant_id, HousekeepingTask.id == task_id
        )
    )
    if not task:
        raise ApiError(404, "not_found", "Không tìm thấy công việc buồng phòng.")
    # Every workflow locks room first, then tasks. Checkout uses the same order.
    room = db.session.scalar(
        select(PhysicalRoom)
        .where(PhysicalRoom.tenant_id == tenant_id, PhysicalRoom.id == task.room_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    task = db.session.scalar(
        select(HousekeepingTask)
        .where(HousekeepingTask.tenant_id == tenant_id, HousekeepingTask.id == task_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return task, room


def task_current(task, room):
    if task.room_revision != room.housekeeping_revision or not room.active:
        raise ApiError(
            409, "stale_room", "Phòng đã đổi lượt lưu trú hoặc tình trạng; cần dùng công việc mới."
        )


class AssignTaskView(CommonMethodView):
    @staticmethod
    @require_tenant("housekeeping.write")
    def dispatch_request(tenant_id, task_id):
        manager_only()
        data = payload()
        known_fields(data, {"staffId", "shiftId", "revision"})
        if "staffId" not in data:
            raise ApiError(422, "invalid_staff", "Cần mã nhân viên hoặc null để gỡ phân công.")
        task, room = find_task_locked(tenant_id, task_id)
        revision_value(data, task)
        task_current(task, room)
        if task.status not in OPEN_TASKS:
            raise ApiError(409, "task_closed", "Công việc đã đóng.")
        staff_id, shift_id = assignment_values(
            tenant_id, task.date, data.get("staffId"), data.get("shiftId")
        )
        previous = task.staff_id
        task.staff_id, task.shift_id, task.status = staff_id, shift_id, "pending"
        task.started_at = None
        task.revision += 1
        if room.condition == "inspection":
            room.condition = "dirty"
        work_log(
            "housekeeping.task_assigned",
            task=task,
            room=room,
            details={"fromStaffId": previous, "staffId": staff_id, "shiftId": shift_id},
        )
        db.session.flush()
        return task_json(task)


class ChangeTaskStatusView(CommonMethodView):
    @staticmethod
    @require_tenant("housekeeping.write")
    def dispatch_request(tenant_id, task_id):
        data = payload()
        known_fields(data, {"status", "note", "revision"})
        task, room = find_task_locked(tenant_id, task_id)
        revision_value(data, task)
        task_current(task, room)
        status = data.get("status")
        if not isinstance(status, str):
            raise ApiError(422, "invalid_status", "Trạng thái công việc không hợp lệ.")
        staff = (
            find_staff(tenant_id, task.staff_id, active=True, locked=True)
            if task.staff_id and (g.role == "HOUSEKEEPING" or status != "cancelled")
            else None
        )
        if g.role == "HOUSEKEEPING":
            if not staff or staff.user_id != g.user.id:
                raise ApiError(
                    403, "not_assigned", "Bạn chỉ được cập nhật công việc được giao cho mình."
                )
            if status not in {"in_progress", "inspection"}:
                raise ApiError(
                    403, "inspection_required", "Cần lễ tân hoặc quản lý kiểm tra và xác nhận sạch."
                )
        else:
            manager_only()
        transitions = {
            "pending": {"in_progress", "cancelled"},
            "in_progress": {"inspection", "cancelled"},
            "inspection": {"completed", "in_progress", "cancelled"},
        }
        if status not in transitions.get(task.status, set()):
            raise ApiError(
                409, "invalid_transition", "Trạng thái công việc không cho phép thao tác này."
            )
        if status != "cancelled":
            if task.date > local_date():
                raise ApiError(
                    409, "outside_work_date", "Chưa đến ngày thực hiện công việc được lập kế hoạch."
                )
            if room.condition == "maintenance":
                raise ApiError(409, "room_maintenance", "Phòng đang bảo trì.")
            if task.kind in {"checkout", "departure"}:
                stay = db.session.get(Reservation, task.reservation_id)
                if not stay or stay.status != "CHECKED_OUT":
                    raise ApiError(
                        409,
                        "departure_pending",
                        "Khách chưa trả phòng; chưa thể bắt đầu dọn lượt trả phòng.",
                    )
            if status == "completed" and room.condition != "inspection":
                raise ApiError(
                    409,
                    "inspection_required",
                    "Phòng phải ở trạng thái đang kiểm tra trước khi xác nhận sạch.",
                )
            if status == "in_progress" and db.session.scalar(
                select(HousekeepingTask.id)
                .where(
                    HousekeepingTask.tenant_id == tenant_id,
                    HousekeepingTask.room_id == room.id,
                    HousekeepingTask.id != task.id,
                    HousekeepingTask.status.in_({"in_progress", "inspection"}),
                )
                .limit(1)
            ):
                raise ApiError(
                    409, "room_work_active", "Phòng đã có công việc đang dọn hoặc đang kiểm tra."
                )
        previous = task.status
        task.status = status
        task.revision += 1
        if "note" in data:
            task.note = text_value(data["note"], "Ghi chú", 1000, empty=True)
        if status == "in_progress":
            task.started_at = task.started_at or utcnow()
            room.condition = "dirty"
        elif status == "inspection":
            room.condition = "inspection"
        elif status == "completed":
            task.completed_at = utcnow()
            room.condition = "clean"
        elif room.condition == "inspection":
            room.condition = "dirty"
        work_log(
            "housekeeping.task_status",
            task=task,
            room=room,
            details={
                "from": previous,
                "to": status,
                "condition": room.condition,
                "note": task.note,
            },
        )
        audit(
            f"room.{room.condition}",
            "room",
            room.number,
            {"condition": room.condition, "taskId": task.id},
        )
        db.session.flush()
        return task_json(task)


def cancel_reservation_tasks(reservation, rooms, reason):
    """Caller holds the reservation and room locks; other stays' tasks remain usable."""
    room_map = {room.id: room for room in rooms}
    tasks = db.session.scalars(
        select(HousekeepingTask)
        .where(
            HousekeepingTask.tenant_id == reservation.tenant_id,
            HousekeepingTask.reservation_id == reservation.id,
            HousekeepingTask.status.in_(OPEN_TASKS),
        )
        .order_by(HousekeepingTask.id)
        .with_for_update()
    )
    for task in tasks:
        task.status = "cancelled"
        task.revision += 1
        work_log(
            "housekeeping.task_superseded",
            task=task,
            room=room_map.get(task.room_id),
            details={"reason": reason},
        )


def invalidate_room_tasks(room, reason):
    """Caller holds the room lock; a previous occupant's work must never clean a new stay."""
    room.housekeeping_revision += 1
    tasks = db.session.scalars(
        select(HousekeepingTask)
        .where(
            HousekeepingTask.tenant_id == room.tenant_id,
            HousekeepingTask.room_id == room.id,
            HousekeepingTask.status.in_(OPEN_TASKS),
        )
        .order_by(HousekeepingTask.id)
        .with_for_update()
    )
    for task in tasks:
        task.status = "cancelled"
        task.revision += 1
        work_log("housekeeping.task_superseded", task=task, room=room, details={"reason": reason})


def guard_room_condition(room, condition):
    tasks = list(
        db.session.scalars(
            select(HousekeepingTask).where(
                HousekeepingTask.tenant_id == room.tenant_id,
                HousekeepingTask.room_id == room.id,
                HousekeepingTask.status.in_(OPEN_TASKS),
            )
        )
    )
    if (
        g.role == "HOUSEKEEPING"
        or room.condition == "inspection"
        or any(task.staff_id for task in tasks)
    ):
        raise ApiError(
            409,
            "task_workflow_required",
            "Cần cập nhật phòng qua công việc được giao và bước kiểm tra.",
        )
    if condition == "inspection":
        raise ApiError(
            409,
            "task_workflow_required",
            "Trạng thái đang kiểm tra phải được gửi từ công việc dọn phòng.",
        )


def checkout_task(room, reservation):
    invalidate_room_tasks(room, "checkout")
    return add_task(
        room, local_date(), "checkout", f"checkout:{reservation.id}:{room.id}", reservation.id
    )[0]


def housekeeping_snapshot(tenant_id):
    staff = select(HousekeepingStaff).where(HousekeepingStaff.tenant_id == tenant_id)
    shifts = select(HousekeepingShift).where(HousekeepingShift.tenant_id == tenant_id)
    logs = select(HousekeepingLog).where(HousekeepingLog.tenant_id == tenant_id)
    if getattr(g, "role", None) == "HOUSEKEEPING":
        staff = staff.where(HousekeepingStaff.id.in_(own_staff_ids(tenant_id)))
        shifts = shifts.where(HousekeepingShift.staff_id.in_(own_staff_ids(tenant_id)))
        logs = logs.where(
            HousekeepingLog.task_id.in_(
                select(HousekeepingTask.id).where(
                    HousekeepingTask.tenant_id == tenant_id,
                    HousekeepingTask.staff_id.in_(own_staff_ids(tenant_id)),
                )
            )
        )
    rooms = {
        row.id: row
        for row in db.session.scalars(
            select(PhysicalRoom).where(PhysicalRoom.tenant_id == tenant_id)
        )
    }
    events = list(db.session.scalars(logs.order_by(HousekeepingLog.created_at.desc()).limit(100)))
    actors = (
        {
            row.id: row.name
            for row in db.session.scalars(
                select(User).where(User.id.in_({event.user_id for event in events}))
            )
        }
        if events
        else {}
    )
    return {
        "housekeepingAccounts": [
            {"id": user.id, "name": user.name}
            for user in db.session.scalars(
                select(User)
                .join(TenantUser, TenantUser.user_id == User.id)
                .where(
                    TenantUser.tenant_id == tenant_id,
                    TenantUser.role == "HOUSEKEEPING",
                    TenantUser.active.is_(True),
                    User.active.is_(True),
                )
                .order_by(User.name)
            )
        ]
        if g.role in {"HOTEL_OWNER", "FRONT_DESK"}
        else [],
        "housekeepingStaff": [
            staff_json(row) for row in db.session.scalars(staff.order_by(HousekeepingStaff.name))
        ],
        "housekeepingShifts": [
            shift_json(row)
            for row in db.session.scalars(shifts.order_by(HousekeepingShift.date.desc()).limit(500))
        ],
        "housekeepingTasks": [task_json(row, rooms) for row in task_rows(tenant_id)],
        "housekeepingWorkLogs": [
            {
                "id": row.id,
                "taskId": row.task_id,
                "room": rooms[row.room_id].number if row.room_id in rooms else None,
                "action": row.event,
                "details": row.details,
                "condition": row.details.get("condition"),
                "createdAt": iso(row.created_at),
                "actorId": row.user_id,
                "actor": actors.get(row.user_id, ""),
            }
            for row in events
        ],
    }


def __getattr__(name):
    if name in {"URL", "housekeeping"}:
        from importlib import import_module

        return getattr(import_module(".urls", __package__), name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
