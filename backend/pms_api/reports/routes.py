"""Tenant reports separate room forecasts, closed bills and actual cash movements."""

from collections import defaultdict
from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from flask import g, request
from sqlalchemy import Date, case, cast, func, or_, select

from common import CommonMethodView, RequestData

from ..bookings.models import (
    Charge,
    Guest,
    LedgerEntry,
    Payment,
    Refund,
    Reservation,
    ReservationGuest,
    ReservationNight,
    ReservationRoom,
)
from ..bookings.routes import decimal_text, iso, stay_dates
from ..catalog.models import PhysicalRoom, RoomType
from ..core_models import utcnow
from ..currencies import is_hotel_currency
from ..extensions import db
from ..finance.models import PosInvoice, PosPayment, PosRefund
from ..finance.routes import parse_date
from ..security import ROLE_ACTIONS, ApiError, require_tenant
from ..subscriptions import feature_enabled

ZERO = Decimal(0)
MONEY_FIELDS = (
    "recognizedRevenue",
    "forecastRoomRevenue",
    "roomRevenue",
    "adr",
    "realizedRevenue",
    "cashReceived",
    "cashRefunded",
    "netReceipts",
    "income",
    "outflow",
    "netCash",
    "opening",
    "closing",
)
REPORT_DEFINITION_KEYS = (
    "period",
    "forecastRoomRevenue",
    "roomRevenue",
    "adr",
    "realizedRevenue",
    "netReceipts",
    "cashbook",
    "snapshot",
    "capacity",
)


def report_definition(key):
    return f"i18n:reports.definitions.{key}"


def report_settings():
    settings = g.tenant.settings or {}
    return settings.get("timezone", "Asia/Ho_Chi_Minh"), settings.get("currency", "VND")


def report_currency():
    currency = request.args.get("currency", report_settings()[1])
    if not is_hotel_currency(currency):
        raise ApiError(422, "invalid_currency", "Loại tiền tệ không hợp lệ.")
    return currency


def report_basis():
    basis = request.args.get("basis", "original")
    if basis not in {"original", "base"}:
        raise ApiError(422, "invalid_basis", "Cơ sở tiền tệ phải là original hoặc base.")
    return basis


def report_definitions(basis):
    return {
        **{key: report_definition(key) for key in REPORT_DEFINITION_KEYS},
        "moneyBasis": report_definition(
            "moneyBasisOriginal" if basis == "original" else "moneyBasisBase"
        ),
    }


def money_amount(model, original, basis):
    return model.base_amount if basis == "base" else original


def money_currency(model, basis):
    return model.base_currency if basis == "base" else model.currency


def report_period():
    return stay_dates(*RequestData.date_range())


def ratio(amount, count):
    return (amount / count).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP) if count else ZERO


def sum_by_booking(model, amount, tenant_id, ids, *, basis="original", currency=None):
    if not ids:
        return {}
    scope = [model.tenant_id == tenant_id, model.reservation_id.in_(ids)]
    if basis == "base" and currency:
        scope.append(model.base_currency == currency)
    return dict(
        db.session.execute(
            select(model.reservation_id, func.sum(money_amount(model, amount, basis)))
            .where(*scope)
            .group_by(model.reservation_id)
        ).all()
    )


def booking_balances(tenant_id, bookings, *, basis="original", currency=None):
    """Batch the canonical bookings.totals formula, without a query per booking."""
    ids = [row.id for row in bookings]
    scope = {"basis": basis, "currency": currency}
    room = sum_by_booking(ReservationNight, ReservationNight.price, tenant_id, ids, **scope)
    extra = sum_by_booking(Charge, Charge.amount, tenant_id, ids, **scope)
    paid = sum_by_booking(Payment, Payment.amount, tenant_id, ids, **scope)
    refunds = sum_by_booking(Refund, Refund.amount, tenant_id, ids, **scope)
    return {
        row.id: (
            room.get(row.id, ZERO) + extra.get(row.id, ZERO),
            paid.get(row.id, ZERO) - refunds.get(row.id, ZERO),
        )
        for row in bookings
    }


def nightly_groups(tenant_id, start, end, currency=None, *, basis="original"):
    conditions = [
        ReservationNight.tenant_id == tenant_id,
        Reservation.tenant_id == tenant_id,
        ReservationNight.date >= start,
        ReservationNight.date < end,
        Reservation.status.not_in(("CANCELLED", "NO_SHOW")),
    ]
    if currency:
        conditions.append(
            (ReservationNight.base_currency if basis == "base" else Reservation.currency)
            == currency
        )
    return db.session.execute(
        select(
            ReservationNight.date,
            Reservation.status,
            func.sum(money_amount(ReservationNight, ReservationNight.price, basis)),
            func.count(ReservationNight.id),
        )
        .join(Reservation, Reservation.id == ReservationNight.reservation_id)
        .where(*conditions)
        .group_by(ReservationNight.date, Reservation.status)
    ).all()


def financial_data(tenant_id, start, end, currency, *, basis="original"):
    timezone, _ = report_settings()
    zone, now = ZoneInfo(timezone), utcnow()
    today = now.astimezone(zone).date()
    start_at = datetime.combine(start, datetime.min.time(), tzinfo=zone)
    end_at = datetime.combine(end, datetime.min.time(), tzinfo=zone)
    days = {
        start + timedelta(days=i): {**dict.fromkeys(MONEY_FIELDS, ZERO), "servedNights": 0}
        for i in range((end - start).days)
    }
    for day, status, amount, count in nightly_groups(tenant_id, start, end, currency, basis=basis):
        days[day]["forecastRoomRevenue"] += amount
        if status in {"IN_HOUSE", "CHECKED_OUT"} and day < today:
            days[day]["roomRevenue"] += amount
            days[day]["servedNights"] += count

    from ..reconciliation.models import RevenueRecognition

    for business_day, amount in db.session.execute(
        select(
            RevenueRecognition.business_date,
            func.sum(
                RevenueRecognition.base_amount if basis == "base" else RevenueRecognition.amount
            ),
        )
        .where(
            RevenueRecognition.tenant_id == tenant_id,
            RevenueRecognition.business_date >= start,
            RevenueRecognition.business_date < end,
            (RevenueRecognition.base_currency if basis == "base" else RevenueRecognition.currency)
            == currency,
        )
        .group_by(RevenueRecognition.business_date)
    ):
        days[business_day]["recognizedRevenue"] += amount

    closed = list(
        db.session.scalars(
            select(Reservation).where(
                Reservation.tenant_id == tenant_id,
                money_currency(Reservation, basis) == currency,
                Reservation.status == "CHECKED_OUT",
                Reservation.checked_out_at >= start_at,
                Reservation.checked_out_at < end_at,
            )
        )
    )
    closed_ids = [row.id for row in closed]
    room_totals = sum_by_booking(
        ReservationNight,
        ReservationNight.price,
        tenant_id,
        closed_ids,
        basis=basis,
        currency=currency,
    )
    extras = (
        dict(
            db.session.execute(
                select(Charge.reservation_id, func.sum(money_amount(Charge, Charge.amount, basis)))
                .join(Reservation, Reservation.id == Charge.reservation_id)
                .where(
                    Charge.tenant_id == tenant_id,
                    Reservation.tenant_id == tenant_id,
                    money_currency(Charge, basis) == currency,
                    Charge.reservation_id.in_(closed_ids),
                    Charge.created_at <= Reservation.checked_out_at,
                )
                .group_by(Charge.reservation_id)
            ).all()
        )
        if closed_ids
        else {}
    )
    for row in closed:
        day = row.checked_out_at.astimezone(zone).date()
        days[day]["realizedRevenue"] += room_totals.get(row.id, ZERO) + extras.get(row.id, ZERO)
    # Later credit/debit records remain in their own posting period; a correction
    # must not silently rewrite the original closed-bill reporting period.
    corrections = db.session.scalars(
        select(Charge)
        .join(
            Reservation,
            Reservation.id == Charge.reservation_id,
        )
        .where(
            Charge.tenant_id == tenant_id,
            Reservation.tenant_id == tenant_id,
            money_currency(Charge, basis) == currency,
            Reservation.status == "CHECKED_OUT",
            Charge.created_at > Reservation.checked_out_at,
            Charge.created_at >= start_at,
            Charge.created_at < end_at,
        )
    )
    for charge in corrections:
        days[charge.created_at.astimezone(zone).date()]["realizedRevenue"] += (
            charge.base_amount if basis == "base" else charge.amount
        )

    retail = db.session.scalars(
        select(PosInvoice).where(
            PosInvoice.tenant_id == tenant_id,
            money_currency(PosInvoice, basis) == currency,
            PosInvoice.reservation_id.is_(None),
            PosInvoice.status.in_(("POSTED", "CANCELLED")),
            or_(
                PosInvoice.posted_at.between(start_at, end_at),
                PosInvoice.cancelled_at.between(start_at, end_at),
            ),
        )
    )
    for row in retail:
        for timestamp, sign in ((row.posted_at, 1), (row.cancelled_at, -1)):
            if timestamp:
                day = timestamp.astimezone(zone).date()
                if day in days:
                    days[day]["realizedRevenue"] += sign * (
                        row.base_amount if basis == "base" else row.total
                    )

    ledger_date = func.coalesce(
        LedgerEntry.booked_at, cast(func.timezone(timezone, LedgerEntry.created_at), Date)
    )
    ledger_scope = [
        LedgerEntry.tenant_id == tenant_id,
        money_currency(LedgerEntry, basis) == currency,
    ]
    ledger_amount = money_amount(LedgerEntry, LedgerEntry.amount, basis)
    opening = Decimal(
        db.session.scalar(
            select(func.coalesce(func.sum(ledger_amount), 0)).where(
                *ledger_scope,
                ledger_date < start,
            )
        )
    )
    ledger_groups = db.session.execute(
        select(
            ledger_date,
            LedgerEntry.kind,
            func.sum(ledger_amount),
            func.sum(func.greatest(ledger_amount, 0)),
            func.sum(func.greatest(-ledger_amount, 0)),
        )
        .where(*ledger_scope, ledger_date >= start, ledger_date < end)
        .group_by(ledger_date, LedgerEntry.kind)
    )
    for day, kind, amount, income, outflow in ledger_groups:
        daily = days[day]
        daily["income"] += income
        daily["outflow"] += outflow
        if kind in {"payment", "pos_payment"}:
            daily["cashReceived"] += amount
        elif kind in {"refund", "pos_refund"}:
            daily["cashRefunded"] -= amount
    balance = opening
    for daily in days.values():
        daily["opening"] = balance
        daily["netCash"] = daily["income"] - daily["outflow"]
        daily["netReceipts"] = daily["cashReceived"] - daily["cashRefunded"]
        daily["adr"] = ratio(daily["roomRevenue"], daily["servedNights"])
        balance += daily["netCash"]
        daily["closing"] = balance

    totals = {key: sum((row[key] for row in days.values()), ZERO) for key in MONEY_FIELDS}
    totals["servedNights"] = sum(row["servedNights"] for row in days.values())
    totals.update(
        opening=opening, closing=balance, adr=ratio(totals["roomRevenue"], totals["servedNights"])
    )
    active = list(
        db.session.scalars(
            select(Reservation).where(
                Reservation.tenant_id == tenant_id,
                money_currency(Reservation, basis) == currency,
                Reservation.status.in_(("CONFIRMED", "IN_HOUSE")),
            )
        )
    )
    balances = booking_balances(tenant_id, active, basis=basis, currency=currency)
    deposits = sum(
        (max(balances[row.id][1], ZERO) for row in active if row.status == "CONFIRMED"), ZERO
    )
    debt = sum((max(total - paid, ZERO) for total, paid in balances.values()), ZERO)
    posted_retail = list(
        db.session.scalars(
            select(PosInvoice).where(
                PosInvoice.tenant_id == tenant_id,
                money_currency(PosInvoice, basis) == currency,
                PosInvoice.status == "POSTED",
                PosInvoice.reservation_id.is_(None),
            )
        )
    )
    ids = [row.id for row in posted_retail]
    paid, refunds = {}, {}
    if ids:
        for model, destination in ((PosPayment, paid), (PosRefund, refunds)):
            destination.update(
                db.session.execute(
                    select(model.invoice_id, func.sum(money_amount(model, model.amount, basis)))
                    .where(
                        model.tenant_id == tenant_id,
                        money_currency(model, basis) == currency,
                        model.invoice_id.in_(ids),
                    )
                    .group_by(model.invoice_id)
                ).all()
            )
    debt += sum(
        (
            max(
                (row.base_amount if basis == "base" else row.total)
                - paid.get(row.id, ZERO)
                + refunds.get(row.id, ZERO),
                ZERO,
            )
            for row in posted_retail
        ),
        ZERO,
    )

    def output(row):
        return {
            key: decimal_text(value) if key in MONEY_FIELDS else value for key, value in row.items()
        }

    return {
        "start": iso(start),
        "end": iso(end),
        "currency": currency,
        "basis": basis,
        "timezone": timezone,
        "asOf": iso(now),
        "summary": output(totals),
        "snapshot": {
            "asOf": iso(now),
            "deposits": decimal_text(deposits),
            "debt": decimal_text(debt),
        },
        "rows": [{"date": iso(day), **output(daily)} for day, daily in days.items()],
        "definitions": report_definitions(basis),
    }


class DashboardView(CommonMethodView):
    @staticmethod
    @require_tenant("dashboard.view")
    def dispatch_request(tenant_id):
        day = parse_date(request.args.get("date"))
        timezone, currency = report_settings()
        now = utcnow()
        rooms = list(
            db.session.scalars(
                select(PhysicalRoom)
                .where(
                    PhysicalRoom.tenant_id == tenant_id,
                    PhysicalRoom.active.is_(True),
                )
                .order_by(PhysicalRoom.number)
            )
        )
        bookings = list(
            db.session.scalars(
                select(Reservation)
                .where(
                    Reservation.tenant_id == tenant_id,
                    or_(
                        Reservation.status == "IN_HOUSE",
                        (Reservation.status == "CONFIRMED") & (Reservation.check_in == day),
                    ),
                )
                .order_by(Reservation.check_in, Reservation.id)
            )
        )
        ids = [row.id for row in bookings]
        linked = (
            list(
                db.session.scalars(
                    select(ReservationRoom).where(
                        ReservationRoom.tenant_id == tenant_id,
                        ReservationRoom.reservation_id.in_(ids),
                        ReservationRoom.active.is_(True),
                    )
                )
            )
            if ids
            else []
        )
        room_numbers = defaultdict(list)
        for room in linked:
            room_numbers[room.reservation_id].append(room.room_number)
        can_finance = feature_enabled("REPORTS_BASIC") and (
            g.role == "HOTEL_OWNER" or "reports.view" in ROLE_ACTIONS.get(g.role, set())
        )
        balances = booking_balances(tenant_id, bookings) if can_finance else {}

        def booking_output(row):
            result = {
                "id": row.id,
                "guest": row.guest_name,
                "rooms": sorted(room_numbers[row.id]),
                "checkIn": iso(row.check_in),
                "checkOut": iso(row.check_out),
                "currency": row.currency,
                "status": row.status,
            }
            if can_finance:
                total, paid = balances[row.id]
                result["balance"] = decimal_text(total - paid)
            return result

        arrivals = [row for row in bookings if row.status == "CONFIRMED"]
        departures = [row for row in bookings if row.status == "IN_HOUSE" and row.check_out == day]
        overdue = [row for row in bookings if row.status == "IN_HOUSE" and row.check_out < day]
        in_house = {row.id for row in bookings if row.status == "IN_HOUSE"}
        occupied = len({room.room_id for room in linked if room.reservation_id in in_house})
        capacity = len(rooms)
        chart_start = day - timedelta(days=6)
        chart = {chart_start + timedelta(days=i): {"occupied": 0, "reserved": 0} for i in range(7)}
        today = now.astimezone(ZoneInfo(timezone)).date()
        for night_day, status, _, count in nightly_groups(
            tenant_id, chart_start, day + timedelta(days=1)
        ):
            chart[night_day]["reserved"] += count
            if status in {"IN_HOUSE", "CHECKED_OUT"} and night_day < today:
                chart[night_day]["occupied"] += count
        if today in chart:
            chart[today]["occupied"] = occupied
        financial = (
            financial_data(tenant_id, chart_start, day + timedelta(days=1), currency, basis="base")
            if can_finance
            else None
        )
        financial_days = {row["date"]: row for row in financial["rows"]} if financial else {}
        chart_output = []
        for chart_day, values in chart.items():
            item = {
                "date": iso(chart_day),
                **values,
                "capacity": capacity,
                "occupancy": decimal_text(ratio(Decimal(values["occupied"]) * 100, capacity)),
            }
            if can_finance:
                daily = financial_days[iso(chart_day)]
                item.update(
                    roomRevenue=daily["roomRevenue"], realizedRevenue=daily["realizedRevenue"]
                )
            chart_output.append(item)
        return {
            "date": iso(day),
            "asOf": iso(now),
            "timezone": timezone,
            "currency": currency,
            "arriving": sum(len(room_numbers[row.id]) for row in arrivals),
            "departing": sum(len(room_numbers[row.id]) for row in departures),
            "occupied": occupied,
            "activeRooms": capacity,
            "occupancy": decimal_text(ratio(Decimal(occupied) * 100, capacity)),
            "arrivalBookings": [booking_output(row) for row in arrivals],
            "departureBookings": [booking_output(row) for row in departures],
            "alerts": {
                "dirtyRooms": [
                    {"id": room.id, "number": room.number, "condition": room.condition}
                    for room in rooms
                    if room.condition == "dirty"
                ],
                "inspectionRooms": [
                    {"id": room.id, "number": room.number, "condition": room.condition}
                    for room in rooms
                    if room.condition == "inspection"
                ],
                "overdueDepartures": [booking_output(row) for row in overdue],
                "pendingArrivals": [booking_output(row) for row in arrivals],
            },
            "chart": chart_output,
            "financial": {
                "summary": financial_days[iso(day)],
                "snapshot": financial["snapshot"],
                "basis": financial["basis"],
                "currency": financial["currency"],
                "definitions": financial["definitions"],
            }
            if financial
            else None,
        }


class RevenueReportView(CommonMethodView):
    @staticmethod
    @require_tenant("reports.view")
    def dispatch_request(tenant_id):
        start, end = report_period()
        currency = report_currency()
        basis = report_basis()
        by_day = defaultdict(lambda: {"amount": ZERO, "reserved": 0, "nights": 0})
        for day, _, amount, count in nightly_groups(tenant_id, start, end, currency, basis=basis):
            by_day[day]["amount"] += amount
            by_day[day]["reserved"] += count
            by_day[day]["nights"] += count
        reserved_rooms = dict(
            db.session.execute(
                select(ReservationNight.date, func.count(func.distinct(ReservationNight.room_id)))
                .join(Reservation, Reservation.id == ReservationNight.reservation_id)
                .where(
                    ReservationNight.tenant_id == tenant_id,
                    Reservation.tenant_id == tenant_id,
                    ReservationNight.date >= start,
                    ReservationNight.date < end,
                    Reservation.status.not_in(("CANCELLED", "NO_SHOW")),
                )
                .group_by(ReservationNight.date)
            ).all()
        )
        rows = []
        for offset in range((end - start).days):
            day = start + timedelta(days=offset)
            daily = by_day[day]
            rows.append(
                {
                    "date": iso(day),
                    **daily,
                    "amount": decimal_text(daily["amount"]),
                    "reservedRooms": reserved_rooms.get(day, 0),
                }
            )
        return {
            "rows": rows,
            "currency": currency,
            "basis": basis,
            "start": iso(start),
            "end": iso(end),
            "definitions": report_definitions(basis),
        }


class FinancialReportView(CommonMethodView):
    @staticmethod
    @require_tenant("reports.view")
    def dispatch_request(tenant_id):
        start, end = report_period()
        return financial_data(tenant_id, start, end, report_currency(), basis=report_basis())


class BusinessReportView(CommonMethodView):
    @staticmethod
    @require_tenant("reports.advanced.view")
    def dispatch_request(tenant_id):
        report = request.args.get("report", "source")
        if report not in {
            "source",
            "room",
            "roomType",
            "cancellations",
            "nationality",
            "discounts",
        }:
            raise ApiError(422, "invalid_report", "Loại báo cáo không hợp lệ.")
        start, end = report_period()
        currency, basis = report_currency(), report_basis()
        timezone, _ = report_settings()
        now, zone = utcnow(), ZoneInfo(timezone)
        today = now.astimezone(zone).date()
        start_at = datetime.combine(start, datetime.min.time(), tzinfo=zone)
        end_at = datetime.combine(end, datetime.min.time(), tzinfo=zone)
        rows = []
        money_fields = set()
        counts = set()
        definitions = report_definitions(basis)

        if report in {"source", "room", "roomType"}:
            amount = money_amount(ReservationNight, ReservationNight.price, basis)
            served = (Reservation.status.in_(("IN_HOUSE", "CHECKED_OUT"))) & (
                ReservationNight.date < today
            )
            identity, label = Reservation.source_id, Reservation.source_name
            if report == "room":
                identity, label = ReservationNight.room_id, ReservationNight.room_number
            elif report == "roomType":
                identity, label = ReservationNight.room_type_id, RoomType.name
                definitions["roomType"] = report_definition("roomType")
            statement = (
                select(
                    identity.label("id"),
                    label.label("label"),
                    func.count(func.distinct(Reservation.id)).label("bookings"),
                    func.count(ReservationNight.id).label("nights"),
                    func.sum(case((served, 1), else_=0)).label("servedNights"),
                    func.sum(amount).label("forecastRoomRevenue"),
                    func.sum(case((served, amount), else_=ZERO)).label("roomRevenue"),
                )
                .select_from(ReservationNight)
                .join(
                    Reservation,
                    (Reservation.id == ReservationNight.reservation_id)
                    & (Reservation.tenant_id == tenant_id),
                )
                .where(
                    ReservationNight.tenant_id == tenant_id,
                    ReservationNight.date >= start,
                    ReservationNight.date < end,
                    Reservation.status.not_in(("CANCELLED", "NO_SHOW")),
                    (ReservationNight.base_currency if basis == "base" else Reservation.currency)
                    == currency,
                )
            )
            if report == "roomType":
                statement = statement.join(
                    RoomType,
                    (RoomType.id == ReservationNight.room_type_id)
                    & (RoomType.tenant_id == tenant_id),
                )
            rows = [
                dict(row)
                for row in db.session.execute(
                    statement.group_by(identity, label).order_by(label, identity)
                ).mappings()
            ]
            money_fields = {"forecastRoomRevenue", "roomRevenue"}
            counts = {"bookings", "nights", "servedNights"}
            definitions["bookings"] = report_definition("bookings")
        elif report == "cancellations":
            cancelled_day = cast(func.timezone(timezone, Reservation.cancelled_at), Date)
            rows = [
                dict(row)
                for row in db.session.execute(
                    select(
                        cancelled_day.label("date"),
                        Reservation.source_name.label("source"),
                        func.count(func.distinct(Reservation.id)).label("bookings"),
                        func.count(ReservationNight.id).label("nights"),
                        func.coalesce(
                            func.sum(money_amount(ReservationNight, ReservationNight.price, basis)),
                            ZERO,
                        ).label("cancelledRoomValue"),
                    )
                    .select_from(Reservation)
                    .outerjoin(
                        ReservationNight,
                        (ReservationNight.reservation_id == Reservation.id)
                        & (ReservationNight.tenant_id == tenant_id),
                    )
                    .where(
                        Reservation.tenant_id == tenant_id,
                        Reservation.status == "CANCELLED",
                        Reservation.cancelled_at >= start_at,
                        Reservation.cancelled_at < end_at,
                        money_currency(Reservation, basis) == currency,
                    )
                    .group_by(cancelled_day, Reservation.source_name)
                    .order_by(cancelled_day, Reservation.source_name)
                ).mappings()
            ]
            for row in rows:
                row["date"] = iso(row["date"])
            money_fields = {"cancelledRoomValue"}
            counts = {"bookings", "nights"}
            definitions["cancellations"] = report_definition("cancellations")
        elif report == "nationality":
            nationality = func.coalesce(
                func.nullif(func.trim(Guest.nationality), ""),
                report_definition("unknownNationality"),
            )
            overlap = func.least(Reservation.check_out, end) - func.greatest(
                Reservation.check_in, start
            )
            rows = [
                dict(row)
                for row in db.session.execute(
                    select(
                        nationality.label("nationality"),
                        func.count(func.distinct(Guest.id)).label("guests"),
                        func.count(func.distinct(Reservation.id)).label("bookings"),
                        func.sum(overlap).label("guestNights"),
                    )
                    .select_from(ReservationGuest)
                    .join(
                        Guest,
                        (Guest.id == ReservationGuest.guest_id) & (Guest.tenant_id == tenant_id),
                    )
                    .join(
                        Reservation,
                        (Reservation.id == ReservationGuest.reservation_id)
                        & (Reservation.tenant_id == tenant_id),
                    )
                    .where(
                        ReservationGuest.tenant_id == tenant_id,
                        Reservation.status.in_(("IN_HOUSE", "CHECKED_OUT")),
                        Reservation.check_in < end,
                        Reservation.check_out > start,
                    )
                    .group_by(nationality)
                    .order_by(nationality)
                ).mappings()
            ]
            definitions["nationality"] = report_definition("nationality")
            counts = {"bookings", "guestNights"}
        else:
            grouped = {}
            bookings = db.session.scalars(
                select(Reservation).where(
                    Reservation.tenant_id == tenant_id,
                    Reservation.status.not_in(("CANCELLED", "NO_SHOW")),
                    Reservation.created_at >= start_at,
                    Reservation.created_at < end_at,
                    money_currency(Reservation, basis) == currency,
                )
            )
            for booking in bookings:
                snapshot = booking.pricing_snapshot or {}
                policy = snapshot.get("discount")
                if not policy:
                    continue
                key = (
                    policy.get("kind", ""),
                    policy.get("id", ""),
                    policy.get("name", ""),
                    policy.get("code", ""),
                )
                row = grouped.setdefault(
                    key,
                    {
                        "kind": key[0],
                        "label": key[2],
                        "code": key[3],
                        "bookings": 0,
                        "discountAmount": ZERO,
                    },
                )
                row["bookings"] += 1
                row["discountAmount"] += Decimal(
                    snapshot.get("discountBase" if basis == "base" else "discountAmount", "0")
                )
            rows = [row for _, row in sorted(grouped.items())]
            money_fields = {"discountAmount"}
            counts = {"bookings"}
            definitions["discounts"] = report_definition("discounts")

        definitions["groupTotals"] = report_definition("groupTotals")
        summary = {
            key: sum((row[key] for row in rows), ZERO if key in money_fields else 0)
            for key in counts | money_fields
        }

        def output(row):
            return {
                key: decimal_text(value) if key in money_fields else value
                for key, value in row.items()
            }

        return {
            "report": report,
            "start": iso(start),
            "end": iso(end),
            "currency": currency,
            "basis": basis,
            "timezone": timezone,
            "asOf": iso(now),
            "rows": [output(row) for row in rows],
            "summary": output(summary),
            "definitions": definitions,
        }


def __getattr__(name):
    if name in {"URL", "reports"}:
        from importlib import import_module

        return getattr(import_module(".urls", __package__), name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
