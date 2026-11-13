"""Tenant stays and money writes share one database transaction per request."""

import hashlib
import json
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from flask import g, request
from sqlalchemy import delete, func, select, text

from common import CommonMethodView, ValueFormatter

from ..auth.routes import validate_email
from ..catalog.models import Master, PhysicalRoom, RoomType
from ..catalog.routes import (
    adjust_inventory,
    lock_inventory,
    quote_stay,
    refresh_existing_inventory,
)
from ..channels.models import ChannelBooking
from ..core_models import AuditLog, Tenant, User, utcnow
from ..extensions import db
from ..housekeeping.routes import (
    cancel_reservation_tasks,
    checkout_task,
    guard_room_condition,
    invalidate_room_tasks,
)
from ..pricing.engine import money_json, redeem_voucher, rounded, snapshot_money
from ..security import ApiError, audit, payload, require_tenant
from ..validation import phone_value
from .models import (
    BookingNote,
    Charge,
    Guest,
    IdempotencyRecord,
    LedgerEntry,
    Payment,
    Refund,
    Reservation,
    ReservationGuest,
    ReservationNight,
    ReservationRoom,
)
from .room_stays import inventory_adjustments, room_stays

PREFIX = "/api/tenants/<tenant_id>"
ACTIVE = {"CONFIRMED", "IN_HOUSE"}
MONEY_LIMIT = Decimal("999999999999999.9999")


def money_value(value, *, allow_zero=False, limit=MONEY_LIMIT):
    if isinstance(value, bool) or value is None:
        raise ApiError(422, "invalid_amount", "Số tiền không hợp lệ.")
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise ApiError(422, "invalid_amount", "Số tiền không hợp lệ.") from None
    if (
        not amount.is_finite()
        or amount < 0
        or (not allow_zero and amount == 0)
        or amount > limit
        or amount.as_tuple().exponent < -4
    ):
        raise ApiError(422, "invalid_amount", "Số tiền phải không âm, tối đa 4 chữ số thập phân.")
    return amount


def stay_dates(start, end):
    try:
        start, end = date.fromisoformat(str(start)), date.fromisoformat(str(end))
    except (ValueError, TypeError):
        raise ApiError(422, "invalid_dates", "Ngày nhận/trả phòng không hợp lệ.") from None
    if not 1 <= (end - start).days <= 366:
        raise ApiError(422, "invalid_dates", "Lưu trú phải từ 1 đến 366 đêm.")
    return start, end


def string_value(value, label, maximum, *, required=False):
    if value is None and not required:
        return ""
    if (
        not isinstance(value, str)
        or len(value.strip()) > maximum
        or (required and not value.strip())
    ):
        raise ApiError(422, "invalid_input", f"{label} không hợp lệ.")
    return value.strip()


def decimal_text(amount):
    return ValueFormatter.decimal_text(amount)


def commission_snapshot(source):
    percent = money_value(source.data.get("commission", "0"), allow_zero=True, limit=Decimal(100))
    return {"sourceId": source.id, "sourceName": source.name, "percent": decimal_text(percent)}


def iso(value):
    return ValueFormatter.iso(value)


def guest_json(row):
    return {
        "id": row.id,
        "name": row.name,
        "phone": row.phone,
        "email": row.email,
        "identityNumber": row.identity_number,
        "nationality": row.nationality,
        "active": row.active,
    }


def find_reservation(tenant_id, reservation_id, *, locked=False):
    statement = select(Reservation).where(
        Reservation.tenant_id == tenant_id, Reservation.id == reservation_id
    )
    if locked:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    row = db.session.execute(statement).scalar_one_or_none()
    if not row:
        raise ApiError(404, "not_found", "Không tìm thấy đặt phòng.")
    return row


def require_booking_version(row, data):
    version = data.get("expectedVersion")
    if isinstance(version, bool) or not isinstance(version, int) or not 1 <= version <= 2147483647:
        raise ApiError(422, "version_required", "Cần phiên bản đặt phòng đã tải trước khi chỉnh sửa.")
    if version != row.version:
        raise ApiError(409, "stale_booking", "Đặt phòng đã thay đổi. Vui lòng tải lại dữ liệu trước khi tiếp tục.")


def rows_for(model, tenant_id, reservation_id=None):
    statement = select(model).where(model.tenant_id == tenant_id)
    if reservation_id:
        statement = statement.where(model.reservation_id == reservation_id)
    return db.session.execute(statement).scalars().all()


def totals(row):
    room_total = db.session.scalar(
        select(func.coalesce(func.sum(ReservationNight.price), 0)).where(
            ReservationNight.tenant_id == row.tenant_id, ReservationNight.reservation_id == row.id
        )
    )
    extra = db.session.scalar(
        select(func.coalesce(func.sum(Charge.amount), 0)).where(
            Charge.tenant_id == row.tenant_id, Charge.reservation_id == row.id
        )
    )
    paid = db.session.scalar(
        select(func.coalesce(func.sum(Payment.amount), 0)).where(
            Payment.tenant_id == row.tenant_id, Payment.reservation_id == row.id
        )
    )
    refunded = db.session.scalar(
        select(func.coalesce(func.sum(Refund.amount), 0)).where(
            Refund.tenant_id == row.tenant_id, Refund.reservation_id == row.id
        )
    )
    total, net_paid = Decimal(room_total) + Decimal(extra), Decimal(paid) - Decimal(refunded)
    return total, net_paid, total - net_paid


def load_booking_data(tenant_id, reservation_id=None):
    models = (
        ReservationRoom,
        ReservationGuest,
        ReservationNight,
        Charge,
        Payment,
        Refund,
        BookingNote,
    )
    data = {}
    for model in models:
        grouped = defaultdict(list)
        for row in rows_for(model, tenant_id, reservation_id):
            grouped[row.reservation_id].append(row)
        data[model] = grouped
    data[Guest] = {row.id: row for row in rows_for(Guest, tenant_id)}
    audits = select(AuditLog).where(
        AuditLog.tenant_id == tenant_id, AuditLog.entity_type == "reservation"
    )
    if reservation_id:
        audits = audits.where(AuditLog.entity_id == reservation_id)
    history = defaultdict(list)
    for row in db.session.execute(audits.order_by(AuditLog.created_at)).scalars():
        history[row.entity_id].append(row)
    data[AuditLog] = history
    actor_ids = {row.user_id for rows in history.values() for row in rows}
    for model in (Charge, Payment, Refund, BookingNote):
        actor_ids.update(row.user_id for rows in data[model].values() for row in rows)
    data[User] = (
        {
            row.id: row.name
            for row in db.session.execute(select(User).where(User.id.in_(actor_ids))).scalars()
        }
        if actor_ids
        else {}
    )
    return data


def reservation_json(row, data=None, *, redact=False):
    data = data or load_booking_data(row.tenant_id, row.id)
    rooms = sorted(data[ReservationRoom][row.id], key=lambda room: room.room_number)
    if redact:
        return {
            "id": row.id,
            "version": row.version,
            "guest": "Khách lưu trú",
            "phone": "",
            "room": rooms[0].room_number if rooms else "",
            "rooms": [room.room_number for room in rooms],
            "roomStays": room_stays(data[ReservationNight][row.id]),
            "source": "",
            "checkIn": iso(row.check_in),
            "checkOut": iso(row.check_out),
            "status": row.status,
            "total": "0.0000",
            "paid": "0.0000",
            "balance": "0.0000",
            "currency": row.currency,
            "guests": [],
            "nightlyRates": [],
            "charges": [],
            "payments": [],
            "notes": [],
            "history": [],
        }
    links = sorted(data[ReservationGuest][row.id], key=lambda link: not link.is_primary)
    nights = sorted(
        data[ReservationNight][row.id], key=lambda night: (night.date, night.room_number)
    )
    charges = sorted(data[Charge][row.id], key=lambda charge: charge.created_at)
    payments = sorted(data[Payment][row.id], key=lambda payment: payment.created_at)
    refunds = sorted(data[Refund][row.id], key=lambda refund: refund.created_at)
    total = sum((night.price for night in nights), Decimal(0)) + sum(
        (charge.amount for charge in charges), Decimal(0)
    )
    paid = sum((payment.amount for payment in payments), Decimal(0)) - sum(
        (refund.amount for refund in refunds), Decimal(0)
    )
    actors = data[User]

    def refund_json(refund):
        return {
            "id": refund.id,
            "amount": decimal_text(refund.amount),
            **money_json(refund),
            "reason": refund.reason,
            "createdAt": iso(refund.created_at),
            "actor": actors.get(refund.user_id, ""),
        }

    return {
        "id": row.id,
        "version": row.version,
        "guest": row.guest_name,
        "phone": row.guest_phone,
        "room": rooms[0].room_number if rooms else "",
        "rooms": [room.room_number for room in rooms],
        "roomStays": room_stays(data[ReservationNight][row.id]),
        "source": row.source_name,
        "sourceId": row.source_id,
        "checkIn": iso(row.check_in),
        "checkOut": iso(row.check_out),
        "total": decimal_text(total),
        "paid": decimal_text(paid),
        "balance": decimal_text(total - paid),
        "currency": row.currency,
        "baseCurrency": row.base_currency,
        "exchangeRate": str(row.exchange_rate),
        "baseAmount": decimal_text(
            sum((night.base_amount for night in nights), Decimal(0))
            + sum((charge.base_amount for charge in charges), Decimal(0))
        ),
        "basePaid": decimal_text(
            sum((payment.base_amount for payment in payments), Decimal(0))
            - sum((refund.base_amount for refund in refunds), Decimal(0))
        ),
        "pricingSnapshot": row.pricing_snapshot,
        "voucherCode": (row.pricing_snapshot.get("discount") or {}).get("code"),
        "status": row.status,
        "createdAt": iso(row.created_at),
        "checkedInAt": iso(row.checked_in_at),
        "checkedOutAt": iso(row.checked_out_at),
        "noShowAt": iso(row.no_show_at),
        "guests": [
            guest_json(data[Guest][link.guest_id]) for link in links if link.guest_id in data[Guest]
        ],
        "nightlyRates": [
            {
                "id": night.id,
                "room": night.room_number,
                "date": iso(night.date),
                "price": decimal_text(night.price),
                **money_json(night),
            }
            for night in nights
        ],
        "charges": [
            {
                "id": charge.id,
                "serviceId": charge.service_id,
                "description": charge.description,
                "type": charge.kind,
                "quantity": decimal_text(charge.quantity),
                "unitPrice": decimal_text(charge.unit_price),
                "amount": decimal_text(charge.amount),
                **money_json(charge),
                "createdAt": iso(charge.created_at),
                "actor": actors.get(charge.user_id, ""),
            }
            for charge in charges
        ],
        "payments": [
            {
                "id": payment.id,
                "amount": decimal_text(payment.amount),
                **money_json(payment),
                "methodId": payment.method_id,
                "method": payment.method_name,
                "fundId": payment.fund_id,
                "fund": payment.fund_name,
                "note": payment.note,
                "createdAt": iso(payment.created_at),
                "actor": actors.get(payment.user_id, ""),
                "refunded": decimal_text(
                    sum(
                        (refund.amount for refund in refunds if refund.payment_id == payment.id),
                        Decimal(0),
                    )
                ),
                "refunds": [
                    refund_json(refund) for refund in refunds if refund.payment_id == payment.id
                ],
            }
            for payment in payments
        ],
        "notes": [
            {
                "id": note.id,
                "text": note.text,
                "createdAt": iso(note.created_at),
                "actor": actors.get(note.user_id, ""),
            }
            for note in sorted(data[BookingNote][row.id], key=lambda note: note.created_at)
        ],
        "history": [
            {
                "id": event.id,
                "event": event.event,
                "details": event.details,
                "createdAt": iso(event.created_at),
                "actor": actors.get(event.user_id, ""),
            }
            for event in data[AuditLog][row.id]
        ],
    }


def booking_snapshot(tenant_id):
    rows = rows_for(Reservation, tenant_id)
    data = load_booking_data(tenant_id)
    redact = getattr(g, "role", None) == "HOUSEKEEPING"
    ledger = (
        []
        if redact
        else [
            {
                "id": row.id,
                "bookingId": row.reservation_id,
                "paymentId": row.payment_id,
                "refundId": row.refund_id,
                "fundId": row.fund_id,
                "type": row.kind,
                "amount": decimal_text(row.amount),
                "currency": row.currency,
                **money_json(row),
                "description": row.description,
                "createdAt": iso(row.created_at),
                "userId": row.user_id,
            }
            for row in db.session.scalars(
                select(LedgerEntry)
                .where(LedgerEntry.tenant_id == tenant_id)
                .order_by(LedgerEntry.created_at.desc(), LedgerEntry.id)
                .limit(100)
            )
        ]
    )
    housekeeping = (
        db.session.execute(
            select(AuditLog)
            .where(AuditLog.tenant_id == tenant_id, AuditLog.entity_type == "room")
            .order_by(AuditLog.created_at.desc())
            .limit(100)
        )
        .scalars()
        .all()
    )
    housekeeping_actor_ids = {row.user_id for row in housekeeping if row.user_id}
    housekeeping_actors = (
        {
            row.id: row.name
            for row in db.session.execute(
                select(User).where(User.id.in_(housekeeping_actor_ids))
            ).scalars()
        }
        if housekeeping_actor_ids
        else {}
    )
    return {
        "bookings": [
            reservation_json(row, data, redact=redact)
            for row in sorted(rows, key=lambda row: row.created_at, reverse=True)
        ],
        "guests": [] if redact else [guest_json(row) for row in data[Guest].values()],
        "ledger": ledger,
        "housekeepingLogs": [
            {
                "id": row.id,
                "room": row.entity_id,
                "action": row.event,
                "condition": row.details.get("condition"),
                "note": row.details.get("note", ""),
                "createdAt": iso(row.created_at),
                "actorId": row.user_id,
                "actor": housekeeping_actors.get(row.user_id, ""),
            }
            for row in housekeeping
        ],
    }


def master(tenant_id, catalog, value, *, read_lock=False):
    value = string_value(value, "Danh mục", 160, required=True)
    statement = select(Master).where(
        Master.tenant_id == tenant_id,
        Master.catalog == catalog,
        Master.active.is_(True),
        (Master.id == value) | (Master.name == value),
    )
    if read_lock:
        statement = statement.with_for_update(read=True).execution_options(populate_existing=True)
    row = db.session.execute(statement).scalar_one_or_none()
    if not row:
        raise ApiError(422, "invalid_master", "Danh mục không tồn tại hoặc đã ngừng sử dụng.")
    return row


def guest_input(tenant_id, data, row=None):
    if not isinstance(data, dict):
        raise ApiError(422, "invalid_guest", "Thông tin khách không hợp lệ.")
    row = row or Guest(tenant_id=tenant_id)
    row.name = string_value(data.get("name", row.name), "Tên khách", 160, required=True)
    for api_key, field, length in (
        ("phone", "phone", 40),
        ("email", "email", 254),
        ("identityNumber", "identity_number", 80),
        ("nationality", "nationality", 80),
    ):
        setattr(row, field, string_value(data.get(api_key, getattr(row, field)), api_key, length))
    row.phone = phone_value(row.phone)
    if row.email:
        row.email = validate_email(row.email)
    if "active" in data:
        if not isinstance(data["active"], bool):
            raise ApiError(422, "invalid_guest", "Trạng thái khách không hợp lệ.")
        row.active = data["active"]
    db.session.add(row)
    db.session.flush()
    return row


def resolve_guests(tenant_id, data, current=None):
    linked_ids = {
        link.guest_id for link in rows_for(ReservationGuest, tenant_id, current.id)
    } if current else set()
    if "guests" not in data:
        existing = [] if current is None else rows_for(ReservationGuest, tenant_id, current.id)
        if existing and "guest" not in data and "phone" not in data:
            return [
                db.session.get(Guest, link.guest_id)
                for link in sorted(existing, key=lambda link: not link.is_primary)
            ]
        name = string_value(
            data.get("guest", current.guest_name if current else None),
            "Tên khách",
            160,
            required=True,
        )
        phone = phone_value(string_value(
            data.get("phone", current.guest_phone if current else ""), "Điện thoại", 40
        ))
        if current and name == current.guest_name and phone == current.guest_phone and existing:
            return [
                db.session.get(Guest, link.guest_id)
                for link in sorted(existing, key=lambda link: not link.is_primary)
            ]
        values = [
            {"name": name, "phone": phone},
            *[{"id": link.guest_id} for link in existing if not link.is_primary],
        ]
    else:
        values = data["guests"]
    if not isinstance(values, list) or not 1 <= len(values) <= 50:
        raise ApiError(422, "invalid_guests", "Đặt phòng cần từ 1 đến 50 khách.")
    existing_ids = []
    for value in values:
        if not isinstance(value, dict):
            raise ApiError(422, "invalid_guest", "Thông tin khách không hợp lệ.")
        if value.get("id"):
            existing_ids.append(string_value(value["id"], "Mã khách", 40, required=True))
    locked_guests = (
        {
            row.id: row
            for row in db.session.execute(
                select(Guest)
                .where(
                    Guest.tenant_id == tenant_id, Guest.id.in_(existing_ids), Guest.active.is_(True)
                )
                .order_by(Guest.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            ).scalars()
        }
        if existing_ids
        else {}
    )
    guests = []
    for value in values:
        if value.get("id"):
            row = locked_guests.get(value["id"])
            if not row:
                raise ApiError(404, "not_found", "Không tìm thấy khách trong khách sạn này.")
            profile = {
                key: value[key]
                for key in ("name", "phone", "email", "identityNumber", "nationality")
                if key in value
            }
            if profile:
                # Attaching a shared profile is link-only; its editing form belongs to an existing stay.
                if row.id not in linked_ids and any(
                    value != getattr(row, {"identityNumber": "identity_number"}.get(key, key))
                    for key, value in profile.items()
                ):
                    raise ApiError(409, "stale_guest", "Hồ sơ khách đã khác dữ liệu đã chọn. Vui lòng tải lại và sửa trong đặt phòng đang liên kết.")
                row = guest_input(tenant_id, profile, row)
                audit("guest.updated", "guest", row.id, {"fields": sorted(profile)})
        else:
            if value.get("active", True) is not True:
                raise ApiError(422, "invalid_guest", "Khách của đặt phòng phải đang hoạt động.")
            row = guest_input(tenant_id, value)
        if row.id in {guest.id for guest in guests}:
            raise ApiError(422, "duplicate_guest", "Khách đã có trong đặt phòng.")
        guests.append(row)
    return guests


def room_numbers(data, current=None):
    numbers = data.get("rooms", [data["room"]] if "room" in data else current)
    if not isinstance(numbers, list) or not 1 <= len(numbers) <= 50:
        raise ApiError(422, "invalid_rooms", "Chọn từ 1 đến 50 phòng.")
    numbers = [string_value(number, "Số phòng", 40, required=True) for number in numbers]
    if len(set(numbers)) != len(numbers):
        raise ApiError(422, "duplicate_room", "Phòng bị chọn trùng.")
    return sorted(numbers)


def lock_rooms(tenant_id, numbers):
    rooms = (
        db.session.execute(
            select(PhysicalRoom)
            .where(PhysicalRoom.tenant_id == tenant_id, PhysicalRoom.number.in_(numbers))
            .order_by(PhysicalRoom.number)
            .with_for_update()
        )
        .scalars()
        .all()
    )
    if len(rooms) != len(numbers):
        raise ApiError(404, "not_found", "Một phòng không thuộc khách sạn này.")
    return rooms


def check_overlaps(tenant_id, rooms, start, end, exclude=None):
    query = select(ReservationRoom.id).where(
        ReservationRoom.tenant_id == tenant_id,
        ReservationRoom.room_id.in_([room.id for room in rooms]),
        ReservationRoom.active.is_(True),
        ReservationRoom.check_in < end,
        ReservationRoom.check_out > start,
    )
    if exclude:
        query = query.where(ReservationRoom.reservation_id != exclude)
    if db.session.scalar(query.limit(1)):
        raise ApiError(409, "room_unavailable", "Phòng đã được đặt trong khoảng ngày này.")


def set_booking_guests(row, guests):
    db.session.execute(
        delete(ReservationGuest).where(
            ReservationGuest.tenant_id == row.tenant_id, ReservationGuest.reservation_id == row.id
        )
    )
    for index, guest in enumerate(guests):
        db.session.add(
            ReservationGuest(
                tenant_id=row.tenant_id,
                reservation_id=row.id,
                guest_id=guest.id,
                is_primary=index == 0,
            )
        )
    row.guest_name, row.guest_phone = guests[0].name, guests[0].phone


def add_stay(row, rooms, quote):
    for room in rooms:
        db.session.add(
            ReservationRoom(
                tenant_id=row.tenant_id,
                reservation_id=row.id,
                room_id=room.id,
                room_number=room.number,
                room_type_id=room.room_type_id,
                check_in=row.check_in,
                check_out=row.check_out,
                active=True,
            )
        )
    db.session.flush()
    for nightly in quote["nightlyRates"]:
        db.session.add(
            ReservationNight(
                tenant_id=row.tenant_id,
                reservation_id=row.id,
                room_id=nightly["roomId"],
                room_number=nightly["room"],
                room_type_id=nightly["roomTypeId"],
                date=date.fromisoformat(nightly["date"]),
                price=money_value(nightly["price"], allow_zero=True),
                base_currency=quote["baseCurrency"],
                exchange_rate=Decimal(quote["exchangeRate"]),
                base_amount=Decimal(nightly["baseAmount"]),
            )
        )


def inventory(tenant_id, rooms, start, end, delta):
    for first, last, counts in inventory_adjustments(rooms, start, end, delta):
        adjust_inventory(tenant_id, sorted(counts), first, last, counts)


def check_guest_capacity(tenant_id, rooms, guests):
    types = {
        row.id: row.capacity
        for row in db.session.execute(
            select(RoomType).where(
                RoomType.tenant_id == tenant_id,
                RoomType.id.in_([room.room_type_id for room in rooms]),
            )
        ).scalars()
    }
    if len(guests) > sum(types[room.room_type_id] for room in rooms):
        raise ApiError(422, "guest_capacity", "Số khách vượt sức chứa của các phòng đã chọn.")


class ListReservationsView(CommonMethodView):
    @staticmethod
    @require_tenant("reservations.view")
    def dispatch_request(tenant_id):
        return {"bookings": booking_snapshot(tenant_id)["bookings"]}


class ReservationDetailView(CommonMethodView):
    @staticmethod
    @require_tenant("reservations.view")
    def dispatch_request(tenant_id, reservation_id):
        return reservation_json(find_reservation(tenant_id, reservation_id))


class CreateReservationView(CommonMethodView):
    @staticmethod
    @require_tenant("reservations.write")
    def dispatch_request(tenant_id):
        data = payload()
        key, fingerprint, replay = begin_write(tenant_id, data)
        if replay is not None:
            return replay, 201
        if data.get("status", "CONFIRMED") != "CONFIRMED":
            raise ApiError(422, "invalid_status", "Đặt phòng mới bắt đầu ở trạng thái đã xác nhận.")
        start, end = stay_dates(data.get("checkIn"), data.get("checkOut"))
        from ..reconciliation.business_days import ensure_open_day

        ensure_open_day(tenant_id, start)
        numbers = room_numbers(data)
        # Serialize the first booking with currency configuration changes, without
        # serializing bookings in independent rooms with each other.
        g.tenant = db.session.scalar(
            select(Tenant)
            .where(Tenant.id == tenant_id)
            .with_for_update(read=True)
            .execution_options(populate_existing=True)
        )
        if g.tenant.status != "active":
            raise ApiError(403, "tenant_suspended", "Khách sạn đang bị tạm ngưng.")
        rooms = lock_rooms(tenant_id, numbers)
        lock_inventory(tenant_id, sorted({room.room_type_id for room in rooms}), start, end)
        check_overlaps(tenant_id, rooms, start, end)
        quote = quote_stay(
            tenant_id,
            numbers,
            start,
            end,
            currency=data.get("currency"),
            voucher_code=data.get("voucherCode"),
            redeem=True,
        )
        guests = resolve_guests(tenant_id, data)
        check_guest_capacity(tenant_id, rooms, guests)
        source = master(
            tenant_id, "bookingSources", data.get("sourceId") or data.get("source", "Direct"), read_lock=True
        )
        row = Reservation(
            tenant_id=tenant_id,
            check_in=start,
            check_out=end,
            source_id=source.id,
            source_name=source.name,
            currency=quote["currency"],
            base_currency=quote["baseCurrency"],
            exchange_rate=Decimal(quote["exchangeRate"]),
            base_amount=Decimal(quote["baseAmount"]),
            pricing_snapshot={**quote["pricingSnapshot"], "commission": commission_snapshot(source)},
            guest_name=guests[0].name,
            guest_phone=guests[0].phone,
        )
        db.session.add(row)
        db.session.flush()
        set_booking_guests(row, guests)
        add_stay(row, rooms, quote)
        inventory(tenant_id, rooms, start, end, 1)
        redeem_voucher(tenant_id, row.id, quote)
        audit(
            "reservation.created",
            "reservation",
            row.id,
            {"rooms": numbers, "checkIn": iso(start), "checkOut": iso(end)},
        )
        db.session.flush()
        return finish_write(tenant_id, key, fingerprint, reservation_json(row), status=201)


class EditReservationView(CommonMethodView):
    @staticmethod
    @require_tenant("reservations.write")
    def dispatch_request(tenant_id, reservation_id):
        data = payload()
        row = find_reservation(tenant_id, reservation_id, locked=True)
        key, fingerprint, replay = begin_write(tenant_id, data, required=False)
        if replay is not None:
            return replay
        require_booking_version(row, data)
        if "currency" in data and data["currency"] != row.currency:
            raise ApiError(
                409, "booking_currency_frozen", "Không đổi tiền tệ của đặt phòng đã tạo."
            )
        voucher_policy = (row.pricing_snapshot or {}).get("discount")
        voucher_policy = (
            voucher_policy if voucher_policy and voucher_policy.get("kind") == "voucher" else None
        )
        if "voucherCode" in data and (data["voucherCode"] or None) != (
            voucher_policy["code"] if voucher_policy else None
        ):
            raise ApiError(
                409, "booking_voucher_frozen", "Voucher đã chốt cùng đặt phòng; không thể thay đổi."
            )
        if row.status not in ACTIVE:
            raise ApiError(409, "stay_closed", "Đặt phòng đã đóng, không thể sửa.")
        if "status" in data and data["status"] != row.status:
            raise ApiError(
                422, "invalid_status", "Dùng thao tác nhận/trả/hủy phòng để đổi trạng thái."
            )
        old_rooms = rows_for(ReservationRoom, tenant_id, row.id)
        old_start, old_end = row.check_in, row.check_out
        numbers = room_numbers(data, [room.room_number for room in old_rooms])
        start, end = stay_dates(
            data.get("checkIn", row.check_in), data.get("checkOut", row.check_out)
        )
        changed = (
            numbers != sorted(room.room_number for room in old_rooms)
            or start != row.check_in
            or end != row.check_out
        )
        if changed and row.status == "IN_HOUSE":
            raise ApiError(
                409,
                "stay_started",
                "Lưu trú đã nhận phòng, không thể thay đổi ngày/phòng trong luồng này.",
            )
        locked_rooms = lock_rooms(
            tenant_id, sorted(set(numbers) | {room.room_number for room in old_rooms})
        )
        rooms = [room for room in locked_rooms if room.number in numbers]
        channel_booking = db.session.scalar(
            select(ChannelBooking.id).where(
                ChannelBooking.tenant_id == tenant_id,
                ChannelBooking.reservation_id == row.id,
            )
        )
        if channel_booking and (
            start != old_start
            or end != old_end
            or sorted(room.room_type_id for room in rooms)
            != sorted(room.room_type_id for room in old_rooms)
            or ("source" in data or "sourceId" in data)
            and (data.get("sourceId") or data.get("source")) not in (row.source_id, row.source_name)
        ):
            raise ApiError(
                409,
                "channel_booking_requires_review",
                "Thay đổi ngày, hạng/số phòng hoặc nguồn đặt phòng OTA cần được đối soát với kênh.",
            )
        guests = resolve_guests(tenant_id, data, row)
        check_guest_capacity(tenant_id, rooms, guests)
        if changed:
            from ..reconciliation.business_days import ensure_open_day

            ensure_open_day(tenant_id, min(start, row.check_in))
            # Lock the union of old/new inventory ranges before releasing any old occupancy.
            kinds = sorted({room.room_type_id for room in locked_rooms})
            lock_inventory(tenant_id, kinds, min(start, row.check_in), max(end, row.check_out))
            check_overlaps(tenant_id, rooms, start, end, row.id)
            quote = quote_stay(
                tenant_id, numbers, start, end, currency=row.currency, voucher_policy=voucher_policy
            )
            if channel_booking:
                # Keep retained rooms' own OTA rates when only some rooms are moved.
                old_ids = {room.room_id for room in old_rooms}
                assigned = {room.id: room for room in rooms if room.id in old_ids}
                remaining = [room for room in rooms if room.id not in old_ids]
                for previous in sorted(old_rooms, key=lambda room: room.room_number):
                    if previous.room_id not in assigned:
                        replacement = next(
                            room for room in remaining if room.room_type_id == previous.room_type_id
                        )
                        assigned[previous.room_id] = replacement
                        remaining.remove(replacement)
                for stay in [*old_rooms, *rows_for(ReservationNight, tenant_id, row.id)]:
                    replacement = assigned[stay.room_id]
                    stay.room_id, stay.room_number = replacement.id, replacement.number
            else:
                old_total, paid, _ = totals(row)
                old_nights = sum(
                    (night.price for night in rows_for(ReservationNight, tenant_id, row.id)), Decimal(0)
                )
                new_total = old_total - old_nights + Decimal(quote["total"])
                if new_total < paid:
                    raise ApiError(
                        409,
                        "refund_required",
                        "Cần hoàn phần tiền dư trước khi giảm giá trị đặt phòng.",
                    )
                inventory(tenant_id, old_rooms, row.check_in, row.check_out, -1)
                db.session.execute(
                    delete(ReservationNight).where(
                        ReservationNight.tenant_id == tenant_id,
                        ReservationNight.reservation_id == row.id,
                    )
                )
                db.session.execute(
                    delete(ReservationRoom).where(
                        ReservationRoom.tenant_id == tenant_id, ReservationRoom.reservation_id == row.id
                    )
                )
                row.check_in, row.check_out = start, end
                row.base_currency, row.exchange_rate, row.base_amount = (
                    quote["baseCurrency"],
                    Decimal(quote["exchangeRate"]),
                    Decimal(quote["baseAmount"]),
                )
                commission = (row.pricing_snapshot or {}).get("commission")
                row.pricing_snapshot = {**quote["pricingSnapshot"], **({"commission": commission} if commission else {})}
                add_stay(row, rooms, quote)
                inventory(tenant_id, rooms, start, end, 1)
        if "source" in data or "sourceId" in data:
            requested_source = data.get("sourceId") or data.get("source")
            if requested_source not in (row.source_id, row.source_name):
                source = master(tenant_id, "bookingSources", requested_source, read_lock=True)
                row.source_id, row.source_name = source.id, source.name
                if row.status == "CONFIRMED" and (row.pricing_snapshot or {}).get("commission"):
                    row.pricing_snapshot = {**row.pricing_snapshot, "commission": commission_snapshot(source)}
        set_booking_guests(row, guests)
        row.version += 1
        audit(
            "reservation.updated",
            "reservation",
            row.id,
            {
                "stayChanged": changed,
                "rooms": numbers,
                "checkIn": iso(row.check_in),
                "checkOut": iso(row.check_out),
                "oldCheckIn": iso(old_start),
                "oldCheckOut": iso(old_end),
            },
        )
        db.session.flush()
        db.session.refresh(row, attribute_names=["version"])
        return finish_write(tenant_id, key, fingerprint, reservation_json(row))


class ChangeStatusView(CommonMethodView):
    @staticmethod
    @require_tenant("reservations.write")
    def dispatch_request(tenant_id, reservation_id):
        data = payload()
        status = data.get("status")
        if not isinstance(status, str):
            raise ApiError(422, "invalid_status", "Trạng thái đặt phòng phải là chuỗi ký tự.")
        row = find_reservation(tenant_id, reservation_id, locked=True)
        key, fingerprint, replay = begin_write(tenant_id, data, required=False)
        if replay is not None:
            return replay
        require_booking_version(row, data)
        transitions = {
            "CONFIRMED": {"IN_HOUSE", "CANCELLED", "NO_SHOW"},
            "IN_HOUSE": {"CHECKED_OUT"},
        }
        if not isinstance(status, str) or status not in transitions.get(row.status, set()):
            raise ApiError(
                409, "invalid_transition", "Trạng thái đặt phòng không cho phép thao tác này."
            )
        linked = rows_for(ReservationRoom, tenant_id, row.id)
        rooms = lock_rooms(tenant_id, sorted(room.room_number for room in linked))
        if status in {"IN_HOUSE", "NO_SHOW"}:
            today = datetime.now(
                ZoneInfo(g.tenant.settings.get("timezone", "Asia/Ho_Chi_Minh"))
            ).date()
            if status == "NO_SHOW" and today < row.check_in:
                raise ApiError(
                    409, "arrival_not_due", "Chưa đến ngày nhận phòng để ghi nhận khách không đến."
                )
        if status == "IN_HOUSE":
            if not row.check_in <= today < row.check_out:
                raise ApiError(409, "outside_stay", "Chỉ nhận phòng trong khoảng ngày lưu trú.")
            if any(room.condition != "clean" or not room.active for room in rooms):
                raise ApiError(
                    409, "room_not_ready", "Tất cả phòng phải sạch và đang hoạt động để nhận phòng."
                )
            row.checked_in_at = utcnow()
            for room in rooms:
                invalidate_room_tasks(room, "checkin")
        else:
            if status == "CHECKED_OUT":
                _, _, balance = totals(row)
                if balance != 0:
                    raise ApiError(
                        409,
                        "unpaid_balance",
                        "Cần thanh toán đủ trước khi trả phòng.",
                        {"balance": decimal_text(balance)},
                    )
                row.checked_out_at = utcnow()
                for room in rooms:
                    room.condition = "dirty"
                    checkout_task(room, row)
                    audit(
                        "room.dirty",
                        "room",
                        room.number,
                        {"condition": "dirty", "reservationId": row.id},
                    )
            elif status == "NO_SHOW":
                row.no_show_at = utcnow()
                cancel_reservation_tasks(row, rooms, "no_show")
            else:
                row.cancelled_at = utcnow()
            lock_inventory(
                tenant_id,
                sorted({room.room_type_id for room in linked}),
                row.check_in,
                row.check_out,
            )
            inventory(tenant_id, linked, row.check_in, row.check_out, -1)
            for room in linked:
                room.active = False
        previous = row.status
        row.status = status
        audit(
            "reservation.status",
            "reservation",
            row.id,
            {
                "from": previous,
                "to": status,
                "checkIn": iso(row.check_in),
                "checkOut": iso(row.check_out),
            },
        )
        db.session.flush()
        return finish_write(tenant_id, key, fingerprint, reservation_json(row))


class RoomConditionView(CommonMethodView):
    @staticmethod
    @require_tenant("housekeeping.write")
    def dispatch_request(tenant_id, number):
        condition = payload().get("condition")
        if not isinstance(condition, str) or condition not in {
            "clean",
            "dirty",
            "inspection",
            "maintenance",
        }:
            raise ApiError(422, "invalid_condition", "Tình trạng phòng không hợp lệ.")
        room = lock_rooms(tenant_id, [number])[0]
        guard_room_condition(room, condition)
        if condition == "maintenance":
            if db.session.scalar(
                select(ReservationRoom.id)
                .where(
                    ReservationRoom.tenant_id == tenant_id,
                    ReservationRoom.room_id == room.id,
                    ReservationRoom.active.is_(True),
                )
                .limit(1)
            ):
                raise ApiError(
                    409,
                    "room_reserved",
                    "Phòng còn đặt phòng đang hoạt động; không thể chuyển bảo trì.",
                )
        previous = room.condition
        if previous != condition:
            invalidate_room_tasks(room, "manual_condition")
        room.condition = condition
        db.session.flush()
        refresh_existing_inventory(tenant_id, [room.room_type_id])
        audit(f"room.{condition}", "room", room.number, {"from": previous, "condition": condition})
        db.session.flush()
        return {
            "id": room.number,
            "uuid": room.id,
            "typeId": room.room_type_id,
            "condition": room.condition,
            "active": room.active,
        }


def begin_write(
    tenant_id, data, *, required=True, record_model=IdempotencyRecord, legacy_money=False
):
    """Serialize an intent and replay its committed result in this transaction."""
    key = request.headers.get("Idempotency-Key", "")
    if not key and not required and "Idempotency-Key" not in request.headers:
        return None, None, None
    if not 8 <= len(key) <= 128 or any(ord(char) < 33 or ord(char) > 126 for char in key):
        raise ApiError(
            422, "idempotency_required", "Thao tác ghi cần Idempotency-Key ổn định (8–128 ký tự)."
        )
    try:
        identity = {"path": request.path, "actor": g.user.id, "body": data}

        def digest(value):
            return hashlib.sha256(json.dumps(
                value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
            ).encode()).hexdigest()

        fingerprint = digest({**identity, "method": request.method})
        # Pending money intents from earlier deployments use the original digest.
        legacy_fingerprint = digest(identity) if legacy_money else None
    except (TypeError, ValueError):
        raise ApiError(422, "invalid_amount", "Nội dung có giá trị số không hợp lệ.") from None
    # Keep the shared money namespace while older deployments may still retry.
    db.session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),
        {"key": f"{tenant_id}:money:{key}"},
    )
    existing = db.session.execute(
        select(record_model).where(record_model.tenant_id == tenant_id, record_model.key == key)
    ).scalar_one_or_none()
    if existing:
        if existing.fingerprint not in {fingerprint, legacy_fingerprint}:
            raise ApiError(409, "idempotency_conflict", "Mã thao tác đã dùng cho nội dung khác.")
        return key, fingerprint, existing.response
    return key, fingerprint, None


def finish_write(
    tenant_id, key, fingerprint, response, *, status=200, record_model=IdempotencyRecord
):
    if key is not None:
        db.session.add(
            record_model(
                tenant_id=tenant_id, key=key, fingerprint=fingerprint, response=response
            )
        )
        db.session.flush()
    return response, status


def begin_money(row, data, *, record_model=IdempotencyRecord):
    return begin_write(row.tenant_id, data, record_model=record_model, legacy_money=True)


def finish_money(row, key, fingerprint):
    db.session.flush()
    return finish_write(row.tenant_id, key, fingerprint, reservation_json(row), status=201)


def refund_snapshot(payment, amount):
    result = snapshot_money(payment.tenant_id, payment.currency, amount, payment)
    refunded, base_refunded = db.session.execute(
        select(
            func.coalesce(func.sum(Refund.amount), 0),
            func.coalesce(func.sum(Refund.base_amount), 0),
        ).where(Refund.tenant_id == payment.tenant_id, Refund.payment_id == payment.id)
    ).one()
    remaining_base = max(payment.base_amount - Decimal(base_refunded), Decimal(0))
    if amount == payment.amount - Decimal(refunded):
        result["base_amount"] = remaining_base
    else:
        cumulative_base = rounded((Decimal(refunded) + amount) * payment.exchange_rate)
        result["base_amount"] = min(
            max(cumulative_base - Decimal(base_refunded), Decimal(0)), remaining_base
        )
    return result


def financial_open(row):
    if row.status not in ACTIVE | {"NO_SHOW"}:
        raise ApiError(
            409, "stay_closed", "Đặt phòng đã đóng, không thể thêm chi phí hoặc thu tiền."
        )


class AddChargeView(CommonMethodView):
    @staticmethod
    @require_tenant("payments.write")
    def dispatch_request(tenant_id, reservation_id):
        data = payload()
        row = find_reservation(tenant_id, reservation_id, locked=True)
        key, fingerprint, replay = begin_money(row, data)
        if replay is not None:
            return replay, 201
        financial_open(row)
        kind = data.get("type", "service")
        if not isinstance(kind, str) or kind not in {"service", "fee", "tax", "discount"}:
            raise ApiError(422, "invalid_charge", "Loại chi phí không hợp lệ.")
        service = (
            master(tenant_id, "services", data["serviceId"]) if data.get("serviceId") else None
        )
        if service and kind != "service":
            raise ApiError(422, "invalid_charge", "Dịch vụ chỉ dùng với chi phí dịch vụ.")
        description = string_value(
            data.get("description") or (service.name if service else None),
            "Nội dung chi phí",
            240,
            required=True,
        )
        quantity = money_value(data.get("quantity", "1"), limit=Decimal("99999999.9999"))
        default_price = (
            rounded(Decimal((service.data or {}).get("price", "0")) / row.exchange_rate)
            if service
            else None
        )
        unit_price = money_value(
            data.get("unitPrice", default_price),
            allow_zero=True,
        )
        amount = quantity * unit_price
        if (
            amount > MONEY_LIMIT
            or amount.as_tuple().exponent < -4
            and amount != amount.quantize(Decimal("0.0001"))
        ):
            raise ApiError(422, "invalid_amount", "Tổng chi phí phải có tối đa 4 chữ số thập phân.")
        amount = amount.quantize(Decimal("0.0001")) * (-1 if kind == "discount" else 1)
        total, paid, _ = totals(row)
        if total + amount < paid or total + amount < 0:
            raise ApiError(
                409,
                "refund_required",
                "Chiết khấu không thể giảm tổng xuống dưới số đã thanh toán.",
            )
        charge = Charge(
            tenant_id=tenant_id,
            reservation_id=row.id,
            service_id=service.id if service else None,
            description=description,
            kind=kind,
            quantity=quantity,
            unit_price=unit_price,
            amount=amount,
            currency=row.currency,
            **snapshot_money(tenant_id, row.currency, amount, row),
            user_id=g.user.id,
        )
        db.session.add(charge)
        audit(
            "reservation.charge",
            "reservation",
            row.id,
            {"type": kind, "description": description, "amount": decimal_text(amount)},
        )
        return finish_money(row, key, fingerprint)


class AddPaymentView(CommonMethodView):
    @staticmethod
    @require_tenant("payments.write")
    def dispatch_request(tenant_id, reservation_id):
        data = payload()
        row = find_reservation(tenant_id, reservation_id, locked=True)
        key, fingerprint, replay = begin_money(row, data)
        if replay is not None:
            return replay, 201
        financial_open(row)
        amount = money_value(data.get("amount"))
        _, _, balance = totals(row)
        if amount > balance:
            raise ApiError(409, "overpayment", "Số tiền thu vượt số còn phải thanh toán.")
        method = master(tenant_id, "paymentMethods", data.get("methodId"))
        from ..finance.routes import local_date, lock_funds

        fund_id = data.get("fundId")
        if not isinstance(fund_id, str) or not fund_id:
            raise ApiError(422, "invalid_fund", "Vui lòng chọn quỹ thu tiền.")
        fund = lock_funds(tenant_id, [fund_id], row.currency)[fund_id]
        payment = Payment(
            tenant_id=tenant_id,
            reservation_id=row.id,
            method_id=method.id,
            fund_id=fund.id,
            method_name=method.name,
            fund_name=fund.name,
            amount=amount,
            currency=row.currency,
            **snapshot_money(tenant_id, row.currency, amount, row),
            note=string_value(data.get("note", ""), "Ghi chú", 500),
            user_id=g.user.id,
        )
        db.session.add(payment)
        db.session.flush()
        db.session.add(
            LedgerEntry(
                tenant_id=tenant_id,
                reservation_id=row.id,
                payment_id=payment.id,
                fund_id=fund.id,
                kind="payment",
                booked_at=local_date(),
                amount=amount,
                currency=row.currency,
                **snapshot_money(tenant_id, row.currency, amount, payment),
                description=payment.note or f"Thu tiền đặt phòng {row.id}",
                user_id=g.user.id,
            )
        )
        audit(
            "reservation.payment",
            "reservation",
            row.id,
            {"paymentId": payment.id, "amount": decimal_text(amount), "fund": fund.name},
        )
        return finish_money(row, key, fingerprint)


class RefundPaymentView(CommonMethodView):
    @staticmethod
    @require_tenant("payments.write")
    def dispatch_request(tenant_id, reservation_id, payment_id):
        data = payload()
        row = find_reservation(tenant_id, reservation_id, locked=True)
        key, fingerprint, replay = begin_money(row, data)
        if replay is not None:
            return replay, 201
        if row.status == "CHECKED_OUT":
            raise ApiError(
                409,
                "stay_closed",
                "Lưu trú đã trả phòng; điều chỉnh sau chốt cần luồng kế toán riêng.",
            )
        payment = db.session.execute(
            select(Payment).where(
                Payment.tenant_id == tenant_id,
                Payment.reservation_id == row.id,
                Payment.id == payment_id,
            )
        ).scalar_one_or_none()
        if not payment:
            raise ApiError(404, "not_found", "Không tìm thấy khoản thanh toán của đặt phòng.")
        amount = money_value(data.get("amount"))
        refunded = db.session.scalar(
            select(func.coalesce(func.sum(Refund.amount), 0)).where(
                Refund.tenant_id == tenant_id, Refund.payment_id == payment_id
            )
        )
        if amount > payment.amount - Decimal(refunded):
            raise ApiError(
                409, "over_refund", "Số tiền hoàn vượt số tiền còn lại của khoản thanh toán."
            )
        reason = string_value(data.get("reason"), "Lý do hoàn tiền", 500, required=True)
        from ..finance.routes import ensure_available, local_date, lock_funds

        lock_funds(tenant_id, [payment.fund_id], row.currency, allow_inactive=True)
        ensure_available(tenant_id, payment.fund_id, row.currency, amount)
        refund = Refund(
            tenant_id=tenant_id,
            reservation_id=row.id,
            payment_id=payment.id,
            amount=amount,
            currency=row.currency,
            **refund_snapshot(payment, amount),
            reason=reason,
            user_id=g.user.id,
        )
        db.session.add(refund)
        db.session.flush()
        db.session.add(
            LedgerEntry(
                tenant_id=tenant_id,
                reservation_id=row.id,
                payment_id=payment.id,
                refund_id=refund.id,
                fund_id=payment.fund_id,
                kind="refund",
                booked_at=local_date(),
                amount=-amount,
                currency=row.currency,
                base_currency=refund.base_currency,
                exchange_rate=refund.exchange_rate,
                base_amount=-refund.base_amount,
                description=reason,
                user_id=g.user.id,
            )
        )
        audit(
            "reservation.refund",
            "reservation",
            row.id,
            {
                "paymentId": payment.id,
                "refundId": refund.id,
                "amount": decimal_text(amount),
                "reason": reason,
            },
        )
        return finish_money(row, key, fingerprint)


class AdjustClosedStayView(CommonMethodView):
    @staticmethod
    @require_tenant("finance.adjust")
    def dispatch_request(tenant_id, reservation_id):
        """Correct a closed stay with paired immutable money records; its balance stays zero."""
        from ..finance.routes import ensure_available, local_date, lock_funds

        data = payload()
        row = find_reservation(tenant_id, reservation_id, locked=True)
        key, fingerprint, replay = begin_money(row, data)
        if replay is not None:
            return replay, 201
        if row.status != "CHECKED_OUT":
            raise ApiError(409, "stay_not_closed", "Điều chỉnh kế toán chỉ dùng sau khi checkout.")
        total, _, balance = totals(row)
        if balance != 0:
            raise ApiError(409, "unbalanced_stay", "Lưu trú đã chốt cần được đối soát trước.")
        kind = data.get("type")
        if not isinstance(kind, str) or kind not in {"credit", "debit"}:
            raise ApiError(422, "invalid_adjustment", "Chọn giảm tiền và hoàn, hoặc thu bổ sung.")
        amount = money_value(data.get("amount"))
        reason = string_value(data.get("reason"), "Lý do điều chỉnh", 500, required=True)
        if kind == "credit":
            payment = db.session.scalar(
                select(Payment).where(
                    Payment.tenant_id == tenant_id,
                    Payment.reservation_id == row.id,
                    Payment.id == data.get("paymentId"),
                )
            )
            if not payment:
                raise ApiError(404, "not_found", "Không tìm thấy khoản thanh toán gốc.")
            refunded = Decimal(
                db.session.scalar(
                    select(func.coalesce(func.sum(Refund.amount), 0)).where(
                        Refund.tenant_id == tenant_id,
                        Refund.payment_id == payment.id,
                    )
                )
            )
            if amount > total or amount > payment.amount - refunded:
                raise ApiError(
                    409, "over_refund", "Điều chỉnh vượt tổng tiền hoặc số còn được hoàn."
                )
            lock_funds(tenant_id, [payment.fund_id], row.currency, allow_inactive=True)
            ensure_available(tenant_id, payment.fund_id, row.currency, amount)
            money_record = Refund(
                tenant_id=tenant_id,
                reservation_id=row.id,
                payment_id=payment.id,
                amount=amount,
                currency=row.currency,
                reason=reason,
                user_id=g.user.id,
                **refund_snapshot(payment, amount),
            )
        else:
            if total + amount > MONEY_LIMIT:
                raise ApiError(422, "invalid_amount", "Tổng sau điều chỉnh vượt giới hạn.")
            method = master(tenant_id, "paymentMethods", data.get("methodId"))
            fund_id = data.get("fundId")
            if not isinstance(fund_id, str) or not fund_id:
                raise ApiError(422, "invalid_fund", "Vui lòng chọn quỹ thu tiền.")
            fund = lock_funds(tenant_id, [fund_id], row.currency)[fund_id]
            money_record = Payment(
                tenant_id=tenant_id,
                reservation_id=row.id,
                method_id=method.id,
                fund_id=fund.id,
                method_name=method.name,
                fund_name=fund.name,
                amount=amount,
                currency=row.currency,
                note=reason,
                user_id=g.user.id,
                **snapshot_money(tenant_id, row.currency, amount, row),
            )
        adjustment_snapshot = {
            "base_currency": money_record.base_currency,
            "exchange_rate": money_record.exchange_rate,
            "base_amount": money_record.base_amount * (-1 if kind == "credit" else 1),
        }
        charge = Charge(
            tenant_id=tenant_id,
            reservation_id=row.id,
            description=reason[:240],
            kind="discount" if kind == "credit" else "fee",
            quantity=Decimal(1),
            unit_price=amount,
            amount=-amount if kind == "credit" else amount,
            currency=row.currency,
            user_id=g.user.id,
            **adjustment_snapshot,
        )
        db.session.add_all([charge, money_record])
        db.session.flush()
        db.session.add(
            LedgerEntry(
                tenant_id=tenant_id,
                reservation_id=row.id,
                payment_id=payment.id if kind == "credit" else money_record.id,
                refund_id=money_record.id if kind == "credit" else None,
                fund_id=payment.fund_id if kind == "credit" else money_record.fund_id,
                kind="refund" if kind == "credit" else "payment",
                booked_at=local_date(),
                amount=-amount if kind == "credit" else amount,
                currency=row.currency,
                base_currency=money_record.base_currency,
                exchange_rate=money_record.exchange_rate,
                base_amount=-money_record.base_amount
                if kind == "credit"
                else money_record.base_amount,
                description=reason,
                user_id=g.user.id,
            )
        )
        audit(
            "reservation.adjustment",
            "reservation",
            row.id,
            {
                "type": kind,
                "amount": decimal_text(amount),
                "reason": reason,
                "chargeId": charge.id,
                "paymentId": payment.id if kind == "credit" else money_record.id,
                "refundId": money_record.id if kind == "credit" else None,
            },
        )
        return finish_money(row, key, fingerprint)


class AddNoteView(CommonMethodView):
    @staticmethod
    @require_tenant("reservations.write")
    def dispatch_request(tenant_id, reservation_id):
        data = payload()
        row = find_reservation(tenant_id, reservation_id, locked=True)
        key, fingerprint, replay = begin_write(tenant_id, data, required=False)
        if replay is not None:
            return replay, 201
        note = BookingNote(
            tenant_id=tenant_id,
            reservation_id=row.id,
            text=string_value(data.get("text"), "Ghi chú", 2000, required=True),
            user_id=g.user.id,
        )
        db.session.add(note)
        audit("reservation.note", "reservation", row.id)
        db.session.flush()
        return finish_write(tenant_id, key, fingerprint, reservation_json(row), status=201)


def __getattr__(name):
    if name in {"URL", "booking"}:
        from importlib import import_module

        return getattr(import_module(".urls", __package__), name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
