"""Price precedence and rounding are explicit, including zero-price stays."""

import unittest
from decimal import Decimal

from pms_api.pricing.engine import allocate_discount, promotional_discount


class PricingValueTests(unittest.TestCase):
    def test_discount_allocation_reconciles_exactly(self):
        discounted = allocate_discount(
            [Decimal("10"), Decimal("20"), Decimal("30")], Decimal("7.0001")
        )
        self.assertEqual(sum(discounted), Decimal("52.9999"))
        self.assertTrue(all(value >= 0 for value in discounted))

    def test_stay_three_pay_two_uses_cheapest_night_per_room(self):
        rows = [
            {"room": "101", "price": "100", "date": "2026-10-10"},
            {"room": "101", "price": "150", "date": "2026-10-11"},
            {"room": "101", "price": "120", "date": "2026-10-12"},
        ]
        promotion = {"kind": "staypay", "stayN": 3, "payM": 2, "percent": "0"}
        self.assertEqual(promotional_discount(promotion, rows), Decimal("100"))

    def test_zero_total_allocates_without_dividing_by_zero(self):
        self.assertEqual(
            allocate_discount([Decimal(0), Decimal(0)], Decimal(0)), [Decimal(0), Decimal(0)]
        )
