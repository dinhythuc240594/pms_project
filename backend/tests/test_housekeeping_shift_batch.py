"""Real PostgreSQL proofs for bulk shift creation, overlap rollback and tenant isolation."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from tests.domain_fixture import DomainTestCase


class ShiftBatchTests(DomainTestCase):
    def setUp(self):
        super().setUp()
        self.day = datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date()
        response = self.request("POST", "/housekeeping/staff", {"name": "Lan"})
        self.assertEqual(response.status_code, 201, response.json)
        self.data = {
            "staffId": response.json["id"],
            "date": str(self.day),
            "startTime": "08:00",
            "endTime": "16:00",
            "note": "Tầng 2",
            "active": True,
        }

    def shifts(self):
        response = self.request("GET", "/housekeeping/shifts?staffId=" + self.data["staffId"])
        self.assertEqual(response.status_code, 200, response.json)
        return response.json["shifts"]

    def test_week_and_calendar_month_create_exact_dates_and_keep_single_day_response(self):
        week = self.request("POST", "/housekeeping/shifts", {**self.data, "period": "week"})
        self.assertEqual(week.status_code, 201, week.json)
        self.assertEqual(week.json["created"], 7)
        self.assertEqual(
            {row["date"] for row in week.json["shifts"]},
            {str(self.day + timedelta(days=index)) for index in range(7)},
        )
        self.assertTrue(
            all(
                row["staffId"] == self.data["staffId"] and row["note"] == "Tầng 2"
                for row in week.json["shifts"]
            )
        )
        month = self.request(
            "POST", "/housekeeping/shifts", {**self.data, "date": "2030-01-31", "period": "month"}
        )
        self.assertEqual(month.status_code, 201, month.json)
        self.assertEqual((month.json["created"], month.json["throughDate"]), (28, "2030-02-27"))
        single = self.request("POST", "/housekeeping/shifts", {**self.data, "date": "2030-05-06"})
        self.assertEqual(single.status_code, 201, single.json)
        self.assertIn("id", single.json)
        self.assertNotIn("shifts", single.json)

    def test_later_overlap_rolls_back_all_earlier_shifts_and_logs(self):
        conflict_day = self.day + timedelta(days=4)
        existing = self.request(
            "POST", "/housekeeping/shifts", {**self.data, "date": str(conflict_day)}
        )
        self.assertEqual(existing.status_code, 201, existing.json)
        before = self.request("GET", "/workspace").json["housekeepingWorkLogs"]
        result = self.request("POST", "/housekeeping/shifts", {**self.data, "period": "week"})
        self.assertEqual(result.status_code, 409, result.json)
        self.assertEqual(result.json["error"]["details"]["date"], str(conflict_day))
        self.assertEqual(self.shifts(), [existing.json])
        self.assertEqual(self.request("GET", "/workspace").json["housekeepingWorkLogs"], before)

    def test_scope_permissions_and_editing_remain_protected(self):
        foreign = self.request(
            "POST",
            "/housekeeping/shifts",
            {**self.data, "period": "week", "staffId": "foreign-staff"},
        )
        self.assertEqual(foreign.status_code, 404, foreign.json)
        client, headers = self.login("hk@test.local")
        denied = self.request(
            "POST",
            "/housekeeping/shifts",
            {**self.data, "period": "week"},
            client=client,
            headers=headers,
        )
        self.assertEqual(denied.status_code, 403, denied.json)
        self.assertEqual(self.shifts(), [])
        single = self.request("POST", "/housekeeping/shifts", self.data)
        self.assertEqual(single.status_code, 201, single.json)
        edit = self.request(
            "PATCH", "/housekeeping/shifts/" + single.json["id"], {"period": "week"}
        )
        self.assertEqual(edit.status_code, 422, edit.json)
        self.assertEqual(len(self.shifts()), 1)

    def test_concurrent_batches_create_one_set_and_reject_duplicate(self):
        def submit(_):
            client, headers = self.login()
            return self.request(
                "POST",
                "/housekeeping/shifts",
                {**self.data, "period": "week"},
                client=client,
                headers=headers,
            ).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(submit, range(2)))
        self.assertEqual(sorted(results), [201, 409])
        self.assertEqual(len(self.shifts()), 7)
