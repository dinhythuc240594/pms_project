"""Real PostgreSQL proofs for inspection, tenant boundaries and concurrent work."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError

from pms_api.core_models import TenantUser
from pms_api.extensions import db
from pms_api.housekeeping.models import HousekeepingLog, HousekeepingStaff, HousekeepingTask
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class HousekeepingIntegrationTests(DomainTestCase):
    def today(self):
        return datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date()

    def make_staff(self, **changes):
        data = {"name": "Housekeeper", "phone": "0900000000", "userId": "hk"}
        data.update(changes)
        response = self.request("POST", "/housekeeping/staff", data)
        self.assertEqual(response.status_code, 201, response.json)
        return response.json

    def make_task(self, room="101"):
        response = self.request("POST", f"/rooms/{room}/condition", {"condition": "dirty"})
        self.assertEqual(response.status_code, 200, response.json)
        response = self.request("POST", "/housekeeping/tasks", {"date": self.today().isoformat()})
        self.assertEqual(response.status_code, 201, response.json)
        return next(
            task
            for task in response.json["tasks"]
            if task["room"] == room and task["status"] == "pending"
        )

    def assign(self, task, staff, **changes):
        data = {"staffId": staff["id"], "revision": task["revision"]}
        data.update(changes)
        response = self.request("POST", f"/housekeeping/tasks/{task['id']}/assign", data)
        self.assertEqual(response.status_code, 200, response.json)
        return response.json

    def status(self, task, status, **changes):
        response = self.request(
            "POST",
            f"/housekeeping/tasks/{task['id']}/status",
            {"status": status, "revision": task["revision"]},
            **changes,
        )
        self.assertEqual(response.status_code, 200, response.json)
        return response.json

    def booking(self, room="101", start=None, end=None):
        start = start or self.today()
        end = end or start + timedelta(days=2)
        response = self.request(
            "POST",
            "/reservations",
            {
                "guest": "Guest",
                "room": room,
                "sourceId": "direct-a",
                "checkIn": start.isoformat(),
                "checkOut": end.isoformat(),
            },
        )
        self.assertEqual(response.status_code, 201, response.json)
        return response.json

    def checkout(self, booking):
        path = f"/reservations/{booking['id']}"
        response = self.request("POST", path + "/status", {"status": "IN_HOUSE"})
        self.assertEqual(response.status_code, 200, response.json)
        response = self.request(
            "POST",
            path + "/payments",
            {"amount": booking["total"], "methodId": "cash-a", "fundId": "fund-a"},
            key="checkout-paid-" + booking["id"],
        )
        self.assertEqual(response.status_code, 201, response.json)
        response = self.request("POST", path + "/status", {"status": "CHECKED_OUT"})
        self.assertEqual(response.status_code, 200, response.json)
        return response.json

    def room_condition(self, number="101"):
        return next(
            room["condition"]
            for room in self.request("GET", "/workspace").json["rooms"]
            if room["id"] == number
        )

    def test_staff_membership_scope_and_housekeeper_cannot_escalate(self):
        staff = self.make_staff()
        self.assertEqual(
            self.request("GET", "/housekeeping/staff").json["staff"][0]["id"], staff["id"]
        )
        for user_id in ("frontdesk", "owner-b", "does-not-exist"):
            response = self.request(
                "POST", "/housekeeping/staff", {"name": user_id, "userId": user_id}
            )
            self.assertEqual(response.status_code, 422, response.json)
        hk, headers = self.login("hk@test.local")
        for condition in ("clean", "dirty", "inspection", "maintenance"):
            response = self.request(
                "POST", "/rooms/101/condition", {"condition": condition}, client=hk, headers=headers
            )
            self.assertEqual(response.status_code, 409, response.json)
        self.assertEqual(self.room_condition(), "clean")
        for path, data in (
            ("/housekeeping/staff", {"name": "Bad"}),
            ("/housekeeping/shifts", {}),
            ("/housekeeping/tasks", {"date": self.today().isoformat()}),
        ):
            self.assertEqual(
                self.request("POST", path, data, client=hk, headers=headers).status_code, 403
            )
        task = self.make_task()
        self.assertEqual(
            self.request(
                "POST",
                f"/housekeeping/tasks/{task['id']}/assign",
                {"staffId": staff["id"], "revision": task["revision"]},
                client=hk,
                headers=headers,
            ).status_code,
            403,
        )
        self.assertEqual(
            self.request("GET", "/housekeeping/tasks", client=hk, headers=headers).json["tasks"], []
        )
        self.assertEqual(
            self.request(
                "GET", f"/api/tenants/{self.other_tenant_id}/housekeeping/tasks"
            ).status_code,
            403,
        )

    def test_assigned_housekeeper_must_submit_inspection_manager_confirms_clean(self):
        staff = self.make_staff()
        task = self.assign(self.make_task(), staff)
        hk, headers = self.login("hk@test.local")
        visible = self.request("GET", "/housekeeping/tasks", client=hk, headers=headers).json[
            "tasks"
        ]
        self.assertEqual([row["id"] for row in visible], [task["id"]])
        task = self.status(task, "in_progress", client=hk, headers=headers)
        task = self.status(task, "inspection", client=hk, headers=headers)
        self.assertEqual(self.room_condition(), "inspection")
        response = self.request("POST", "/rooms/101/condition", {"condition": "clean"})
        self.assertEqual(response.status_code, 409, response.json)
        blocked = self.request(
            "POST", "/rooms/101/condition", {"condition": "clean"}, client=hk, headers=headers
        )
        self.assertEqual(blocked.status_code, 409, blocked.json)
        blocked = self.request(
            "POST",
            f"/housekeeping/tasks/{task['id']}/status",
            {"status": "completed", "revision": task["revision"]},
            client=hk,
            headers=headers,
        )
        self.assertEqual(blocked.status_code, 403, blocked.json)
        task = self.status(task, "completed")
        self.assertIsNotNone(task["completedAt"])
        self.assertEqual(self.room_condition(), "clean")
        log = self.request("GET", "/workspace").json["housekeepingWorkLogs"]
        self.assertTrue(
            any(row["details"].get("to") == "inspection" and row["actorId"] == "hk" for row in log)
        )

    def test_room_catalog_cannot_bypass_task_inspection_workflow(self):
        room_type = self.request("GET", "/workspace").json["rooms"][0]["typeId"]
        response = self.request(
            "POST",
            "/masters/rooms",
            {"number": "103", "typeId": room_type, "condition": "inspection"},
        )
        self.assertEqual(response.status_code, 409, response.json)
        self.assertFalse(
            any(room["id"] == "103" for room in self.request("GET", "/workspace").json["rooms"])
        )
        staff = self.make_staff()
        self.assign(self.make_task(), staff)
        for method in ("POST", "PATCH"):
            response = self.request(
                method,
                "/masters/rooms",
                {"number": "101", "typeId": room_type, "condition": "clean"},
            )
            self.assertEqual(response.status_code, 409, response.json)
        self.assertEqual(self.room_condition(), "dirty")

    def test_other_worker_inactive_membership_and_invalid_shift_cannot_take_work(self):
        staff = self.make_staff(userId=None)
        task = self.assign(self.make_task(), staff)
        hk, headers = self.login("hk@test.local")
        response = self.request(
            "POST",
            f"/housekeeping/tasks/{task['id']}/status",
            {"status": "in_progress", "revision": task["revision"]},
            client=hk,
            headers=headers,
        )
        self.assertEqual(response.status_code, 403, response.json)
        linked = self.make_staff(name="Linked")
        task = self.assign(task, linked)
        wrong_shift = self.request(
            "POST",
            "/housekeeping/shifts",
            {
                "staffId": staff["id"],
                "date": self.today().isoformat(),
                "startTime": "08:00",
                "endTime": "16:00",
            },
        ).json
        response = self.request(
            "POST",
            f"/housekeeping/tasks/{task['id']}/assign",
            {"staffId": linked["id"], "shiftId": wrong_shift["id"], "revision": task["revision"]},
        )
        self.assertEqual(response.status_code, 422, response.json)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            member = db.session.scalar(
                select(TenantUser).where(
                    TenantUser.tenant_id == self.tenant_id, TenantUser.user_id == "hk"
                )
            )
            member.active = False
            db.session.commit()
        response = self.request(
            "POST",
            f"/housekeeping/tasks/{task['id']}/assign",
            {"staffId": linked["id"], "revision": task["revision"]},
        )
        self.assertEqual(response.status_code, 422, response.json)
        self.assertEqual(
            self.request("GET", "/housekeeping/tasks", client=hk, headers=headers).status_code, 403
        )

    def test_shift_overlap_dates_and_reassignment_guard(self):
        staff = self.make_staff()
        data = {
            "staffId": staff["id"],
            "date": self.today().isoformat(),
            "startTime": "08:00",
            "endTime": "12:00",
        }
        created = self.request("POST", "/housekeeping/shifts", data)
        self.assertEqual(created.status_code, 201, created.json)
        overlap = self.request(
            "POST", "/housekeeping/shifts", {**data, "startTime": "11:59", "endTime": "16:00"}
        )
        self.assertEqual(overlap.status_code, 409, overlap.json)
        adjacent = self.request(
            "POST", "/housekeeping/shifts", {**data, "startTime": "12:00", "endTime": "16:00"}
        )
        self.assertEqual(adjacent.status_code, 201, adjacent.json)
        invalid = self.request(
            "POST", "/housekeeping/shifts", {**data, "startTime": "22:00", "endTime": "06:00"}
        )
        self.assertEqual(invalid.status_code, 422, invalid.json)
        task = self.assign(self.make_task(), staff, shiftId=created.json["id"])
        self.assertEqual(task["shiftId"], created.json["id"])
        blocked = self.request(
            "PATCH", f"/housekeeping/shifts/{created.json['id']}", {"active": False}
        )
        self.assertEqual(blocked.status_code, 409, blocked.json)
        blocked = self.request("PATCH", f"/housekeeping/staff/{staff['id']}", {"active": False})
        self.assertEqual(blocked.status_code, 409, blocked.json)

    def test_checkout_creates_task_atomically_and_plan_retry_does_not_duplicate(self):
        booking = self.booking()
        path = f"/reservations/{booking['id']}/status"
        self.assertEqual(self.request("POST", path, {"status": "IN_HOUSE"}).status_code, 200)
        blocked = self.request("POST", path, {"status": "CHECKED_OUT"})
        self.assertEqual(blocked.status_code, 409, blocked.json)
        self.assertEqual(self.request("GET", "/housekeeping/tasks").json["tasks"], [])
        paid = self.request(
            "POST",
            f"/reservations/{booking['id']}/payments",
            {"amount": booking["total"], "methodId": "cash-a", "fundId": "fund-a"},
            key="hk-checkout-payment-1",
        )
        self.assertEqual(paid.status_code, 201, paid.json)
        checked_out = self.request("POST", path, {"status": "CHECKED_OUT"})
        self.assertEqual(checked_out.status_code, 200, checked_out.json)
        tasks = self.request("GET", "/housekeeping/tasks").json["tasks"]
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0]["kind"], "checkout")
        generated = self.request("POST", "/housekeeping/tasks", {"date": self.today().isoformat()})
        self.assertEqual(generated.status_code, 201, generated.json)
        self.assertEqual(generated.json["created"], 0)
        self.assertEqual(len(generated.json["tasks"]), 1)
        self.assertEqual(self.room_condition(), "dirty")

    def test_plan_has_arrival_departure_and_stayover_intents(self):
        arrival = self.booking()
        stayover = self.booking(
            room="102", start=self.today() - timedelta(days=1), end=self.today() + timedelta(days=1)
        )
        self.assertEqual(
            self.request(
                "POST", f"/reservations/{stayover['id']}/status", {"status": "IN_HOUSE"}
            ).status_code,
            200,
        )
        plan = self.request("POST", "/housekeeping/tasks", {"date": self.today().isoformat()})
        self.assertEqual(plan.status_code, 201, plan.json)
        self.assertEqual({task["kind"] for task in plan.json["tasks"]}, {"arrival", "stayover"})
        departure = self.request("POST", "/housekeeping/tasks", {"date": stayover["checkOut"]})
        self.assertEqual(departure.status_code, 201, departure.json)
        self.assertTrue(
            any(
                task["kind"] == "departure" and task["bookingId"] == stayover["id"]
                for task in departure.json["tasks"]
            )
        )
        retried = self.request("POST", "/housekeeping/tasks", {"date": self.today().isoformat()})
        self.assertEqual(retried.json["created"], 0)
        self.assertTrue(any(task["bookingId"] == arrival["id"] for task in retried.json["tasks"]))

    def test_reassignment_and_new_occupant_reject_stale_completion(self):
        staff = self.make_staff()
        task = self.assign(self.make_task(), staff)
        task = self.status(task, "in_progress")
        task = self.status(task, "inspection")
        stale = dict(task)
        task = self.assign(task, staff)
        response = self.request(
            "POST",
            f"/housekeeping/tasks/{task['id']}/status",
            {"status": "completed", "revision": stale["revision"]},
        )
        self.assertEqual(response.status_code, 409, response.json)
        self.assertEqual(self.room_condition(), "dirty")
        task = self.status(task, "in_progress")
        task = self.status(task, "inspection")
        task = self.status(task, "completed")
        booking = self.booking()
        self.checkout(booking)
        stale_completion = self.request(
            "POST",
            f"/housekeeping/tasks/{task['id']}/status",
            {"status": "completed", "revision": task["revision"]},
        )
        self.assertEqual(stale_completion.status_code, 409, stale_completion.json)
        self.assertEqual(self.room_condition(), "dirty")

    def test_concurrent_plan_and_completion_have_one_winner(self):
        self.assertEqual(
            self.request("POST", "/rooms/101/condition", {"condition": "dirty"}).status_code, 200
        )
        clients = [self.login(), self.login()]
        with ThreadPoolExecutor(max_workers=2) as pool:
            plans = list(
                pool.map(
                    lambda pair: self.request(
                        "POST",
                        "/housekeeping/tasks",
                        {"date": self.today().isoformat()},
                        client=pair[0],
                        headers=pair[1],
                    ),
                    clients,
                )
            )
        self.assertEqual([row.status_code for row in plans], [201, 201])
        self.assertEqual(sum(row.json["created"] for row in plans), 1)
        task = self.request("GET", "/housekeeping/tasks").json["tasks"][0]
        task = self.status(task, "in_progress")
        task = self.status(task, "inspection")
        with ThreadPoolExecutor(max_workers=2) as pool:
            finished = list(
                pool.map(
                    lambda pair: self.request(
                        "POST",
                        f"/housekeeping/tasks/{task['id']}/status",
                        {"status": "completed", "revision": task["revision"]},
                        client=pair[0],
                        headers=pair[1],
                    ),
                    clients,
                )
            )
        self.assertEqual(sorted(row.status_code for row in finished), [200, 409])
        self.assertEqual(self.room_condition(), "clean")

    def test_tenant_rls_cross_scope_fk_and_immutable_work_logs(self):
        task = self.make_task()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertGreater(
                db.session.scalar(select(func.count()).select_from(HousekeepingLog)), 0
            )
            with self.assertRaises(DBAPIError) as caught:
                db.session.execute(text("UPDATE housekeeping_logs SET event='tampered'"))
            self.assertEqual(caught.exception.orig.sqlstate, "55000")
            db.session.rollback()
            set_context(self.owner_id, self.tenant_id)
            db.session.add(
                HousekeepingTask(
                    tenant_id=self.tenant_id,
                    room_id="room-b-101",
                    date=self.today(),
                    kind="dirty",
                    source_key="cross-room",
                    room_revision=0,
                )
            )
            with self.assertRaises(DBAPIError) as caught:
                db.session.flush()
            self.assertEqual(caught.exception.orig.sqlstate, "23503")
            db.session.rollback()
            set_context("owner-b", self.other_tenant_id)
            self.assertIsNone(db.session.get(HousekeepingTask, task["id"]))
            self.assertEqual(
                db.session.scalar(select(func.count()).select_from(HousekeepingStaff)), 0
            )
