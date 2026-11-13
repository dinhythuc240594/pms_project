"""Domain values and rules without Flask or database access."""

import re
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from common.errors import ApiError


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
    except InvalidOperation, ValueError, TypeError:
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
    except ValueError, TypeError:
        raise ApiError(422, "VALIDATION_ERROR", "Ngày phải có định dạng YYYY-MM-DD.") from None


def date_range(start, end):
    first, last = parse_date(start), parse_date(end)
    length = (last - first).days
    if length < 1 or length > 366:
        raise ApiError(422, "VALIDATION_ERROR", "Khoảng ngày phải từ 1 đến 366 đêm.")
    return [first + timedelta(days=offset) for offset in range(length)]
