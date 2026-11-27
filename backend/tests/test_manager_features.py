"""Feature controls keep plan, role and tenant boundaries on a disposable database."""

from datetime import datetime, timedelta
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.exc import DBAPIError

from pms_api.core_models import AuditLog, Plan, Subscription, Tenant, utcnow
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase

FEATURE_CODES = {
    "DASHBOARD",
    "ROOM_DIAGRAM",
    "RESERVATION_VIEW",
    "RESERVATION_CREATE",
    "TAPE_CHART",
    "ARI_MANAGEMENT",
    "HOUSEKEEPING",
    "POS_SALES",
    "CASHBOOK",
    "REPORTS_BASIC",
    "OTA_SYNC",
    "REPORTS_ADVANCED",
    "INVENTORY_WAREHOUSE",
    "MULTI_CURRENCY",
    "VOUCHER_PROMO",
    "API_EXTERNAL",
}


class ManagerFeatureTests(DomainTestCase):
    def setUp(self):
        super().setUp()
        self.manager, self.manager_headers = self.login("manager@test.local")
        self.admin, self.admin_headers = self.login("admin@test.local")

    def plan_feature(self, enabled):
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            db.session.get(Plan, "default-pro").features = {"POS_SALES": enabled}
            db.session.commit()

    def override(self, data, *, tenant=None, client=None, headers=None, method="PUT"):
        return self.request(
            method,
            f"/api/tenants/{tenant or self.tenant_id}/feature-overrides/POS_SALES",
            data,
            client=client or self.manager,
            headers=headers or self.manager_headers,
        )

    def global_feature(self, data, *, client=None, headers=None, code="POS_SALES"):
        return self.request(
            "PATCH",
            f"/api/features/{code}",
            data,
            client=client or self.admin,
            headers=headers or self.admin_headers,
        )

    def create_pos(self, *, tenant=None, client=None, headers=None):
        return self.request(
            "POST",
            f"/api/tenants/{tenant or self.tenant_id}/pos/invoices",
            {
                "customerName": "Feature check",
                "items": [{"serviceId": "service-a", "quantity": "1"}],
            },
            client=client,
            headers=headers,
            key="feature-pos-check",
        )

    def test_finite_catalog_defaults_and_system_read_access(self):
        for client, headers in (
            (self.admin, self.admin_headers),
            (self.manager, self.manager_headers),
        ):
            response = self.request("GET", "/api/features", client=client, headers=headers)
            self.assertEqual(response.status_code, 200, response.json)
            self.assertEqual({item["code"] for item in response.json["features"]}, FEATURE_CODES)
            self.assertEqual(response.json["tenantFeatureOverrides"], {})
            for feature in response.json["features"]:
                self.assertEqual(feature["id"], feature["code"])
                self.assertIn(feature["minPlan"], {"FREE", "PRO"})
                self.assertTrue(feature["enabledGlobal"])
                self.assertTrue(
                    all(feature[field] for field in ("name", "description", "category"))
                )
        self.assertEqual(self.request("GET", "/api/features").status_code, 403)
        self.assertEqual(self.app.test_client().get("/api/features").status_code, 401)

    def test_only_super_admin_changes_global_controls_and_global_off_wins(self):
        self.assertEqual(
            self.global_feature(
                {"enabledGlobal": False}, client=self.client, headers=self.headers
            ).status_code,
            403,
        )
        self.assertEqual(
            self.global_feature(
                {"enabledGlobal": False}, client=self.manager, headers=self.manager_headers
            ).status_code,
            403,
        )
        self.assertEqual(self.override({"enabled": True}).status_code, 200)
        response = self.global_feature({"enabledGlobal": False})
        self.assertEqual(response.status_code, 200, response.json)
        self.assertFalse(response.json["feature"]["enabledGlobal"])
        self.assertFalse(self.request("GET", "/workspace").json["features"]["POS_SALES"])
        self.assertEqual(self.request("GET", "/pos/invoices").status_code, 403)
        self.assertEqual(self.create_pos().status_code, 403)

    def test_manager_override_enables_one_hotel_and_preserves_role_permissions(self):
        self.plan_feature(False)
        self.assertEqual(self.create_pos().status_code, 403)
        expiry = utcnow() + timedelta(days=7)
        response = self.override(
            {
                "enabled": True,
                "isTrial": True,
                "expiresAt": expiry.isoformat(),
                "notes": "Seven days",
            }
        )
        self.assertEqual(response.status_code, 200, response.json)
        entry = response.json["featureOverride"]
        self.assertEqual(entry["grantedBy"], "manager")
        self.assertEqual(datetime.fromisoformat(entry["expiresAt"]), expiry)
        self.assertTrue(entry["isTrial"])
        self.assertEqual(entry["notes"], "Seven days")
        self.assertIsNotNone(datetime.fromisoformat(entry["grantedAt"]))
        self.assertTrue(self.request("GET", "/workspace").json["features"]["POS_SALES"])
        self.assertTrue(
            self.request("GET", "/workspace").json["subscription"]["effectiveFeatures"]["POS_SALES"]
        )
        self.assertEqual(self.create_pos().status_code, 201)
        other, other_headers = self.login("owner-b@test.local")
        self.assertEqual(
            self.request(
                "GET",
                f"/api/tenants/{self.other_tenant_id}/pos/invoices",
                client=other,
                headers=other_headers,
            ).status_code,
            403,
        )
        hk, hk_headers = self.login("hk@test.local")
        self.assertEqual(self.create_pos(client=hk, headers=hk_headers).status_code, 403)
        catalog = self.request(
            "GET", "/api/features", client=self.manager, headers=self.manager_headers
        ).json
        self.assertEqual(catalog["tenantFeatureOverrides"], {self.tenant_id: {"POS_SALES": entry}})

    def test_owner_reads_only_own_overrides_and_cannot_change_them(self):
        self.assertEqual(self.override({"enabled": False}).status_code, 200)
        self.assertEqual(
            self.override({"enabled": True}, tenant=self.other_tenant_id).status_code, 200
        )
        own = self.request("GET", "/feature-overrides")
        self.assertEqual(own.status_code, 200, own.json)
        self.assertFalse(own.json["features"]["POS_SALES"])
        self.assertEqual(set(own.json["featureOverrides"]), {"POS_SALES"})
        self.assertEqual(
            self.request(
                "GET", f"/api/tenants/{self.other_tenant_id}/feature-overrides"
            ).status_code,
            403,
        )
        for method in ("PUT", "DELETE"):
            self.assertEqual(
                self.override(
                    {"enabled": True}, client=self.client, headers=self.headers, method=method
                ).status_code,
                403,
            )
        front, headers = self.login("frontdesk@test.local")
        self.assertEqual(
            self.request("GET", "/feature-overrides", client=front, headers=headers).status_code,
            403,
        )

    def test_expired_overrides_fall_back_to_plan_and_delete_restores_plan(self):
        self.plan_feature(False)
        expired = (utcnow() - timedelta(seconds=1)).isoformat()
        self.assertEqual(self.override({"enabled": True, "expiresAt": expired}).status_code, 200)
        self.assertFalse(self.request("GET", "/workspace").json["features"]["POS_SALES"])
        self.assertEqual(self.create_pos().status_code, 403)
        self.plan_feature(True)
        self.assertEqual(self.override({"enabled": False, "expiresAt": expired}).status_code, 200)
        self.assertEqual(self.request("GET", "/pos/invoices").status_code, 200)
        self.assertEqual(self.override({"enabled": False}).status_code, 200)
        self.assertEqual(self.request("GET", "/pos/invoices").status_code, 403)
        removed = self.override(None, method="DELETE")
        self.assertEqual(removed.status_code, 200, removed.json)
        self.assertEqual(removed.json, {"ok": True})
        self.assertEqual(self.request("GET", "/pos/invoices").status_code, 200)
        self.assertEqual(self.request("GET", "/feature-overrides").json["featureOverrides"], {})

    def test_inactive_subscription_and_suspended_hotel_cannot_bypass_with_override(self):
        self.plan_feature(False)
        self.assertEqual(self.override({"enabled": True}).status_code, 200)
        for state in ("expired", "cancelled", "end_date", "future", "inactive", "suspended"):
            with self.subTest(state=state):
                with self.app.app_context():
                    set_context(is_system=True, is_service=True)
                    sub = db.session.get(Subscription, "sub-a")
                    sub.status = state if state in {"expired", "cancelled"} else "active"
                    sub.start_date = (
                        utcnow() + timedelta(days=1)
                        if state == "future"
                        else utcnow() - timedelta(days=1)
                    )
                    sub.end_date = (
                        utcnow() - timedelta(days=1)
                        if state == "end_date"
                        else utcnow() + timedelta(days=30)
                    )
                    db.session.get(Plan, "default-pro").active = state != "inactive"
                    db.session.get(Tenant, self.tenant_id).status = (
                        "suspended" if state == "suspended" else "active"
                    )
                    db.session.commit()
                self.assertEqual(self.create_pos().status_code, 403)
                self.assertFalse(self.request("GET", "/workspace").json["features"]["POS_SALES"])
                self.assertEqual(self.request("GET", "/pos/invoices").status_code, 403)

    def test_invalid_inputs_do_not_change_controls_or_audit(self):
        self.assertEqual(self.override({"enabled": False}).status_code, 200)
        before = self.request("GET", "/feature-overrides").json["featureOverrides"]
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            audit_count = db.session.scalar(select(func.count()).select_from(AuditLog))
        for data in (
            {},
            {"enabled": 1},
            {"enabled": True, "isTrial": "yes"},
            {"enabled": True, "isTrial": True},
            {
                "enabled": False,
                "isTrial": True,
                "expiresAt": (utcnow() + timedelta(days=1)).isoformat(),
            },
            {"enabled": True, "expiresAt": "tomorrow"},
            {"enabled": True, "expiresAt": "2028-01-01T00:00:00"},
            {"enabled": True, "notes": []},
            {"enabled": True, "notes": "x" * 1001},
            {"enabled": True, "grantedBy": "admin"},
            {"enabled": True, "role": "SUPER_ADMIN"},
        ):
            with self.subTest(data=data):
                response = self.override(data)
                self.assertEqual(response.status_code, 422, response.json)
        for data in ({}, {"enabledGlobal": "false"}, {"enabledGlobal": False, "minPlan": "FREE"}):
            self.assertEqual(self.global_feature(data).status_code, 422)
        self.assertEqual(
            self.global_feature({"enabledGlobal": False}, code="UNKNOWN_CODE").status_code, 404
        )
        self.assertEqual(
            self.request(
                "PUT",
                f"/api/tenants/{self.tenant_id}/feature-overrides/UNKNOWN_CODE",
                {"enabled": True},
                client=self.manager,
                headers=self.manager_headers,
            ).status_code,
            404,
        )
        self.assertEqual(self.override({"enabled": True}, tenant="missing-hotel").status_code, 404)
        self.assertEqual(self.request("GET", "/feature-overrides").json["featureOverrides"], before)
        self.assertTrue(self.request("GET", "/workspace").json["features"]["DASHBOARD"])
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            self.assertEqual(
                db.session.scalar(select(func.count()).select_from(AuditLog)), audit_count
            )

    def test_controls_are_audited_with_actor_and_tenant(self):
        self.assertEqual(self.global_feature({"enabledGlobal": False}).status_code, 200)
        self.assertEqual(self.override({"enabled": True, "notes": "Private note"}).status_code, 200)
        self.assertEqual(self.override(None, method="DELETE").status_code, 200)
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            entries = {row.event: row for row in db.session.scalars(select(AuditLog))}
            self.assertEqual(entries["feature.updated"].user_id, "admin")
            self.assertIsNone(entries["feature.updated"].tenant_id)
            for event in ("feature_override.upserted", "feature_override.deleted"):
                self.assertEqual(entries[event].user_id, "manager")
                self.assertEqual(entries[event].tenant_id, self.tenant_id)
                self.assertNotIn("Private note", str(entries[event].details))

    def test_plan_cannot_introduce_a_feature_outside_the_catalog(self):
        response = self.request(
            "PATCH",
            "/api/plans/default-pro",
            {"features": {"UNKNOWN_CODE": True}},
            client=self.admin,
            headers=self.admin_headers,
        )
        self.assertEqual(response.status_code, 422, response.json)
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            self.assertEqual(db.session.get(Plan, "default-pro").features, {"POS_SALES": True})

    def test_worker_transactions_refresh_global_override_and_subscription_access(self):
        from flask import g

        from pms_api.admin.feature_models import FeatureControl, TenantFeatureOverride
        from pms_api.subscriptions import feature_enabled

        self.plan_feature(False)
        for change in ("global", "override_expired", "subscription_expired"):
            with self.subTest(change=change):
                self.assertEqual(self.global_feature({"enabledGlobal": True}).status_code, 200)
                self.assertEqual(
                    self.override(
                        {"enabled": True, "expiresAt": (utcnow() + timedelta(days=1)).isoformat()}
                    ).status_code,
                    200,
                )
                with self.app.app_context():
                    set_context(self.owner_id, self.tenant_id)
                    g.tenant = db.session.get(Tenant, self.tenant_id)
                    with self.app.test_request_context("/api/_channel_worker", method="POST"):
                        self.assertTrue(feature_enabled("POS_SALES", for_write=True))
                    db.session.rollback()
                    set_context("admin", is_system=True, is_service=True)
                    if change == "global":
                        db.session.get(FeatureControl, "POS_SALES").enabled_global = False
                    elif change == "override_expired":
                        db.session.get(
                            TenantFeatureOverride, (self.tenant_id, "POS_SALES")
                        ).expires_at = utcnow() - timedelta(seconds=1)
                    else:
                        db.session.get(Subscription, "sub-a").status = "expired"
                    db.session.commit()
                    set_context(self.owner_id, self.tenant_id)
                    g.tenant = db.session.get(Tenant, self.tenant_id)
                    with self.app.test_request_context("/api/_channel_worker", method="POST"):
                        self.assertFalse(feature_enabled("POS_SALES", for_write=True))
                    db.session.rollback()

    def test_migration_preserves_hotel_data_and_refuses_saved_feature_controls(self):
        from pms_api.admin.feature_models import FeatureControl

        start = utcnow().date()
        booking = self.request(
            "POST",
            "/reservations",
            {
                "guest": "Migration preservation",
                "room": "101",
                "sourceId": "direct-a",
                "checkIn": start.isoformat(),
                "checkOut": (start + timedelta(days=1)).isoformat(),
            },
        )
        self.assertEqual(booking.status_code, 201, booking.json)

        def hotel_snapshot():
            with self.app.app_context():
                set_context(is_system=True, is_service=True)
                return {
                    "tenants": db.session.execute(
                        text("SELECT id,name,status FROM tenants ORDER BY id")
                    ).all(),
                    "bookings": db.session.execute(
                        text("SELECT id,tenant_id,status FROM reservations ORDER BY id")
                    ).all(),
                    "revision": db.session.scalar(text("SELECT version_num FROM alembic_version")),
                }

        before = hotel_snapshot()
        scripts = ScriptDirectory(str(Path(__file__).resolve().parents[1] / "migrations"))
        self.assertEqual(before["revision"], scripts.get_current_head())
        migration = scripts.get_revision("0012_manager_features").module
        engine = create_engine(self.app.config["DATABASE_MIGRATION_URL"], hide_parameters=True)
        try:
            # Exercise this migration without crossing newer migrations' data-loss guards.
            with engine.begin() as connection:
                context = MigrationContext.configure(
                    connection, opts={"target_metadata": db.metadata}
                )
                with Operations.context(context):
                    migration.downgrade()
                    for table in ("feature_controls", "tenant_feature_overrides"):
                        self.assertIsNone(
                            connection.scalar(text("SELECT to_regclass(:table)"), {"table": table})
                        )
                    migration.upgrade()
            self.assertEqual(hotel_snapshot(), before)

            for kind in ("global", "override"):
                with self.subTest(kind=kind):
                    saved = (
                        self.global_feature({"enabledGlobal": False})
                        if kind == "global"
                        else self.override({"enabled": False})
                    )
                    self.assertEqual(saved.status_code, 200, saved.json)
                    catalog = self.request(
                        "GET", "/api/features", client=self.admin, headers=self.admin_headers
                    ).json
                    try:
                        with self.assertRaises(DBAPIError) as refused:
                            with engine.begin() as connection:
                                context = MigrationContext.configure(
                                    connection, opts={"target_metadata": db.metadata}
                                )
                                with Operations.context(context):
                                    migration.downgrade()
                        self.assertIn(
                            "Feature controls exist; downgrade refused", str(refused.exception)
                        )
                        self.assertEqual(hotel_snapshot(), before)
                        self.assertEqual(
                            self.request(
                                "GET",
                                "/api/features",
                                client=self.admin,
                                headers=self.admin_headers,
                            ).json,
                            catalog,
                        )
                        ready = self.client.get("/api/ready")
                        self.assertEqual(ready.status_code, 200, ready.json)
                        self.assertEqual(ready.json["schema"], "ok")
                    finally:
                        if kind == "global":
                            with self.app.app_context():
                                set_context("admin", is_system=True, is_service=True)
                                db.session.delete(db.session.get(FeatureControl, "POS_SALES"))
                                db.session.commit()
                        else:
                            self.assertEqual(self.override(None, method="DELETE").status_code, 200)
        finally:
            engine.dispose()

    def test_database_isolates_override_reads_and_denies_owner_writes(self):
        self.assertEqual(self.override({"enabled": False}).status_code, 200)
        self.assertEqual(
            self.override({"enabled": True}, tenant=self.other_tenant_id).status_code, 200
        )
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            rows = (
                db.session.execute(text("SELECT tenant_id FROM tenant_feature_overrides"))
                .scalars()
                .all()
            )
            self.assertEqual(rows, [self.tenant_id])
            for target in (self.tenant_id, self.other_tenant_id):
                updated = db.session.execute(
                    text(
                        "UPDATE tenant_feature_overrides SET enabled=true WHERE tenant_id=:tenant"
                    ),
                    {"tenant": target},
                )
                self.assertEqual(updated.rowcount, 0)
            with self.assertRaises(DBAPIError):
                db.session.execute(
                    text(
                        "INSERT INTO tenant_feature_overrides (tenant_id,code,enabled,is_trial,notes,granted_by,granted_at) VALUES (:tenant,'OTA_SYNC',true,false,'',:actor,CURRENT_TIMESTAMP)"
                    ),
                    {"tenant": self.tenant_id, "actor": self.owner_id},
                )
            db.session.rollback()

    def test_database_global_controls_reject_owner_and_system_manager_writes(self):
        self.assertEqual(self.global_feature({"enabledGlobal": False}).status_code, 200)
        with self.app.app_context():
            for actor, system in ((self.owner_id, False), ("manager", True)):
                set_context(actor, self.tenant_id, system)
                response = db.session.execute(
                    text("UPDATE feature_controls SET enabled_global=true WHERE code='POS_SALES'")
                )
                self.assertEqual(response.rowcount, 0)
                db.session.rollback()
