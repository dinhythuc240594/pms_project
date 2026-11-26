"""Temporary checkout access must use the same JSON guards as its handler."""

import unittest
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask, g

from common import ApiError
from pms_api.subscriptions import completion_allowed


class SubscriptionCompletionSecurityTests(unittest.TestCase):
    def setUp(self):
        self.granted_at = datetime(2026, 11, 8, tzinfo=UTC)
        self.access = {"createdAt": self.granted_at.isoformat()}
        self.booking = SimpleNamespace(
            status="IN_HOUSE",
            created_at=self.granted_at - timedelta(days=1),
        )
        self.database = self.enterContext(patch("pms_api.subscriptions.db"))
        self.database.session.scalar.return_value = self.booking
        self.app = Flask(__name__)
        self.app.config["TESTING"] = True

        def checkout(reservation_id):
            g.tenant = SimpleNamespace(id="hotel-fixture")
            return {"allowed": completion_allowed("reservations.write", self.access)}

        self.app.add_url_rule(
            "/reservations/<reservation_id>/status",
            endpoint="booking.change_status",
            view_func=checkout,
            methods=["POST"],
        )

        @self.app.errorhandler(ApiError)
        def invalid_input(error):
            return {"error": {"code": error.code}}, error.status

        self.client = self.app.test_client()

    def post(self, **kwargs):
        return self.client.post("/reservations/booking-fixture/status", **kwargs)

    def test_deep_json_returns_422_instead_of_recursion_error(self):
        body = '{"status":"CHECKED_OUT","nested":' + "[" * 100000 + "0" + "]" * 100000 + "}"
        response = self.post(data=body, content_type="application/json")
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json, {"error": {"code": "invalid_json"}})

    def test_invalid_unicode_and_nul_are_rejected_on_completion_branch(self):
        for value in ("\ud800", "\udfff", "fixture\x00value"):
            for extra in ({"note": value}, {value: "note"}):
                with self.subTest(extra=repr(extra)):
                    response = self.post(json={"status": "CHECKED_OUT", **extra})
                    self.assertEqual(response.status_code, 422)
                    self.assertEqual(response.json, {"error": {"code": "invalid_json"}})

    def test_malformed_or_nonobject_json_is_rejected(self):
        for body in ("{", "[]", "null", '"CHECKED_OUT"'):
            with self.subTest(body=body):
                response = self.post(data=body, content_type="application/json")
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.json, {"error": {"code": "invalid_json"}})

    def test_valid_in_house_checkout_preserves_unicode(self):
        response = self.post(json={"status": "CHECKED_OUT", "note": "Khách sạn 🏨"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {"allowed": True})

    def test_other_statuses_do_not_gain_completion_access(self):
        for status in ("IN_HOUSE", "CANCELLED", "NO_SHOW", None, [], {}):
            with self.subTest(status=status):
                response = self.post(json={"status": status})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json, {"allowed": False})
        self.booking.status = "CONFIRMED"
        self.assertEqual(self.post(json={"status": "CHECKED_OUT"}).json, {"allowed": False})

    def test_bookings_created_after_access_and_missing_bookings_are_denied(self):
        for created, expected in (
            (self.granted_at, True),
            (self.granted_at + timedelta(microseconds=1), False),
        ):
            with self.subTest(created=created):
                self.booking.created_at = created
                response = self.post(json={"status": "CHECKED_OUT"})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json, {"allowed": expected})
        self.database.session.scalar.return_value = None
        self.assertEqual(self.post(json={"status": "CHECKED_OUT"}).json, {"allowed": False})
