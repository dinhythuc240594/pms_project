"""Exact commercial pricing and persisted renewal snapshots."""

import copy
import unittest
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import delete

from common import ApiError
from pms_api.core_models import Subscription, utcnow
from pms_api.extensions import db
from pms_api.plan_pricing import (
    calculate_plan_amount,
    default_pricing_rules,
    pricing_rules_value,
)
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


def configured_rules():
    return {
        **default_pricing_rules(),
        "extraRoomPrice": "10",
        "extraRoomPriceYear": "100",
        "adjustments": [
            {"aboveRooms": 30, "percent": "-10"},
            {"aboveRooms": 50, "percent": "-20"},
            {"aboveRooms": 100, "percent": "+5"},
        ],
    }


class PlanPricingValueTests(unittest.TestCase):
    def test_thresholds_are_strict_and_only_the_highest_adjustment_applies(self):
        plan = {"price": "1000", "priceYear": "10000", "pricingRules": configured_rules()}
        for rooms, expected in (
            (1, "1000.0000"),
            (15, "1000.0000"),
            (16, "1010.0000"),
            (30, "1150.0000"),
            (31, "1044.0000"),
            (50, "1215.0000"),
            (51, "1088.0000"),
            (100, "1480.0000"),
            (101, "1953.0000"),
        ):
            with self.subTest(rooms=rooms):
                self.assertEqual(calculate_plan_amount(plan, rooms), Decimal(expected))
        self.assertEqual(calculate_plan_amount(plan, 51, "yearly"), Decimal("10880.0000"))

    def test_decimal_rounding_and_zero_are_exact(self):
        rules = default_pricing_rules()
        rules["adjustments"][0]["percent"] = "50"
        plan = {"price": "0.0001", "priceYear": "0", "pricingRules": rules}
        self.assertEqual(calculate_plan_amount(plan, 31), Decimal("0.0002"))
        rules["adjustments"][0]["percent"] = "-100"
        self.assertEqual(calculate_plan_amount(plan, 31), Decimal("0.0000"))
        plan["price"] = "999999999999999.9999"
        rules["adjustments"][0]["percent"] = "0.0001"
        with self.assertRaises(ApiError):
            calculate_plan_amount(plan, 31)

    def test_malformed_rules_cannot_change_prices_or_thresholds(self):
        variants = [None, {}, [], {**configured_rules(), "unknown": 1}]
        for key, values in (
            ("baseRooms", [True, 0, -1, "15", 1000001]),
            ("extraRoomPrice", [True, "-1", "NaN", "1e3", "0.00001", "1000000000000000"]),
            ("adjustments", [[], [{"aboveRooms": 30, "percent": "0"}]]),
        ):
            variants.extend({**configured_rules(), key: value} for value in values)
        for key, value in (
            ("aboveRooms", 31),
            ("aboveRooms", 30.0),
            ("percent", "-100.0001"),
            ("percent", "1000.0001"),
            ("percent", "NaN"),
            ("percent", True),
        ):
            rules = configured_rules()
            rules["adjustments"][0][key] = value
            variants.append(rules)
        for rules in variants:
            with self.subTest(rules=rules), self.assertRaises(ApiError):
                pricing_rules_value(rules)
        normalized = pricing_rules_value(configured_rules())
        self.assertEqual(normalized["adjustments"][2]["percent"], "5")
        original = default_pricing_rules()
        changed = default_pricing_rules()
        changed["adjustments"][0]["percent"] = "20"
        self.assertEqual(original["adjustments"][0]["percent"], "0")


class PlanPricingApiTests(DomainTestCase):
    def setUp(self):
        super().setUp()
        self.admin, self.headers = self.login("admin@test.local")

    def admin_request(self, method, path, data=None):
        return self.request(method, path, data, client=self.admin, headers=self.headers)

    def create_plan(self, **overrides):
        response = self.admin_request(
            "POST",
            "/api/plans",
            {
                "code": "ROOM_PRICE",
                "name": "Room pricing",
                "price": "1000",
                "priceYear": "10000",
                "pricingRules": configured_rules(),
                **overrides,
            },
        )
        self.assertEqual(response.status_code, 201, response.json)
        return response.json

    def assign(self, plan, **overrides):
        return self.admin_request(
            "PUT",
            f"/api/tenants/{self.tenant_id}/subscription",
            {
                "planId": plan["id"],
                "endDate": (utcnow() + timedelta(days=60)).isoformat(),
                **overrides,
            },
        )

    def test_rules_persist_in_public_catalog_and_survive_partial_edits(self):
        rules = pricing_rules_value(configured_rules())
        plan = self.create_plan()
        self.assertEqual(plan["pricingRules"], rules)
        patched = self.admin_request("PATCH", "/api/plans/" + plan["id"], {"name": "Renamed"})
        self.assertEqual(patched.status_code, 200, patched.json)
        self.assertEqual(patched.json["pricingRules"], rules)
        public = self.app.test_client().get("/api/public/plans").json["plans"]
        self.assertEqual(
            next(row for row in public if row["id"] == plan["id"])["pricingRules"], rules
        )

    def test_default_rooms_and_prices_are_authoritative_and_history_stays_frozen(self):
        plan = self.create_plan()
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            db.session.execute(delete(Subscription).where(Subscription.tenant_id == self.tenant_id))
            db.session.commit()
        initial = self.assign(plan, amount="1")
        self.assertEqual(initial.status_code, 200, initial.json)
        self.assertEqual(initial.json["subscription"]["roomCount"], 15)
        first = initial.json["history"][0]
        self.assertEqual(first["amount"], "1000.0000")
        self.assertEqual(first["cycle"], "monthly")
        renewed = self.assign(plan, roomCount=51, cycle="yearly", amount="0")
        self.assertEqual(renewed.status_code, 200, renewed.json)
        self.assertEqual(renewed.json["history"][0]["amount"], "10880.0000")
        edited = self.admin_request("PATCH", "/api/plans/" + plan["id"], {"price": "2000"})
        self.assertEqual(edited.status_code, 200, edited.json)
        current = self.admin_request("GET", f"/api/tenants/{self.tenant_id}/subscription").json
        self.assertEqual(
            next(row for row in current["history"] if row["id"] == first["id"])["amount"],
            "1000.0000",
        )
        preserved = self.assign(plan)
        self.assertEqual(preserved.status_code, 200, preserved.json)
        self.assertEqual(preserved.json["subscription"]["roomCount"], 51)
        self.assertEqual(preserved.json["history"][0]["amount"], "1888.0000")

    def test_defaults_respect_plan_cap_and_reject_invalid_rules(self):
        data = {"code": "ROOM_PRICE", "name": "Pricing", "price": "1000"}
        invalid = configured_rules()
        invalid["adjustments"][0]["percent"] = "-100.1"
        rejected = self.admin_request("POST", "/api/plans", {**data, "pricingRules": invalid})
        self.assertEqual(rejected.status_code, 422, rejected.json)
        free = self.admin_request(
            "POST",
            "/api/plans",
            {
                "code": "FREE",
                "name": "Free",
                "price": "0",
                "priceYear": "0",
                "pricingRules": configured_rules(),
            },
        )
        self.assertEqual(free.status_code, 422, free.json)
        plan = self.create_plan(maxRooms=10)
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            db.session.execute(delete(Subscription).where(Subscription.tenant_id == self.tenant_id))
            db.session.commit()
        assigned = self.assign(plan)
        self.assertEqual(assigned.status_code, 200, assigned.json)
        self.assertEqual(assigned.json["subscription"]["roomCount"], 10)
        before = copy.deepcopy(assigned.json)
        invalid_cycle = self.assign(plan, cycle=None)
        self.assertEqual(invalid_cycle.status_code, 422, invalid_cycle.json)
        current = self.admin_request("GET", f"/api/tenants/{self.tenant_id}/subscription").json
        self.assertEqual(current["subscription"], before["subscription"])
        self.assertEqual(current["history"], before["history"])


if __name__ == "__main__":
    unittest.main()
