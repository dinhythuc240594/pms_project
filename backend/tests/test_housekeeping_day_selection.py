"""Day-specific choices must be bounded and match this tenant, staff member and date."""

import unittest
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import patch

from pms_api.housekeeping.routes import plan_day_values, validate_plan_days
from pms_api.security import ApiError


class DailyPlanValueTests(unittest.TestCase):
    day = date(2026, 10, 17)

    def parse(self, rows):
        return plan_day_values({"dayPlans": rows}, [self.day], ["a", "b"])

    def test_room_and_shift_choices_preserve_explicit_null_and_automatic_defaults(self):
        self.assertEqual(plan_day_values({}, [self.day], ["a"]), {})
        self.assertEqual(
            self.parse([{"date": str(self.day)}]), {self.day: {"room_ids": None, "shifts": {}}}
        )
        self.assertEqual(
            self.parse(
                [
                    {
                        "date": str(self.day),
                        "roomIds": ["r"],
                        "shifts": [
                            {"staffId": "a", "shiftId": "late"},
                            {"staffId": "b", "shiftId": None},
                        ],
                    }
                ]
            ),
            {self.day: {"room_ids": ["r"], "shifts": {"a": "late", "b": None}}},
        )

    def test_daily_choices_reject_invalid_scope_shapes_duplicates_and_empty_rooms(self):
        for rows in (
            None,
            {},
            [None],
            [{"date": str(self.day + timedelta(days=1))}],
            [{"date": str(self.day)}] * 2,
            [{"date": str(self.day), "roomIds": []}],
            [{"date": str(self.day), "roomIds": "r"}],
            [{"date": str(self.day), "roomIds": [True]}],
            [{"date": str(self.day), "roomIds": ["r", " r "]}],
            [{"date": str(self.day), "roomIds": [str(i) for i in range(501)]}],
            [{"date": str(self.day), "shifts": {}}],
            [{"date": str(self.day), "shifts": [None]}],
            [{"date": str(self.day), "shifts": [{"staffId": "outside", "shiftId": "s"}]}],
            [{"date": str(self.day), "shifts": [{"staffId": "a"}]}],
            [{"date": str(self.day), "shifts": [{"staffId": "a", "shiftId": True}]}],
            [{"date": str(self.day), "shifts": [{"staffId": "a", "shiftId": None}] * 2}],
            [{"date": str(self.day), "unknown": True}],
        ):
            with self.subTest(rows=rows), self.assertRaises(ApiError) as caught:
                self.parse(rows)
            self.assertEqual(caught.exception.status, 422)

    @patch("pms_api.housekeeping.routes.db")
    def test_explicit_shifts_must_match_day_owner_active_state_and_tenant_lookup(self, database):
        plans = {self.day: {"room_ids": None, "shifts": {"a": "s", "b": None}}}
        good = {"id": "s", "staff_id": "a", "date": self.day, "active": True}
        database.session.scalars.return_value = [SimpleNamespace(**good)]
        validate_plan_days("hotel", plans)
        for changes in (
            {"date": self.day + timedelta(days=1)},
            {"staff_id": "b"},
            {"active": False},
            None,
        ):
            database.session.scalars.return_value = (
                [] if changes is None else [SimpleNamespace(**{**good, **changes})]
            )
            with self.subTest(changes=changes), self.assertRaises(ApiError) as caught:
                validate_plan_days("hotel", plans)
            self.assertEqual(caught.exception.status, 422)

    @patch("pms_api.housekeeping.routes.db")
    def test_rooms_must_exist_in_this_tenant_and_be_active_without_maintenance_or_inspection(
        self, database
    ):
        plans = {self.day: {"room_ids": ["r"], "shifts": {}}}
        database.session.scalars.return_value = [
            SimpleNamespace(id="r", active=True, condition="clean")
        ]
        validate_plan_days("hotel", plans)
        for rows, status in (
            ([], 404),
            ([SimpleNamespace(active=False, condition="clean")], 404),
            ([SimpleNamespace(active=True, condition="maintenance")], 409),
            ([SimpleNamespace(active=True, condition="inspection")], 409),
        ):
            database.session.scalars.return_value = rows
            with self.subTest(status=status, rows=rows), self.assertRaises(ApiError) as caught:
                validate_plan_days("hotel", plans)
            self.assertEqual(caught.exception.status, status)
