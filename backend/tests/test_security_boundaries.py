"""Abuse cases at the authentication boundary, exercised through real HTTP views."""

import re
import unittest
from datetime import timedelta
from http.cookies import SimpleCookie
from unittest.mock import patch

from sqlalchemy import func, select

from pms_api import create_app
from pms_api.core_models import AuthSession, LoginAttempt, utcnow
from pms_api.extensions import db
from pms_api.security import COOKIE, digest
from tests.domain_fixture import TEST_PASSWORD, DomainTestCase


class AnonymousRouteSecurityTests(unittest.TestCase):
    def test_every_registered_protected_api_method_rejects_anonymous_requests(self):
        app = create_app(
            {
                "APP_ENV": "testing",
                "DATABASE_URL": "postgres://pms_app:fixture@127.0.0.1:1/pms_test_routes",
            },
            env_file=None,
        )
        public = {
            "/api/health",
            "/api/ready",
            "/api/auth/login",
            "/api/public/plans",
            "/api/public/contact",
            "/api/channex/webhooks/<tenant_id>",
        }
        client = app.test_client()
        checked = 0
        try:
            with (
                patch("pms_api.security.set_context"),
                patch("pms_api.security.db") as database,
                patch.object(app.logger, "warning"),
            ):
                for rule in app.url_map.iter_rules():
                    if not rule.rule.startswith("/api/") or rule.rule in public:
                        continue
                    path = re.sub(
                        r"<(?:[^:<>]+:)?([^<>]+)>",
                        "security-probe",
                        rule.rule,
                    )
                    for method in sorted(rule.methods - {"OPTIONS"}):
                        with self.subTest(route=rule.rule, method=method):
                            response = client.open(path, method=method, json={})
                            self.assertEqual(
                                response.status_code, 401, response.get_data(as_text=True)
                            )
                            if method != "HEAD":
                                self.assertEqual(response.json["error"]["code"], "unauthenticated")
                        checked += 1
                self.assertGreater(checked, 0)
                database.session.get.assert_not_called()
                database.session.commit.assert_not_called()
        finally:
            with app.app_context():
                db.engine.dispose()


class SecurityBoundaryTests(DomainTestCase):
    def test_head_and_method_override_headers_do_not_bypass_role_or_csrf_checks(self):
        client, csrf = self.login("hk@test.local")
        response = client.head(f"/api/tenants/{self.tenant_id}/users")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data, b"")
        for method, expected in (("GET", 405), ("POST", 405), ("PATCH", 403)):
            with self.subTest(method=method):
                response = client.open(
                    "/api/auth/profile?_method=PATCH",
                    method=method,
                    json={"name": "Override attack", "_method": "PATCH"},
                    headers={"X-HTTP-Method-Override": "PATCH", "X-Method-Override": "PATCH"},
                )
                self.assertEqual(response.status_code, expected, response.json)
        self.assertEqual(client.get("/api/auth/session").json["user"]["name"], "hk")
        self.assertEqual(
            client.patch(
                "/api/auth/profile",
                json={"name": "Housekeeper"},
                headers=csrf,
            ).status_code,
            200,
        )

    def test_csrf_tokens_are_session_bound_and_not_accepted_from_forms_or_json(self):
        other, other_csrf = self.login()
        for client, headers in ((self.client, other_csrf), (other, self.headers)):
            response = client.patch(
                "/api/auth/profile",
                json={"name": "Cross-session attack"},
                headers=headers,
            )
            self.assertEqual(response.status_code, 403, response.json)
            self.assertEqual(response.json["error"]["code"], "csrf_failed")
        for content_type, body in (
            (
                "application/json",
                '{"name":"JSON attack","csrfToken":"%s"}' % self.headers["X-CSRF-Token"],
            ),
            ("application/x-www-form-urlencoded", "name=Form+attack"),
            ("text/plain", '{"name":"Plain text attack"}'),
        ):
            with self.subTest(content_type=content_type):
                response = self.client.patch(
                    "/api/auth/profile",
                    data=body,
                    content_type=content_type,
                    headers={"Origin": "http://localhost"},
                )
                self.assertEqual(response.status_code, 403, response.json)
                self.assertEqual(response.json["error"]["code"], "csrf_failed")
        self.assertEqual(self.client.get("/api/auth/session").json["user"]["name"], "owner-a")

    def test_cross_site_login_cannot_replace_a_victims_session(self):
        token = self.client.get_cookie(COOKIE, path="/api").value
        for headers in (
            {"Origin": "null"},
            {"Origin": "http://localhost.attacker.example"},
            {"Sec-Fetch-Site": "cross-site"},
        ):
            with self.subTest(headers=headers):
                response = self.client.post(
                    "/api/auth/login",
                    json={"email": "owner-b@test.local", "password": TEST_PASSWORD},
                    headers=headers,
                )
                self.assertEqual(response.status_code, 403, response.json)
                self.assertEqual(response.json["error"]["code"], "origin_denied")
                self.assertEqual(self.client.get_cookie(COOKIE, path="/api").value, token)
        self.assertEqual(self.client.get("/api/auth/session").json["user"]["id"], self.owner_id)
        with self.app.app_context():
            self.assertEqual(db.session.scalar(select(func.count()).select_from(AuthSession)), 1)

    def test_successful_login_rotates_session_and_csrf_and_rejects_the_old_cookie(self):
        previous_token = self.client.get_cookie(COOKIE, path="/api").value
        response = self.client.post(
            "/api/auth/login",
            json={"email": "owner-a@test.local", "password": TEST_PASSWORD},
        )
        self.assertEqual(response.status_code, 200, response.json)
        self.assertNotEqual(self.client.get_cookie(COOKIE, path="/api").value, previous_token)
        self.assertNotEqual(response.json["csrfToken"], self.headers["X-CSRF-Token"])
        replay = self.app.test_client()
        replay.set_cookie(COOKIE, previous_token, path="/api")
        self.assertEqual(replay.get("/api/auth/session").status_code, 401)
        self.assertEqual(
            self.client.patch(
                "/api/auth/profile",
                json={"name": "Old CSRF attack"},
                headers=self.headers,
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.patch(
                "/api/auth/profile",
                json={"name": "Current session"},
                headers={"X-CSRF-Token": response.json["csrfToken"]},
            ).status_code,
            200,
        )

    def test_production_session_cookie_flags_and_remember_lifetimes(self):
        client = self.app.test_client()
        for remember in (False, True):
            with (
                self.subTest(remember=remember),
                patch.dict(self.app.config, {"APP_ENV": "production"}),
            ):
                response = client.post(
                    "/api/auth/login",
                    base_url="https://localhost",
                    json={
                        "email": "owner-a@test.local",
                        "password": TEST_PASSWORD,
                        "remember": remember,
                    },
                )
                self.assertEqual(response.status_code, 200, response.json)
                cookie = SimpleCookie(response.headers["Set-Cookie"])[COOKIE]
                self.assertTrue(cookie["httponly"])
                self.assertTrue(cookie["secure"])
                self.assertEqual(cookie["samesite"], "Lax")
                self.assertEqual(cookie["path"], "/api")
                self.assertEqual(cookie["max-age"], str(7 * 86400) if remember else "")
                with self.app.app_context():
                    row = db.session.get(AuthSession, digest(cookie.value))
                    expected = timedelta(days=7) if remember else timedelta(hours=8)
                    self.assertLess(
                        abs((row.expires_at - row.created_at) - expected), timedelta(seconds=1)
                    )

    def test_forwarded_ip_cannot_evade_throttling_and_expired_window_recovers(self):
        with self.app.app_context():
            counter = db.session.get(LoginAttempt, digest("ip:127.0.0.1"))
            counter.attempts = 60
            db.session.commit()
        for forwarded in ("203.0.113.1", "203.0.113.2"):
            response = self.app.test_client().post(
                "/api/auth/login",
                json={"email": "owner-a@test.local", "password": TEST_PASSWORD},
                headers={"X-Forwarded-For": forwarded, "X-Real-IP": forwarded},
            )
            self.assertEqual(response.status_code, 429, response.json)
        with self.app.app_context():
            expired = utcnow() - timedelta(minutes=16)
            for key in ("ip:127.0.0.1", "email:owner-a@test.local"):
                counter = db.session.get(LoginAttempt, digest(key))
                counter.started_at, counter.attempts = expired, 60
            db.session.commit()
        client, _ = self.login()
        self.assertEqual(client.get("/api/auth/session").status_code, 200)
        with self.app.app_context():
            for key in ("ip:127.0.0.1", "email:owner-a@test.local"):
                self.assertEqual(db.session.get(LoginAttempt, digest(key)).attempts, 1)

    def test_password_change_failures_persist_and_limit_is_account_scoped(self):
        other_session, other_headers = self.login()
        path = "/api/auth/change-password"
        invalid = {"currentPassword": "Incorrect-fixture-password!", "newPassword": TEST_PASSWORD}
        for attempt in range(10):
            client, headers = (
                (self.client, self.headers) if attempt % 2 else (other_session, other_headers)
            )
            response = client.post(path, json=invalid, headers=headers)
            self.assertEqual(response.status_code, 403, response.json)
            self.assertEqual(response.json["error"]["code"], "invalid_password")
        response = self.client.post(
            path,
            json={"currentPassword": TEST_PASSWORD, "newPassword": TEST_PASSWORD},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 429, response.json)
        with self.app.app_context():
            key = digest("password-change:user:" + self.owner_id)
            counter = db.session.get(LoginAttempt, key)
            self.assertEqual(counter.attempts, 11)
            counter.started_at = utcnow() - timedelta(minutes=16)
            db.session.commit()
        response = self.client.post(
            path,
            json={"currentPassword": TEST_PASSWORD, "newPassword": TEST_PASSWORD},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(other_session.get("/api/auth/session").status_code, 401)
        other_user, headers = self.login("owner-b@test.local")
        response = other_user.post(path, json=invalid, headers=headers)
        self.assertEqual(response.status_code, 403, response.json)
        self.assertEqual(response.json["error"]["code"], "invalid_password")
