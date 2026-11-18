"""Deterministic pricing: daily override, one rate rule, then one discount.

Rules use descending priority and ascending ID. A valid explicit voucher replaces
promotions; otherwise the largest eligible promotion wins (ID breaks ties).
Hotel business date controls advance-purchase and voucher validity. Stay windows
are half-open. Voucher quotas are consumed only by a committed new reservation,
including zero-value redemptions; cancellation does not restore a quota.
"""

from datetime import date
from decimal import Decimal
from zoneinfo import ZoneInfo

from pms_api.ports import runtime

from ..core_models import utcnow
from ..currencies import is_hotel_currency
from ..security import ApiError
from .domain import CENT as CENT
from .domain import LIMIT as LIMIT
from .domain import allocate_discount as allocate_discount
from .domain import eligible_promotion as eligible_promotion
from .domain import rounded as rounded


def business_date(tenant):
    return (
        utcnow()
        .astimezone(ZoneInfo((tenant.settings or {}).get("timezone", "Asia/Ho_Chi_Minh")))
        .date()
    )


def exchange_snapshot(tenant_id, currency=None):
    tenant = runtime().pricing.tenant(tenant_id)
    base = (tenant.settings or {}).get("currency", "VND")
    currency = currency or base
    if not is_hotel_currency(currency) or not is_hotel_currency(base):
        raise ApiError(422, "invalid_currency", "Tiền tệ không được hỗ trợ.")
    if currency == base:
        return currency, base, Decimal(1)
    require_feature("MULTI_CURRENCY")
    row = runtime().pricing.exchange_rate(tenant_id, currency, base)
    if not row:
        raise ApiError(409, "exchange_rate_required", "Cần khai báo tỷ giá cho tiền tệ đã chọn.")
    return currency, base, row.rate


def require_feature(code):
    from ..subscriptions import feature_enabled

    if not feature_enabled(code):
        raise ApiError(
            403,
            "feature_disabled",
            "Tính năng đã bị tắt trong gói của khách sạn.",
            {"feature": code},
        )


def snapshot_money(tenant_id, currency, amount, source=None):
    """Model kwargs; a source always reuses its frozen conversion, including refunds."""
    if source is None:
        _, base, rate = exchange_snapshot(tenant_id, currency)
    elif isinstance(source, dict):
        base, rate = source["baseCurrency"], Decimal(source["exchangeRate"])
    else:
        base, rate = source.base_currency, source.exchange_rate
    return {
        "base_currency": base,
        "exchange_rate": rate,
        "base_amount": rounded(Decimal(str(amount)) * rate),
    }


def money_json(row):
    return {
        "baseCurrency": row.base_currency,
        "exchangeRate": str(row.exchange_rate),
        "baseAmount": str(row.base_amount),
    }


def promotional_discount(policy, nightly):
    from .strategies import promotion_strategy

    return promotion_strategy(policy["kind"]).discount(policy, nightly)


def apply_pricing(
    tenant_id,
    nightly,
    start,
    end,
    *,
    currency=None,
    voucher_code=None,
    voucher_policy=None,
    redeem=False,
):
    tenant = runtime().pricing.tenant(tenant_id)
    today = business_date(tenant)
    currency, base, rate = exchange_snapshot(tenant_id, currency)
    nights = (end - start).days
    rules = runtime().pricing.rules(tenant_id)
    priced, applied = [], {}
    for raw in nightly:
        item = dict(raw)
        price = Decimal(item["price"])
        item["priceSource"] = "daily" if item.pop("override", False) else "base"
        if item["priceSource"] != "daily":
            day = date.fromisoformat(item["date"])
            for rule in rules:
                policy = rule.config
                if rule.room_type_id and rule.room_type_id != item["roomTypeId"]:
                    continue
                if (
                    nights < policy["minNights"]
                    or policy["maxNights"] is not None
                    and nights > policy["maxNights"]
                ):
                    continue
                if rule.kind == "weekend" and day.isoweekday() not in policy["weekdays"]:
                    continue
                price = rounded(price * (1 + Decimal(policy["adjustmentPercent"]) / 100))
                item["priceSource"] = rule.id
                applied[rule.id] = {
                    "id": rule.id,
                    "name": rule.name,
                    "kind": rule.kind,
                    "priority": rule.priority,
                    **policy,
                }
                break
        item["price"] = str(price)
        priced.append(item)
    gross = sum((Decimal(item["price"]) for item in priced), Decimal(0))
    discount, selected = Decimal(0), None
    voucher = None
    if voucher_code or voucher_policy is not None:
        require_feature("VOUCHER_PROMO")
    if voucher_policy is not None:
        selected = dict(voucher_policy)
        voucher_code = selected["code"]
    elif voucher_code:
        if not isinstance(voucher_code, str) or len(voucher_code.strip()) > 40:
            raise ApiError(422, "invalid_voucher", "Mã voucher không hợp lệ.")
        voucher = runtime().pricing.voucher_by_code(
            tenant_id, voucher_code.strip().upper(), locked=redeem
        )
        if not voucher or not voucher.active:
            raise ApiError(422, "invalid_voucher", "Voucher không tồn tại hoặc đã ngừng sử dụng.")
        if voucher.usage_limit is not None and voucher.used_count >= voucher.usage_limit:
            raise ApiError(409, "voucher_exhausted", "Voucher đã hết lượt sử dụng.")
        selected = {
            "id": voucher.id,
            "code": voucher.code,
            "name": voucher.name,
            "kind": "voucher",
            "discountType": voucher.discount_type,
            "value": str(voucher.value),
            "bookingDate": today.isoformat(),
            **voucher.config,
        }
    if selected:
        booked = date.fromisoformat(selected.get("bookingDate", today.isoformat()))
        if (
            selected.get("validFrom")
            and booked < date.fromisoformat(selected["validFrom"])
            or selected.get("validTo")
            and booked >= date.fromisoformat(selected["validTo"])
        ):
            raise ApiError(422, "voucher_expired", "Voucher ngoài thời gian hiệu lực.")
        if nights < selected["minNights"] or gross < Decimal(selected["minTotal"]):
            raise ApiError(422, "voucher_conditions", "Đặt phòng chưa đáp ứng điều kiện voucher.")
        value = Decimal(selected["value"])
        discount = rounded(gross * value / 100) if selected["discountType"] == "percent" else value
    else:
        candidates = []
        from ..subscriptions import feature_enabled

        promotions = (
            runtime().pricing.promotions(tenant_id) if feature_enabled("VOUCHER_PROMO") else []
        )
        for promotion in promotions:
            policy = {
                "id": promotion.id,
                "name": promotion.name,
                "kind": promotion.kind,
                **promotion.config,
            }
            if eligible_promotion(policy, start, end, today):
                candidates.append((promotional_discount(policy, priced), promotion.id, policy))
        if candidates:
            discount, _, selected = sorted(candidates, key=lambda item: (-item[0], item[1]))[0]
    discount = min(discount, gross)
    original_prices = [rounded(Decimal(item["price"]) / rate) for item in priced]
    final_prices = allocate_discount(original_prices, rounded(discount / rate))
    for item, original, price in zip(priced, original_prices, final_prices):
        item["listBasePrice"] = item["price"]
        item["listPrice"] = str(original)
        item["price"] = str(price)
        item["baseAmount"] = str(rounded(price * rate))
    total = sum(final_prices, Decimal(0))
    base_amount = sum((Decimal(item["baseAmount"]) for item in priced), Decimal(0))
    # Validate aggregate too: many individually valid nights can exceed storage.
    rounded(total)
    rounded(base_amount)
    snapshot = {
        "version": 1,
        "businessDate": today.isoformat(),
        "rules": list(applied.values()),
        "discount": selected,
        "baseGross": str(gross),
        "discountBase": str(discount),
        "discountAmount": str(sum(original_prices, Decimal(0)) - total),
        "roundingDelta": str(base_amount - (gross - discount)),
    }
    return {
        "currency": currency,
        "baseCurrency": base,
        "exchangeRate": str(rate),
        "baseAmount": str(base_amount),
        "nightlyRates": priced,
        "total": str(total),
        "pricingSnapshot": snapshot,
        "voucherCode": selected["code"] if selected and selected["kind"] == "voucher" else None,
    }


def redeem_voucher(tenant_id, reservation_id, quote):
    policy = quote["pricingSnapshot"]["discount"]
    if not policy or policy["kind"] != "voucher":
        return
    row = runtime().pricing.voucher_by_id(tenant_id, policy["id"])
    if row.usage_limit is not None and row.used_count >= row.usage_limit:
        raise ApiError(409, "voucher_exhausted", "Voucher đã hết lượt sử dụng.")
    row.used_count += 1
    runtime().pricing.add_redemption(
        tenant_id, row.id, reservation_id, Decimal(quote["pricingSnapshot"]["discountBase"])
    )
