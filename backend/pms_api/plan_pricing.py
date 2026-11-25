"""Exact room-based subscription prices shared by commercial plan endpoints."""

import re
from decimal import ROUND_HALF_UP, Decimal, localcontext

from common import ApiError

ROOM_THRESHOLDS = (30, 50, 100)
MONEY_LIMIT = Decimal("999999999999999.9999")


def default_pricing_rules():
    return {
        "baseRooms": 15,
        "extraRoomPrice": "0",
        "extraRoomPriceYear": "0",
        "adjustments": [{"aboveRooms": count, "percent": "0"} for count in ROOM_THRESHOLDS],
    }


def pricing_rules_value(value):
    fields = {"baseRooms", "extraRoomPrice", "extraRoomPriceYear", "adjustments"}
    if not isinstance(value, dict) or set(value) != fields:
        raise ApiError(422, "invalid_pricing_rules", "Cần nhập đủ điều kiện tính giá gói.")
    rooms = value["baseRooms"]
    if isinstance(rooms, bool) or not isinstance(rooms, int) or not 1 <= rooms <= 1000000:
        raise ApiError(422, "invalid_pricing_rules", "Số phòng cơ bản phải từ 1 đến 1.000.000.")

    def decimal_text(raw, *, percent=False):
        pattern = (
            r"[+-]?[0-9]{1,4}(?:\.[0-9]{1,4})?" if percent else r"[0-9]{1,15}(?:\.[0-9]{1,4})?"
        )
        if isinstance(raw, bool) or not isinstance(raw, (str, int, float)):
            raise ApiError(422, "invalid_pricing_rules", "Giá và tỷ lệ phải là số hợp lệ.")
        text = str(raw)
        if not re.fullmatch(pattern, text):
            raise ApiError(422, "invalid_pricing_rules", "Giá và tỷ lệ có tối đa 4 số thập phân.")
        number = Decimal(text)
        if percent and not Decimal(-100) <= number <= Decimal(1000):
            raise ApiError(422, "invalid_pricing_rules", "Tỷ lệ tăng giảm phải từ -100% đến 1000%.")
        return format(number, "f")

    adjustments = value["adjustments"]
    if not isinstance(adjustments, list) or len(adjustments) != len(ROOM_THRESHOLDS):
        raise ApiError(422, "invalid_pricing_rules", "Cần đủ ba mốc vượt 30, 50 và 100 phòng.")
    normalized = []
    for row, threshold in zip(adjustments, ROOM_THRESHOLDS, strict=True):
        if (
            not isinstance(row, dict)
            or set(row) != {"aboveRooms", "percent"}
            or isinstance(row["aboveRooms"], bool)
            or not isinstance(row["aboveRooms"], int)
            or row["aboveRooms"] != threshold
        ):
            raise ApiError(
                422, "invalid_pricing_rules", "Mốc tăng giảm phải là 30, 50 và 100 phòng."
            )
        normalized.append(
            {"aboveRooms": threshold, "percent": decimal_text(row["percent"], percent=True)}
        )
    return {
        "baseRooms": rooms,
        "extraRoomPrice": decimal_text(value["extraRoomPrice"]),
        "extraRoomPriceYear": decimal_text(value["extraRoomPriceYear"]),
        "adjustments": normalized,
    }


def calculate_plan_amount(plan, room_count, cycle="monthly"):
    """Apply only the highest strictly exceeded threshold to the entire cycle price."""
    rules = plan["pricingRules"]
    annual = cycle == "yearly"
    base = Decimal(plan["priceYear"] if annual else plan["price"])
    extra = Decimal(rules["extraRoomPriceYear"] if annual else rules["extraRoomPrice"])
    percent = Decimal(0)
    for row in rules["adjustments"]:
        if room_count > row["aboveRooms"]:
            percent = Decimal(row["percent"])
    with localcontext() as context:
        context.prec = 40
        total = (base + max(0, room_count - rules["baseRooms"]) * extra) * (1 + percent / 100)
        total = total.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
    if total > MONEY_LIMIT:
        raise ApiError(422, "invalid_amount", "Giá gói sau tính toán vượt giới hạn số tiền.")
    return total
