"""Normalize an authoritative provider revision, then use canonical stay locks.

Mapped stays preserve room prices and split documented taxes/services exactly.
Ambiguous financials and changes to operational/settled stays remain unacked for
explicit operator reconciliation. Card guarantees and prepaid OTA flags are
never stored as local payments.
"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import delete, or_, select

from ..bookings.models import (
    Charge,
    Guest,
    Payment,
    Reservation,
    ReservationGuest,
    ReservationNight,
    ReservationRoom,
)
from ..bookings.routes import (
    add_stay,
    commission_snapshot,
    inventory,
    money_value,
    stay_dates,
)
from ..catalog.models import Master, PhysicalRoom, RoomBlock, RoomType
from ..catalog.routes import lock_inventory
from ..core_models import utcnow
from ..currencies import is_hotel_currency
from ..extensions import db
from ..pricing.engine import allocate_discount, snapshot_money
from ..security import ApiError, audit
from ..subscriptions import lock_tenant
from .client import ProviderError, remote_id
from .models import ChannelBooking, ChannelBookingReview, ChannelMapping, ChannelRevision


def invalid(code="unsupported_booking"):
    raise ApiError(409, code, "Đặt phòng kênh cần được kiểm tra trước khi xác nhận đồng bộ.")


def identifier(value):
    try:
        return remote_id(value)
    except ProviderError:
        invalid("invalid_booking_revision")


def text(value, length, *, required=False):
    value = "" if value is None else value
    if (
        not isinstance(value, str)
        or len(value) > length
        or (required and not value.strip())
        or any(ord(c) < 32 for c in value)
    ):
        invalid("invalid_booking_revision")
    return value.strip()


def revision_identity(entity, property_id):
    if (
        not isinstance(entity, dict)
        or entity.get("type") != "booking_revision"
        or not isinstance(entity.get("attributes"), dict)
    ):
        invalid("invalid_booking_revision")
    raw = entity["attributes"]
    if (
        raw.get("property_id") != property_id
        or not isinstance(raw.get("status"), str)
        or raw["status"] not in {"new", "modified", "cancelled"}
    ):
        invalid("invalid_booking_revision")
    try:
        inserted = datetime.fromisoformat(raw["inserted_at"].replace("Z", "+00:00"))
        # Channex examples use naive ISO timestamps; their timestamps are UTC.
        inserted = (
            inserted.replace(tzinfo=UTC) if inserted.tzinfo is None else inserted.astimezone(UTC)
        )
    except (KeyError, ValueError, TypeError, AttributeError, OverflowError):
        invalid("invalid_booking_revision")
    return {
        "id": identifier(entity.get("id")),
        "bookingId": identifier(raw.get("booking_id")),
        "status": raw["status"],
        "insertedAt": inserted,
    }


def financial_lines(items, kind):
    """Provider total_price is authoritative; included room taxes are split, not added twice."""
    if items is None:
        items = []
    if not isinstance(items, list) or len(items) > 100:
        invalid("booking_financial_extras_unsupported")
    lines = []
    for item in items:
        if not isinstance(item, dict) or item.get("is_withheld"):
            invalid("booking_financial_extras_unsupported")
        if kind == "tax" and type(item.get("is_inclusive")) is not bool:
            invalid("booking_financial_extras_unsupported")
        try:
            amount = money_value(item.get("total_price"), allow_zero=True)
            description = text(item.get("name"), 200, required=True)
        except ApiError:
            invalid("booking_financial_extras_unsupported")
        lines.append(
            {
                "kind": kind,
                "description": description,
                "amount": amount,
                "included": item["is_inclusive"] if kind == "tax" else False,
            }
        )
    return lines


def normalize(entity, property_id):
    result = revision_identity(entity, property_id)
    raw = entity["attributes"]
    if result["status"] == "cancelled":
        if raw.get("services"):
            invalid("booking_financial_extras_unsupported")
        return result
    start, end = stay_dates(raw.get("arrival_date"), raw.get("departure_date"))
    if not is_hotel_currency(raw.get("currency")):
        invalid("unsupported_booking_currency")
    # Channex documents room taxes; undocumented booking-level/withheld totals need reconciliation.
    if raw.get("taxes") or raw.get("collected_taxes"):
        invalid("booking_financial_extras_unsupported")
    rooms = raw.get("rooms")
    if not isinstance(rooms, list) or not 1 <= len(rooms) <= 20:
        invalid()
    nights = {(start + timedelta(days=i)).isoformat() for i in range((end - start).days)}
    parsed = []
    extras = financial_lines(raw.get("services"), "service")
    for room in rooms:
        if isinstance(room, dict) and room.get("collected_taxes"):
            invalid("booking_financial_extras_unsupported")
        if (
            not isinstance(room, dict)
            or room.get("checkin_date") != start.isoformat()
            or room.get("checkout_date") != end.isoformat()
        ):
            invalid()
        prices = room.get("days")
        if not isinstance(prices, dict) or set(prices) != nights:
            invalid("booking_rates_incomplete")
        prices = {day: money_value(value, allow_zero=True) for day, value in prices.items()}
        if sum(prices.values(), Decimal(0)) != money_value(room.get("amount"), allow_zero=True):
            invalid("booking_amount_mismatch")
        room_extras = financial_lines(room.get("taxes"), "tax") + financial_lines(
            room.get("services"), "service"
        )
        included = sum((line["amount"] for line in room_extras if line["included"]), Decimal(0))
        if included > sum(prices.values(), Decimal(0)):
            invalid("booking_amount_mismatch")
        original_prices = dict(prices)
        prices = dict(zip(prices, allocate_discount(list(prices.values()), included)))
        extras.extend(room_extras)
        occupancy = room.get("occupancy")
        if not isinstance(occupancy, dict) or any(
            isinstance(occupancy.get(k), bool)
            or not isinstance(occupancy.get(k), int)
            or not 0 <= occupancy[k] <= 50
            for k in ("adults", "children", "infants")
        ):
            invalid("invalid_booking_occupancy")
        count = sum(occupancy[k] for k in ("adults", "children", "infants"))
        if count < 1:
            invalid("invalid_booking_occupancy")
        parsed.append(
            {
                "typeId": identifier(room.get("room_type_id")),
                "rateId": identifier(room.get("rate_plan_id")),
                "prices": prices,
                "providerPrices": original_prices,
                "occupancy": count,
            }
        )
    amount = money_value(raw.get("amount"), allow_zero=True)
    if (
        sum((sum(r["prices"].values(), Decimal(0)) for r in parsed), Decimal(0))
        + sum((line["amount"] for line in extras), Decimal(0))
        != amount
    ):
        invalid("booking_amount_mismatch")
    commission = raw.get("ota_commission")
    if commission is not None:
        try:
            commission = money_value(commission, allow_zero=True, limit=amount)
        except ApiError:
            invalid("booking_commission_unsupported")
    customer = raw.get("customer")
    if not isinstance(customer, dict):
        invalid("invalid_booking_revision")
    name = text(
        " ".join(
            filter(None, [text(customer.get("name"), 160), text(customer.get("surname"), 160)])
        ),
        160,
        required=True,
    )
    payment_collect = raw.get("payment_collect")
    if payment_collect is not None and (
        not isinstance(payment_collect, str) or payment_collect not in {"property", "ota"}
    ):
        invalid("invalid_booking_revision")
    result.update(
        start=start,
        end=end,
        rooms=parsed,
        extras=extras,
        amount=amount,
        currency=raw["currency"],
        name=name,
        phone=text(customer.get("phone"), 40),
        email=text(customer.get("mail"), 254),
        source=text(raw.get("ota_name"), 160, required=True),
        paymentCollect=payment_collect,
        otaCommission=commission,
    )
    return result


def review_details(entity):
    """Retain bounded reconciliation fields, never guarantees or arbitrary provider data."""
    raw = entity["attributes"]

    def value(item, length):
        return "".join(c for c in item[:length] if ord(c) >= 32) if isinstance(item, str) else None

    details = {
        key: value(raw.get(source), limit)
        for key, source, limit in (
            ("source", "ota_name", 160),
            ("bookingCode", "unique_id", 160),
            ("arrivalDate", "arrival_date", 10),
            ("departureDate", "departure_date", 10),
            ("currency", "currency", 3),
            ("amount", "amount", 48),
            ("otaCommission", "ota_commission", 48),
        )
    }
    details["hasTaxes"] = bool(raw.get("taxes"))
    details["hasCollectedTaxes"] = bool(raw.get("collected_taxes"))
    details["paymentCollect"] = value(raw.get("payment_collect"), 20)

    def extras(items):
        return (
            [
                {
                    "name": value(line.get("name"), 200),
                    "totalPrice": value(line.get("total_price"), 48),
                    "type": value(line.get("type"), 80),
                    "included": line.get("is_inclusive") is True,
                    "withheld": line.get("is_withheld") is True,
                }
                for line in items[:100]
                if isinstance(line, dict)
            ]
            if isinstance(items, list)
            else []
        )

    details["services"] = extras(raw.get("services"))
    details["taxes"] = extras(raw.get("taxes"))
    details["collectedTaxes"] = extras(raw.get("collected_taxes"))
    details["rooms"] = []
    raw_rooms = raw.get("rooms")
    for room in raw_rooms[:20] if isinstance(raw_rooms, list) else []:
        if not isinstance(room, dict):
            continue
        occupancy = room.get("occupancy")
        details["rooms"].append(
            {
                "roomTypeId": value(room.get("room_type_id"), 36),
                "ratePlanId": value(room.get("rate_plan_id"), 36),
                "amount": value(room.get("amount"), 48),
                "hasTaxes": bool(room.get("taxes")),
                "hasCollectedTaxes": bool(room.get("collected_taxes")),
                "taxes": extras(room.get("taxes")),
                "collectedTaxes": extras(room.get("collected_taxes")),
                "services": extras(room.get("services")),
                "days": {
                    day: value(amount, 48)
                    for day, amount in list(room["days"].items())[:366]
                    if isinstance(day, str) and len(day) == 10
                }
                if isinstance(room.get("days"), dict)
                else {},
                "occupancy": {
                    key: occupancy.get(key)
                    for key in ("adults", "children", "infants")
                    if isinstance(occupancy, dict)
                    and type(occupancy.get(key)) is int
                    and 0 <= occupancy[key] <= 50
                },
            }
        )
    return details


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
    from flask import g

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
                user_id=g.user.id,
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
