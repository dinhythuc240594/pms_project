"""Domain values and rules without Flask or database access."""

from datetime import date
from decimal import Decimal, InvalidOperation

from common.errors import ApiError
from common.values import ValueFormatter

MONEY_LIMIT = Decimal("999999999999999.9999")
ACTIVE = {"CONFIRMED", "IN_HOUSE"}


def money_value(value, *, allow_zero=False, limit=MONEY_LIMIT):
    if isinstance(value, bool) or value is None:
        raise ApiError(422, "invalid_amount", "Số tiền không hợp lệ.")
    try:
        amount = Decimal(str(value))
    except InvalidOperation, ValueError, TypeError:
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
    except ValueError, TypeError:
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
