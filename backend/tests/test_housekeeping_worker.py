"""Disposable PostgreSQL proofs for daily generation by the trusted CLI worker."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

from flask import g
from sqlalchemy import func, select, text

from pms_api.admin.feature_models import FeatureControl, TenantFeatureOverride
from pms_api.catalog.models import PhysicalRoom
from pms_api.core_models import AuditLog, Plan, Subscription, Tenant, User, utcnow
from pms_api.extensions import db
from pms_api.housekeeping.models import HousekeepingLog, HousekeepingTask
from pms_api.housekeeping.service import process_day_plan
from pms_api.security import ApiError, set_context
from tests.domain_fixture import DomainTestCase


class HousekeepingWorkerTests(DomainTestCase):
    def poll(self, *args, actor="manager@test.local"):
        return self.app.test_cli_runner().invoke(
            args=["process-housekeeping-plans", "--actor-email", actor, *args]
        )

    def dirty_rooms(self):
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            for suffix in ("a", "b"):
                db.session.get(PhysicalRoom, f"room-{suffix}-101").condition = "dirty"
            db.session.commit()

    def snapshot(self):
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            result = (
                [
                    (row.tenant_id, row.date, row.kind, row.reservation_id)
                    for row in db.session.scalars(
                        select(HousekeepingTask).order_by(HousekeepingTask.tenant_id)
                    )
                ],
                db.session.scalar(select(func.count()).select_from(HousekeepingLog)),
                db.session.scalar(select(func.count()).select_from(AuditLog)),
            )
            db.session.rollback()
            return result

    def booking(self, room="102", day=None):
        day = day or utcnow().astimezone(ZoneInfo("Asia/Ho_Chi_Minh")).date()
        response = self.request(
            "POST",
            "/reservations",
            {
                "guest": "Worker guest",
                "room": room,
                "sourceId": "direct-a",
                "checkIn": day.isoformat(),
                "checkOut": (day + timedelta(days=2)).isoformat(),
            },
        )
        self.assertEqual(response.status_code, 201, response.json)
        return response.json

    def test_local_day_per_hotel_noop_is_silent_and_later_arrivals_are_generated(self):
        self.dirty_rooms()
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            db.session.get(Tenant, self.tenant_id).settings = {"timezone": "Pacific/Kiritimati"}
            db.session.get(Tenant, self.other_tenant_id).settings = {"timezone": "Pacific/Honolulu"}
            db.session.commit()
        instant = datetime(2026, 11, 15, 3, tzinfo=UTC)
        with patch("pms_api.pricing.engine.utcnow", return_value=instant):
            result = self.poll()
            self.assertEqual(result.exit_code, 0, result.output)
            self.assertIn("Created 2 housekeeping tasks.", result.output)
            before = self.snapshot()
            self.assertEqual(
                [(tenant, day.isoformat()) for tenant, day, _, _ in before[0]],
                [(self.tenant_id, "2026-11-15"), (self.other_tenant_id, "2026-11-14")],
            )
            result = self.poll()
            self.assertEqual(result.exit_code, 0, result.output)
            self.assertEqual(self.snapshot(), before)
            booking = self.booking(day=instant.date())
            result = self.poll()
            self.assertEqual(result.exit_code, 0, result.output)
            self.assertIn("Created 1 housekeeping tasks.", result.output)
            self.assertTrue(any(row[3] == booking["id"] for row in self.snapshot()[0]))

    def test_paused_expired_future_and_disabled_entitlements_skip_generation(self):
        self.dirty_rooms()
        for blocked in (
            "tenant",
            "expired",
            "cancelled",
            "future",
            "ended",
            "plan",
            "feature",
            "global",
            "override",
        ):
            with self.subTest(blocked=blocked):
                with self.app.app_context():
                    set_context("admin", is_system=True, is_service=True)
                    tenant = db.session.get(Tenant, self.tenant_id)
                    subscription = db.session.get(Subscription, "sub-a")
                    plan = db.session.get(Plan, "default-pro")
                    tenant.status = "suspended" if blocked == "tenant" else "active"
                    subscription.status = (
                        blocked if blocked in {"expired", "cancelled"} else "active"
                    )
                    subscription.start_date = (
                        utcnow() + timedelta(days=1)
                        if blocked == "future"
                        else utcnow() - timedelta(days=1)
                    )
                    subscription.end_date = (
                        utcnow() - timedelta(seconds=1)
                        if blocked == "ended"
                        else utcnow() + timedelta(days=1)
                    )
                    plan.active = blocked != "plan"
                    plan.features = {"HOUSEKEEPING": blocked != "feature"}
                    db.session.merge(
                        FeatureControl(code="HOUSEKEEPING", enabled_global=blocked != "global")
                    )
                    db.session.merge(
                        TenantFeatureOverride(
                            tenant_id=self.tenant_id,
                            code="HOUSEKEEPING",
                            enabled=blocked != "override",
                            granted_by="admin",
                            expires_at=utcnow() - timedelta(seconds=1)
                            if blocked == "feature"
                            else None,
                        )
                    )
                    db.session.commit()
                before = self.snapshot()
                result = self.poll("--tenant", self.tenant_id)
                self.assertEqual(result.exit_code, 0, result.output)
                self.assertEqual(self.snapshot(), before)
        with self.app.app_context():
            set_context("admin", is_system=True, is_service=True)
            db.session.get(TenantFeatureOverride, (self.tenant_id, "HOUSEKEEPING")).enabled = True
            db.session.commit()
        result = self.poll("--tenant", self.tenant_id)
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("Created 1 housekeeping tasks.", result.output)

    def test_actor_is_explicit_active_system_account_and_watch_checks_each_poll(self):
        self.dirty_rooms()
        missing = self.app.test_cli_runner().invoke(args=["process-housekeeping-plans"])
        self.assertNotEqual(missing.exit_code, 0)
        for actor in ("missing@test.local", "owner-a@test.local"):
            result = self.poll(actor=actor)
            self.assertNotEqual(result.exit_code, 0)
            self.assertEqual(self.snapshot()[0], [])
        with self.app.app_context():
            db.session.get(User, "manager").active = False
            db.session.commit()
        self.assertNotEqual(self.poll().exit_code, 0)
        self.assertEqual(self.snapshot()[0], [])
        result = self.poll("--tenant", self.tenant_id, actor="admin@test.local")
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertEqual(len(self.snapshot()[0]), 1)

        def revoke(_):
            with self.app.app_context():
                db.session.get(User, "admin").active = False
                db.session.commit()

        with patch("pms_api.commands.time.sleep", side_effect=revoke) as sleep:
            result = self.poll("--watch", "--tenant", self.tenant_id, actor="admin@test.local")
        self.assertNotEqual(result.exit_code, 0)
        sleep.assert_called_once_with(900)
        self.assertEqual(len(self.snapshot()[0]), 1)

    def test_no_show_is_excluded_and_checkout_intent_is_reused(self):
        no_show = self.booking("101")
        closed = self.request(
            "POST", f"/reservations/{no_show['id']}/status", {"status": "NO_SHOW"}
        )
        self.assertEqual(closed.status_code, 200, closed.json)
        booking = self.booking()
        path = f"/reservations/{booking['id']}"
        self.assertEqual(
            self.request("POST", path + "/status", {"status": "IN_HOUSE"}).status_code, 200
        )
        self.assertEqual(
            self.request(
                "POST",
                path + "/payments",
                {"amount": booking["total"], "methodId": "cash-a", "fundId": "fund-a"},
                key="worker-checkout",
            ).status_code,
            201,
        )
        self.assertEqual(
            self.request("POST", path + "/status", {"status": "CHECKED_OUT"}).status_code, 200
        )
        before = self.snapshot()
        result = self.poll()
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual([(row[2], row[3]) for row in before[0]], [("checkout", booking["id"])])
        departure = datetime.fromisoformat(booking["checkOut"]).replace(hour=12, tzinfo=UTC)
        with patch("pms_api.pricing.engine.utcnow", return_value=departure):
            result = self.poll()
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertEqual(self.snapshot(), before)

    def test_two_workers_and_manual_generation_share_one_intent(self):
        self.dirty_rooms()

        def worker():
            with self.app.app_context():
                return process_day_plan(self.tenant_id, "manager")

        def manual():
            response = self.request(
                "POST",
                "/housekeeping/tasks",
                {"date": utcnow().astimezone(ZoneInfo("Asia/Ho_Chi_Minh")).date().isoformat()},
            )
            self.assertEqual(response.status_code, 201, response.json)
            return response.json["created"]

        with ThreadPoolExecutor(max_workers=3) as pool:
            counts = list(pool.map(lambda fn: fn(), [worker, worker, manual]))
        self.assertEqual(sum(counts), 1)
        self.assertEqual(len(self.snapshot()[0]), 1)

    def test_worker_restores_outer_flask_and_database_context_on_success_and_error(self):
        self.dirty_rooms()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            g.tenant = db.session.get(Tenant, self.tenant_id)
            g.user = db.session.get(User, self.owner_id)
            g.role = "FRONT_DESK"
            for actor in ("manager", "owner-b"):
                if actor == "manager":
                    self.assertEqual(process_day_plan(self.other_tenant_id, actor), 1)
                else:
                    with self.assertRaises(ApiError):
                        process_day_plan(self.other_tenant_id, actor)
                self.assertEqual(
                    (g.tenant.id, g.user.id, g.role), (self.tenant_id, self.owner_id, "FRONT_DESK")
                )
                self.assertEqual(
                    db.session.execute(
                        text(
                            "SELECT current_setting('app.user_id'), current_setting('app.tenant_id'), current_setting('app.is_system')"
                        )
                    ).one(),
                    (self.owner_id, self.tenant_id, "false"),
                )
                self.assertFalse(
                    any(
                        row.tenant_id != self.tenant_id
                        for row in db.session.scalars(select(HousekeepingTask))
                    )
                )
            db.session.rollback()
