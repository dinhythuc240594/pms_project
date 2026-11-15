"""Shift period calculations and create responses retain the legacy single-day contract."""

import unittest
from datetime import date
from unittest.mock import patch

from pms_api.housekeeping.routes import create_shifts, shift_creation_dates
from pms_api.security import ApiError


class ShiftCreationValueTests(unittest.TestCase):
    def test_daily_and_weekly_dates_are_inclusive_and_cross_years(self):
        self.assertEqual(shift_creation_dates("2026-10-17"), [date(2026, 10, 17)])
        days = shift_creation_dates("2026-12-29", "week")
        self.assertEqual((days[0], days[-1], len(days)), (date(2026, 12, 29), date(2027, 1, 4), 7))

    def test_calendar_month_uses_exclusive_clamped_anniversary(self):
        for start, count, end in (
            ("2026-10-17", 31, date(2026, 11, 16)),
            ("2026-01-31", 28, date(2026, 2, 27)),
            ("2028-02-01", 29, date(2028, 2, 29)),
            ("2026-12-17", 31, date(2027, 1, 16)),
            ("9999-12-01", 31, date(9999, 12, 31)),
        ):
            with self.subTest(start=start):
                days = shift_creation_dates(start, "month")
                self.assertEqual((len(days), days[-1]), (count, end))

    def test_bad_periods_dates_and_overflow_are_validation_errors(self):
        for value, period in (
            ("", "day"),
            ("2026-02-29", "week"),
            ("0000-01-01", "day"),
            ("2026-10-17", None),
            ("2026-10-17", True),
            ("2026-10-17", []),
            ("2026-10-17", "year"),
            ("9999-12-26", "week"),
            ("9999-12-02", "month"),
        ):
            with self.subTest(value=value, period=period), self.assertRaises(ApiError) as caught:
                shift_creation_dates(value, period)
            self.assertEqual(caught.exception.status, 422)

    @patch("pms_api.housekeeping.routes.shift_json", side_effect=lambda row: row)
    @patch("pms_api.housekeeping.routes.shift_values")
    def test_legacy_response_is_a_single_shift_and_batch_keeps_all_shared_fields(
        self, save, serialize
    ):
        save.side_effect = lambda tenant_id, data: {"id": data["date"], **data}
        data = {
            "date": "2026-10-17",
            "staffId": "staff",
            "startTime": "08:00",
            "endTime": "16:00",
            "active": True,
            "note": "Tầng 2",
        }
        single = create_shifts("hotel", data)
        self.assertEqual(single["id"], data["date"])
        self.assertNotIn("created", single)
        batch = create_shifts("hotel", {**data, "period": "week"})
        self.assertEqual(
            (batch["created"], batch["date"], batch["throughDate"]), (7, "2026-10-17", "2026-10-23")
        )
        self.assertEqual(len({row["date"] for row in batch["shifts"]}), 7)
        self.assertTrue(
            all(
                row["note"] == "Tầng 2" and row["staffId"] == "staff" and row["active"]
                for row in batch["shifts"]
            )
        )
        self.assertTrue(all("period" not in call.args[1] for call in save.call_args_list))

    @patch("pms_api.housekeeping.routes.shift_json", side_effect=lambda row: row)
    @patch("pms_api.housekeeping.routes.shift_values")
    def test_later_overlap_stops_the_batch_and_identifies_the_conflicting_date(
        self, save, serialize
    ):
        save.side_effect = [
            {"date": "2026-10-17"},
            {"date": "2026-10-18"},
            ApiError(409, "shift_overlap", "Overlap"),
        ]
        with self.assertRaises(ApiError) as caught:
            create_shifts("hotel", {"date": "2026-10-17", "period": "week"})
        self.assertEqual(caught.exception.status, 409)
        self.assertEqual(caught.exception.details, {"date": "2026-10-19"})
        self.assertEqual(caught.exception.message["$i18n"], "hk.shiftOverlapDate")
        self.assertEqual(save.call_count, 3)

    @patch("pms_api.housekeeping.routes.shift_values")
    def test_unknown_fields_fail_before_writing_any_shift(self, save):
        with self.assertRaises(ApiError):
            create_shifts("hotel", {"date": "2026-10-17", "period": "week", "id": "existing"})
        save.assert_not_called()
