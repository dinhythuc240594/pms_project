"""Immutable daily revenue posting and tenant-scoped closed-period boundaries."""

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import func, select

from pms_api.bookings.application import decimal_text, iso
from pms_api.ports import runtime

from ..bookings.models import Charge, Reservation, ReservationNight
from ..core_models import utcnow
from ..extensions import db
from ..finance.models import PosInvoice
from ..security import ApiError
from .models import NightAudit, RevenueRecognition
from .service import preview_token


def last_closed_day(tenant_id):
    return db.session.scalar(
        select(func.max(NightAudit.business_date)).where(NightAudit.tenant_id == tenant_id)
    )


def ensure_open_day(tenant_id, day):
    if isinstance(day, str):
        day = date.fromisoformat(day)
    closed = last_closed_day(tenant_id)
    if closed and day <= closed:
        raise ApiError(
            409,
            "period_closed",
            "Ngày đã chốt; ghi điều chỉnh vào ngày đang mở.",
            {"lastClosedDay": iso(closed)},
        )
    return day


def posting_date(tenant_id, requested=None):
    today = (
        utcnow()
        .astimezone(ZoneInfo(runtime().state.tenant.settings.get("timezone", "Asia/Ho_Chi_Minh")))
        .date()
    )
    return ensure_open_day(tenant_id, requested if requested is not None else today)


def recognition_changes(tenant_id, day, timezone):
    zone = ZoneInfo(timezone)
    start = (
        db.session.scalar(
            select(func.min(NightAudit.business_date)).where(NightAudit.tenant_id == tenant_id)
        )
        or day
    )
    targets = {}

    def add(kind, row, amount, source_day, **details):
        targets[kind, row.id] = {
            "sourceKind": kind,
            "sourceId": row.id,
            "sourceDate": iso(source_day),
            "amount": decimal_text(amount),
            "currency": details.pop("currency", getattr(row, "currency", None)),
            "baseAmount": decimal_text(row.base_amount if amount else Decimal(0)),
            "baseCurrency": row.base_currency,
            "details": details,
        }

    for night, booking in db.session.execute(
        select(ReservationNight, Reservation)
        .join(
            Reservation,
            (Reservation.tenant_id == ReservationNight.tenant_id)
            & (Reservation.id == ReservationNight.reservation_id),
        )
        .where(
            ReservationNight.tenant_id == tenant_id,
            ReservationNight.date >= start,
            ReservationNight.date <= day,
            Reservation.status.in_(["IN_HOUSE", "CHECKED_OUT"]),
        )
    ):
        add(
            "room",
            night,
            night.price,
            night.date,
            currency=booking.currency,
            bookingId=booking.id,
            room=night.room_number,
        )
    for charge, booking in db.session.execute(
        select(Charge, Reservation)
        .join(
            Reservation,
            (Reservation.tenant_id == Charge.tenant_id) & (Reservation.id == Charge.reservation_id),
        )
        .where(Charge.tenant_id == tenant_id, Reservation.status != "CONFIRMED")
    ):
        source_day = charge.created_at.astimezone(zone).date()
        if start <= source_day <= day:
            add("charge", charge, charge.amount, source_day, bookingId=booking.id, type=charge.kind)
    for invoice in db.session.scalars(
        select(PosInvoice).where(
            PosInvoice.tenant_id == tenant_id,
            PosInvoice.reservation_id.is_(None),
            PosInvoice.posted_at.is_not(None),
        )
    ):
        source_day = invoice.posted_at.astimezone(zone).date()
        if start <= source_day <= day:
            cancelled = invoice.cancelled_at and invoice.cancelled_at.astimezone(zone).date() <= day
            add("pos", invoice, Decimal(0) if cancelled else invoice.total, source_day)
    posted = defaultdict(lambda: [Decimal(0), Decimal(0)])
    for entry in db.session.scalars(
        select(RevenueRecognition).where(RevenueRecognition.tenant_id == tenant_id)
    ):
        key = entry.source_kind, entry.source_id
        posted[key][0] += entry.amount
        posted[key][1] += entry.base_amount
        targets.setdefault(
            key,
            {
                "sourceKind": entry.source_kind,
                "sourceId": entry.source_id,
                "sourceDate": iso(entry.source_date),
                "amount": "0",
                "currency": entry.currency,
                "baseAmount": "0",
                "baseCurrency": entry.base_currency,
                "details": entry.details,
            },
        )
    changes = []
    for key, target in sorted(targets.items()):
        original, base = Decimal(target["amount"]), Decimal(target["baseAmount"])
        amount, base_amount = original - posted[key][0], base - posted[key][1]
        if amount or base_amount:
            changes.append(
                {
                    **target,
                    "amount": decimal_text(amount),
                    "baseAmount": decimal_text(base_amount),
                    "adjustment": bool(posted[key][0] or posted[key][1]),
                }
            )
    return changes


def night_audit_preview(tenant_id, value):
    timezone = runtime().state.tenant.settings.get("timezone", "Asia/Ho_Chi_Minh")
    try:
        day = date.fromisoformat(value)
    except TypeError, ValueError:
        raise ApiError(422, "invalid_dates", "Chọn ngày chốt hợp lệ.") from None
    today = utcnow().astimezone(ZoneInfo(timezone)).date()
    if day >= today:
        raise ApiError(422, "day_not_finished", "Chỉ chốt ngày đã kết thúc theo múi giờ khách sạn.")
    previous = last_closed_day(tenant_id)
    existing = db.session.scalar(
        select(NightAudit).where(NightAudit.tenant_id == tenant_id, NightAudit.business_date == day)
    )
    if existing:
        return {**existing.snapshot, "periodLocked": True, "auditId": existing.id}
    if previous and day != previous + timedelta(days=1):
        raise ApiError(
            409,
            "audit_sequence",
            "Chốt lần lượt từng ngày sau ngày đã chốt gần nhất.",
            {"nextDate": iso(previous + timedelta(days=1))},
        )
    blockers = [
        {"bookingId": row.id, "guest": row.guest_name, "status": row.status}
        for row in db.session.scalars(
            select(Reservation)
            .where(
                Reservation.tenant_id == tenant_id,
                ((Reservation.status == "CONFIRMED") & (Reservation.check_in <= day))
                | ((Reservation.status == "IN_HOUSE") & (Reservation.check_out <= day)),
            )
            .order_by(Reservation.id)
        )
    ]
    from ..channels.models import ChannelBookingReview

    blockers += [
        {"reviewId": row.id, "status": "OTA_REVIEW"}
        for row in db.session.scalars(
            select(ChannelBookingReview)
            .where(
                ChannelBookingReview.tenant_id == tenant_id,
                ChannelBookingReview.resolved_at.is_(None),
            )
            .order_by(ChannelBookingReview.id)
        )
    ]
    entries = recognition_changes(tenant_id, day, timezone)
    grouped = defaultdict(lambda: [Decimal(0), Decimal(0)])
    for entry in entries:
        group = grouped[entry["currency"], entry["baseCurrency"]]
        group[0] += Decimal(entry["amount"])
        group[1] += Decimal(entry["baseAmount"])
    result = {
        "date": iso(day),
        "timezone": timezone,
        "lastClosedDay": iso(previous),
        "recognitionStart": iso(
            db.session.scalar(
                select(func.min(NightAudit.business_date)).where(NightAudit.tenant_id == tenant_id)
            )
            or day
        ),
        "periodLocked": False,
        "blockers": blockers,
        "entries": entries,
        "totals": [
            {
                "currency": currency,
                "baseCurrency": base,
                "amount": decimal_text(values[0]),
                "baseAmount": decimal_text(values[1]),
            }
            for (currency, base), values in sorted(grouped.items())
        ],
    }
    return {**result, "previewToken": preview_token(result)}
