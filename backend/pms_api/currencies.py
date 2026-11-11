"""Common currencies shared by hotel settings and channel workflows.

Verified against https://staging.channex.io/api/v1/currencies on 2026-10-30.
SaaS plan and invoice currencies have their own commercial restrictions.
"""

from .security import ApiError

HOTEL_CURRENCIES = (
    "VND", "USD", "EUR", "GBP", "JPY", "KRW", "CNY", "HKD", "SGD", "THB",
    "AUD", "CAD", "CHF", "NZD", "MYR", "IDR", "PHP", "INR", "AED", "TWD",
)
HOTEL_CURRENCY_CODES = frozenset(HOTEL_CURRENCIES)


def is_hotel_currency(value):
    return isinstance(value, str) and value in HOTEL_CURRENCY_CODES


def normalize_hotel_currency(value):
    if not isinstance(value, str) or not is_hotel_currency(value.strip().upper()):
        raise ApiError(422, "invalid_currency", "Tiền tệ không được hỗ trợ.")
    return value.strip().upper()
