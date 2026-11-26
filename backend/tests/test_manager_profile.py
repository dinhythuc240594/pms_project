"""Self-service profile and session controls cannot act on another user."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event, get_ident
from unittest.mock import patch

from pms_api.security import authenticate
from tests.domain_fixture import TEST_PASSWORD, DomainTestCase


class ManagerProfileTests(DomainTestCase):
    def setUp(self):
        super().setUp()
        self.manager, self.csrf = self.login("manager@test.local")

    def test_self_profile_name_only_and_csrf(self):
        response = self.manager.patch(
            "/api/auth/profile", json={"name": "Support Lead"}, headers=self.csrf
        )
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json["user"]["name"], "Support Lead")
        self.assertEqual(self.manager.get("/api/auth/session").json["user"]["name"], "Support Lead")
        for body in (
            {"name": ""},
            {"name": "x" * 161},
            {"globalRole": "SUPER_ADMIN"},
            {"email": "changed@test.local"},
            {"userId": "admin", "name": "Bad"},
        ):
            self.assertEqual(
                self.manager.patch("/api/auth/profile", json=body, headers=self.csrf).status_code,
                422,
            )
        self.assertEqual(
            self.manager.patch("/api/auth/profile", json={"name": "Bad"}).status_code, 403
        )

    def test_session_list_has_no_tokens_and_revoke_preserves_current_and_other_users(self):
        other, _ = self.login("manager@test.local")
        admin, _ = self.login("admin@test.local")
        response = self.manager.get("/api/auth/sessions")
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(len(response.json["sessions"]), 2)
        self.assertEqual(sum(row["current"] for row in response.json["sessions"]), 1)
        self.assertNotIn("token", str(response.json).lower())
        self.assertNotIn("csrf", str(response.json).lower())
        self.assertEqual(
            self.manager.post("/api/auth/sessions/revoke-others", json={}).status_code, 403
        )
        result = self.manager.post("/api/auth/sessions/revoke-others", json={}, headers=self.csrf)
        self.assertEqual(result.status_code, 200, result.json)
        self.assertEqual(result.json["revoked"], 1)
        self.assertEqual(other.get("/api/auth/session").status_code, 401)
        self.assertEqual(self.manager.get("/api/auth/session").status_code, 200)
        self.assertEqual(admin.get("/api/auth/session").status_code, 200)
        self.assertEqual(
            self.manager.post(
                "/api/auth/sessions/revoke-others", json={"userId": "admin"}, headers=self.csrf
            ).status_code,
            422,
        )

    def test_revoked_request_cannot_revoke_current_session_change_profile_or_password(self):
        for path, method, body in (
            ("/api/auth/sessions/revoke-others", "POST", {}),
            ("/api/auth/profile", "PATCH", {"name": "Revoked request"}),
            (
                "/api/auth/change-password",
                "POST",
                {
                    "currentPassword": TEST_PASSWORD,
                    "newPassword": "Changed-password-2026!",
                },
            ),
        ):
            with self.subTest(path=path):
                other, csrf = self.login("manager@test.local")
                authenticated, release = Event(), Event()
                worker = [None]

                def pause_authenticated_request():
                    user = authenticate()
                    if get_ident() == worker[0]:
                        authenticated.set()
                        if not release.wait(5):
                            raise RuntimeError("Revoked request was not released")
                    return user

                def pending_request():
                    worker[0] = get_ident()
                    return self.request(method, path, body, client=other, headers=csrf)

                with patch(
                    "pms_api.auth.routes.authenticate", side_effect=pause_authenticated_request
                ):
                    with ThreadPoolExecutor(max_workers=1) as pool:
                        future = pool.submit(pending_request)
                        try:
                            self.assertTrue(authenticated.wait(5), "Request did not authenticate")
                            revoked = self.manager.post(
                                "/api/auth/sessions/revoke-others", json={}, headers=self.csrf
                            )
                            self.assertEqual(revoked.status_code, 200, revoked.json)
                        finally:
                            release.set()
                        response = future.result(timeout=10)
                self.assertEqual(response.status_code, 401, response.json)
                self.assertEqual(other.get("/api/auth/session").status_code, 401)
                current = self.manager.get("/api/auth/session")
                self.assertEqual(current.status_code, 200, current.json)
                self.assertEqual(current.json["user"]["name"], "manager")
