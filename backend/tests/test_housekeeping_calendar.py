"""Manual plans and calendar reads use real tenant, assignment and workflow rules."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from tests.domain_fixture import DomainTestCase


class HousekeepingCalendarTests(DomainTestCase):
    def setUp(self):
        super().setUp()
        self.day = datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date()

    def manual(self, **changes):
        return self.request(
            "POST",
            "/housekeeping/tasks/manual",
            {
                "date": self.day.isoformat(),
                "room": "101",
                "note": "Thay khăn",
                **changes,
            },
        )

    def staff_and_shift(self):
        staff = self.request("POST", "/housekeeping/staff", {"name": "Lan", "userId": "hk"})
        self.assertEqual(staff.status_code, 201, staff.json)
        shift = self.request(
            "POST",
            "/housekeeping/shifts",
            {
                "date": self.day.isoformat(),
                "staffId": staff.json["id"],
                "startTime": "08:00",
                "endTime": "16:00",
            },
        )
        self.assertEqual(shift.status_code, 201, shift.json)
        return staff.json, shift.json

    def test_manual_creation_assignment_and_inspection_workflow(self):
        staff, shift = self.staff_and_shift()
        response = self.manual(staffId=staff["id"], shiftId=shift["id"])
        self.assertEqual(response.status_code, 201, response.json)
        task = response.json
        self.assertEqual(
            (task["source"], task["status"], task["note"]), ("manual", "pending", "Thay khăn")
        )
        self.assertEqual(task["shiftId"], shift["id"])
        room = self.request("GET", "/workspace").json["rooms"][0]
        self.assertEqual(room["condition"], "clean")
        self.assertEqual(self.manual().status_code, 409)
        hk, headers = self.login("hk@test.local")
        for status in ("in_progress", "inspection"):
            response = self.request(
                "POST",
                f"/housekeeping/tasks/{task['id']}/status",
                {
                    "status": status,
                    "revision": task["revision"],
                    "note": "Đã dọn",
                },
                client=hk,
                headers=headers,
            )
            self.assertEqual(response.status_code, 200, response.json)
            task = response.json
        denied = self.request(
            "POST",
            f"/housekeeping/tasks/{task['id']}/status",
            {
                "status": "completed",
                "revision": task["revision"],
            },
            client=hk,
            headers=headers,
        )
        self.assertEqual(denied.status_code, 403)
        completed = self.request(
            "POST",
            f"/housekeeping/tasks/{task['id']}/status",
            {
                "status": "completed",
                "revision": task["revision"],
            },
        )
        self.assertEqual(completed.status_code, 200, completed.json)
        # A new, distinct manual intent is allowed after the old work is closed.
        self.assertEqual(self.manual().status_code, 201)

    def test_invalid_manual_work_rolls_back_and_preserves_scope(self):
        staff, shift = self.staff_and_shift()
        for changes, expected in [
            ({"staffId": "foreign-staff"}, 404),
            ({"shiftId": shift["id"]}, 422),
            (
                {
                    "staffId": staff["id"],
                    "shiftId": shift["id"],
                    "date": (self.day + timedelta(days=1)).isoformat(),
                },
                422,
            ),
            ({"room": "does-not-exist"}, 404),
            ({"note": "x" * 1001}, 422),
            ({"status": "completed"}, 422),
        ]:
            response = self.manual(**changes)
            self.assertEqual(response.status_code, expected, response.json)
        self.assertEqual(self.request("GET", "/housekeeping/tasks").json["tasks"], [])
        self.assertFalse(
            any(
                log["action"] == "housekeeping.task_created"
                for log in self.request("GET", "/workspace").json["housekeepingWorkLogs"]
            )
        )
        self.request("POST", "/rooms/101/condition", {"condition": "maintenance"})
        self.assertEqual(self.manual().status_code, 409)
        hk, headers = self.login("hk@test.local")
        denied = self.request(
            "POST",
            "/housekeeping/tasks/manual",
            {
                "date": self.day.isoformat(),
                "room": "102",
            },
            client=hk,
            headers=headers,
        )
        self.assertEqual(denied.status_code, 403)

    def test_calendar_range_is_exclusive_and_housekeepers_see_only_own_work(self):
        staff, shift = self.staff_and_shift()
        assigned = self.manual(staffId=staff["id"], shiftId=shift["id"]).json
        second = self.manual(room="102").json
        tomorrow = (self.day + timedelta(days=1)).isoformat()
        self.assertEqual(self.manual(date=tomorrow).status_code, 201)
        query = f"?start={self.day}&end={tomorrow}"
        tasks = self.request("GET", "/housekeeping/tasks" + query)
        self.assertEqual(tasks.status_code, 200, tasks.json)
        self.assertEqual(
            {task["id"] for task in tasks.json["tasks"]}, {assigned["id"], second["id"]}
        )
        hk, headers = self.login("hk@test.local")
        own = self.request("GET", "/housekeeping/tasks" + query, client=hk, headers=headers)
        self.assertEqual([row["id"] for row in own.json["tasks"]], [assigned["id"]])
        self.assertEqual(
            len(
                self.request(
                    "GET", "/housekeeping/shifts" + query, client=hk, headers=headers
                ).json["shifts"]
            ),
            1,
        )
        self.assertEqual(
            self.request(
                "GET",
                f"/api/tenants/{self.other_tenant_id}/housekeeping/tasks" + query,
                client=hk,
                headers=headers,
            ).status_code,
            403,
        )
        for suffix in (
            f"?start={self.day}",
            f"?start={self.day}&end={self.day}",
            f"?start={tomorrow}&end={self.day}",
            f"?start={self.day}&end={self.day + timedelta(days=32)}",
            f"?date={self.day}&start={self.day}&end={tomorrow}",
        ):
            for route in ("tasks", "shifts"):
                self.assertEqual(
                    self.request("GET", f"/housekeeping/{route}" + suffix).status_code, 422
                )

    def test_concurrent_manual_submissions_create_one_open_task(self):
        def submit(_):
            client, headers = self.login()
            return self.request(
                "POST",
                "/housekeeping/tasks/manual",
                {
                    "date": self.day.isoformat(),
                    "room": "101",
                },
                client=client,
                headers=headers,
            ).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(submit, range(2)))
        self.assertEqual(sorted(results), [201, 409])
        self.assertEqual(len(self.request("GET", "/housekeeping/tasks").json["tasks"]), 1)
