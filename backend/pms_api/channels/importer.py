"""Normalize an authoritative provider revision, then use canonical stay locks.

Mapped stays preserve room prices and split documented taxes/services exactly.
Ambiguous financials and changes to operational/settled stays remain unacked for
explicit operator reconciliation. Card guarantees and prepaid OTA flags are
never stored as local payments.
"""

from decimal import Decimal

from sqlalchemy import delete, or_, select

from pms_api.bookings.application import (
    add_stay,
    commission_snapshot,
    inventory,
)
from pms_api.catalog.application import lock_inventory

from ..bookings.models import (
    Charge,
    Guest,
    Payment,
    Reservation,
    ReservationGuest,
    ReservationNight,
    ReservationRoom,
)
from ..catalog.models import Master, PhysicalRoom, RoomBlock, RoomType
from ..core_models import utcnow
from ..extensions import db
from ..pricing.engine import snapshot_money
from ..security import ApiError, audit
from ..subscriptions import lock_tenant
from .domain import financial_lines as financial_lines
from .domain import identifier as identifier
from .domain import invalid as invalid
from .domain import normalize as normalize
from .domain import review_details as review_details
from .domain import revision_identity as revision_identity
from .domain import text as text
from .models import ChannelBooking, ChannelBookingReview, ChannelMapping, ChannelRevision


def import_revision(
    tenant_id, entity, property_id, *, retry_review=False, verify_cancellation=None
):
    # The tenant lock also serializes two first revisions before a booking link exists.
    lock_tenant(tenant_id)
    revision = revision_identity(entity, property_id)
    existing = db.session.scalar(
        select(ChannelRevision).where(
            ChannelRevision.tenant_id == tenant_id, ChannelRevision.revision_id == revision["id"]
        )
    )
    if existing:
        if existing.booking_id != revision["bookingId"]:
            invalid("invalid_booking_revision")
        return existing
    review = db.session.scalar(
        select(ChannelBookingReview)
        .where(
            ChannelBookingReview.tenant_id == tenant_id,
            ChannelBookingReview.revision_id == revision["id"],
        )
        .with_for_update()
    )
    if review and (
        review.booking_id != revision["bookingId"]
        or review.provider_status != revision["status"]
        or review.revision_at != revision["insertedAt"]
    ):
        invalid("invalid_booking_revision")
    if review and not retry_review:
        return review
    link = db.session.scalar(
        select(ChannelBooking)
        .where(
            ChannelBooking.tenant_id == tenant_id,
            ChannelBooking.booking_id == revision["bookingId"],
        )
        .with_for_update()
    )
    first = link is None
    if first:
        link = ChannelBooking(
            tenant_id=tenant_id,
            booking_id=revision["bookingId"],
            latest_revision_at=revision["insertedAt"],
            latest_revision_id=revision["id"],
            latest_status=revision["status"],
        )
        db.session.add(link)
        db.session.flush()
    row = (
        db.session.scalar(
            select(Reservation)
            .where(
                Reservation.tenant_id == tenant_id,
                Reservation.id == link.reservation_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if link.reservation_id
        else None
    )
    unverified_cancellation = (
        row is None and link.latest_status == "cancelled" and not link.cancellation_verified_at
    )
    # A rejected update cannot supersede a create until a local stay exists.
    missing_create = (
        row is None and revision["status"] == "new" and link.latest_status != "cancelled"
    )
    stale = (
        revision["insertedAt"] < link.latest_revision_at
        and not unverified_cancellation
        and not missing_create
    )
    watermark = revision
    try:
        # A rejected modification must leave its original stay and inventory intact.
        with db.session.begin_nested():
            if unverified_cancellation and revision["status"] != "cancelled":
                if verify_cancellation is None:
                    invalid("channel_cancellation_unverified")
                watermark = verify_cancellation()
                link.cancellation_verified_at = utcnow()
                link.latest_revision_at = watermark["insertedAt"]
                link.latest_revision_id = watermark["id"]
                stale = revision["insertedAt"] < watermark["insertedAt"]
            if stale:
                if row is None and link.latest_status != "cancelled":
                    invalid("channel_booking_not_found")
                outcome = "stale"
            elif (
                not first
                and revision["insertedAt"] == link.latest_revision_at
                and link.latest_revision_id != revision["id"]
            ):
                invalid("revision_order_conflict")
            elif revision["status"] == "cancelled":
                if entity["attributes"].get("services"):
                    invalid("booking_financial_extras_unsupported")
                if row is None:
                    if verify_cancellation is None:
                        invalid("channel_cancellation_unverified")
                    watermark = verify_cancellation()
                link.cancellation_verified_at = utcnow()
                if row and row.status not in {"CONFIRMED", "CANCELLED"}:
                    invalid("booking_requires_review")
                if row and row.status == "CONFIRMED":
                    if db.session.scalar(
                        select(Charge.id)
                        .where(
                            Charge.tenant_id == tenant_id,
                            Charge.reservation_id == row.id,
                        )
                        .limit(1)
                    ):
                        invalid("booking_requires_review")
                    from ..reconciliation.business_days import ensure_open_day

                    ensure_open_day(tenant_id, row.check_in)
                    rooms = list(
                        db.session.scalars(
                            select(ReservationRoom).where(
                                ReservationRoom.tenant_id == tenant_id,
                                ReservationRoom.reservation_id == row.id,
                                ReservationRoom.active.is_(True),
                            )
                        )
                    )
                    inventory(tenant_id, rooms, row.check_in, row.check_out, -1)
                    for room in rooms:
                        room.active = False
                    row.status, row.cancelled_at = "CANCELLED", utcnow()
                    audit(
                        "reservation.status",
                        "reservation",
                        row.id,
                        {
                            "from": "CONFIRMED",
                            "to": "CANCELLED",
                            "checkIn": row.check_in.isoformat(),
                            "checkOut": row.check_out.isoformat(),
                        },
                    )
                outcome = "cancelled"
            else:
                if not first and link.latest_status == "cancelled":
                    invalid("booking_requires_review")
                revision = normalize(entity, property_id)
                if row and (
                    row.status != "CONFIRMED"
                    or row.currency != revision["currency"]
                    or db.session.scalar(
                        select(Payment.id)
                        .where(Payment.tenant_id == tenant_id, Payment.reservation_id == row.id)
                        .limit(1)
                    )
                    or db.session.scalar(
                        select(Charge.id)
                        .where(Charge.tenant_id == tenant_id, Charge.reservation_id == row.id)
                        .limit(1)
                    )
                ):
                    invalid("booking_requires_review")
                row = apply_stay(tenant_id, revision, row)
                link.reservation_id = row.id
                outcome = "imported"
            if not stale and watermark["insertedAt"] >= link.latest_revision_at:
                link.latest_revision_at = watermark["insertedAt"]
                link.latest_revision_id = watermark["id"]
                link.latest_status = watermark["status"]
            receipt = ChannelRevision(
                tenant_id=tenant_id,
                revision_id=revision["id"],
                booking_id=revision["bookingId"],
                reservation_id=row.id if row else None,
                outcome=outcome,
                money_snapshot=row.pricing_snapshot["channel"] if outcome == "imported" else {},
            )
            db.session.add(receipt)
            db.session.flush()
    except ApiError as error:
        if revision["insertedAt"] > link.latest_revision_at:
            link.latest_revision_at = revision["insertedAt"]
            link.latest_revision_id = revision["id"]
            # An unresolved later update cannot clear an established cancellation.
            if link.latest_status != "cancelled":
                link.latest_status = revision["status"]
        if review is None:
            review = ChannelBookingReview(
                tenant_id=tenant_id,
                revision_id=revision["id"],
                booking_id=revision["bookingId"],
                provider_status=revision["status"],
                revision_at=revision["insertedAt"],
                details=review_details(entity),
            )
            db.session.add(review)
        review.error_code = (
            "room_unavailable"
            if error.code in {"NO_AVAILABILITY", "INVENTORY_CONFLICT"}
            else error.code
        )
        db.session.flush()
        return review
    pending = db.session.scalars(
        select(ChannelBookingReview).where(
            ChannelBookingReview.tenant_id == tenant_id,
            ChannelBookingReview.booking_id == revision["bookingId"],
            ChannelBookingReview.resolved_at.is_(None),
            or_(
                ChannelBookingReview.revision_at < watermark["insertedAt"],
                ChannelBookingReview.revision_id.in_({revision["id"], watermark["id"]}),
            ),
        )
    )
    for pending_review in pending:
        pending_review.resolved_at = utcnow()
        if pending_review.revision_id != receipt.revision_id:
            db.session.add(
                ChannelRevision(
                    tenant_id=tenant_id,
                    revision_id=pending_review.revision_id,
                    booking_id=revision["bookingId"],
                    reservation_id=row.id if row else None,
                    outcome="cancelled"
                    if pending_review.revision_id == watermark["id"]
                    and watermark["status"] == "cancelled"
                    else "stale",
                )
            )
    db.session.flush()
    return receipt


def apply_stay(tenant_id, revision, row):
    from ..reconciliation.business_days import ensure_open_day

    ensure_open_day(tenant_id, min(row.check_in, revision["start"]) if row else revision["start"])
    mappings = {}
    for mapping in db.session.scalars(
        select(ChannelMapping).where(ChannelMapping.tenant_id == tenant_id)
    ):
        for rate_id in [mapping.remote_rate_plan_id, *(mapping.inbound_rate_plan_ids or [])]:
            key = (mapping.remote_room_type_id, rate_id)
            if key in mappings and mappings[key].id != mapping.id:
                invalid("booking_mapping_ambiguous")
            mappings[key] = mapping
    previous_commission = (row.pricing_snapshot or {}).get("commission") if row else None
    if (
        previous_commission
        and "providerAmount" in previous_commission
        and revision["otaCommission"] is None
        and revision["amount"]
        != Decimal((row.pricing_snapshot.get("channel") or {}).get("amount", "-1"))
    ):
        invalid("booking_commission_missing")
    for room in revision["rooms"]:
        mapping = mappings.get((room["typeId"], room["rateId"]))
        if not mapping or (not mapping.active and mapping.used_at is None):
            invalid("booking_unmapped")
        room["localTypeId"] = mapping.room_type_id
        mapping.used_at = mapping.used_at or utcnow()
        from .service import publication_ranges

        mapping.published_ranges = publication_ranges(
            [
                *mapping.published_ranges,
                {"start": revision["start"].isoformat(), "end": revision["end"].isoformat()},
            ]
        )
    kinds = sorted({r["localTypeId"] for r in revision["rooms"]})
    types = {
        r.id: r
        for r in db.session.scalars(
            select(RoomType).where(RoomType.tenant_id == tenant_id, RoomType.id.in_(kinds))
        )
    }
    if any(r["localTypeId"] not in types for r in revision["rooms"]):
        invalid("booking_unmapped")
    if any(not types[r["localTypeId"]].active for r in revision["rooms"]):
        invalid("channel_room_type_inactive")
    if any(r["occupancy"] > types[r["localTypeId"]].capacity for r in revision["rooms"]):
        invalid("invalid_booking_occupancy")
    old_start, old_end = (
        (row.check_in, row.check_out) if row else (revision["start"], revision["end"])
    )
    old_rooms = (
        list(
            db.session.scalars(
                select(ReservationRoom).where(
                    ReservationRoom.tenant_id == tenant_id, ReservationRoom.reservation_id == row.id
                )
            )
        )
        if row
        else []
    )
    candidates = list(
        db.session.scalars(
            select(PhysicalRoom)
            .where(
                PhysicalRoom.tenant_id == tenant_id,
                PhysicalRoom.room_type_id.in_(set(kinds) | {r.room_type_id for r in old_rooms}),
            )
            .order_by(PhysicalRoom.id)
            .with_for_update()
        )
    )
    if any(not any(r.room_type_id == kind and r.active for r in candidates) for kind in kinds):
        invalid("channel_room_inactive")
    lock_inventory(
        tenant_id,
        sorted(set(kinds) | {r.room_type_id for r in old_rooms}),
        min(old_start, revision["start"]),
        max(old_end, revision["end"]),
    )
    blocked = set(
        db.session.scalars(
            select(RoomBlock.room_id).where(
                RoomBlock.tenant_id == tenant_id,
                RoomBlock.start_date < revision["end"],
                RoomBlock.end_date > revision["start"],
            )
        )
    )
    overlaps = select(ReservationRoom.room_id).where(
        ReservationRoom.tenant_id == tenant_id,
        ReservationRoom.active.is_(True),
        ReservationRoom.check_in < revision["end"],
        ReservationRoom.check_out > revision["start"],
    )
    if row:
        overlaps = overlaps.where(ReservationRoom.reservation_id != row.id)
    blocked.update(db.session.scalars(overlaps))
    assigned = []
    for requested in revision["rooms"]:
        chosen = next(
            (
                r
                for r in candidates
                if r.room_type_id == requested["localTypeId"]
                and r.active
                and r.condition != "maintenance"
                and r.id not in blocked
            ),
            None,
        )
        if chosen is None:
            invalid("room_unavailable")
        assigned.append(chosen)
        blocked.add(chosen.id)
    snapshot = snapshot_money(tenant_id, revision["currency"], revision["amount"], source=row)
    pricing = {
        "version": 1,
        "rules": [],
        "discount": None,
        "channel": {
            "provider": "channex",
            "bookingId": revision["bookingId"],
            "revisionId": revision["id"],
            "currency": revision["currency"],
            "amount": str(revision["amount"]),
            "baseCurrency": snapshot["base_currency"],
            "exchangeRate": str(snapshot["exchange_rate"]),
            "baseAmount": str(snapshot["base_amount"]),
            "paymentCollect": revision["paymentCollect"],
            "otaCommission": str(revision["otaCommission"])
            if revision["otaCommission"] is not None
            else None,
            "extras": [{**line, "amount": str(line["amount"])} for line in revision["extras"]],
            "rooms": [
                {
                    "roomTypeId": room["typeId"],
                    "ratePlanId": room["rateId"],
                    "days": {day: str(amount) for day, amount in room["providerPrices"].items()},
                }
                for room in revision["rooms"]
            ],
        },
    }
    if row is None:
        source = db.session.scalar(
            select(Master)
            .where(
                Master.tenant_id == tenant_id,
                Master.catalog == "bookingSources",
                Master.active.is_(True),
                Master.name == revision["source"],
                Master.data["type"].astext == "OTA",
            )
            .with_for_update(read=True)
        )
        if source:
            pricing["commission"] = commission_snapshot(source)
        row = Reservation(
            tenant_id=tenant_id,
            check_in=revision["start"],
            check_out=revision["end"],
            source_name=revision["source"],
            source_id=source.id if source else None,
            currency=revision["currency"],
            pricing_snapshot=pricing,
            guest_name=revision["name"],
            **snapshot,
        )
        db.session.add(row)
        db.session.flush()
    else:
        if (row.pricing_snapshot or {}).get("commission"):
            pricing["commission"] = row.pricing_snapshot["commission"]
        inventory(tenant_id, old_rooms, old_start, old_end, -1)
        for model in (ReservationNight, ReservationRoom):
            db.session.execute(
                delete(model).where(model.tenant_id == tenant_id, model.reservation_id == row.id)
            )
        row.check_in, row.check_out, row.pricing_snapshot, row.base_amount = (
            revision["start"],
            revision["end"],
            pricing,
            snapshot["base_amount"],
        )
    if revision["otaCommission"] is not None:
        pricing = {
            **pricing,
            "commission": {
                **(pricing.get("commission") or {}),
                "providerAmount": str(revision["otaCommission"]),
                "providerRevisionId": revision["id"],
                "basis": "provider_amount",
            },
        }
        row.pricing_snapshot = pricing
    nightly = []
    for physical, requested in zip(assigned, revision["rooms"]):
        for day, price in requested["prices"].items():
            nightly.append(
                {
                    "roomId": physical.id,
                    "room": physical.number,
                    "roomTypeId": physical.room_type_id,
                    "date": day,
                    "price": str(price),
                    "baseAmount": str(
                        snapshot_money(tenant_id, row.currency, price, source=row)["base_amount"]
                    ),
                }
            )
    add_stay(
        row,
        assigned,
        {
            "nightlyRates": nightly,
            "baseCurrency": row.base_currency,
            "exchangeRate": str(row.exchange_rate),
        },
    )
    from pms_api.ports import runtime

    for line in revision["extras"]:
        db.session.add(
            Charge(
                tenant_id=tenant_id,
                reservation_id=row.id,
                description=line["description"],
                kind=line["kind"],
                quantity=1,
                unit_price=line["amount"],
                amount=line["amount"],
                currency=row.currency,
                user_id=runtime().state.user.id,
                **snapshot_money(tenant_id, row.currency, line["amount"], source=row),
            )
        )
    row.base_amount = sum((Decimal(n["baseAmount"]) for n in nightly), Decimal(0)) + sum(
        (
            snapshot_money(tenant_id, row.currency, line["amount"], source=row)["base_amount"]
            for line in revision["extras"]
        ),
        Decimal(0),
    )
    row.pricing_snapshot = {
        **row.pricing_snapshot,
        "channel": {**row.pricing_snapshot["channel"], "baseAmount": str(row.base_amount)},
    }
    inventory(tenant_id, assigned, row.check_in, row.check_out, 1)
    guest = db.session.scalar(
        select(Guest)
        .join(
            ReservationGuest,
            (ReservationGuest.tenant_id == Guest.tenant_id)
            & (ReservationGuest.guest_id == Guest.id),
        )
        .where(
            ReservationGuest.tenant_id == tenant_id,
            ReservationGuest.reservation_id == row.id,
            ReservationGuest.is_primary.is_(True),
        )
    )
    if guest is None or (guest.name, guest.phone, guest.email) != (
        revision["name"],
        revision["phone"],
        revision["email"],
    ):
        guest = Guest(
            tenant_id=tenant_id,
            name=revision["name"],
            phone=revision["phone"],
            email=revision["email"],
        )
        db.session.add(guest)
        db.session.flush()
    # OTA revisions identify the primary guest, not companions entered in the PMS.
    db.session.execute(
        delete(ReservationGuest).where(
            ReservationGuest.tenant_id == tenant_id,
            ReservationGuest.reservation_id == row.id,
            ReservationGuest.is_primary.is_(True),
        )
    )
    db.session.add(
        ReservationGuest(
            tenant_id=tenant_id, reservation_id=row.id, guest_id=guest.id, is_primary=True
        )
    )
    row.guest_name, row.guest_phone = guest.name, guest.phone
    audit(
        "reservation.updated" if old_rooms else "reservation.created",
        "reservation",
        row.id,
        {
            "checkIn": row.check_in.isoformat(),
            "checkOut": row.check_out.isoformat(),
            "oldCheckIn": old_start.isoformat(),
            "oldCheckOut": old_end.isoformat(),
        },
    )
    return row
