"""Small explicit pricing catalogs; amounts are decimal strings in hotel currency."""

import re
from decimal import Decimal, InvalidOperation

from sqlalchemy import select

from pms_api.ports import runtime

from ..catalog.models import RoomType
from ..core_models import Tenant, uid, utcnow
from ..currencies import is_hotel_currency
from ..extensions import db
from ..security import ApiError, audit
from .engine import business_date, require_feature
from .models import ExchangeRate, PricingRule, Promotion, Voucher


def invalid(message="Cấu hình giá không hợp lệ."):
    raise ApiError(422, "invalid_pricing", message)


def text(value, maximum=160):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
        invalid()
    return value.strip()


def integer(value, low=0, high=3660, nullable=False):
    if nullable and value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        invalid()
    return value


def decimal(value, low=Decimal(0), high=Decimal("999999999999999.9999"), places=4):
    try:
        number = Decimal(str(value))
        if (
            not number.is_finite()
            or number < low
            or number > high
            or number != number.quantize(Decimal(10) ** -places)
        ):
            invalid()
        return str(number)
    except InvalidOperation, ValueError, TypeError:
        invalid()


def optional_date(value):
    from datetime import date

    if value is None or value == "":
        return None
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError, TypeError:
        invalid("Ngày cần dùng định dạng YYYY-MM-DD.")


def window(data, first, last):
    start, end = optional_date(data.get(first)), optional_date(data.get(last))
    if start and end and start >= end:
        invalid("Ngày kết thúc phải sau ngày bắt đầu.")
    return {first: start, last: end}


def row_json(row):
    result = {"id": row.id, "name": row.name, "active": row.active, **row.config}
    if isinstance(row, PricingRule):
        result.update(kind=row.kind, roomTypeId=row.room_type_id, priority=row.priority)
    elif isinstance(row, Promotion):
        result["kind"] = row.kind
    else:
        result.update(
            code=row.code,
            discountType=row.discount_type,
            value=str(row.value),
            usageLimit=row.usage_limit,
            usedCount=row.used_count,
        )
    return result


def pricing_snapshot(tenant_id):
    from ..subscriptions import feature_enabled

    result = {}
    for name, model in (("rules", PricingRule), ("vouchers", Voucher), ("promotions", Promotion)):
        result[name] = [
            row_json(row)
            for row in db.session.scalars(
                select(model).where(model.tenant_id == tenant_id).order_by(model.id)
            )
        ]
    tenant = db.session.get(Tenant, tenant_id)
    base = (tenant.settings or {}).get("currency", "VND")
    result["baseCurrency"] = base
    result["businessDate"] = business_date(tenant).isoformat()
    result["exchangeRates"] = [
        {
            "currency": row.currency,
            "baseCurrency": row.base_currency,
            "rate": str(row.rate),
            "updatedAt": row.updated_at.isoformat(),
        }
        for row in db.session.scalars(
            select(ExchangeRate)
            .where(ExchangeRate.tenant_id == tenant_id)
            .order_by(ExchangeRate.currency)
        )
    ]
    if not feature_enabled("VOUCHER_PROMO"):
        result["vouchers"], result["promotions"] = [], []
    if not feature_enabled("MULTI_CURRENCY"):
        result["exchangeRates"] = []
    return result


def handle_snapshot(tenant_id):
    return pricing_snapshot(tenant_id)


def tenant_lock(tenant_id):
    return db.session.scalar(
        select(Tenant)
        .where(Tenant.id == tenant_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def save(tenant_id, model, name, updating):
    if model in (Promotion, Voucher):
        require_feature("VOUCHER_PROMO")
    data = runtime().payload()
    tenant_lock(tenant_id)
    row = None
    if updating:
        identifier = text(data.get("id"), 40)
        row = db.session.scalar(
            select(model)
            .where(model.tenant_id == tenant_id, model.id == identifier)
            .with_for_update()
        )
        if row is None:
            raise ApiError(404, "not_found", "Không tìm thấy cấu hình giá.")
    common = {"id", "name", "active"}
    specifics = {
        PricingRule: {
            "kind",
            "roomTypeId",
            "priority",
            "adjustmentPercent",
            "weekdays",
            "minNights",
            "maxNights",
        },
        Promotion: {
            "kind",
            "percent",
            "minDaysBefore",
            "maxDaysBefore",
            "minNights",
            "stayN",
            "payM",
            "startDate",
            "endDate",
        },
        Voucher: {
            "code",
            "discountType",
            "value",
            "minNights",
            "minTotal",
            "validFrom",
            "validTo",
            "usageLimit",
        },
    }
    if set(data) - common - specifics[model]:
        invalid("Có trường cấu hình không được hỗ trợ.")
    data = {**(row_json(row) if row else {}), **data}
    name_value = text(data.get("name"))
    active = data.get("active", True)
    if not isinstance(active, bool):
        invalid()
    config = {"minNights": integer(data.get("minNights", 1), 1, 366)}
    if model is PricingRule:
        kind = data.get("kind", "weekend")
        if kind not in ("weekend", "los"):
            invalid()
        type_id = data.get("roomTypeId") or None
        if type_id is not None and (
            not isinstance(type_id, str)
            or not db.session.scalar(
                select(RoomType.id).where(RoomType.tenant_id == tenant_id, RoomType.id == type_id)
            )
        ):
            invalid("Loại phòng không tồn tại trong khách sạn.")
        config["maxNights"] = integer(data.get("maxNights"), 1, 366, nullable=True)
        if config["maxNights"] is not None and config["maxNights"] < config["minNights"]:
            invalid()
        config["adjustmentPercent"] = decimal(
            data.get("adjustmentPercent", "0"), Decimal(-100), Decimal(1000)
        )
        weekdays = data.get("weekdays", [6, 7])
        if not isinstance(weekdays, list) or not weekdays or len(weekdays) > 7:
            invalid()
        config["weekdays"] = sorted({integer(day, 1, 7) for day in weekdays})
        values = dict(
            kind=kind, room_type_id=type_id, priority=integer(data.get("priority", 0), 0, 1000)
        )
    elif model is Promotion:
        kind = data.get("kind", "earlybird")
        if kind not in ("earlybird", "lastminute", "staypay"):
            invalid()
        config.update(window(data, "startDate", "endDate"))
        config["percent"] = decimal(data.get("percent", "0"), high=Decimal(100))
        config["minDaysBefore"] = integer(
            data.get("minDaysBefore", 7 if kind == "earlybird" else 0)
        )
        config["maxDaysBefore"] = integer(
            data.get("maxDaysBefore", 2 if kind == "lastminute" else None), nullable=True
        )
        if (
            config["maxDaysBefore"] is not None
            and config["maxDaysBefore"] < config["minDaysBefore"]
        ):
            invalid()
        config["stayN"] = integer(data.get("stayN", 3), 2, 366)
        config["payM"] = integer(data.get("payM", 2), 1, 365)
        if kind == "staypay" and config["payM"] >= config["stayN"]:
            invalid("Số đêm trả tiền phải nhỏ hơn số đêm lưu trú.")
        values = dict(kind=kind)
    else:
        code = text(data.get("code"), 40).upper()
        if not re.fullmatch(r"[A-Z0-9_-]+", code):
            invalid("Mã voucher chỉ gồm chữ, số, dấu gạch ngang hoặc gạch dưới.")
        discount_type = data.get("discountType", "percent")
        if discount_type not in ("percent", "fixed"):
            invalid()
        value = decimal(
            data.get("value", "0"),
            high=Decimal(100) if discount_type == "percent" else Decimal("999999999999999.9999"),
        )
        config.update(window(data, "validFrom", "validTo"))
        config["minTotal"] = decimal(data.get("minTotal", "0"))
        limit = integer(data.get("usageLimit"), 1, 2147483647, nullable=True)
        if row and limit is not None and limit < row.used_count:
            invalid("Giới hạn không được thấp hơn số lượt đã sử dụng.")
        if db.session.scalar(
            select(Voucher.id).where(
                Voucher.tenant_id == tenant_id,
                Voucher.code == code,
                Voucher.id != (row.id if row else ""),
            )
        ):
            raise ApiError(409, "duplicate_voucher", "Mã voucher đã tồn tại.")
        values = dict(
            code=code, discount_type=discount_type, value=Decimal(value), usage_limit=limit
        )
    if row is None:
        row = model(id=uid(), tenant_id=tenant_id)
        db.session.add(row)
    row.name, row.active, row.config = name_value, active, config
    for key, value in values.items():
        setattr(row, key, value)
    db.session.flush()
    audit(f"pricing.{name}.{'updated' if updating else 'created'}", "pricing", row.id)
    return row_json(row), 200 if updating else 201


def handle_create_rule(tenant_id):
    return save(tenant_id, PricingRule, "rule", False)


def handle_update_rule(tenant_id):
    return save(tenant_id, PricingRule, "rule", True)


def handle_create_promotion(tenant_id):
    return save(tenant_id, Promotion, "promotion", False)


def handle_update_promotion(tenant_id):
    return save(tenant_id, Promotion, "promotion", True)


def handle_create_voucher(tenant_id):
    return save(tenant_id, Voucher, "voucher", False)


def handle_update_voucher(tenant_id):
    return save(tenant_id, Voucher, "voucher", True)


def handle_save_exchange_rate(tenant_id):
    require_feature("MULTI_CURRENCY")
    data = runtime().payload()
    if set(data) - {"currency", "rate"}:
        invalid()
    tenant = tenant_lock(tenant_id)
    base = (tenant.settings or {}).get("currency", "VND")
    currency = data.get("currency")
    if not is_hotel_currency(currency) or currency == base:
        invalid("Tỷ giá tiền tệ gốc luôn bằng 1; hãy chọn tiền tệ còn lại.")
    rate = Decimal(
        decimal(
            data.get("rate"),
            low=Decimal("0.00000001"),
            high=Decimal("99999999999.99999999"),
            places=8,
        )
    )
    row = db.session.scalar(
        select(ExchangeRate)
        .where(ExchangeRate.tenant_id == tenant_id, ExchangeRate.currency == currency)
        .with_for_update()
    )
    if row is None:
        row = ExchangeRate(tenant_id=tenant_id, currency=currency)
        db.session.add(row)
    row.base_currency, row.rate, row.updated_at = base, rate, utcnow()
    db.session.flush()
    audit(
        "pricing.exchange_rate.updated",
        "pricing",
        row.id,
        {"currency": currency, "baseCurrency": base, "rate": str(rate)},
    )
    return {
        "currency": currency,
        "baseCurrency": base,
        "rate": str(rate),
        "updatedAt": row.updated_at.isoformat(),
    }
