"""Real PostgreSQL checks for atomic multi-day generation and assignment."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

from pms_api.housekeeping.service import generate_day_plan
from pms_api.security import ApiError
from tests.domain_fixture import DomainTestCase


class HousekeepingBatchTests(DomainTestCase):
    def setUp(self):
        super().setUp()
        self.day = datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date()
        self.last = self.day + timedelta(days=2)
        self.staff_ids = []
        for name in ("Lan", "Mai"):
            response = self.request("POST", "/housekeeping/staff", {"name": name})
            self.assertEqual(response.status_code, 201, response.json)
            self.staff_ids.append(response.json["id"])
        for room in ("101", "102"):
            response = self.request(
                "POST",
                "/reservations",
                {
                    "guest": "Batch guest",
                    "room": room,
                    "sourceId": "direct-a",
                    "checkIn": self.day.isoformat(),
                    "checkOut": self.last.isoformat(),
                },
            )
            self.assertEqual(response.status_code, 201, response.json)

    def batch(self, **changes):
        return self.request(
            "POST",
            "/housekeeping/tasks",
            {
                "dates": [self.last.isoformat(), self.day.isoformat()],
                "staffIds": self.staff_ids,
                **changes,
            },
        )

    def tasks(self):
        response = self.request(
            "GET", f"/housekeeping/tasks?start={self.day}&end={self.last + timedelta(days=1)}"
        )
        self.assertEqual(response.status_code, 200, response.json)
        return response.json["tasks"]

    def test_sparse_dates_balanced_assignments_correct_shifts_and_idempotent_retry(self):
        early = self.request(
            "POST",
            "/housekeeping/shifts",
            {
                "date": self.day.isoformat(),
                "staffId": self.staff_ids[0],
                "startTime": "08:00",
                "endTime": "12:00",
            },
        )
        self.assertEqual(early.status_code, 201, early.json)
        later = self.request(
            "POST",
            "/housekeeping/shifts",
            {
                "date": self.day.isoformat(),
                "staffId": self.staff_ids[0],
                "startTime": "13:00",
                "endTime": "17:00",
            },
        )
        self.assertEqual(later.status_code, 201, later.json)
        response = self.batch()
        self.assertEqual(response.status_code, 201, response.json)
        self.assertEqual((response.json["created"], response.json["assigned"]), (4, 4))
        self.assertEqual(response.json["dates"], [self.day.isoformat(), self.last.isoformat()])
        self.assertNotIn("tasks", response.json)
        before = self.tasks()
        self.assertEqual(len(before), 4)
        for day in (self.day.isoformat(), self.last.isoformat()):
            rows = [row for row in before if row["date"] == day]
            self.assertEqual({row["staffId"] for row in rows}, set(self.staff_ids))
            self.assertTrue(all(row["status"] == "pending" for row in rows))
            for row in rows:
                expected = (
                    early.json["id"]
                    if day == self.day.isoformat() and row["staffId"] == self.staff_ids[0]
                    else None
                )
                self.assertEqual(row["shiftId"], expected)
        response = self.batch(staffIds=list(reversed(self.staff_ids)))
        self.assertEqual(response.status_code, 201, response.json)
        self.assertEqual((response.json["created"], response.json["assigned"]), (0, 0))
        self.assertEqual(self.tasks(), before)

    def test_invalid_participant_or_later_failure_rolls_back_all_dates(self):
        for ids in (["foreign-staff"], [self.staff_ids[0], "missing"]):
            response = self.batch(staffIds=ids)
            self.assertEqual(response.status_code, 404, response.json)
            self.assertEqual(self.tasks(), [])

        def fail_on_last(tenant_id, day):
            if day == self.last:
                raise ApiError(409, "test_conflict", "Conflict")
            return generate_day_plan(tenant_id, day)

        with patch("pms_api.housekeeping.routes.generate_day_plan", side_effect=fail_on_last):
            response = self.batch()
        self.assertEqual(response.status_code, 409, response.json)
        self.assertEqual(self.tasks(), [])
        logs = self.request("GET", "/workspace").json["housekeepingWorkLogs"]
        self.assertFalse(any(row["action"] == "housekeeping.task_created" for row in logs))

    def test_inactive_staff_and_housekeeper_cannot_generate_batch(self):
        response = self.request(
            "PATCH", "/housekeeping/staff/" + self.staff_ids[0], {"active": False}
        )
        self.assertEqual(response.status_code, 200, response.json)
        response = self.batch()
        self.assertEqual(response.status_code, 404, response.json)
        self.assertEqual(self.tasks(), [])
        client, headers = self.login("hk@test.local")
        denied = self.request(
            "POST",
            "/housekeeping/tasks",
            {"dates": [self.day.isoformat()], "staffIds": [self.staff_ids[1]]},
            client=client,
            headers=headers,
        )
        self.assertEqual(denied.status_code, 403, denied.json)

    def test_concurrent_batch_requests_preserve_one_set_of_work(self):
        def submit(_):
            client, headers = self.login()
            return self.request(
                "POST",
                "/housekeeping/tasks",
                {
                    "dates": [self.day.isoformat(), self.last.isoformat()],
                    "staffIds": self.staff_ids,
                },
                client=client,
                headers=headers,
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(submit, range(2)))
        self.assertTrue(all(response.status_code == 201 for response in responses))
        self.assertEqual(sorted(response.json["created"] for response in responses), [0, 4])
        self.assertEqual(sorted(response.json["assigned"] for response in responses), [0, 4])
        self.assertEqual(len(self.tasks()), 4)

    def make_shift(self, day, staff_id, start="08:00", end="12:00"):
        response = self.request(
            "POST",
            "/housekeeping/shifts",
            {
                "date": str(day),
                "staffId": staff_id,
                "startTime": start,
                "endTime": end,
            },
        )
        self.assertEqual(response.status_code, 201, response.json)
        return response.json["id"]

    def test_daily_rooms_and_explicit_later_or_no_shift_are_applied_exactly(self):
        self.make_shift(self.day, self.staff_ids[0])
        late = self.make_shift(self.day, self.staff_ids[0], "13:00", "17:00")
        self.make_shift(self.last, self.staff_ids[1])
        plans = [
            {
                "date": str(self.day),
                "roomIds": ["room-a-101"],
                "shifts": [{"staffId": self.staff_ids[0], "shiftId": late}],
            },
            {
                "date": str(self.last),
                "roomIds": ["room-a-102"],
                "shifts": [{"staffId": self.staff_ids[1], "shiftId": None}],
            },
        ]
        response = self.batch(dayPlans=plans)
        self.assertEqual(response.status_code, 201, response.json)
        self.assertEqual((response.json["created"], response.json["assigned"]), (2, 2))
        tasks = sorted(self.tasks(), key=lambda row: row["date"])
        self.assertEqual(
            [(row["date"], row["room"]) for row in tasks],
            [(str(self.day), "101"), (str(self.last), "102")],
        )
        self.assertEqual(
            [(row["staffId"], row["shiftId"]) for row in tasks],
            [(self.staff_ids[0], late), (self.staff_ids[1], None)],
        )
        retry = self.batch(dayPlans=plans)
        self.assertEqual((retry.json["created"], retry.json["assigned"]), (0, 0))
        self.assertEqual(sorted(self.tasks(), key=lambda row: row["date"]), tasks)

    def test_selected_clean_room_without_bookings_gets_one_task_per_day(self):
        day = self.last + timedelta(days=3)
        data = {"dates": [str(day)], "dayPlans": [{"date": str(day), "roomIds": ["room-a-101"]}]}
        response = self.batch(**data)
        self.assertEqual(response.status_code, 201, response.json)
        self.assertEqual((response.json["created"], response.json["assigned"]), (1, 1))
        rows = self.request("GET", f"/housekeeping/tasks?date={day}").json["tasks"]
        self.assertEqual([row["room"] for row in rows], ["101"])
        self.assertEqual(self.request("GET", "/workspace").json["rooms"][0]["condition"], "clean")
        retry = self.batch(**data)
        self.assertEqual((retry.json["created"], retry.json["assigned"]), (0, 0))

    def test_invalid_daily_shifts_and_foreign_rooms_reject_the_entire_batch(self):
        wrong_day = self.make_shift(self.last, self.staff_ids[0])
        wrong_staff = self.make_shift(self.day, self.staff_ids[1])
        for shift_id in (wrong_day, wrong_staff, "foreign-shift"):
            response = self.batch(
                dayPlans=[
                    {
                        "date": str(self.day),
                        "roomIds": ["room-a-101"],
                        "shifts": [{"staffId": self.staff_ids[0], "shiftId": shift_id}],
                    }
                ]
            )
            self.assertEqual(response.status_code, 422, response.json)
            self.assertEqual(self.tasks(), [])
        response = self.batch(dayPlans=[{"date": str(self.last), "roomIds": ["room-b-101"]}])
        self.assertEqual(response.status_code, 404, response.json)
        self.assertEqual(self.tasks(), [])

    def test_existing_closed_daily_work_is_not_recreated_and_single_day_labels_remain_complete(
        self,
    ):
        original = self.request(
            "POST", "/housekeeping/tasks/manual", {"date": str(self.day), "room": "101"}
        )
        self.assertEqual(original.status_code, 201, original.json)
        closed = self.request(
            "POST",
            f"/housekeeping/tasks/{original.json['id']}/status",
            {"status": "cancelled", "revision": original.json["revision"]},
        )
        self.assertEqual(closed.status_code, 200, closed.json)
        response = self.batch(
            dates=[str(self.day)], dayPlans=[{"date": str(self.day), "roomIds": ["room-a-101"]}]
        )
        self.assertEqual((response.json["created"], response.json["assigned"]), (0, 0))
        self.assertEqual(
            self.request("GET", f"/housekeeping/tasks?date={self.day}").json["tasks"], [closed.json]
        )
        other = self.request(
            "POST", "/housekeeping/tasks/manual", {"date": str(self.day), "room": "102"}
        )
        self.assertEqual(other.status_code, 201, other.json)
        single = self.request(
            "POST",
            "/housekeeping/tasks",
            {
                "date": str(self.day),
                "dayPlans": [{"date": str(self.day), "roomIds": ["room-a-101"]}],
            },
        )
        self.assertEqual(single.status_code, 201, single.json)
        self.assertEqual({row["room"] for row in single.json["tasks"]}, {"101", "102"})
