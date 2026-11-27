from datetime import timedelta

from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from werkzeug.security import check_password_hash

from pms_api.core_models import AuditLog, AuthSession, LoginAttempt, TenantUser, User, utcnow
from pms_api.extensions import db
from pms_api.security import digest, set_context
from tests.domain_fixture import TEST_PASSWORD, DomainTestCase


class IdentityTests(DomainTestCase):
    def test_system_emails_cannot_create_or_receive_hotel_memberships(self):
        for account in ("admin", "manager"):
            for account_active in (True, False):
                with self.app.app_context():
                    user = db.session.get(User, account)
                    original = (user.name, user.email, user.password_hash, user.global_role)
                    user.active = account_active
                    db.session.commit()
                for selector in (
                    {
                        "name": "Hotel staff",
                        "email": f" {account.upper()}@TEST.LOCAL ",
                        "password": TEST_PASSWORD,
                    },
                    {"email": f" {account.upper()}@TEST.LOCAL "},
                    {"userId": account},
                ):
                    for active in (True, False):
                        with self.subTest(
                            account=account,
                            account_active=account_active,
                            selector=selector.keys(),
                            active=active,
                        ):
                            response = self.request(
                                "POST",
                                "/users",
                                {
                                    **selector,
                                    "role": "FRONT_DESK",
                                    "active": active,
                                },
                            )
                            self.assertEqual(response.status_code, 409, response.json)
                            self.assertEqual(response.json["error"]["code"], "email_exists")
                with self.app.app_context():
                    set_context(is_system=True, is_service=True)
                    user = db.session.get(User, account)
                    self.assertEqual(
                        (user.name, user.email, user.password_hash, user.global_role), original
                    )
                    self.assertEqual(user.active, account_active)
                    self.assertEqual(
                        db.session.scalars(
                            select(TenantUser).where(TenantUser.user_id == account)
                        ).all(),
                        [],
                    )
                    self.assertEqual(
                        db.session.scalars(
                            select(AuditLog).where(
                                AuditLog.event == "membership.created",
                                AuditLog.entity_id == account,
                            )
                        ).all(),
                        [],
                    )
                    self.assertEqual(db.session.scalar(select(func.count()).select_from(User)), 7)

    def test_existing_customer_can_still_receive_another_hotel_membership(self):
        for account, selector in (
            ("owner-b", {"email": " OWNER-B@TEST.LOCAL "}),
            ("frontdesk", {"userId": "frontdesk"}),
        ):
            with self.subTest(account=account):
                path, client, headers = "/users", self.client, self.headers
                if account == "frontdesk":
                    path = f"/api/tenants/{self.other_tenant_id}/users"
                    client, headers = self.login("owner-b@test.local")
                response = self.request(
                    "POST", path, {**selector, "role": "FRONT_DESK"}, client=client, headers=headers
                )
                self.assertEqual(response.status_code, 201, response.json)
                self.assertEqual(response.json["id"], account)
                self.assertEqual(response.json["globalRole"], "USER")
                repeated = self.request(
                    "POST", path, {**selector, "role": "FRONT_DESK"}, client=client, headers=headers
                )
                self.assertEqual(repeated.status_code, 409, repeated.json)
                self.assertEqual(repeated.json["error"]["code"], "membership_exists")

    def test_login_cookie_hash_and_logout_revocation(self):
        response = self.client.get("/api/auth/session")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([t["id"] for t in response.json["tenants"]], [self.tenant_id])
        with self.app.app_context():
            user = db.session.get(User, self.owner_id)
            self.assertNotEqual(user.password_hash, TEST_PASSWORD)
            self.assertTrue(check_password_hash(user.password_hash, TEST_PASSWORD))
        response = self.request("POST", "/api/auth/logout")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get("/api/auth/session").status_code, 401)

    def test_wrong_password_and_expired_session(self):
        client = self.app.test_client()
        self.assertEqual(
            client.post(
                "/api/auth/login", json={"email": "owner-a@test.local", "password": "wrong"}
            ).status_code,
            401,
        )
        with self.app.app_context():
            session = db.session.scalar(
                select(AuthSession).where(AuthSession.user_id == self.owner_id)
            )
            session.expires_at = utcnow() - timedelta(seconds=1)
            db.session.commit()
        self.assertEqual(self.client.get("/api/auth/session").status_code, 401)

    def test_csrf_origin_and_cross_tenant_rejected(self):
        response = self.request(
            "PATCH", "/settings", {"name": "Oops"}, headers={"X-CSRF-Token": "é"}
        )
        self.assertEqual(response.status_code, 403)
        response = self.client.patch(
            f"/api/tenants/{self.tenant_id}/settings", json={"name": "Oops"}
        )
        self.assertEqual(response.status_code, 403)
        response = self.request(
            "PATCH",
            "/settings",
            {"name": "Oops"},
            headers={**self.headers, "Origin": "https://evil.example"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(
            self.request("GET", f"/api/tenants/{self.other_tenant_id}/workspace").status_code, 403
        )

    def test_role_matrix_self_permission_lock_and_membership_deactivation(self):
        self.assertEqual(
            self.request("PATCH", "/users/frontdesk", {"email": "renamed@test.local"}).status_code,
            422,
        )
        hk, headers = self.login("hk@test.local")
        self.assertEqual(
            self.request(
                "POST", "/masters/services", {"name": "No"}, client=hk, headers=headers
            ).status_code,
            403,
        )
        self.assertEqual(
            self.request("PATCH", f"/users/{self.owner_id}", {"active": False}).status_code, 403
        )
        self.assertEqual(
            self.request("PATCH", "/users/frontdesk", {"active": False}).status_code, 200
        )
        frontdesk, headers = self.login("frontdesk@test.local")
        self.assertEqual(
            self.request("GET", "/workspace", client=frontdesk, headers=headers).status_code, 403
        )

    def test_system_manager_and_suspended_hotel(self):
        manager, headers = self.login("manager@test.local")
        self.assertEqual(manager.get("/api/audit").status_code, 403)
        response = self.request(
            "PATCH",
            f"/api/tenants/{self.tenant_id}",
            {"status": "suspended"},
            client=manager,
            headers=headers,
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.request("POST", "/masters/services", {"name": "No"}).status_code, 403)
        self.assertEqual(self.request("GET", "/workspace").status_code, 200)

    def test_raw_rls_read_write_and_pool_context_reset(self):
        with self.app.app_context():
            engine = db.engine
            with engine.begin() as connection:
                connection.execute(
                    text("SELECT set_config('app.tenant_id',:tenant,true)"),
                    {"tenant": self.tenant_id},
                )
                ids = connection.execute(text("SELECT tenant_id FROM room_types")).scalars().all()
                self.assertEqual(ids, [self.tenant_id])
                result = connection.execute(
                    text("UPDATE room_types SET name='Hidden' WHERE tenant_id=:tenant"),
                    {"tenant": self.other_tenant_id},
                )
                self.assertEqual(result.rowcount, 0)
            with engine.connect() as connection:
                self.assertEqual(
                    connection.execute(text("SELECT tenant_id FROM room_types")).all(), []
                )

    def test_rate_limit_persists_failed_attempts(self):
        client = self.app.test_client()
        for _ in range(10):
            self.assertEqual(
                client.post(
                    "/api/auth/login", json={"email": "missing@test.local", "password": "wrong"}
                ).status_code,
                401,
            )
        self.assertEqual(
            client.post(
                "/api/auth/login", json={"email": "missing@test.local", "password": "wrong"}
            ).status_code,
            429,
        )

    def test_blocked_ip_cannot_create_or_increment_email_counters(self):
        with self.app.app_context():
            db.session.get(LoginAttempt, digest("ip:127.0.0.1")).attempts = 60
            email_key = digest("email:owner-a@test.local")
            attempts = db.session.get(LoginAttempt, email_key).attempts
            count = db.session.scalar(select(func.count()).select_from(LoginAttempt))
            db.session.commit()
        client = self.app.test_client()
        for email in ("new-target@test.local", "owner-a@test.local"):
            response = client.post("/api/auth/login", json={"email": email, "password": "wrong"})
            self.assertEqual(response.status_code, 429, response.json)
        with self.app.app_context():
            self.assertEqual(
                db.session.scalar(select(func.count()).select_from(LoginAttempt)), count
            )
            self.assertEqual(db.session.get(LoginAttempt, email_key).attempts, attempts)

    def test_admin_creates_hotel_owner_and_owner_creates_staff(self):
        admin, headers = self.login("admin@test.local")
        created = self.request(
            "POST",
            "/api/tenants",
            {
                "name": "New hotel",
                "ownerName": "New owner",
                "ownerEmail": "new-owner@test.local",
                "ownerPassword": TEST_PASSWORD,
            },
            client=admin,
            headers=headers,
        )
        self.assertEqual(created.status_code, 201, created.json)
        owner, owner_headers = self.login("new-owner@test.local")
        tenant_id = created.json["id"]
        workspace = owner.get(f"/api/tenants/{tenant_id}/workspace")
        self.assertEqual(workspace.status_code, 200)
        self.assertEqual(workspace.json["rooms"], [])
        staff = self.request(
            "POST",
            f"/api/tenants/{tenant_id}/users",
            {
                "name": "New staff",
                "email": "new-staff@test.local",
                "password": TEST_PASSWORD,
                "role": "FRONT_DESK",
            },
            client=owner,
            headers=owner_headers,
        )
        self.assertEqual(staff.status_code, 201, staff.json)
        updated = self.request(
            "PATCH",
            f"/api/tenants/{tenant_id}/users/{staff.json['id']}",
            {"role": "ACCOUNTANT"},
            client=owner,
            headers=owner_headers,
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json["memberships"][0]["role"], "ACCOUNTANT")

    def test_password_change_revokes_other_sessions(self):
        other, _ = self.login()
        new_password = "Changed-password-2026!"
        changed = self.request(
            "POST",
            "/api/auth/change-password",
            {"currentPassword": TEST_PASSWORD, "newPassword": new_password},
        )
        self.assertEqual(changed.status_code, 200)
        self.assertEqual(other.get("/api/auth/session").status_code, 401)
        self.assertEqual(self.client.get("/api/auth/session").status_code, 200)
        fresh, _ = self.login(password=new_password)
        self.assertEqual(fresh.get("/api/auth/session").status_code, 200)

    def test_rls_rejects_cross_tenant_insert(self):
        with self.app.app_context():
            with db.engine.connect() as connection:
                connection.execute(
                    text("SELECT set_config('app.tenant_id',:tenant,true)"),
                    {"tenant": self.tenant_id},
                )
                with self.assertRaises(DBAPIError) as caught:
                    connection.execute(
                        text(
                            "INSERT INTO room_types(id,tenant_id,name,base_price,capacity,active) VALUES('bad-id',:tenant,'Intruder',1,2,true)"
                        ),
                        {"tenant": self.other_tenant_id},
                    )
                self.assertEqual(caught.exception.orig.sqlstate, "42501")
                connection.rollback()
