"""Preview today's evidence and retain a confirmation without posting or locking money."""

import hmac
from datetime import UTC, timedelta

from flask import g, request
from sqlalchemy import Date, case, cast, func, or_, select

from common import CommonMethodView

from ..bookings.models import LedgerEntry, Reservation, ReservationRoom
from ..bookings.routes import decimal_text, iso, string_value
from ..catalog.models import Master
from ..core_models import utcnow
from ..extensions import db
from ..finance.routes import begin, finish, pagination
from ..reports.routes import financial_data, report_settings
from ..security import ApiError, audit, payload, require_tenant
from .models import DayReconciliation
from .service import day_window, preview_token


def reconciliation_preview(tenant_id, value):
    timezone, currency = report_settings()
    now = utcnow()
    day, start_at, end_at = day_window(value, timezone, now)
    stays = list(
        db.session.scalars(
            select(Reservation)
            .where(
                Reservation.tenant_id == tenant_id,
                or_(
                    (Reservation.status == "CONFIRMED") & (Reservation.check_in <= day),
                    (Reservation.status == "IN_HOUSE") & (Reservation.check_out <= day),
                ),
            )
            .order_by(Reservation.check_in, Reservation.id)
        )
    )
    rooms = {}
    if stays:
        for booking_id, number in db.session.execute(
            select(
                ReservationRoom.reservation_id,
                ReservationRoom.room_number,
            )
            .where(
                ReservationRoom.tenant_id == tenant_id,
                ReservationRoom.reservation_id.in_([row.id for row in stays]),
            )
            .order_by(ReservationRoom.room_number)
        ):
            rooms.setdefault(booking_id, []).append(number)

    def stay_json(row):
        return {
            "id": row.id,
            "guest": row.guest_name,
            "rooms": rooms.get(row.id, []),
            "status": row.status,
            "checkIn": iso(row.check_in),
            "checkOut": iso(row.check_out),
        }

    # Match the cashbook/report business-date rule, including legacy rows without booked_at.
    ledger_date = func.coalesce(
        LedgerEntry.booked_at, cast(func.timezone(timezone, LedgerEntry.created_at), Date)
    )
    funds = list(
        db.session.execute(
            select(
                LedgerEntry.fund_id,
                Master.name,
                LedgerEntry.currency,
                func.sum(case((ledger_date < day, LedgerEntry.amount), else_=0)),
                func.sum(case((ledger_date == day, func.greatest(LedgerEntry.amount, 0)), else_=0)),
                func.sum(
                    case((ledger_date == day, func.greatest(-LedgerEntry.amount, 0)), else_=0)
                ),
                func.sum(LedgerEntry.amount),
            )
            .join(
                Master,
                (Master.tenant_id == LedgerEntry.tenant_id) & (Master.id == LedgerEntry.fund_id),
            )
            .where(LedgerEntry.tenant_id == tenant_id, ledger_date <= day)
            .group_by(LedgerEntry.fund_id, Master.name, LedgerEntry.currency)
            .order_by(Master.name, LedgerEntry.fund_id, LedgerEntry.currency)
        )
    )
    financial = financial_data(tenant_id, day, day + timedelta(days=1), currency, basis="base")
    snapshot = {
        "schemaVersion": 1,
        "date": iso(day),
        "timezone": timezone,
        "currency": currency,
        "periodStart": iso(start_at),
        "periodEndExclusive": iso(end_at),
        "periodLocked": False,
        "arrivals": [stay_json(row) for row in stays if row.status == "CONFIRMED"],
        "departures": [stay_json(row) for row in stays if row.status == "IN_HOUSE"],
        "summary": {
            key: financial["summary"][key]
            for key in (
                "cashReceived",
                "cashRefunded",
                "netReceipts",
                "income",
                "outflow",
                "netCash",
            )
        },
        "funds": [
            {
                "fundId": fund_id,
                "fund": name,
                "currency": native_currency,
                **{
                    key: decimal_text(amount)
                    for key, amount in zip(
                        ("opening", "income", "outflow", "closing"), amounts, strict=True
                    )
                },
            }
            for fund_id, name, native_currency, *amounts in funds
        ],
    }
    return {**snapshot, "generatedAt": iso(now), "previewToken": preview_token(snapshot)}


def confirmation_json(row):
    return {
        "id": row.id,
        "date": iso(row.business_date),
        "timezone": row.timezone,
        "actorId": row.actor_id,
        "actor": row.actor_name,
        "note": row.note,
        "createdAt": iso(row.created_at.astimezone(UTC)),
        "snapshot": row.snapshot,
    }


class PreviewView(CommonMethodView):
    @staticmethod
    @require_tenant("reconciliation.view")
    def dispatch_request(tenant_id):
        return reconciliation_preview(tenant_id, request.args.get("date"))


class ConfirmView(CommonMethodView):
    @staticmethod
    @require_tenant("reconciliation.confirm")
    def dispatch_request(tenant_id):
        data = payload()
        key, fingerprint, replay = begin(tenant_id, data)
        if replay is not None:
            return replay, 201
        token = data.get("previewToken")
        if (
            not isinstance(token, str)
            or len(token) != 64
            or any(c not in "0123456789abcdef" for c in token)
        ):
            raise ApiError(
                422, "preview_required", "Tải bản xem trước trước khi xác nhận đối soát."
            )
        note = string_value(data.get("note", ""), "Ghi chú", 1000)
        snapshot = reconciliation_preview(tenant_id, data.get("date"))
        if not hmac.compare_digest(token, snapshot["previewToken"]):
            raise ApiError(
                409,
                "preview_changed",
                "Dữ liệu đã thay đổi. Tải lại và kiểm tra bản xem trước trước khi xác nhận.",
            )
        row = DayReconciliation(
            tenant_id=tenant_id,
            business_date=day_window(data.get("date"), snapshot["timezone"], utcnow())[0],
            timezone=snapshot["timezone"],
            actor_id=g.user.id,
            actor_name=g.user.name,
            note=note,
            snapshot=snapshot,
        )
        db.session.add(row)
        db.session.flush()
        audit(
            "reconciliation.confirmed",
            "day_reconciliation",
            row.id,
            {"date": iso(row.business_date), "previewToken": token, "periodLocked": False},
        )
        return finish(tenant_id, key, fingerprint, confirmation_json(row))


class HistoryView(CommonMethodView):
    @staticmethod
    @require_tenant("reconciliation.view")
    def dispatch_request(tenant_id):
        timezone, _ = report_settings()
        day, _, _ = day_window(request.args.get("date"), timezone, utcnow())
        page, size = pagination()
        conditions = [
            DayReconciliation.tenant_id == tenant_id,
            DayReconciliation.business_date == day,
        ]
        total = db.session.scalar(
            select(func.count()).select_from(DayReconciliation).where(*conditions)
        )
        rows = db.session.scalars(
            select(DayReconciliation)
            .where(*conditions)
            .order_by(DayReconciliation.created_at.desc(), DayReconciliation.id.desc())
            .offset((page - 1) * size)
            .limit(size)
        )
        return {
            "confirmations": [confirmation_json(row) for row in rows],
            "pagination": {"page": page, "pageSize": size, "totalItems": total},
        }
