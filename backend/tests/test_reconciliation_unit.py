"""Pure boundaries for an explicitly timestamped reconciliation snapshot."""

import unittest
from datetime import UTC, date, datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from pms_api.reconciliation.routes import confirmation_json
from pms_api.reconciliation.service import day_window, preview_token
from pms_api.security import ApiError


class ReconciliationBoundaryTests(unittest.TestCase):
    def confirmation(self, created_at):
        return SimpleNamespace(
            id="confirmation",
            business_date=date(2026, 10, 18),
            timezone="Asia/Ho_Chi_Minh",
            actor_id="owner",
            actor_name="Owner",
            note="",
            snapshot={"previewToken": "saved-token"},
            created_at=created_at,
        )

    def test_confirmation_timestamp_is_identical_across_database_timezones(self):
        instant = datetime(2026, 10, 18, 23, 30, 12, 123456, tzinfo=UTC)
        for zone in ("UTC", "Asia/Ho_Chi_Minh", "America/New_York", "Pacific/Kiritimati"):
            with self.subTest(zone=zone):
                row = self.confirmation(instant.astimezone(ZoneInfo(zone)))
                result = confirmation_json(row)
                self.assertEqual(result["createdAt"], instant.isoformat())
                self.assertEqual(result["date"], "2026-10-18")
                self.assertEqual(result["timezone"], row.timezone)
                self.assertEqual(result["snapshot"], {"previewToken": "saved-token"})

    def test_confirmation_timestamp_keeps_dst_fold_instants_distinct(self):
        zone = ZoneInfo("America/New_York")
        instants = [datetime(2026, 11, 1, hour, 30, tzinfo=UTC) for hour in (5, 6)]
        local = [instant.astimezone(zone) for instant in instants]
        self.assertEqual([stamp.hour for stamp in local], [1, 1])
        self.assertEqual(
            [confirmation_json(self.confirmation(stamp))["createdAt"] for stamp in local],
            [instant.isoformat() for instant in instants],
        )

    def test_hotel_day_is_not_the_utc_date_and_uses_exclusive_end(self):
        day, start, end = day_window(
            "2026-10-18", "Asia/Ho_Chi_Minh", datetime(2026, 10, 17, 18, tzinfo=UTC)
        )
        self.assertEqual(day, date(2026, 10, 18))
        self.assertEqual(start.astimezone(UTC).isoformat(), "2026-10-17T17:00:00+00:00")
        self.assertEqual(end.astimezone(UTC).isoformat(), "2026-10-18T17:00:00+00:00")

    def test_dst_day_uses_calendar_midnights(self):
        _, start, end = day_window(
            "2026-11-01", "America/New_York", datetime(2026, 11, 2, 12, tzinfo=UTC)
        )
        self.assertEqual((end.astimezone(UTC) - start.astimezone(UTC)).total_seconds(), 25 * 3600)

    def test_invalid_and_future_dates_are_rejected(self):
        for value in (None, "", "2026-02-30", "2026-10-19", True):
            with self.subTest(value=value), self.assertRaises(ApiError):
                day_window(value, "Asia/Ho_Chi_Minh", datetime(2026, 10, 18, 3, tzinfo=UTC))

    def test_preview_token_is_stable_but_detects_changed_amount_or_booking(self):
        original = {"date": "2026-10-18", "funds": [{"closing": "100.0000"}], "arrivals": []}
        self.assertEqual(
            preview_token(original), preview_token(dict(reversed(list(original.items()))))
        )
        self.assertNotEqual(
            preview_token(original), preview_token({**original, "arrivals": ["b1"]})
        )
        self.assertNotEqual(
            preview_token(original), preview_token({**original, "funds": [{"closing": "101.0000"}]})
        )
