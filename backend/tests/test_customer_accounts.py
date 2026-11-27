"""Only active hotel owners can be assigned an additional hotel through SaaS setup."""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask
from sqlalchemy import func, select
from sqlalchemy.dialects import postgresql

from pms_api.admin import customers, routes
from pms_api.core_models import Tenant, TenantUser, User
from pms_api.extensions import db
from pms_api.security import ApiError, set_context
from tests.domain_fixture import TEST_PASSWORD, DomainTestCase


class CustomerOwnerEligibilityTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)

    def test_picker_filters_active_owner_memberships_before_applying_limit(self):
        with patch.object(customers, "db") as database:
            database.session.scalars.return_value.all.return_value = []
            self.assertEqual(customers.customer_accounts("match"), [])
            statement = database.session.scalars.call_args.args[0]
        compiled = statement.compile(dialect=postgresql.dialect())
        sql = str(compiled)
        self.assertEqual(sql.count("EXISTS"), 1)
        self.assertIn("users.active IS true", sql)
        self.assertIn("tenant_users.active IS true", sql)
        self.assertIn("tenant_users.user_id = users.id", sql)
        self.assertIn("HOTEL_OWNER", compiled.params.values())
        self.assertIn("USER", compiled.params.values())
        self.assertEqual(statement._limit_clause.value, 20)

    def test_direct_assignment_rejects_missing_owner_membership_before_any_write(self):
        owner = SimpleNamespace(id="staff", active=True, global_role="USER")
        with (
            self.app.test_request_context(json={"name": "Hotel", "ownerUserId": owner.id}),
            patch.object(routes, "db") as database,
            self.assertRaises(ApiError) as caught,
        ):
            database.session.scalar.side_effect = [owner, None]
            routes.CreateTenantView.dispatch_request.__wrapped__()
        self.assertEqual((caught.exception.status, caught.exception.code), (422, "invalid_owner"))
        database.session.add.assert_not_called()
        database.session.flush.assert_not_called()
        database.session.execute.assert_not_called()
        membership_query = database.session.scalar.call_args_list[1].args[0]
        compiled = membership_query.compile(dialect=postgresql.dialect())
        self.assertIn("FOR UPDATE", str(compiled))
        self.assertIn("tenant_users.active IS true", str(compiled))
        self.assertIn("HOTEL_OWNER", compiled.params.values())
        self.assertIn(owner.id, compiled.params.values())

    def test_inactive_and_internal_accounts_are_rejected_before_membership_or_writes(self):
        for role, active in (("USER", False), ("SUPER_ADMIN", True), ("SYSTEM_MANAGER", True)):
            with (
                self.subTest(role=role, active=active),
                self.app.test_request_context(json={"name": "Hotel", "ownerUserId": "account"}),
                patch.object(routes, "db") as database,
                self.assertRaises(ApiError) as caught,
            ):
                database.session.scalar.return_value = SimpleNamespace(
                    id="account", active=active, global_role=role
                )
                routes.CreateTenantView.dispatch_request.__wrapped__()
            self.assertEqual(
                (caught.exception.status, caught.exception.code), (422, "invalid_owner")
            )
            self.assertEqual(database.session.scalar.call_count, 1)
            database.session.add.assert_not_called()
            database.session.execute.assert_not_called()

    def test_existing_owner_is_checked_then_provisioned_with_owner_role(self):
        owner = SimpleNamespace(
            id="owner", name="Owner", email="owner@example.test", active=True, global_role="USER"
        )
        tenant = SimpleNamespace(id="new-hotel", settings={})
        with (
            self.app.test_request_context(json={"name": "Hotel", "ownerUserId": owner.id}),
            patch.object(routes, "db") as database,
            patch.object(routes, "Tenant", return_value=tenant),
            patch.object(routes, "customer_tenants", return_value=[{"id": tenant.id}]),
            patch.object(routes, "audit"),
            patch.object(routes, "new_user") as create_user,
        ):
            database.session.scalar.side_effect = [owner, "active-owner-membership"]
            response, status = routes.CreateTenantView.dispatch_request.__wrapped__()
        self.assertEqual((status, response.json), (201, {"id": tenant.id}))
        create_user.assert_not_called()
        granted = next(
            call.args[0]
            for call in database.session.add.call_args_list
            if isinstance(call.args[0], TenantUser)
        )
        self.assertEqual(
            (granted.user_id, granted.tenant_id, granted.role), (owner.id, tenant.id, "HOTEL_OWNER")
        )

    def test_new_account_creation_provisions_its_first_owner_membership(self):
        owner = SimpleNamespace(id="new-owner", name="Owner", email="owner@example.test")
        tenant = SimpleNamespace(id="new-hotel", settings={})
        with (
            self.app.test_request_context(json={"name": "Hotel", "ownerName": "Owner"}),
            patch.object(routes, "db") as database,
            patch.object(routes, "Tenant", return_value=tenant),
            patch.object(routes, "customer_tenants", return_value=[{"id": tenant.id}]),
            patch.object(routes, "audit"),
            patch.object(routes, "new_user", return_value=owner) as create_user,
        ):
            _, status = routes.CreateTenantView.dispatch_request.__wrapped__()
        self.assertEqual(status, 201)
        create_user.assert_called_once_with({"name": "Hotel", "ownerName": "Owner"}, prefix="owner")
        database.session.scalar.assert_not_called()
        granted = next(
            call.args[0]
            for call in database.session.add.call_args_list
            if isinstance(call.args[0], TenantUser)
        )
        self.assertEqual((granted.user_id, granted.role), (owner.id, "HOTEL_OWNER"))


class CustomerAccountTests(DomainTestCase):
    def setUp(self):
        super().setUp()
        self.manager, self.csrf = self.login("manager@test.local")

    def create(self, body, **kwargs):
        return self.request(
            "POST",
            "/api/tenants",
            body,
            client=kwargs.get("client", self.manager),
            headers=kwargs.get("headers", self.csrf),
        )

    def counts(self):
        with self.app.app_context():
            set_context(is_system=True)
            return tuple(
                db.session.scalar(select(func.count()).select_from(model))
                for model in (Tenant, User, TenantUser)
            )

    def test_search_matches_name_email_and_returns_only_safe_customer_details(self):
        for actor in ("admin", "manager"):
            client, _ = self.login(actor + "@test.local")
            for query in ("OWNER-A", "OWNER-A@TEST.LOCAL"):
                response = client.get(
                    "/api/admin/customer-accounts", query_string={"search": query}
                )
                self.assertEqual(response.status_code, 200, response.json)
                self.assertEqual(len(response.json["users"]), 1)
                user = response.json["users"][0]
                self.assertEqual(
                    set(user), {"id", "name", "email", "active", "createdAt", "memberships"}
                )
                self.assertEqual(user["id"], self.owner_id)
                self.assertEqual(
                    user["memberships"],
                    [
                        {
                            "tenantId": self.tenant_id,
                            "tenantName": "Hotel a",
                            "role": "HOTEL_OWNER",
                            "active": True,
                        }
                    ],
                )
                self.assertNotIn("password", str(response.json).lower())
            response = client.get("/api/admin/customer-accounts?search=test.local")
            self.assertEqual(
                {row["id"] for row in response.json["users"]},
                {"owner-a", "owner-b"},
            )
        anonymous = self.app.test_client()
        self.assertEqual(
            anonymous.get("/api/admin/customer-accounts?search=owner").status_code, 401
        )
        self.assertEqual(
            self.client.get("/api/admin/customer-accounts?search=owner").status_code, 403
        )

    def test_search_excludes_disabled_accounts_and_escapes_like_wildcards(self):
        with self.app.app_context():
            set_context(is_system=True)
            db.session.get(User, "owner-b").active = False
            db.session.get(User, "owner-a").name = "100%_literal"
            db.session.get(User, "frontdesk").name = "100%_literal"
            db.session.commit()
        self.assertEqual(
            self.manager.get("/api/admin/customer-accounts?search=owner-b").json["users"], []
        )
        for query in ("%_", "100%_"):
            response = self.manager.get(
                "/api/admin/customer-accounts", query_string={"search": query}
            )
            self.assertEqual([row["id"] for row in response.json["users"]], ["owner-a"])
        self.assertEqual(
            self.manager.get("/api/admin/customer-accounts?search=missing").json["users"], []
        )

    def test_search_rejects_unbounded_and_unsupported_filters(self):
        for query in (
            "",
            "?search=",
            "?search=a",
            "?search=" + "x" * 255,
            "?search=owner&role=SUPER_ADMIN",
            "?search=owner&search=staff",
            "?search=ow%00ner",
        ):
            response = self.manager.get("/api/admin/customer-accounts" + query)
            self.assertEqual(response.status_code, 422, (query, response.json))

    def test_search_returns_at_most_twenty_matches(self):
        with self.app.app_context():
            set_context(is_system=True)
            password_hash = db.session.get(User, self.owner_id).password_hash
            for index in range(25):
                user = User(
                    name=f"Matching customer {index:02}",
                    email=f"match-{index:02}@test.local",
                    password_hash=password_hash,
                )
                db.session.add(user)
                db.session.flush()
                db.session.add(
                    TenantUser(tenant_id=self.tenant_id, user_id=user.id, role="HOTEL_OWNER")
                )
            db.session.commit()
        response = self.manager.get("/api/admin/customer-accounts?search=Matching")
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(len(response.json["users"]), 20)
        self.assertEqual(response.json["users"][0]["name"], "Matching customer 00")

    def test_existing_account_gets_new_owner_membership_without_profile_or_password_changes(self):
        before = self.counts()
        with self.app.app_context():
            original_hash = db.session.get(User, self.owner_id).password_hash
        response = self.create({"name": "Second hotel", "ownerUserId": self.owner_id})
        self.assertEqual(response.status_code, 201, response.json)
        self.assertEqual(self.counts(), (before[0] + 1, before[1], before[2] + 1))
        hotel_id = response.json["id"]
        self.assertEqual(response.json["owner"]["id"], self.owner_id)
        self.assertEqual(response.json["contactName"], "owner-a")
        self.assertEqual(response.json["contactEmail"], "owner-a@test.local")
        self.assertNotIn("password", str(response.json).lower())
        with self.app.app_context():
            user = db.session.get(User, self.owner_id)
            self.assertEqual(user.password_hash, original_hash)
            self.assertEqual(
                (user.name, user.email, user.global_role), ("owner-a", "owner-a@test.local", "USER")
            )
            set_context(is_system=True)
            memberships = db.session.scalars(
                select(TenantUser).where(TenantUser.user_id == self.owner_id)
            ).all()
            self.assertEqual({row.tenant_id for row in memberships}, {self.tenant_id, hotel_id})
            self.assertTrue(all(row.role == "HOTEL_OWNER" and row.active for row in memberships))
        owner, _ = self.login("owner-a@test.local", TEST_PASSWORD)
        self.assertEqual(owner.get(f"/api/tenants/{hotel_id}/workspace").status_code, 200)

    def test_revoked_owner_and_unassigned_accounts_cannot_be_promoted_during_hotel_creation(self):
        with self.app.app_context():
            set_context(is_system=True)
            db.session.add(
                TenantUser(
                    tenant_id=self.other_tenant_id,
                    user_id="frontdesk",
                    role="HOTEL_OWNER",
                    active=False,
                )
            )
            db.session.add(
                User(
                    id="unassigned",
                    name="Unassigned",
                    email="unassigned@test.local",
                    password_hash=db.session.get(User, self.owner_id).password_hash,
                )
            )
            db.session.commit()
        before = self.counts()
        for user_id in ("frontdesk", "unassigned"):
            with self.subTest(user_id=user_id):
                response = self.create({"name": "Rejected hotel", "ownerUserId": user_id})
                self.assertEqual(response.status_code, 422, response.json)
                self.assertEqual(response.json["error"]["code"], "invalid_owner")
                self.assertEqual(self.counts(), before)
                search = self.manager.get(
                    "/api/admin/customer-accounts", query_string={"search": user_id}
                )
                self.assertEqual(search.json["users"], [])
        directory = self.manager.get(
            "/api/admin/customer-accounts/directory", query_string={"search": "frontdesk"}
        )
        self.assertEqual([user["id"] for user in directory.json["users"]], ["frontdesk"])

    def test_owner_with_another_staff_membership_can_manage_a_new_hotel(self):
        with self.app.app_context():
            set_context(is_system=True)
            db.session.add(
                TenantUser(
                    tenant_id=self.other_tenant_id,
                    user_id=self.owner_id,
                    role="FRONT_DESK",
                )
            )
            db.session.commit()
        found = self.manager.get(
            "/api/admin/customer-accounts", query_string={"search": self.owner_id}
        )
        self.assertEqual([user["id"] for user in found.json["users"]], [self.owner_id])
        self.assertEqual(len(found.json["users"][0]["memberships"]), 2)
        created = self.create({"name": "Another hotel", "ownerUserId": self.owner_id})
        self.assertEqual(created.status_code, 201, created.json)
        with self.app.app_context():
            set_context(is_system=True)
            membership = db.session.scalar(
                select(TenantUser).where(
                    TenantUser.user_id == self.owner_id,
                    TenantUser.tenant_id == self.other_tenant_id,
                )
            )
            self.assertEqual(membership.role, "FRONT_DESK")

    def test_account_details_are_independent_from_hotel_contacts(self):
        response = self.create(
            {
                "name": "Second hotel",
                "ownerUserId": self.owner_id,
                "contactName": "Reception",
                "contactEmail": "reception@test.local",
            }
        )
        self.assertEqual(response.status_code, 201, response.json)
        self.assertEqual(response.json["contactEmail"], "reception@test.local")
        self.assertEqual(response.json["owner"]["email"], "owner-a@test.local")
        hotel = next(
            row
            for row in self.manager.get("/api/tenants").json["tenants"]
            if row["id"] == response.json["id"]
        )
        self.assertEqual(hotel["owner"], response.json["owner"])

    def test_invalid_or_conflicting_owner_selection_leaves_no_partial_data(self):
        with self.app.app_context():
            set_context(is_system=True)
            db.session.get(User, "owner-b").active = False
            db.session.commit()
        before = self.counts()
        for fields, expected in (
            ({"ownerUserId": "missing"}, 404),
            ({"ownerUserId": "owner-b"}, 422),
            ({"ownerUserId": "admin"}, 422),
            ({"ownerUserId": "manager"}, 422),
            ({"ownerUserId": "frontdesk"}, 422),
            ({"ownerUserId": "hk"}, 422),
            ({"ownerUserId": "accountant"}, 422),
            ({"ownerUserId": None}, 422),
            ({"ownerUserId": 123}, 422),
            ({"ownerUserId": ""}, 422),
            ({"ownerUserId": " " + self.owner_id}, 422),
            ({"ownerUserId": "x" * 41}, 422),
            ({"ownerUserId": self.owner_id, "ownerName": "Changed"}, 422),
            ({"ownerUserId": self.owner_id, "ownerEmail": "changed@test.local"}, 422),
            ({"ownerUserId": self.owner_id, "ownerPassword": "Changed-password-2026!"}, 422),
            (
                {
                    "ownerEmail": "owner-a@test.local",
                    "ownerName": "Existing",
                    "ownerPassword": TEST_PASSWORD,
                },
                409,
            ),
        ):
            with self.subTest(fields=fields):
                response = self.create({"name": "Rejected hotel", **fields})
                self.assertEqual(response.status_code, expected, response.json)
                self.assertEqual(self.counts(), before)
        response = self.create(
            {
                "name": "",
                "ownerName": "New",
                "ownerEmail": "fresh@test.local",
                "ownerPassword": TEST_PASSWORD,
            }
        )
        self.assertEqual(response.status_code, 422, response.json)
        self.assertEqual(self.counts(), before)

    def test_creation_requires_system_access_csrf_and_valid_contact_inputs(self):
        body = {"name": "Rejected hotel", "ownerUserId": self.owner_id}
        self.assertEqual(
            self.create(body, client=self.client, headers=self.headers).status_code, 403
        )
        self.assertEqual(self.create(body, headers={}).status_code, 403)
        before = self.counts()
        for fields in (
            {"contactPhone": "123456"},
            {"contactPhone": "1" * 16},
            {"contactEmail": "bad..email@hotel.example"},
            {"taxId": "1e10"},
        ):
            response = self.create({**body, **fields})
            self.assertEqual(response.status_code, 422, response.json)
            self.assertEqual(self.counts(), before)
