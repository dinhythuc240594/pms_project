"""Shift validation and optimistic versions reject ambiguous input before writes."""

import unittest
from datetime import date
from types import SimpleNamespace

from flask import Flask

from pms_api.housekeeping.routes import (
    calendar_range,
    plan_generation_values,
    revision_value,
    shift_times,
)
from pms_api.security import ApiError


class HousekeepingValueTests(unittest.TestCase):
    def test_generation_accepts_legacy_days_and_sorts_sparse_batch_days(self):
        self.assertEqual(plan_generation_values({"date": "2026-10-17"}), ([date(2026, 10, 17)], []))
        self.assertEqual(
            plan_generation_values({"dates": ["2027-01-02", "2026-12-31"], "staffIds": ["b", "a"]}),
            ([date(2026, 12, 31), date(2027, 1, 2)], ["b", "a"]),
        )
        self.assertEqual(
            plan_generation_values({"dates": ["9999-12-31"], "staffIds": []}),
            ([date(9999, 12, 31)], []),
        )

    def test_generation_rejects_ambiguous_oversized_or_duplicate_inputs(self):
        for values in (
            {},
            {"date": "2026-10-17", "dates": ["2026-10-17"]},
            {"dates": []},
            {"dates": "2026-10-17"},
            {"dates": ["2026-02-29"]},
            {"dates": ["2026-10-17"] * 32},
            {"dates": ["2026-10-17", "2026-10-17"]},
            {"dates": ["2026-10-01", "2026-11-01"]},
            {"date": "2026-10-17", "staffIds": "a"},
            {"date": "2026-10-17", "staffIds": None},
            {"date": "2026-10-17", "staffIds": [True]},
            {"date": "2026-10-17", "staffIds": ["a", " a "]},
            {"date": "2026-10-17", "staffIds": [str(i) for i in range(101)]},
            {"date": "2026-10-17", "status": "completed"},
        ):
            with self.subTest(values=values), self.assertRaises(ApiError) as caught:
                plan_generation_values(values)
            self.assertEqual(caught.exception.status, 422)

    def test_calendar_ranges_reject_missing_reversed_and_oversized_windows(self):
        app = Flask(__name__)
        with app.test_request_context("/?start=2026-12-28&end=2027-01-04"):
            self.assertEqual(calendar_range(), (date(2026, 12, 28), date(2027, 1, 4)))
        with app.test_request_context("/?start=9999-12-30&end=9999-12-31"):
            self.assertEqual(calendar_range(), (date(9999, 12, 30), date(9999, 12, 31)))
        with app.test_request_context("/?date=2026-10-15"):
            self.assertIsNone(calendar_range())
        for query in (
            "start=2026-10-01",
            "end=2026-10-02",
            "start=bad&end=2026-10-02",
            "start=2026-10-02&end=2026-10-01",
            "start=2026-10-01&end=2026-10-01",
            "start=2026-10-01&end=2026-11-02",
            "date=2026-10-01&start=2026-10-01&end=2026-10-02",
        ):
            with (
                self.subTest(query=query),
                app.test_request_context("/?" + query),
                self.assertRaises(ApiError) as caught,
            ):
                calendar_range()
            self.assertEqual(caught.exception.status, 422)

    def test_shift_times_are_same_day_and_exact_minutes(self):
        first, last = shift_times("08:00", "16:30")
        self.assertEqual((first.hour, last.minute), (8, 30))
        for first, last in (
            ("8:00", "12:00"),
            ("23:00", "06:00"),
            ("08:00", "08:00"),
            ("00:00", "24:00"),
            (True, "12:00"),
            ("08:00:10", "12:00"),
        ):
            with self.subTest(first=first, last=last), self.assertRaises(ApiError):
                shift_times(first, last)

    def test_task_revision_is_required_and_never_coerces_boolean_or_float(self):
        row = SimpleNamespace(revision=2)
        revision_value({"revision": 2}, row)
        for value in (None, True, "2", 2.0, 0):
            with self.subTest(value=value), self.assertRaises(ApiError) as caught:
                revision_value({"revision": value}, row)
            self.assertEqual(caught.exception.status, 422)
        with self.assertRaises(ApiError) as caught:
            revision_value({"revision": 1}, row)
        self.assertEqual(caught.exception.status, 409)
