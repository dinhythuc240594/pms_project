"""Domain values and rules without Flask or database access."""

from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from common.errors import ApiError

CENT = Decimal("0.0001")
LIMIT = Decimal("999999999999999.9999")


def rounded(value):
    try:
        result = Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)
        if not result.is_finite() or abs(result) > LIMIT:
            raise ValueError
        return result
    except InvalidOperation, ValueError, TypeError:
        raise ApiError(422, "invalid_amount", "Giá trị tiền vượt giới hạn.") from None


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
