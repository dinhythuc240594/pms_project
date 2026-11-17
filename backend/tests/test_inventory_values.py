"""Exact decimal inventory arithmetic, including the final unit's residual value."""

import unittest
from decimal import Decimal

from pms_api.inventory.routes import allocate_cost, cost_value, stock_quantity
from pms_api.security import ApiError


class InventoryValuesTests(unittest.TestCase):
    def test_four_place_quantity_validation(self):
        self.assertEqual(stock_quantity("0.0001"), Decimal("0.0001"))
        for value in ("NaN", "Infinity", "-1", "0.00001", True, None):
            with self.subTest(value=value), self.assertRaises(ApiError):
                stock_quantity(value)

    def test_exact_eight_place_cost_and_large_values(self):
        self.assertEqual(cost_value(Decimal("0.0001"), Decimal("0.0001")), Decimal("0.00000001"))
        self.assertEqual(
            cost_value(Decimal("999999999999999"), Decimal("999999999999999")),
            Decimal("999999999999998000000000000001.00000000"),
        )

    def test_final_unit_preserves_all_inventory_value(self):
        first = allocate_cost(Decimal("3"), Decimal("10"), Decimal("1"))
        self.assertEqual(first, Decimal("3.33333333"))
        self.assertEqual(
            allocate_cost(Decimal("2"), Decimal("10") - first, Decimal("2")), Decimal("6.66666667")
        )
