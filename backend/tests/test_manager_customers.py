"""Manager client profiles must never leak into a hotel workspace."""

from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError

from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class ManagerCustomerTests(DomainTestCase):
    def setUp(self):
        super().setUp()
        self.manager, self.csrf = self.login("manager@test.local")

    def update(self, body, **kwargs):
        return self.request(
            "PATCH",
            f"/api/tenants/{self.tenant_id}",
            body,
            client=kwargs.get("client", self.manager),
            headers=kwargs.get("headers", self.csrf),
        )

    def test_contact_roundtrip_is_separate_from_owner_identity_and_hotel_workspace(self):
        initial = self.manager.get("/api/tenants").json["tenants"]
        self.assertEqual(
            next(t for t in initial if t["id"] == self.tenant_id)["contactEmail"],
            "owner-a@test.local",
        )
        body = {
            "contactName": "Sales contact",
            "contactEmail": "contact@test.local",
            "contactPhone": "+84 900 123",
            "address": "10 Nguyen Hue",
            "city": "HCM",
            "taxId": "01012345",
            "domain": "hotel.example.com",
            "customerNotes": "Private CRM",
        }
        result = self.update(body)
        self.assertEqual(result.status_code, 200, result.json)
        for key, value in body.items():
            self.assertEqual(result.json[key], value)
        rows = self.manager.get("/api/tenants").json["tenants"]
        self.assertEqual(
            next(t for t in rows if t["id"] == self.tenant_id)["customerNotes"], "Private CRM"
        )
        self.assertNotIn("Private CRM", str(self.client.get("/api/auth/session").json))
        self.assertNotIn("Private CRM", str(self.request("GET", "/workspace").json))
        self.assertEqual(
            self.client.get("/api/auth/session").json["user"]["email"], "owner-a@test.local"
        )
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(
                db.session.scalar(text("SELECT count(*) FROM tenant_client_profiles")), 0
            )

    def test_validation_permissions_and_csrf(self):
        self.assertEqual(
            self.update(
                {"contactName": "No"}, client=self.client, headers=self.headers
            ).status_code,
            403,
        )
        self.assertEqual(self.update({"city": "No"}, headers={}).status_code, 403)
        for body in (
            {"contactEmail": "bad"},
            {"contactPhone": "098210910A"},
            {"contactPhone": "090+123"},
            {"domain": "https://example.com/path"},
            {"customerNotes": "x" * 4001},
            {"phone": "unsupported"},
            {"city": 42},
        ):
            self.assertEqual(self.update(body).status_code, 422, body)
        self.assertEqual(self.update({"domain": "", "contactEmail": ""}).status_code, 200)

    def test_create_stores_contacts_and_does_not_put_password_in_audit(self):
        body = {
            "name": "New hotel",
            "ownerName": "Owner",
            "ownerEmail": "new@test.local",
            "ownerPassword": "New-owner-password-2026!",
            "contactPhone": "0901234567",
            "customerNotes": "Internal follow-up",
            "domain": "new.example.com",
        }
        rejected = self.request(
            "POST",
            "/api/tenants",
            {**body, "contactPhone": "098210910A"},
            client=self.manager,
            headers=self.csrf,
        )
        self.assertEqual(rejected.status_code, 422, rejected.json)
        response = self.request(
            "POST", "/api/tenants", body, client=self.manager, headers=self.csrf
        )
        self.assertEqual(response.status_code, 201, response.json)
        self.assertEqual(response.json["contactEmail"], "new@test.local")
        self.assertEqual(response.json["contactPhone"], "0901234567")
        audit = self.manager.get(f"/api/tenants/{response.json['id']}/customer-history").json
        self.assertNotIn(body["ownerPassword"], str(audit))
        self.assertNotIn(body["customerNotes"], str(audit))

    def test_customer_history_scoped_available_when_suspended(self):
        self.assertEqual(self.update({"status": "suspended"}).status_code, 200)
        path = f"/api/tenants/{self.tenant_id}/customer-history"
        result = self.manager.get(path + "?pageSize=1")
        self.assertEqual(result.status_code, 200, result.json)
        self.assertTrue(result.json["auditLogs"])
        self.assertTrue(all(row["tenantId"] == self.tenant_id for row in result.json["auditLogs"]))
        self.assertEqual(self.client.get(path).status_code, 403)
        self.assertEqual(self.manager.get(path + "?tenantId=other").status_code, 422)

    def test_suspended_staff_require_owner_membership_not_system_role(self):
        path = f"/api/tenants/{self.tenant_id}/users"
        self.assertEqual(self.update({"status": "suspended"}).status_code, 200)
        response = self.client.get(path)
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(
            {row["id"] for row in response.json["users"]},
            {"owner-a", "frontdesk", "hk", "accountant"},
        )
        self.assertNotIn("password", str(response.json).lower())
        for email in (
            "admin@test.local",
            "manager@test.local",
            "owner-b@test.local",
            "frontdesk@test.local",
            "hk@test.local",
            "accountant@test.local",
        ):
            client, _ = self.login(email)
            self.assertEqual(client.get(path).status_code, 403)
        self.assertEqual(self.app.test_client().get(path).status_code, 401)
        self.assertEqual(
            self.client.get(f"/api/tenants/{self.other_tenant_id}/users").status_code, 403
        )
        for client, csrf, code in (
            (self.manager, self.csrf, "tenant_denied"),
            (self.client, self.headers, "tenant_suspended"),
        ):
            for method, suffix, body in (
                (
                    "POST",
                    "",
                    {
                        "name": "Blocked",
                        "email": "blocked@test.local",
                        "password": "Blocked-password-2026!",
                        "role": "FRONT_DESK",
                    },
                ),
                ("PATCH", "/frontdesk", {"active": False}),
            ):
                response = self.request(method, path + suffix, body, client=client, headers=csrf)
                self.assertEqual(response.status_code, 403, response.json)
                self.assertEqual(response.json["error"]["code"], code)

    def test_customer_profile_downgrade_refuses_saved_contact_data(self):
        scripts = ScriptDirectory(str(Path(__file__).resolve().parents[1] / "migrations"))
        migration = scripts.get_revision("0014_manager_customers").module
        engine = create_engine(self.app.config["DATABASE_MIGRATION_URL"], hide_parameters=True)
        try:
            before_empty = self.manager.get("/api/tenants").json
            # Exercise the profile migration alone while preserving later schema and quotas.
            with engine.begin() as connection:
                revision = connection.scalar(text("SELECT version_num FROM alembic_version"))
                self.assertEqual(revision, scripts.get_current_head())
                context = MigrationContext.configure(
                    connection, opts={"target_metadata": db.metadata}
                )
                with Operations.context(context):
                    migration.downgrade()
                    self.assertIsNone(
                        connection.scalar(text("SELECT to_regclass('tenant_client_profiles')"))
                    )
                    migration.upgrade()
            self.assertEqual(self.manager.get("/api/tenants").json, before_empty)
            self.assertEqual(
                self.update({"contactPhone": "0901234567", "customerNotes": "Private"}).status_code,
                200,
            )
            before = self.manager.get("/api/tenants").json
            with self.assertRaises(DBAPIError) as refused:
                with engine.begin() as connection:
                    context = MigrationContext.configure(
                        connection, opts={"target_metadata": db.metadata}
                    )
                    with Operations.context(context):
                        migration.downgrade()
            self.assertIn(
                "customer profiles exist; downgrade refused", str(refused.exception).lower()
            )
            with engine.connect() as connection:
                self.assertEqual(
                    connection.scalar(text("SELECT version_num FROM alembic_version")), revision
                )
            self.assertEqual(self.manager.get("/api/tenants").json, before)
            self.assertEqual(self.client.get("/api/auth/session").status_code, 200)
        finally:
            engine.dispose()
