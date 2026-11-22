"""Preview and confirm the remaining stay without rewriting served room nights."""

import hmac
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import delete, select

from pms_api.bookings.application import (
    begin_write,
    check_guest_capacity,
    check_overlaps,
    decimal_text,
    find_reservation,
    finish_write,
    inventory,
    iso,
    load_booking_data,
    lock_inventory,
    lock_rooms,
    require_booking_version,
    reservation_json,
    room_numbers,
    rows_for,
    stay_dates,
    string_value,
    totals,
)
from pms_api.catalog.application import quote_stay
from pms_api.housekeeping.application import (
    cancel_reservation_tasks,
    checkout_task,
    invalidate_room_tasks,
)
from pms_api.ports import runtime

from ..channels.models import ChannelBooking, ChannelConnection
from ..core_models import utcnow
from ..extensions import db
from ..pricing.engine import business_date, rounded
from ..reconciliation.service import preview_token
from ..security import ApiError, audit
from .models import ReservationNight, ReservationRoom


def change_preview(row, data):
    if set(data) - {
        "rooms",
        "effectiveDate",
        "checkOut",
        "expectedVersion",
        "previewToken",
        "reason",
        "confirmOta",
    }:
        raise ApiError(
            422, "invalid_stay_change", "Thay đổi lưu trú chứa trường không được hỗ trợ."
        )
    require_booking_version(row, data)
    if row.status != "IN_HOUSE":
        raise ApiError(409, "stay_not_started", "Chỉ thay đổi lưu trú đã nhận phòng.")
    today = business_date(runtime().state.tenant)
    from ..reconciliation.business_days import ensure_open_day

    ensure_open_day(row.tenant_id, min(today, row.check_out))
    try:
        effective = date.fromisoformat(data.get("effectiveDate", ""))
    except TypeError, ValueError:
        raise ApiError(422, "invalid_dates", "Chọn ngày thay đổi hợp lệ.") from None
    _, end = stay_dates(row.check_in, data.get("checkOut"))
    if effective != today or end < today or effective < row.check_in:
        raise ApiError(
            422, "invalid_dates", "Thay đổi có hiệu lực hôm nay; ngày trả không được ở quá khứ."
        )
    old = rows_for(ReservationRoom, row.tenant_id, row.id)
    numbers = room_numbers(data, [room.room_number for room in old])
    if len(numbers) != len(old):
        raise ApiError(
            422,
            "room_count_frozen",
            "Giữ số phòng của lưu trú; chuyển từng phòng bằng cách chọn phòng thay thế.",
        )
    if end == today and numbers != sorted(room.room_number for room in old):
        raise ApiError(422, "invalid_stay_change", "Trả sớm hôm nay giữ nguyên phòng đang ở.")
    rooms = lock_rooms(row.tenant_id, sorted(set(numbers) | {room.room_number for room in old}))
    selected = [room for room in rooms if room.number in numbers]
    if any(
        room.number not in {r.room_number for r in old} and room.condition != "clean"
        for room in selected
    ):
        raise ApiError(409, "room_not_ready", "Phòng chuyển đến phải sạch.")
    booking = reservation_json(row)
    check_guest_capacity(row.tenant_id, selected, booking["guests"])
    if end > effective:
        check_overlaps(row.tenant_id, selected, effective, end, row.id)
        # The platform validates active rooms, blocks and stop-sell before pricing.
        quote = quote_stay(row.tenant_id, numbers, effective, end, currency=row.base_currency)
        quoted = {(item["room"], item["date"]): item for item in quote["nightlyRates"]}
    else:
        quoted = {}
    existing = rows_for(ReservationNight, row.tenant_id, row.id)
    old_nights = {(night.room_id, night.date): night for night in existing}
    remaining = sorted(selected, key=lambda room: room.number)
    pairs = []
    # Retain each room first, then same-type moves, before matching an upgrade.
    for previous in sorted(old, key=lambda room: room.room_number):
        target = next((r for r in remaining if r.id == previous.room_id), None)
        if target:
            pairs.append((previous, target))
            remaining.remove(target)
    for previous in sorted(old, key=lambda room: room.room_number):
        if any(before.id == previous.id for before, _ in pairs):
            continue
        target = next(
            (r for r in remaining if r.room_type_id == previous.room_type_id), remaining[0]
        )
        remaining.remove(target)
        pairs.append((previous, target))
    nightly = []
    for previous, target in pairs:
        day = effective
        while day < end:
            retained = old_nights.get((previous.room_id, day))
            keep = retained and previous.room_type_id == target.room_type_id
            price = (
                retained.price
                if keep
                else rounded(Decimal(quoted[target.number, iso(day)]["price"]) / row.exchange_rate)
            )
            nightly.append(
                {
                    "roomId": target.id,
                    "room": target.number,
                    "roomTypeId": target.room_type_id,
                    "date": iso(day),
                    "price": decimal_text(price),
                    "baseAmount": decimal_text(
                        retained.base_amount if keep else rounded(price * row.exchange_rate)
                    ),
                    "exchangeRate": str(retained.exchange_rate if keep else row.exchange_rate),
                    "baseCurrency": retained.base_currency if keep else row.base_currency,
                }
            )
            day += timedelta(days=1)
    if row.check_out < effective:
        old_numbers = sorted(room.room_number for room in old)
        old_physical = [room for room in rooms if room.number in old_numbers]
        check_overlaps(row.tenant_id, old_physical, row.check_out, effective, row.id)
        overdue = quote_stay(
            row.tenant_id, old_numbers, row.check_out, effective, currency=row.base_currency
        )
        for item in overdue["nightlyRates"]:
            price = rounded(Decimal(item["price"]) / row.exchange_rate)
            nightly.append(
                {
                    **{key: item[key] for key in ("roomId", "room", "roomTypeId", "date")},
                    "price": decimal_text(price),
                    "baseAmount": decimal_text(rounded(price * row.exchange_rate)),
                    "baseCurrency": row.base_currency,
                    "exchangeRate": str(row.exchange_rate),
                }
            )
    history = [night for night in existing if night.date < effective]
    old_total, paid, _ = totals(row)
    room_before = sum((night.price for night in existing), Decimal(0))
    room_after = sum((night.price for night in history), Decimal(0)) + sum(
        (Decimal(n["price"]) for n in nightly), Decimal(0)
    )
    total = old_total - room_before + room_after
    linked = db.session.scalar(
        select(ChannelBooking.id).where(
            ChannelBooking.tenant_id == row.tenant_id,
            ChannelBooking.reservation_id == row.id,
        )
    )
    result = {
        "bookingId": row.id,
        "expectedVersion": row.version,
        "effectiveDate": iso(effective),
        "previousCheckOut": iso(row.check_out),
        "checkOut": iso(end),
        "rooms": numbers,
        "previousRooms": sorted(r.room_number for r in old),
        "nightlyRates": nightly,
        "total": decimal_text(total),
        "previousTotal": decimal_text(old_total),
        "difference": decimal_text(total - old_total),
        "paid": decimal_text(paid),
        "balance": decimal_text(total - paid),
        "refundRequired": decimal_text(max(paid - total, Decimal(0))),
        "currency": row.currency,
        "baseCurrency": row.base_currency,
        "exchangeRate": str(row.exchange_rate),
        "checkoutNow": end == today,
        "otaLinked": bool(linked),
    }
    return {**result, "previewToken": preview_token(result)}, old, rooms


def handle_preview_stay_change(tenant_id, reservation_id):
    row = find_reservation(tenant_id, reservation_id, locked=True)
    return change_preview(row, runtime().payload())[0]


def handle_confirm_stay_change(tenant_id, reservation_id):
    data = runtime().payload()
    row = find_reservation(tenant_id, reservation_id, locked=True)
    key, fingerprint, replay = begin_write(tenant_id, data)
    if replay is not None:
        return replay
    reason = string_value(data.get("reason"), "Lý do thay đổi", 1000, required=True)
    preview, old, rooms = change_preview(row, data)
    supplied = data.get("previewToken")
    if (
        not isinstance(supplied, str)
        or not supplied.isascii()
        or not hmac.compare_digest(supplied, preview["previewToken"])
    ):
        raise ApiError(409, "preview_changed", "Dữ liệu/giá đã đổi; tải lại bản xem trước.")
    if Decimal(preview["refundRequired"]) > 0:
        raise ApiError(
            409,
            "refund_required",
            "Hoàn phần tiền dư trước khi xác nhận trả sớm.",
            {"amount": preview["refundRequired"]},
        )
    if preview["checkoutNow"] and Decimal(preview["balance"]) != 0:
        raise ApiError(
            409, "unpaid_balance", "Thanh toán đủ tổng tiền sau điều chỉnh trước khi trả sớm."
        )
    if preview["otaLinked"] and data.get("confirmOta") is not True:
        raise ApiError(
            409,
            "ota_confirmation_required",
            "Xác nhận thay đổi nội bộ và đối soát đặt phòng với OTA.",
        )
    effective, end = (
        date.fromisoformat(preview["effectiveDate"]),
        date.fromisoformat(preview["checkOut"]),
    )
    lock_inventory(
        tenant_id,
        sorted({room.room_type_id for room in rooms}),
        min(r.check_in for r in old),
        max(row.check_out, end),
    )
    inventory(tenant_id, old, row.check_in, row.check_out, -1)
    db.session.execute(
        delete(ReservationNight).where(
            ReservationNight.tenant_id == tenant_id,
            ReservationNight.reservation_id == row.id,
            ReservationNight.date >= effective,
        )
    )
    db.session.execute(
        delete(ReservationRoom).where(
            ReservationRoom.tenant_id == tenant_id,
            ReservationRoom.reservation_id == row.id,
        )
    )
    selected = [room for room in rooms if room.number in preview["rooms"]]
    cancel_reservation_tasks(row, rooms, "stay_changed")
    for room in rooms:
        if room.number in preview["previousRooms"] and (
            room.number not in preview["rooms"] or preview["checkoutNow"]
        ):
            room.condition = "dirty"
            checkout_task(room, row)
            audit(
                "room.dirty", "room", room.number, {"condition": "dirty", "reservationId": row.id}
            )
        elif room.number not in preview["previousRooms"]:
            invalidate_room_tasks(room, "stay_changed")
    for item in preview["nightlyRates"]:
        db.session.add(
            ReservationNight(
                tenant_id=tenant_id,
                reservation_id=row.id,
                room_id=item["roomId"],
                room_number=item["room"],
                room_type_id=item["roomTypeId"],
                date=date.fromisoformat(item["date"]),
                price=Decimal(item["price"]),
                base_amount=Decimal(item["baseAmount"]),
                base_currency=item["baseCurrency"],
                exchange_rate=Decimal(item["exchangeRate"]),
            )
        )
    for room in selected:
        db.session.add(
            ReservationRoom(
                tenant_id=tenant_id,
                reservation_id=row.id,
                room_id=room.id,
                room_number=room.number,
                room_type_id=room.room_type_id,
                check_in=effective if end > effective else row.check_in,
                check_out=end,
                active=not preview["checkoutNow"],
            )
        )
    if end > effective:
        inventory(tenant_id, selected, effective, end, 1)
    row.check_out = end
    row.version += 1
    if preview["checkoutNow"]:
        row.status, row.checked_out_at = "CHECKED_OUT", utcnow()
    row.base_amount = sum(
        (night.base_amount for night in rows_for(ReservationNight, tenant_id, row.id)), Decimal(0)
    )
    entry = audit(
        "reservation.updated",
        "reservation",
        row.id,
        {"stayChanged": True, "reason": reason, **preview},
    )
    if preview["otaLinked"]:
        from pms_api.channels.exceptions_application import receive_incident

        receive_incident(
            tenant_id,
            {
                "property_id": db.session.scalar(
                    select(ChannelConnection.property_id).where(
                        ChannelConnection.tenant_id == tenant_id
                    )
                ),
                "event": "sync_warning",
                "timestamp": utcnow().isoformat(),
                "payload": {
                    "channel_name": "Thay đổi lưu trú PMS",
                    "error_type": "local_stay_change_requires_provider_confirmation",
                    "channel_event_id": entry.id,
                },
            },
        )
    db.session.flush()
    return finish_write(
        tenant_id, key, fingerprint, reservation_json(row, load_booking_data(tenant_id, row.id))
    )
