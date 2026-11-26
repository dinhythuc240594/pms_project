"""Deterministic pricing: daily override, one rate rule, then one discount.

Rules use descending priority and ascending ID. A valid explicit voucher replaces
promotions; otherwise the largest eligible promotion wins (ID breaks ties).
Hotel business date controls advance-purchase and voucher validity. Stay windows
are half-open. Voucher quotas are consumed only by a committed new reservation,
including zero-value redemptions; cancellation does not restore a quota.
"""

from collections import defaultdict
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from sqlalchemy import select

from ..core_models import Tenant, utcnow
from ..currencies import is_hotel_currency
from ..extensions import db
from ..security import ApiError
from .models import ExchangeRate, PricingRule, Promotion, Voucher, VoucherRedemption

CENT = Decimal("0.0001")
LIMIT = Decimal("999999999999999.9999")


def rounded(value):
    try:
        result = Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)
        if not result.is_finite() or abs(result) > LIMIT:
            raise ValueError
        return result
    except (InvalidOperation, ValueError, TypeError):
        raise ApiError(422, "invalid_amount", "Giá trị tiền vượt giới hạn.") from None


def business_date(tenant):
    return (
        utcnow()
        .astimezone(ZoneInfo((tenant.settings or {}).get("timezone", "Asia/Ho_Chi_Minh")))
        .date()
    )


def exchange_snapshot(tenant_id, currency=None):
    tenant = db.session.get(Tenant, tenant_id)
    base = (tenant.settings or {}).get("currency", "VND")
    currency = currency or base
    if not is_hotel_currency(currency) or not is_hotel_currency(base):
        raise ApiError(422, "invalid_currency", "Tiền tệ không được hỗ trợ.")
    if currency == base:
        return currency, base, Decimal(1)
    require_feature("MULTI_CURRENCY")
    row = db.session.scalar(
        select(ExchangeRate).where(
            ExchangeRate.tenant_id == tenant_id,
            ExchangeRate.currency == currency,
            ExchangeRate.base_currency == base,
        )
    )
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


def allocate_discount(prices, discount):
    """Allocate with an exact total; capped rounding residue goes to the last rows."""
    prices = [rounded(price) for price in prices]
    total = sum(prices, Decimal(0))
    discount = min(max(rounded(discount), Decimal(0)), total)
    if total == 0:
        return prices
    remaining = discount
    allocations = []
    for price in prices:
        share = min(price, remaining, rounded(discount * price / total))
        allocations.append(share)
        remaining -= share
    for index in reversed(range(len(prices))):
        extra = min(prices[index] - allocations[index], remaining)
        allocations[index] += extra
        remaining -= extra
    return [price - allocation for price, allocation in zip(prices, allocations)]


def promotional_discount(policy, nightly):
    if policy["kind"] != "staypay":
        return rounded(
            sum((Decimal(n["price"]) for n in nightly), Decimal(0))
            * Decimal(policy["percent"])
            / 100
        )
    rooms = defaultdict(list)
    for night in nightly:
        rooms[night["room"]].append(Decimal(night["price"]))
    return sum(
        (
            sum(
                sorted(prices)[
                    : len(prices) // policy["stayN"] * (policy["stayN"] - policy["payM"])
                ],
                Decimal(0),
            )
            for prices in rooms.values()
        ),
        Decimal(0),
    )


def eligible_promotion(policy, start, end, today):
    nights = (end - start).days
    advance = (start - today).days
    if nights < policy["minNights"] or advance < 0:
        return False
    if policy.get("startDate") and start < date.fromisoformat(policy["startDate"]):
        return False
    if policy.get("endDate") and end > date.fromisoformat(policy["endDate"]):
        return False
    if policy["kind"] == "staypay":
        return nights >= policy["stayN"]
    return advance >= policy["minDaysBefore"] and (
        policy["maxDaysBefore"] is None or advance <= policy["maxDaysBefore"]
    )


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
    tenant = db.session.get(Tenant, tenant_id)
    today = business_date(tenant)
    currency, base, rate = exchange_snapshot(tenant_id, currency)
    nights = (end - start).days
    rules = list(
        db.session.scalars(
            select(PricingRule)
            .where(PricingRule.tenant_id == tenant_id, PricingRule.active.is_(True))
            .order_by(PricingRule.priority.desc(), PricingRule.id)
        )
    )
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
        statement = select(Voucher).where(
            Voucher.tenant_id == tenant_id, Voucher.code == voucher_code.strip().upper()
        )
        if redeem:
            statement = statement.with_for_update().execution_options(populate_existing=True)
        voucher = db.session.scalar(statement)
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
            db.session.scalars(
                select(Promotion)
                .where(Promotion.tenant_id == tenant_id, Promotion.active.is_(True))
                .order_by(Promotion.id)
            )
            if feature_enabled("VOUCHER_PROMO")
            else []
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
    row = db.session.scalar(
        select(Voucher)
        .where(Voucher.tenant_id == tenant_id, Voucher.id == policy["id"])
        .with_for_update()
    )
    if row.usage_limit is not None and row.used_count >= row.usage_limit:
        raise ApiError(409, "voucher_exhausted", "Voucher đã hết lượt sử dụng.")
    row.used_count += 1
    db.session.add(
        VoucherRedemption(
            tenant_id=tenant_id,
            voucher_id=row.id,
            reservation_id=reservation_id,
            discount=Decimal(quote["pricingSnapshot"]["discountBase"]),
        )
    )
