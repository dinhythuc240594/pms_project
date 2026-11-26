"""Client IP persistence, legacy records and audit access on disposable PostgreSQL."""

from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from werkzeug.middleware.proxy_fix import ProxyFix

from pms_api.core_models import AuditLog
from pms_api.extensions import db
from pms_api.security import audit, set_context
from tests.domain_fixture import DomainTestCase


class AuditIPPersistenceTests(DomainTestCase):
    def setUp(self):
        super().setUp()
        self.admin, self.admin_headers = self.login("admin@test.local")

    def update_manager(self, address, forwarded=None):
        headers = {**self.admin_headers, "X-Real-IP": "9.9.9.9"}
        if forwarded:
            headers["X-Forwarded-For"] = forwarded
        response = self.admin.patch(
            "/api/users/manager",
            json={"name": "Updated manager"},
            headers=headers,
            environ_base={"REMOTE_ADDR": address},
        )
        self.assertEqual(response.status_code, 200, response.json)
        response = self.admin.get("/api/audit", query_string={"event": "system_user.updated"})
        self.assertEqual(response.status_code, 200, response.json)
        return response.json["auditLogs"][0]

    def test_direct_ip_is_persisted_separately_and_cannot_be_overridden_by_headers(self):
        row = self.update_manager("192.168.1.5", "8.8.8.8")
        self.assertEqual(row["ipAddress"], "192.168.1.5")
        self.assertEqual(row["ipInfo"], {"version": 4, "scope": "private", "source": "direct"})
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            stored = db.session.get(AuditLog, row["id"])
            self.assertEqual(stored.ip_address, row["ipAddress"])
            self.assertEqual(stored.ip_source, "direct")
            self.assertNotIn("ipAddress", stored.details)
            stored.ip_address = "8.8.8.8"
            with self.assertRaises(DBAPIError):
                db.session.flush()
            db.session.rollback()

    def test_trusted_proxy_ipv6_is_canonical_and_spoofed_leftmost_hop_is_ignored(self):
        original_wsgi, original_count = self.app.wsgi_app, self.app.config["TRUSTED_PROXY_COUNT"]
        self.app.wsgi_app = ProxyFix(original_wsgi, x_for=1)
        self.app.config["TRUSTED_PROXY_COUNT"] = 1
        self.addCleanup(setattr, self.app, "wsgi_app", original_wsgi)
        self.addCleanup(self.app.config.__setitem__, "TRUSTED_PROXY_COUNT", original_count)
        row = self.update_manager("10.0.0.2", "1.1.1.1, 2001:4860:4860:0:0:0:0:8888")
        self.assertEqual(row["ipAddress"], "2001:4860:4860::8888")
        self.assertEqual(
            row["ipInfo"], {"version": 6, "scope": "public", "source": "trusted_proxy"}
        )

    def test_legacy_and_background_rows_remain_unknown_and_details_are_unchanged(self):
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            db.session.add(
                AuditLog(
                    id="legacy-ip",
                    event="tenant.updated",
                    entity_type="tenant",
                    entity_id=self.tenant_id,
                    details={"legacy": True},
                )
            )
            background = audit("tenant.updated", "tenant", self.tenant_id, {"background": True})
            background_id = background.id
            db.session.commit()
        rows = self.admin.get("/api/audit").json["auditLogs"]
        rows = {row["id"]: row for row in rows}
        for key, details in (
            ("legacy-ip", {"legacy": True}),
            (background_id, {"background": True}),
        ):
            self.assertIsNone(rows[key]["ipAddress"])
            self.assertEqual(
                rows[key]["ipInfo"], {"version": None, "scope": "unknown", "source": "unknown"}
            )
            self.assertEqual(rows[key]["details"], details)

    def test_ip_does_not_expand_audit_authorization(self):
        self.update_manager("8.8.8.8")
        self.assertEqual(self.app.test_client().get("/api/audit").status_code, 401)
        for email in ("manager@test.local", "owner-a@test.local", "owner-b@test.local"):
            client, _ = self.login(email)
            self.assertEqual(client.get("/api/audit").status_code, 403)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.add(
                AuditLog(
                    event="membership.updated",
                    entity_type="user",
                    entity_id=self.owner_id,
                    tenant_id=self.tenant_id,
                    user_id=self.owner_id,
                    ip_address="10.0.0.1",
                    ip_source="direct",
                )
            )
            db.session.commit()
        allowed = self.client.get(f"/api/tenants/{self.tenant_id}/audit")
        self.assertEqual(allowed.status_code, 200, allowed.json)
        self.assertEqual(allowed.json["auditLogs"][0]["ipAddress"], "10.0.0.1")
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            self.assertEqual(len(db.session.scalars(select(AuditLog)).all()), 2)
