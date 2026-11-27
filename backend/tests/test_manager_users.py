"""System account administration and owner-scoped activity use real PostgreSQL."""

from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Event
from unittest.mock import patch

from sqlalchemy import select
from werkzeug.security import check_password_hash

from pms_api.core_models import AuditLog, AuthSession, User
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import TEST_PASSWORD, DomainTestCase


class ManagerUserTests(DomainTestCase):
    def setUp(self):
        super().setUp()
        self.admin, self.admin_headers = self.login("admin@test.local")

    def system(self, method, path="", body=None, client=None, headers=None):
        return self.request(
            method,
            "/api/users" + path,
            body,
            client=client or self.admin,
            headers=self.admin_headers if headers is None else headers,
        )

    def test_system_users_are_super_admin_only_and_do_not_expose_passwords(self):
        rows = self.system("GET").json
        self.assertEqual({row["id"] for row in rows["users"]}, {"admin", "manager"})
        self.assertNotIn("password", str(rows).lower())
        manager, csrf = self.login("manager@test.local")
        self.assertEqual(self.system("GET", client=manager, headers=csrf).status_code, 403)
        self.assertEqual(
            self.system("GET", client=self.client, headers=self.headers).status_code, 403
        )
        self.assertEqual(
            self.system("GET", client=self.app.test_client(), headers={}).status_code, 401
        )

    def test_create_manager_validate_identity_and_audit_without_secret(self):
        data = {
            "name": "Support",
            "email": "support@test.local",
            "password": TEST_PASSWORD,
            "globalRole": "SYSTEM_MANAGER",
            "active": True,
        }
        denied = self.system("POST", body=data, headers={})
        self.assertEqual(denied.status_code, 403)
        response = self.system("POST", body=data)
        self.assertEqual(response.status_code, 201, response.json)
        self.assertEqual(response.json["globalRole"], "SYSTEM_MANAGER")
        self.assertNotIn("password", str(response.json).lower())
        with self.app.app_context():
            user = db.session.get(User, response.json["id"])
            self.assertTrue(check_password_hash(user.password_hash, TEST_PASSWORD))
            set_context(is_system=True, is_service=True)
            entries = db.session.scalars(
                select(AuditLog).where(AuditLog.entity_id == user.id)
            ).all()
            self.assertTrue(entries)
            self.assertNotIn(TEST_PASSWORD, str([e.details for e in entries]))
        client, csrf = self.login("support@test.local")
        self.assertEqual(client.get("/api/tenants").status_code, 200)
        self.assertEqual(self.system("GET", client=client, headers=csrf).status_code, 403)
        self.assertEqual(self.system("POST", body=data).status_code, 409)
        for changes in ({"globalRole": "USER"}, {"twoFactor": True}, {"password": "short"}):
            candidate = {**data, "email": "invalid@test.local", **changes}
            self.assertEqual(self.system("POST", body=candidate).status_code, 422)

    def test_deactivate_revokes_sessions_and_reactivation_does_not_restore_them(self):
        manager, _ = self.login("manager@test.local")
        result = self.system("PATCH", "/manager", {"active": False})
        self.assertEqual(result.status_code, 200, result.json)
        self.assertEqual(manager.get("/api/auth/session").status_code, 401)
        self.assertEqual(self.system("PATCH", "/manager", {"active": True}).status_code, 200)
        self.assertEqual(manager.get("/api/auth/session").status_code, 401)
        with self.app.app_context():
            self.assertEqual(
                db.session.scalars(
                    select(AuthSession).where(AuthSession.user_id == "manager")
                ).all(),
                [],
            )
        fresh, _ = self.login("manager@test.local")
        self.assertEqual(fresh.get("/api/auth/session").status_code, 200)

    def test_deactivation_revokes_a_login_already_checking_its_password(self):
        client = self.app.test_client()
        checked, release = Event(), Event()

        def paused_password_check(*args):
            valid = check_password_hash(*args)
            checked.set()
            if not release.wait(5):
                raise RuntimeError("Test did not release the password check")
            return valid

        with patch("pms_api.auth.routes.check_password_hash", side_effect=paused_password_check):
            with ThreadPoolExecutor(max_workers=2) as workers:
                login = workers.submit(
                    client.post,
                    "/api/auth/login",
                    json={"email": "manager@test.local", "password": TEST_PASSWORD},
                )
                try:
                    self.assertTrue(checked.wait(5), "Login did not check the password")
                    deactivate = workers.submit(self.system, "PATCH", "/manager", {"active": False})
                    try:
                        deactivate.result(timeout=1)
                    except TimeoutError:
                        pass  # A login holding the user lock must finish before revocation.
                finally:
                    release.set()
                response = login.result(timeout=5)
                self.assertEqual(response.status_code, 200, response.json)
                result = deactivate.result(timeout=5)
                self.assertEqual(result.status_code, 200, result.json)

        self.assertEqual(self.system("PATCH", "/manager", {"active": True}).status_code, 200)
        self.assertEqual(client.get("/api/auth/session").status_code, 401)

    def test_global_role_changes_revoke_sessions_and_self_lockout_is_rejected(self):
        manager, _ = self.login("manager@test.local")
        response = self.system(
            "PATCH", "/manager", {"globalRole": "SUPER_ADMIN", "name": "Admin two"}
        )
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(manager.get("/api/auth/session").status_code, 401)
        for body in ({"active": False}, {"globalRole": "SYSTEM_MANAGER"}):
            response = self.system("PATCH", "/admin", body)
            self.assertEqual(response.status_code, 409)
        for body in (
            {"password": TEST_PASSWORD},
            {"email": "changed@test.local"},
            {"department": "x"},
            {"active": "false"},
        ):
            self.assertEqual(self.system("PATCH", "/manager", body).status_code, 422)
        self.assertEqual(self.system("PATCH", "/owner-a", {"active": False}).status_code, 404)
        self.assertEqual(self.system("DELETE", "/manager").status_code, 405)

    def test_owner_cannot_grant_system_role_or_revoke_own_access(self):
        self.assertEqual(
            self.request("PATCH", "/users/frontdesk", {"globalRole": "SUPER_ADMIN"}).status_code,
            403,
        )
        response = self.request("PATCH", "/users/owner-a", {"active": False})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json["error"]["code"], "self_permissions_locked")

    def test_owner_activity_is_filtered_paginated_and_isolated(self):
        self.request("PATCH", "/users/frontdesk", {"role": "ACCOUNTANT"})
        self.request("PATCH", "/users/frontdesk", {"role": "FRONT_DESK"})
        other, csrf = self.login("owner-b@test.local")
        self.request(
            "PATCH",
            "/api/tenants/test-hotel-b/users/owner-b",
            {"role": "HOTEL_OWNER"},
            client=other,
            headers=csrf,
        )
        response = self.request("GET", "/audit?pageSize=1&event=membership.updated")
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json["pagination"]["totalItems"], 2)
        first = response.json["auditLogs"][0]
        self.assertEqual(first["tenantId"], self.tenant_id)
        second = self.request("GET", "/audit?pageSize=1&page=2&event=membership.updated").json[
            "auditLogs"
        ][0]
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(self.request("GET", "/audit?userId=owner-b").json["auditLogs"], [])
        self.assertEqual(self.request("GET", "/api/tenants/test-hotel-b/audit").status_code, 403)
        desk, headers = self.login("frontdesk@test.local")
        self.assertEqual(
            self.request("GET", "/audit", client=desk, headers=headers).status_code, 403
        )
        for query in (
            "page=0",
            "pageSize=201",
            "tenantId=test-hotel-b",
            "event=",
            "start=2026-10-01",
            "start=2026-10-03T00:00:00Z&end=2026-10-01T00:00:00Z",
        ):
            self.assertEqual(self.request("GET", "/audit?" + query).status_code, 422)
