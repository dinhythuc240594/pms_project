"""Booking input tests: financial values must never silently round user input."""

import unittest
from contextlib import ExitStack
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask, g

from pms_api.bookings.routes import AddChargeView, money_value, stay_dates
from pms_api.security import ApiError


class BookingValueTests(unittest.TestCase):
    def test_money_is_exact_and_accepts_four_decimal_places(self):
        self.assertEqual(money_value("123.4567"), Decimal("123.4567"))

    def test_money_rejects_nonfinite_negative_or_excess_precision(self):
        for value in ("NaN", "Infinity", "-1", "1.00001", True, "1e40"):
            with self.subTest(value=value), self.assertRaises(ApiError):
                money_value(value)

    def test_zero_allowed_only_when_requested(self):
        self.assertEqual(money_value("0", allow_zero=True), Decimal(0))
        with self.assertRaises(ApiError):
            money_value("0")

    def test_stay_uses_half_open_dates_and_bounds_length(self):
        start, end = stay_dates("2026-10-03", "2026-10-04")
        self.assertEqual((end - start).days, 1)
        for dates in (
            ("2026-10-04", "2026-10-04"),
            ("2026-10-04", "2026-10-03"),
            ("2026-10-03", "2028-10-03"),
            ("bad", "2026-10-04"),
        ):
            with self.subTest(dates=dates), self.assertRaises(ApiError):
                stay_dates(*dates)


class ChargeInputSecurityTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        stack = self.enterContext(ExitStack())
        row = SimpleNamespace(id="booking", tenant_id="hotel", status="CONFIRMED", currency="VND")
        stack.enter_context(patch("pms_api.bookings.routes.find_reservation", return_value=row))
        stack.enter_context(
            patch(
                "pms_api.bookings.routes.begin_money",
                return_value=(None, None, None),
            )
        )
        stack.enter_context(
            patch(
                "pms_api.bookings.routes.totals",
                return_value=(Decimal(100), Decimal(0), Decimal(100)),
            )
        )
        stack.enter_context(patch("pms_api.bookings.routes.snapshot_money", return_value={}))
        stack.enter_context(patch("pms_api.bookings.routes.audit"))
        stack.enter_context(
            patch(
                "pms_api.bookings.routes.finish_money",
                return_value=({"saved": True}, 201),
            )
        )
        self.database = stack.enter_context(patch("pms_api.bookings.routes.db"))

    def dispatch(self, body):
        with self.app.test_request_context(json=body, method="POST"):
            g.user = SimpleNamespace(id="actor")
            # Authorization is covered by endpoint integration tests; exercise input and writes here.
            return AddChargeView.dispatch_request.__wrapped__("hotel", "booking")

    def test_composite_and_invalid_charge_types_are_rejected_without_writes(self):
        for value in ([], {}, ["service"], True, 1, None, "unknown"):
            with self.subTest(value=value):
                with self.assertRaises(ApiError) as caught:
                    self.dispatch({"type": value, "description": "Charge", "unitPrice": "10"})
                self.assertEqual(caught.exception.status, 422)
                self.assertEqual(caught.exception.code, "invalid_charge")
        self.database.session.add.assert_not_called()

    def test_supported_charge_types_keep_amounts_and_default_service(self):
        for value in ("service", "fee", "tax", "discount", None):
            with self.subTest(value=value):
                body = {"description": "Charge", "unitPrice": "10", "quantity": "2"}
                if value is not None:
                    body["type"] = value
                self.assertEqual(self.dispatch(body), ({"saved": True}, 201))
                charge = self.database.session.add.call_args.args[0]
                self.assertEqual(charge.kind, value or "service")
                self.assertEqual(charge.amount, Decimal(-20 if value == "discount" else 20))
