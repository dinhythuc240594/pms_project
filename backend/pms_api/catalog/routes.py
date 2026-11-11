"""Validated hotel masters, room configuration and nightly price quotes."""

import re
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from flask import request
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from common import CommonMethodView, RequestData

from ..core_models import Tenant, uid
from ..currencies import is_hotel_currency
from ..extensions import db
from ..security import ApiError, audit, payload, require_tenant
from ..subscriptions import ensure_quota
from ..validation import phone_value, tax_id_value
from .models import (
    DailyRate,
    Master,
    PhysicalRoom,
    RoomBlock,
    RoomType,
    RoomTypeAvailability,
)

CATALOG_FIELDS = {
    "bookingSources": {"type", "commission", "email"},
    "services": {"price", "category", "unit", "tax", "description"},
    "serviceCategories": {"tax"},
    "paymentMethods": {"type", "desc"},
    "funds": {"type", "currency", "accountNumber", "bank", "description"},
    "cashbookCategories": {"type"},
    "commissionTypes": set(),
    "commissionRules": {"typeId"},
    "bedTypes": set(),
    "units": set(),
    "meals": {"price"},
}
DEFAULT_SETTINGS = {
    "timezone": "Asia/Ho_Chi_Minh",
    "currency": "VND",
    "checkInTime": "14:00",
    "checkOutTime": "12:00",
    "address": "",
    "policies": "",
    "phone": "",
    "contactEmail": "",
    "website": "",
    "logoUrl": "",
    "taxCode": "",
    "bankName": "",
    "bankAccount": "",
    "bankAccountName": "",
    "defaultLanguage": "vi",
}


def text_value(value, label, maximum=160, *, empty=False):
    if (
        not isinstance(value, str)
        or len(value.strip()) > maximum
        or (not empty and not value.strip())
    ):
        raise ApiError(422, "VALIDATION_ERROR", f"{label} không hợp lệ.")
    return value.strip()


def bool_value(value):
    if not isinstance(value, bool):
        raise ApiError(422, "VALIDATION_ERROR", "Giá trị bật/tắt phải là boolean.")
    return value


def money_value(value):
    try:
        if isinstance(value, bool):
            raise ValueError
        amount = Decimal(str(value))
        if not amount.is_finite() or amount < 0 or amount > Decimal("999999999999999.9999"):
            raise ValueError
        rounded = amount.quantize(Decimal("0.0001"))
        if amount != rounded:
            raise ValueError
        return rounded
    except (InvalidOperation, ValueError, TypeError):
        raise ApiError(
            422, "VALIDATION_ERROR", "Số tiền phải không âm và tối đa 4 số lẻ."
        ) from None


def parse_date(value):
    if isinstance(value, date):
        return value
    try:
        if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError
        return date.fromisoformat(value)
    except (ValueError, TypeError):
        raise ApiError(422, "VALIDATION_ERROR", "Ngày phải có định dạng YYYY-MM-DD.") from None


def date_range(start, end):
    first, last = parse_date(start), parse_date(end)
    length = (last - first).days
    if length < 1 or length > 366:
        raise ApiError(422, "VALIDATION_ERROR", "Khoảng ngày phải từ 1 đến 366 đêm.")
    return [first + timedelta(days=offset) for offset in range(length)]


def validated_settings(data):
    allowed = set(DEFAULT_SETTINGS) | {"name"}
    if set(data) - allowed:
        raise ApiError(422, "VALIDATION_ERROR", "Cấu hình chứa trường không được hỗ trợ.")
    result = dict(data)
    limits = {
        "name": 160,
        "address": 500,
        "policies": 4000,
        "phone": 40,
        "contactEmail": 254,
        "website": 2048,
        "logoUrl": 2048,
        "taxCode": 80,
        "bankName": 160,
        "bankAccount": 80,
        "bankAccountName": 160,
    }
    for key, maximum in limits.items():
        if key in result:
            result[key] = text_value(result[key], key, maximum, empty=key != "name")
    if result.get("contactEmail"):
        from ..auth.routes import validate_email

        result["contactEmail"] = validate_email(result["contactEmail"])
    if "phone" in result:
        result["phone"] = phone_value(result["phone"])
    if "taxCode" in result:
        result["taxCode"] = tax_id_value(result["taxCode"])
    for key, schemes in (("website", {"http", "https"}), ("logoUrl", {"https"})):
        if not result.get(key):
            continue
        value = result[key]
        try:
            parsed = urlsplit(value)
            host = parsed.hostname or ""
            if (
                parsed.scheme not in schemes
                or not host
                or parsed.username is not None
                or parsed.password is not None
                or any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in value)
                or "\\" in value
            ):
                raise ValueError
            parsed.port  # Reject invalid and out-of-range ports.
            if ":" not in host:
                labels = host.rstrip(".").encode("idna").decode("ascii").split(".")
                if len(".".join(labels)) > 253 or not all(
                    re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", label)
                    for label in labels
                ):
                    raise ValueError
        except (ValueError, UnicodeError):
            raise ApiError(
                422, "VALIDATION_ERROR", f"{key} cần URL hợp lệ, không chứa tài khoản đăng nhập."
            ) from None
    if "defaultLanguage" in result and result["defaultLanguage"] not in ("vi", "en"):
        raise ApiError(422, "VALIDATION_ERROR", "Ngôn ngữ mặc định hỗ trợ vi hoặc en.")
    if "timezone" in result:
        try:
            result["timezone"] = text_value(result["timezone"], "Múi giờ", 100)
            ZoneInfo(result["timezone"])
        except (ZoneInfoNotFoundError, ValueError, TypeError):
            raise ApiError(422, "VALIDATION_ERROR", "Múi giờ IANA không hợp lệ.") from None
    if "currency" in result and not is_hotel_currency(result["currency"]):
        raise ApiError(422, "VALIDATION_ERROR", "Tiền tệ không được hỗ trợ.")
    for key in ("checkInTime", "checkOutTime"):
        if key in result and (
            not isinstance(result[key], str)
            or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", result[key])
        ):
            raise ApiError(422, "VALIDATION_ERROR", "Giờ nhận/trả phải theo HH:MM.")
    return result


def get_room_type(tenant_id, type_id, *, lock=False):
    type_id = text_value(type_id, "Mã loại phòng", 40)
    query = select(RoomType).where(RoomType.tenant_id == tenant_id, RoomType.id == type_id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    value = db.session.scalar(query)
    if value is None:
        raise ApiError(404, "NOT_FOUND", "Không tìm thấy loại phòng.")
    return value


def room_json(room):
    return {
        "id": room.number,
        "uuid": room.id,
        "typeId": room.room_type_id,
        "floor": room.floor,
        "area": room.area,
        "condition": room.condition,
        "active": room.active,
    }


def type_json(room_type):
    return {
        "id": room_type.id,
        "code": room_type.code,
        "name": room_type.name,
        "price": str(room_type.base_price),
        "capacity": room_type.capacity,
        "active": room_type.active,
    }


def master_json(master):
    return {**master.data, "id": master.id, "name": master.name, "active": master.active}


def rate_json(rate):
    return {
        "id": rate.id,
        "roomTypeId": rate.room_type_id,
        "date": rate.date.isoformat(),
        "price": str(rate.price),
        "stopSell": rate.stop_sell,
    }


def block_json(block):
    room = db.session.scalar(
        select(PhysicalRoom).where(
            PhysicalRoom.tenant_id == block.tenant_id, PhysicalRoom.id == block.room_id
        )
    )
    return {
        "id": block.id,
        "roomId": block.room_id,
        "room": room.number,
        "start": block.start_date.isoformat(),
        "end": block.end_date.isoformat(),
        "reason": block.reason,
    }


def catalog_snapshot(tenant_id):
    tenant = db.session.get(Tenant, tenant_id)
    masters = {name: [] for name in CATALOG_FIELDS}
    masters.update(
        {name: [] for name in ("warehouses", "items", "itemCategories", "suppliers", "staff")}
    )
    masters["roomTypes"] = [
        type_json(item)
        for item in db.session.scalars(
            select(RoomType).where(RoomType.tenant_id == tenant_id).order_by(RoomType.name)
        )
    ]
    for item in db.session.scalars(
        select(Master).where(Master.tenant_id == tenant_id).order_by(Master.name)
    ):
        masters.setdefault(item.catalog, []).append(master_json(item))
    return {
        "rooms": [
            room_json(item)
            for item in db.session.scalars(
                select(PhysicalRoom)
                .where(PhysicalRoom.tenant_id == tenant_id)
                .order_by(PhysicalRoom.number)
            )
        ],
        "masters": masters,
        "settings": {**DEFAULT_SETTINGS, **(tenant.settings or {}), "name": tenant.name},
        "rates": [
            rate_json(item)
            for item in db.session.scalars(
                select(DailyRate).where(DailyRate.tenant_id == tenant_id).order_by(DailyRate.date)
            )
        ],
        "roomBlocks": [
            block_json(item)
            for item in db.session.scalars(
                select(RoomBlock)
                .where(RoomBlock.tenant_id == tenant_id)
                .order_by(RoomBlock.start_date)
            )
        ],
    }


def active_reservations(room_ids, *, start=None, end=None):
    from ..bookings.models import ReservationRoom

    query = select(ReservationRoom).where(
        ReservationRoom.room_id.in_(room_ids), ReservationRoom.active.is_(True)
    )
    if start is not None:
        query = query.where(ReservationRoom.check_in < end, ReservationRoom.check_out > start)
    return db.session.scalars(query).first() is not None


def capacity_for(tenant_id, type_id, day):
    room_type = get_room_type(tenant_id, type_id)
    if not room_type.active:
        return 0
    room_ids = set(
        db.session.scalars(
            select(PhysicalRoom.id).where(
                PhysicalRoom.tenant_id == tenant_id,
                PhysicalRoom.room_type_id == type_id,
                PhysicalRoom.active.is_(True),
                PhysicalRoom.condition != "maintenance",
            )
        )
    )
    blocked = set(
        db.session.scalars(
            select(RoomBlock.room_id).where(
                RoomBlock.tenant_id == tenant_id,
                RoomBlock.room_id.in_(room_ids),
                RoomBlock.start_date <= day,
                RoomBlock.end_date > day,
            )
        )
    )
    return len(room_ids - blocked)


def lock_inventory(tenant_id, room_type_ids, start, end):
    days, result = date_range(start, end), {}
    type_ids = sorted(set(room_type_ids))
    # A room-type lock also serializes creation of its previously absent day rows.
    for type_id in type_ids:
        get_room_type(tenant_id, type_id, lock=True)
    for type_id in type_ids:
        for day in days:
            capacity = capacity_for(tenant_id, type_id, day)
            statement = (
                insert(RoomTypeAvailability)
                .values(
                    id=uid(),
                    tenant_id=tenant_id,
                    room_type_id=type_id,
                    date=day,
                    total_rooms=capacity,
                    booked_rooms=0,
                )
                .on_conflict_do_nothing(index_elements=["tenant_id", "room_type_id", "date"])
            )
            db.session.execute(statement)
            row = db.session.scalar(
                select(RoomTypeAvailability)
                .where(
                    RoomTypeAvailability.tenant_id == tenant_id,
                    RoomTypeAvailability.room_type_id == type_id,
                    RoomTypeAvailability.date == day,
                )
                .with_for_update()
            )
            if row.booked_rooms > capacity:
                raise ApiError(
                    409, "INVENTORY_CONFLICT", "Thay đổi này làm số phòng bán vượt sức chứa."
                )
            row.total_rooms = capacity
            result[(type_id, day)] = row
    db.session.flush()
    return result


def adjust_inventory(tenant_id, room_type_ids, start, end, delta):
    rows = lock_inventory(tenant_id, room_type_ids, start, end)
    for (type_id, _), row in rows.items():
        change = delta.get(type_id, 0) if isinstance(delta, dict) else delta
        count = row.booked_rooms + change
        if count < 0 or count > row.total_rooms:
            raise ApiError(
                409, "NO_AVAILABILITY", "Không còn đủ phòng trống trong khoảng ngày đã chọn."
            )
        row.booked_rooms = count
    db.session.flush()
    return rows


def quote_stay(tenant_id, room_numbers, start_date, end_date, **pricing_options):
    days = date_range(start_date, end_date)
    if not isinstance(room_numbers, list) or not room_numbers or len(room_numbers) > 100:
        raise ApiError(422, "VALIDATION_ERROR", "Cần chọn từ 1 đến 100 phòng.")
    numbers = [text_value(item, "Số phòng", 40) for item in room_numbers]
    if len(set(numbers)) != len(numbers):
        raise ApiError(422, "VALIDATION_ERROR", "Mỗi phòng chỉ được chọn một lần.")
    rates, total = [], Decimal("0.0000")
    for number in numbers:
        room = db.session.scalar(
            select(PhysicalRoom).where(
                PhysicalRoom.tenant_id == tenant_id, PhysicalRoom.number == number
            )
        )
        if room is None:
            raise ApiError(404, "NOT_FOUND", "Không tìm thấy phòng.")
        room_type = get_room_type(tenant_id, room.room_type_id)
        if not room.active or not room_type.active or room.condition == "maintenance":
            raise ApiError(409, "ROOM_UNAVAILABLE", "Phòng đang ngừng hoạt động hoặc bảo trì.")
        block = db.session.scalar(
            select(RoomBlock.id).where(
                RoomBlock.tenant_id == tenant_id,
                RoomBlock.room_id == room.id,
                RoomBlock.start_date < days[-1] + timedelta(days=1),
                RoomBlock.end_date > days[0],
            )
        )
        if block:
            raise ApiError(409, "ROOM_BLOCKED", "Phòng bị khóa trong khoảng lưu trú.")
        overrides = {
            item.date: item
            for item in db.session.scalars(
                select(DailyRate).where(
                    DailyRate.tenant_id == tenant_id,
                    DailyRate.room_type_id == room_type.id,
                    DailyRate.date.in_(days),
                )
            )
        }
        for day in days:
            override = overrides.get(day)
            if override and override.stop_sell:
                raise ApiError(409, "STOP_SELL", "Loại phòng đã dừng bán trong khoảng lưu trú.")
            price = override.price if override else room_type.base_price
            total += price
            rates.append(
                {
                    "room": number,
                    "roomId": room.id,
                    "roomTypeId": room_type.id,
                    "date": day.isoformat(),
                    "price": str(price),
                    "override": bool(override),
                }
            )
    from ..pricing.engine import apply_pricing

    priced = apply_pricing(
        tenant_id, rates, days[0], days[-1] + timedelta(days=1), **pricing_options
    )
    return {
        "checkIn": days[0].isoformat(),
        "checkOut": (days[-1] + timedelta(days=1)).isoformat(),
        "rooms": numbers,
        **priced,
    }


def refresh_existing_inventory(tenant_id, type_ids):
    db.session.flush()
    for type_id in sorted(set(type_ids)):
        get_room_type(tenant_id, type_id, lock=True)
    # Changes to physical capacity revalidate all previously sold dates atomically.
    rows = list(
        db.session.scalars(
            select(RoomTypeAvailability)
            .where(
                RoomTypeAvailability.tenant_id == tenant_id,
                RoomTypeAvailability.room_type_id.in_(type_ids),
            )
            .order_by(RoomTypeAvailability.room_type_id, RoomTypeAvailability.date)
            .with_for_update()
        )
    )
    for row in rows:
        capacity = capacity_for(tenant_id, row.room_type_id, row.date)
        if row.booked_rooms > capacity:
            raise ApiError(
                409, "INVENTORY_CONFLICT", "Phòng đã có đặt chỗ, không thể giảm sức chứa."
            )
        row.total_rooms = capacity
    db.session.flush()


def save_room_type(tenant_id, data, *, updating=False, toggle=False):
    type_id = data.get("id")
    if type_id is not None:
        type_id = text_value(type_id, "Mã loại phòng", 40)
    current = (
        db.session.scalar(
            select(RoomType).where(RoomType.tenant_id == tenant_id, RoomType.id == type_id)
        )
        if type_id
        else None
    )
    if updating and current is None:
        raise ApiError(404, "NOT_FOUND", "Không tìm thấy loại phòng.")
    # Match booking's lock order: physical rooms first, then type/day inventory.
    all_rooms = list(
        db.session.scalars(
            select(PhysicalRoom)
            .where(PhysicalRoom.tenant_id == tenant_id)
            .order_by(PhysicalRoom.number)
            .with_for_update()
        )
    )
    if current:
        current = get_room_type(tenant_id, current.id, lock=True)
    else:
        current = RoomType(
            id=uid(), tenant_id=tenant_id, name="", base_price=0, capacity=2, active=True
        )
        db.session.add(current)
    if "name" in data or not current.name:
        current.name = text_value(data.get("name"), "Tên loại phòng", 120)
    if "code" in data:
        code = text_value(data["code"], "Mã loại phòng", 40)
        if db.session.scalar(
            select(RoomType.id).where(
                RoomType.tenant_id == tenant_id, RoomType.code == code, RoomType.id != current.id
            )
        ):
            raise ApiError(
                409, "ROOM_TYPE_CODE_EXISTS", "Mã loại phòng đã tồn tại trong khách sạn."
            )
        current.code = code
    if "price" in data:
        current.base_price = money_value(data["price"])
    if "capacity" in data:
        capacity = data["capacity"]
        if isinstance(capacity, bool) or not isinstance(capacity, int) or not 1 <= capacity <= 50:
            raise ApiError(422, "VALIDATION_ERROR", "Sức chứa phải từ 1 đến 50 người.")
        current.capacity = capacity
    if "active" in data or toggle:
        next_active = not current.active if toggle else bool_value(data["active"])
        affected = [room.id for room in all_rooms if room.room_type_id == current.id]
        if not next_active and affected and active_reservations(affected):
            raise ApiError(409, "ROOM_HAS_BOOKING", "Loại phòng còn đặt chỗ đang hoạt động.")
        current.active = next_active
    db.session.flush()
    affected_types = {current.id}
    if "roomNumbers" in data:
        numbers = data["roomNumbers"]
        if not isinstance(numbers, list) or len(numbers) > 500:
            raise ApiError(422, "VALIDATION_ERROR", "Danh sách số phòng không hợp lệ.")
        numbers = [text_value(number, "Số phòng", 40) for number in numbers]
        if len(numbers) != len(set(numbers)):
            raise ApiError(422, "VALIDATION_ERROR", "Số phòng bị trùng.")
        existing = {room.number: room for room in all_rooms}
        additions = sum(number not in existing or not existing[number].active for number in numbers)
        removals = sum(
            room.active and room.room_type_id == current.id and room.number not in numbers
            for room in all_rooms
        )
        ensure_quota(tenant_id, "rooms", additions - removals, require_registration=additions > 0)
        for room in all_rooms:
            if room.room_type_id == current.id and room.number not in numbers and room.active:
                if active_reservations([room.id]):
                    raise ApiError(
                        409, "ROOM_HAS_BOOKING", "Không thể ngừng phòng đang có đặt chỗ."
                    )
                room.active = False
        for number in numbers:
            room = existing.get(number)
            if room is None:
                db.session.add(
                    PhysicalRoom(
                        id=uid(),
                        tenant_id=tenant_id,
                        number=number,
                        room_type_id=current.id,
                        condition="clean",
                        active=True,
                    )
                )
            elif room.room_type_id != current.id:
                if active_reservations([room.id]):
                    raise ApiError(
                        409, "ROOM_HAS_BOOKING", "Không thể đổi loại phòng đang có đặt chỗ."
                    )
                affected_types.add(room.room_type_id)
                room.room_type_id, room.active = current.id, True
            else:
                room.active = True
    refresh_existing_inventory(tenant_id, sorted(affected_types))
    return type_json(current)


def save_physical_room(tenant_id, data, *, updating=False, toggle=False):
    number = text_value(data.get("number", data.get("id")), "Số phòng", 40)
    location = {
        key: text_value(data[key], label, 120, empty=True) or None
        if data[key] is not None
        else None
        for key, label in (("floor", "Tầng"), ("area", "Khu vực"))
        if key in data
    }
    room = db.session.scalar(
        select(PhysicalRoom)
        .where(PhysicalRoom.tenant_id == tenant_id, PhysicalRoom.number == number)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if updating and room is None:
        raise ApiError(404, "NOT_FOUND", "Không tìm thấy phòng.")
    type_id = text_value(
        data.get("typeId", room.room_type_id if room else None), "Mã loại phòng", 40
    )
    previous_type = room.room_type_id if room else type_id
    previous_condition = room.condition if room else None
    for affected_type in sorted({previous_type, type_id}):
        get_room_type(tenant_id, affected_type, lock=True)
    condition = data.get("condition", room.condition if room else "clean")
    if condition not in ("clean", "dirty", "inspection", "maintenance"):
        raise ApiError(422, "VALIDATION_ERROR", "Trạng thái phòng không hợp lệ.")
    if condition == "inspection" and (room is None or room.condition != condition):
        raise ApiError(
            409,
            "task_workflow_required",
            "Trạng thái đang kiểm tra phải được gửi từ công việc dọn phòng.",
        )
    active = (
        not room.active
        if toggle and room
        else bool_value(data.get("active", room.active if room else True))
    )
    if active and (room is None or not room.active):
        ensure_quota(tenant_id, "rooms")
    if (
        room
        and (not active or type_id != previous_type or condition == "maintenance")
        and active_reservations([room.id])
    ):
        raise ApiError(
            409, "ROOM_HAS_BOOKING", "Không thể ngừng, bảo trì hoặc đổi loại phòng đang có đặt chỗ."
        )
    if room and (room.condition != condition or room.active != active or type_id != previous_type):
        from ..housekeeping.routes import guard_room_condition, invalidate_room_tasks

        guard_room_condition(room, condition)
        invalidate_room_tasks(room, "room_config_changed")
    if room is None:
        room = PhysicalRoom(id=uid(), tenant_id=tenant_id, number=number)
        db.session.add(room)
    room.room_type_id, room.condition, room.active = type_id, condition, active
    for key, value in location.items():
        setattr(room, key, value)
    refresh_existing_inventory(tenant_id, sorted({previous_type, type_id}))
    if previous_condition is not None and previous_condition != room.condition:
        audit(
            f"room.{room.condition}",
            "room",
            room.number,
            {
                "from": previous_condition,
                "condition": room.condition,
            },
        )
    return room_json(room)


def save_master(tenant_id, catalog_name, data, *, updating=False):
    if catalog_name == "roomTypes":
        return save_room_type(tenant_id, data, updating=updating)
    if catalog_name == "rooms":
        return save_physical_room(tenant_id, data, updating=updating)
    if catalog_name not in CATALOG_FIELDS:
        raise ApiError(422, "UNSUPPORTED_CATALOG", "Danh mục chưa thuộc chức năng đang triển khai.")
    if data.get("id") is not None:
        data = {**data, "id": text_value(data["id"], "Mã danh mục", 40)}
    fields = CATALOG_FIELDS[catalog_name]
    if set(data) - fields - {"id", "name", "active"}:
        raise ApiError(422, "VALIDATION_ERROR", "Danh mục chứa trường không được hỗ trợ.")
    current = (
        db.session.scalar(
            select(Master)
            .where(
                Master.tenant_id == tenant_id,
                Master.catalog == catalog_name,
                Master.id == data.get("id"),
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if data.get("id")
        else None
    )
    if updating and current is None:
        raise ApiError(404, "NOT_FOUND", "Không tìm thấy danh mục.")
    existing = current is not None
    if current is None:
        current = Master(
            id=uid(), tenant_id=tenant_id, catalog=catalog_name, name="", data={}, active=True
        )
        db.session.add(current)
    if "name" in data or not current.name:
        current.name = text_value(data.get("name"), "Tên danh mục")
    details = dict(current.data)
    for key in fields.intersection(data):
        value = data[key]
        if key == "price":
            details[key] = str(money_value(value))
        elif key in ("commission", "tax"):
            percentage = money_value(value)
            if percentage > 100:
                raise ApiError(422, "VALIDATION_ERROR", "Tỷ lệ phải từ 0 đến 100%.")
            details[key] = str(percentage)
        else:
            details[key] = text_value(value, key, 500, empty=True)
            if key == "email" and details[key]:
                from ..auth.routes import validate_email

                details[key] = validate_email(details[key])
    if catalog_name == "cashbookCategories" and details.get("type") not in ("INCOME", "EXPENSE"):
        raise ApiError(422, "VALIDATION_ERROR", "Danh mục thu chi cần loại INCOME hoặc EXPENSE.")
    if catalog_name == "commissionRules":
        type_id = text_value(details.get("typeId"), "Loại chi phí hoa hồng", 40)
        commission_type = db.session.scalar(
            select(Master)
            .where(
                Master.tenant_id == tenant_id,
                Master.catalog == "commissionTypes",
                Master.id == type_id,
            )
            .with_for_update()
        )
        if commission_type is None or (
            not commission_type.active and current.data.get("typeId") != type_id
        ):
            raise ApiError(422, "VALIDATION_ERROR", "Loại chi phí hoa hồng không còn sử dụng.")
    if catalog_name == "funds":
        details.setdefault("type", "cash")
        base_currency = (db.session.get(Tenant, tenant_id).settings or {}).get("currency", "VND")
        details.setdefault("currency", base_currency)
        if details["type"] not in ("cash", "bank"):
            raise ApiError(422, "VALIDATION_ERROR", "Loại quỹ phải là cash hoặc bank.")
        if not is_hotel_currency(details["currency"]):
            raise ApiError(422, "VALIDATION_ERROR", "Tiền tệ không được hỗ trợ.")
        if existing and (
            details["type"] != current.data.get("type", "cash")
            or details["currency"] != current.data.get("currency", base_currency)
        ):
            from ..bookings.models import LedgerEntry

            if db.session.scalar(
                select(LedgerEntry.id)
                .where(LedgerEntry.tenant_id == tenant_id, LedgerEntry.fund_id == current.id)
                .limit(1)
            ):
                raise ApiError(
                    409,
                    "FUND_HAS_HISTORY",
                    "Không đổi loại hoặc tiền tệ quỹ khi đã có lịch sử giao dịch.",
                )
    current.data = details
    if "active" in data:
        current.active = bool_value(data["active"])
    db.session.flush()
    return master_json(current)


class SaveMasterRouteView(CommonMethodView):
    @staticmethod
    @require_tenant("settings.write")
    def dispatch_request(tenant_id, catalog_name):
        result = save_master(tenant_id, catalog_name, payload(), updating=request.method == "PATCH")
        audit("master.saved", catalog_name, result.get("uuid", result["id"]))
        return result, 201 if request.method == "POST" else 200


class ToggleMasterRouteView(CommonMethodView):
    @staticmethod
    @require_tenant("settings.write")
    def dispatch_request(tenant_id, catalog_name, item_id):
        if catalog_name == "roomTypes":
            result = save_room_type(tenant_id, {"id": item_id}, updating=True, toggle=True)
        elif catalog_name == "rooms":
            item = db.session.scalar(
                select(PhysicalRoom).where(
                    PhysicalRoom.tenant_id == tenant_id, PhysicalRoom.number == item_id
                )
            )
            if item is None:
                raise ApiError(404, "NOT_FOUND", "Không tìm thấy phòng.")
            result = save_physical_room(tenant_id, {"id": item_id}, updating=True, toggle=True)
        elif catalog_name in CATALOG_FIELDS:
            item = db.session.scalar(
                select(Master)
                .where(
                    Master.tenant_id == tenant_id,
                    Master.catalog == catalog_name,
                    Master.id == item_id,
                )
                .with_for_update()
            )
            if item is None:
                raise ApiError(404, "NOT_FOUND", "Không tìm thấy danh mục.")
            item.active = not item.active
            result = master_json(item)
        else:
            raise ApiError(422, "UNSUPPORTED_CATALOG", "Danh mục chưa được hỗ trợ.")
        audit("master.toggled", catalog_name, item_id, {"active": result["active"]})
        return result


class SettingsRouteView(CommonMethodView):
    @staticmethod
    @require_tenant("settings.write")
    def dispatch_request(tenant_id):
        data = validated_settings(payload())
        tenant = db.session.scalar(
            select(Tenant)
            .where(Tenant.id == tenant_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        old = tenant.settings or {}
        if "currency" in data and data["currency"] != old.get("currency", "VND"):
            from ..bookings.models import LedgerEntry, Reservation
            from ..finance.models import CashDocument, PosInvoice
            from ..inventory.models import InventoryDocument
            from ..pricing.models import ExchangeRate

            if (
                db.session.scalar(
                    select(Reservation.id).where(Reservation.tenant_id == tenant_id).limit(1)
                )
                or db.session.scalar(
                    select(LedgerEntry.id).where(LedgerEntry.tenant_id == tenant_id).limit(1)
                )
                or db.session.scalar(
                    select(PosInvoice.id).where(PosInvoice.tenant_id == tenant_id).limit(1)
                )
                or db.session.scalar(
                    select(CashDocument.id).where(CashDocument.tenant_id == tenant_id).limit(1)
                )
                or db.session.scalar(
                    select(InventoryDocument.id)
                    .where(InventoryDocument.tenant_id == tenant_id)
                    .limit(1)
                )
            ):
                raise ApiError(
                    409,
                    "CURRENCY_HAS_HISTORY",
                    "Không đổi tiền tệ khi đã có lịch sử đặt phòng hoặc tài chính.",
                )
            for exchange in db.session.scalars(
                select(ExchangeRate).where(ExchangeRate.tenant_id == tenant_id)
            ):
                db.session.delete(exchange)
        if "name" in data:
            tenant.name = data.pop("name")
        tenant.settings = {**DEFAULT_SETTINGS, **old, **data}
        audit("settings.saved", "tenant", tenant_id, {"fields": sorted(data)})
        return {**tenant.settings, "name": tenant.name}


class RatesRouteView(CommonMethodView):
    @staticmethod
    @require_tenant("rates.view")
    def dispatch_request(tenant_id):
        days = date_range(*RequestData.date_range())
        result = []
        for room_type in db.session.scalars(
            select(RoomType).where(RoomType.tenant_id == tenant_id)
        ):
            overrides = {
                item.date: item
                for item in db.session.scalars(
                    select(DailyRate).where(
                        DailyRate.tenant_id == tenant_id,
                        DailyRate.room_type_id == room_type.id,
                        DailyRate.date.in_(days),
                    )
                )
            }
            for day in days:
                item = overrides.get(day)
                result.append(
                    rate_json(item)
                    if item
                    else {
                        "id": None,
                        "roomTypeId": room_type.id,
                        "date": day.isoformat(),
                        "price": str(room_type.base_price),
                        "stopSell": False,
                    }
                )
        return {"rates": result}


class SaveRatesRouteView(CommonMethodView):
    @staticmethod
    @require_tenant("settings.write")
    def dispatch_request(tenant_id):
        data = payload()
        room_type = get_room_type(tenant_id, data.get("roomTypeId"), lock=True)
        days = date_range(data.get("start"), data.get("end"))
        if "price" not in data and "stopSell" not in data:
            raise ApiError(422, "VALIDATION_ERROR", "Cần nhập giá hoặc trạng thái dừng bán.")
        price = money_value(data["price"]) if "price" in data else None
        stop_sell = bool_value(data["stopSell"]) if "stopSell" in data else None
        result = []
        for day in days:
            item = db.session.scalar(
                select(DailyRate).where(
                    DailyRate.tenant_id == tenant_id,
                    DailyRate.room_type_id == room_type.id,
                    DailyRate.date == day,
                )
            )
            if item is None:
                item = DailyRate(
                    id=uid(),
                    tenant_id=tenant_id,
                    room_type_id=room_type.id,
                    date=day,
                    price=room_type.base_price,
                    stop_sell=False,
                )
                db.session.add(item)
            if price is not None:
                item.price = price
            if stop_sell is not None:
                item.stop_sell = stop_sell
            result.append(rate_json(item))
        db.session.flush()
        audit(
            "rates.saved",
            "room_type",
            room_type.id,
            {"start": days[0].isoformat(), "end": data["end"]},
        )
        return {"rates": result}


class RoomBlocksRouteView(CommonMethodView):
    @staticmethod
    @require_tenant("rooms.view")
    def dispatch_request(tenant_id):
        return {
            "roomBlocks": [
                block_json(item)
                for item in db.session.scalars(
                    select(RoomBlock)
                    .where(RoomBlock.tenant_id == tenant_id)
                    .order_by(RoomBlock.start_date)
                )
            ]
        }


class AddRoomBlockRouteView(CommonMethodView):
    @staticmethod
    @require_tenant("settings.write")
    def dispatch_request(tenant_id):
        data = payload()
        days = date_range(data.get("start"), data.get("end"))
        number = text_value(data.get("room", data.get("roomNumber")), "Số phòng", 40)
        room = db.session.scalar(
            select(PhysicalRoom)
            .where(
                PhysicalRoom.tenant_id == tenant_id,
                PhysicalRoom.number == number,
            )
            .with_for_update()
        )
        if room is None:
            raise ApiError(404, "NOT_FOUND", "Không tìm thấy phòng.")
        get_room_type(tenant_id, room.room_type_id, lock=True)
        end = days[-1] + timedelta(days=1)
        if active_reservations([room.id], start=days[0], end=end):
            raise ApiError(409, "ROOM_HAS_BOOKING", "Phòng đã có đặt chỗ trong khoảng cần khóa.")
        block = RoomBlock(
            id=uid(),
            tenant_id=tenant_id,
            room_id=room.id,
            start_date=days[0],
            end_date=end,
            reason=text_value(data.get("reason"), "Lý do khóa phòng", 500),
        )
        db.session.add(block)
        refresh_existing_inventory(tenant_id, [room.room_type_id])
        audit("room.blocked", "room", room.id, {"start": data["start"], "end": data["end"]})
        return block_json(block), 201


class DeleteRoomBlockRouteView(CommonMethodView):
    @staticmethod
    @require_tenant("settings.write")
    def dispatch_request(tenant_id, block_id):
        block = db.session.scalar(
            select(RoomBlock).where(RoomBlock.tenant_id == tenant_id, RoomBlock.id == block_id)
        )
        if block is None:
            raise ApiError(404, "NOT_FOUND", "Không tìm thấy khóa phòng.")
        room = db.session.scalar(
            select(PhysicalRoom)
            .where(PhysicalRoom.tenant_id == tenant_id, PhysicalRoom.id == block.room_id)
            .with_for_update()
        )
        get_room_type(tenant_id, room.room_type_id, lock=True)
        db.session.delete(block)
        refresh_existing_inventory(tenant_id, [room.room_type_id])
        audit(
            "room.unblocked",
            "room",
            room.id,
            {
                "blockId": block_id,
                "start": block.start_date.isoformat(),
                "end": block.end_date.isoformat(),
            },
        )
        return {"deleted": True}


class AvailabilityRouteView(CommonMethodView):
    @staticmethod
    @require_tenant("rooms.view")
    def dispatch_request(tenant_id):
        days = date_range(*RequestData.date_range())
        query = select(RoomType).where(RoomType.tenant_id == tenant_id, RoomType.active.is_(True))
        if request.args.get("typeId"):
            query = query.where(RoomType.id == request.args["typeId"])
        result = []
        for room_type in db.session.scalars(query):
            stored = {
                item.date: item
                for item in db.session.scalars(
                    select(RoomTypeAvailability).where(
                        RoomTypeAvailability.tenant_id == tenant_id,
                        RoomTypeAvailability.room_type_id == room_type.id,
                        RoomTypeAvailability.date.in_(days),
                    )
                )
            }
            stopped = {
                item.date
                for item in db.session.scalars(
                    select(DailyRate).where(
                        DailyRate.tenant_id == tenant_id,
                        DailyRate.room_type_id == room_type.id,
                        DailyRate.date.in_(days),
                        DailyRate.stop_sell.is_(True),
                    )
                )
            }
            for day in days:
                capacity = capacity_for(tenant_id, room_type.id, day)
                booked = stored[day].booked_rooms if day in stored else 0
                result.append(
                    {
                        "roomTypeId": room_type.id,
                        "date": day.isoformat(),
                        "total": capacity,
                        "booked": booked,
                        "available": 0 if day in stopped else max(0, capacity - booked),
                        "stopSell": day in stopped,
                    }
                )
        return {"availability": result}


class QuoteRouteView(CommonMethodView):
    @staticmethod
    @require_tenant("reservations.view")
    def dispatch_request(tenant_id):
        data = payload()
        numbers = data.get("rooms", [data.get("room")])
        days = date_range(data.get("checkIn"), data.get("checkOut"))
        if not isinstance(numbers, list) or not numbers or len(numbers) > 100:
            raise ApiError(422, "VALIDATION_ERROR", "Cần chọn từ 1 đến 100 phòng.")
        numbers = [text_value(item, "Số phòng", 40) for item in numbers]
        rooms = list(
            db.session.scalars(
                select(PhysicalRoom)
                .where(PhysicalRoom.tenant_id == tenant_id, PhysicalRoom.number.in_(numbers))
                .order_by(PhysicalRoom.number)
                .with_for_update()
            )
        )
        for type_id in sorted({room.room_type_id for room in rooms}):
            get_room_type(tenant_id, type_id, lock=True)
        result = quote_stay(
            tenant_id,
            numbers,
            days[0],
            days[-1] + timedelta(days=1),
            currency=data.get("currency"),
            voucher_code=data.get("voucherCode"),
        )
        if active_reservations(
            [room.id for room in rooms], start=days[0], end=days[-1] + timedelta(days=1)
        ):
            raise ApiError(409, "ROOM_UNAVAILABLE", "Phòng đã có đặt chỗ trong khoảng lưu trú.")
        return result


def __getattr__(name):
    if name in {"URL", "catalog"}:
        from importlib import import_module

        return getattr(import_module(".urls", __package__), name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
