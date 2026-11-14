"""POS snapshots never round away an unsupported precision or trust client totals."""

import unittest
from decimal import Decimal

from pms_api.finance.routes import line_amount
from pms_api.security import ApiError


class FinanceValuesTests(unittest.TestCase):
    def test_exact_four_place_totals(self):
        self.assertEqual(line_amount(Decimal("2.5"), Decimal("10.12")), Decimal("25.3000"))

    def test_nonrepresentable_or_overflow_line_is_rejected(self):
        for quantity, price in [("0.0001", "0.0001"), ("99999999", "999999999999999")]:
            with self.subTest(quantity=quantity), self.assertRaises(ApiError):
                line_amount(Decimal(quantity), Decimal(price))
