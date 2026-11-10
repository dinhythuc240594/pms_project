"""Hotel members may edit their own display name without account privilege changes."""

from sqlalchemy import select
from sqlalchemy.exc import DBAPIError

from pms_api.core_models import AuditLog, uid
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class ClientProfileTests(DomainTestCase):
    def test_client_roles_can_update_own_name_without_invalidating_current_session(self):
        for user_id, role in (
            ("owner-a", "HOTEL_OWNER"),
            ("frontdesk", "FRONT_DESK"),
            ("accountant", "ACCOUNTANT"),
        ):
            with self.subTest(role=role):
                client, csrf = self.login(f"{user_id}@test.local")
                response = client.patch(
                    "/api/auth/profile", json={"name": "  Nguyễn Thị Ánh  "}, headers=csrf
                )
                self.assertEqual(response.status_code, 200, response.json)
                self.assertEqual(response.json["user"]["name"], "Nguyễn Thị Ánh")
                session = client.get("/api/auth/session")
                self.assertEqual(session.status_code, 200, session.json)
                self.assertEqual(session.json["user"]["name"], "Nguyễn Thị Ánh")
                self.assertEqual(session.json["user"]["id"], user_id)
                self.assertEqual(session.json["user"]["email"], f"{user_id}@test.local")
                self.assertEqual(session.json["user"]["globalRole"], "USER")
                self.assertEqual(session.json["csrfToken"], csrf["X-CSRF-Token"])
                membership = next(
                    row
                    for row in session.json["user"]["memberships"]
                    if row["tenantId"] == self.tenant_id
                )
                self.assertEqual(membership["role"], role)

    def test_client_profile_rejects_other_identity_and_privilege_fields(self):
        for user_id in ("owner-a", "frontdesk", "accountant"):
            with self.subTest(user=user_id):
                client, csrf = self.login(f"{user_id}@test.local")
                for extra in (
                    {"email": "changed@test.local"},
                    {"globalRole": "SUPER_ADMIN"},
                    {"role": "HOTEL_OWNER"},
                    {"userId": "owner-b"},
                    {"id": "owner-b"},
                ):
                    response = client.patch(
                        "/api/auth/profile", json={"name": "Unauthorized", **extra}, headers=csrf
                    )
                    self.assertEqual(response.status_code, 422, response.json)
                session = client.get("/api/auth/session")
                self.assertEqual(session.json["user"]["name"], user_id)
                self.assertEqual(session.json["user"]["globalRole"], "USER")
        other, _ = self.login("owner-b@test.local")
        self.assertEqual(other.get("/api/auth/session").json["user"]["name"], "owner-b")

    def test_client_profile_requires_csrf_and_valid_name(self):
        for name in ("", "   ", "x" * 161, None, 123):
            response = self.client.patch(
                "/api/auth/profile", json={"name": name}, headers=self.headers
            )
            self.assertEqual(response.status_code, 422, response.json)
        response = self.client.patch("/api/auth/profile", json={"name": "No CSRF"})
        self.assertEqual(response.status_code, 403, response.json)
        session = self.client.get("/api/auth/session")
        self.assertEqual(session.status_code, 200, session.json)
        self.assertEqual(session.json["user"]["name"], self.owner_id)

    def test_client_can_revoke_other_sessions_without_affecting_other_users(self):
        other, _ = self.login("owner-a@test.local")
        foreign, _ = self.login("owner-b@test.local")
        result = self.client.post("/api/auth/sessions/revoke-others", json={}, headers=self.headers)
        self.assertEqual(result.status_code, 200, result.json)
        self.assertEqual(result.json["revoked"], 1)
        self.assertEqual(other.get("/api/auth/session").status_code, 401)
        self.assertEqual(self.client.get("/api/auth/session").status_code, 200)
        self.assertEqual(foreign.get("/api/auth/session").status_code, 200)

    def test_self_service_audit_is_private_and_cannot_forge_actor_entity_or_event(self):
        with self.app.app_context():
            set_context(self.owner_id)
            entry = AuditLog(
                id=uid(),
                user_id=self.owner_id,
                event="profile.updated",
                entity_type="user",
                entity_id=self.owner_id,
                details={},
            )
            db.session.add(entry)
            db.session.flush()
            entry_id = entry.id
            self.assertEqual(db.session.scalars(select(AuditLog)).all(), [])
            db.session.commit()
            for changes in (
                {"user_id": "owner-b"},
                {"entity_id": "owner-b"},
                {"entity_type": "tenant"},
                {"event": "tenant.updated"},
                {"tenant_id": self.tenant_id},
                {"tenant_id": self.other_tenant_id},
            ):
                with self.subTest(changes=changes):
                    set_context(self.owner_id)
                    fields = {
                        "id": uid(),
                        "user_id": self.owner_id,
                        "event": "profile.updated",
                        "entity_type": "user",
                        "entity_id": self.owner_id,
                        "details": {},
                    }
                    db.session.add(AuditLog(**{**fields, **changes}))
                    with self.assertRaises(DBAPIError):
                        db.session.flush()
                    db.session.rollback()
            set_context(is_system=True, is_service=True)
            record = db.session.get(AuditLog, entry_id)
            self.assertEqual(record.user_id, self.owner_id)
            record.event = "sessions.revoked"
            with self.assertRaises(DBAPIError):
                db.session.flush()
            db.session.rollback()
            set_context(is_system=True, is_service=True)
            db.session.delete(db.session.get(AuditLog, entry_id))
            with self.assertRaises(DBAPIError):
                db.session.flush()
            db.session.rollback()
