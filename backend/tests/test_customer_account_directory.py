"""The SaaS customer directory lists safe identities without granting hotel access."""

import unittest
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask
from sqlalchemy.dialects import postgresql
from werkzeug.datastructures import MultiDict

from pms_api import security
from pms_api.admin import customers, routes
from pms_api.core_models import TenantUser, User
from pms_api.extensions import db
from pms_api.security import ApiError, set_context
from tests.domain_fixture import DomainTestCase


class CustomerDirectoryUnitTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)

    def test_filters_allow_browsing_and_short_literal_search(self):
        for raw, expected in (("", ""), (" a ", "a"), ("100%_", "100%_")):
            with self.subTest(raw=raw):
                filters = customers.customer_directory_filters(MultiDict({"search": raw}))
                self.assertEqual(
                    filters,
                    {
                        "search": expected,
                        "tenant_id": None,
                        "role": None,
                        "active": None,
                    },
                )
        self.assertEqual(
            customers.customer_directory_filters(
                MultiDict(
                    {
                        "tenantId": "hotel-a",
                        "role": "FRONT_DESK",
                        "active": "false",
                    }
                )
            ),
            {
                "search": "",
                "tenant_id": "hotel-a",
                "role": "FRONT_DESK",
                "active": False,
            },
        )

    def test_filters_reject_invalid_ambiguous_and_unknown_parameters(self):
        invalid = [
            MultiDict({"search": "x" * 255}),
            MultiDict({"search": "a\x00b"}),
            MultiDict({"search": " a\n"}),
            MultiDict({"role": "SUPER_ADMIN"}),
            MultiDict({"role": ""}),
            MultiDict({"tenantId": ""}),
            MultiDict({"tenantId": "x" * 41}),
            MultiDict({"active": "1"}),
            MultiDict({"active": ""}),
            MultiDict({"active": "TRUE"}),
            MultiDict({"globalRole": "USER"}),
        ]
        invalid.extend(
            MultiDict([(key, "x"), (key, "x")])
            for key in (
                "search",
                "tenantId",
                "role",
                "active",
                "page",
                "pageSize",
            )
        )
        for query in invalid:
            with self.subTest(query=query), self.assertRaises(ApiError) as caught:
                customers.customer_directory_filters(query)
            self.assertEqual(caught.exception.status, 422)

    def test_route_defaults_and_bounds_use_bounded_pagination(self):
        for query, expected in (("", (1, 20)), ("?page=2&pageSize=100", (2, 100))):
            with (
                self.subTest(query=query),
                self.app.test_request_context("/" + query),
                patch.object(
                    routes, "customer_account_directory", return_value={"users": []}
                ) as directory,
            ):
                routes.CustomerAccountDirectoryView.dispatch_request.__wrapped__()
                self.assertEqual(directory.call_args.args, expected)
        for query in (
            "?page=0",
            "?page=100001",
            "?page=no",
            "?pageSize=0",
            "?pageSize=101",
            "?pageSize=500",
            "?pageSize=no",
            "?pageSize=20&pageSize=20",
        ):
            with (
                self.subTest(query=query),
                self.app.test_request_context("/" + query),
                patch.object(routes, "customer_account_directory") as directory,
                self.assertRaises(ApiError) as caught,
            ):
                routes.CustomerAccountDirectoryView.dispatch_request.__wrapped__()
            self.assertEqual(caught.exception.status, 422)
            directory.assert_not_called()

    def test_route_rejects_unknown_hotel_before_directory_query(self):
        with (
            self.app.test_request_context("/?tenantId=missing"),
            patch.object(routes, "db") as database,
            patch.object(routes, "customer_account_directory") as directory,
            self.assertRaises(ApiError) as caught,
        ):
            database.session.get.return_value = None
            routes.CustomerAccountDirectoryView.dispatch_request.__wrapped__()
        self.assertEqual((caught.exception.status, caught.exception.code), (404, "not_found"))
        directory.assert_not_called()

    def test_route_allows_system_roles_and_denies_ordinary_customers(self):
        for role in ("SUPER_ADMIN", "SYSTEM_MANAGER", "USER"):
            with (
                self.subTest(role=role),
                self.app.test_request_context(),
                patch.object(
                    security,
                    "authenticate",
                    return_value=SimpleNamespace(id="actor", global_role=role),
                ),
                patch.object(security, "set_context") as context,
                patch.object(
                    routes, "customer_account_directory", return_value={"users": []}
                ) as directory,
            ):
                if role == "USER":
                    with self.assertRaises(ApiError) as caught:
                        routes.CustomerAccountDirectoryView.dispatch_request()
                    self.assertEqual(caught.exception.status, 403)
                    context.assert_not_called()
                    directory.assert_not_called()
                else:
                    self.assertEqual(
                        routes.CustomerAccountDirectoryView.dispatch_request().json, {"users": []}
                    )
                    context.assert_called_once_with("actor", is_system=True)
        with (
            self.app.test_request_context(),
            patch.object(
                security, "authenticate", side_effect=ApiError(401, "unauthenticated", "Sign in")
            ),
            patch.object(routes, "customer_account_directory") as directory,
            self.assertRaises(ApiError) as caught,
        ):
            routes.CustomerAccountDirectoryView.dispatch_request()
        self.assertEqual(caught.exception.status, 401)
        directory.assert_not_called()

    def test_query_correlates_hotel_and_role_in_one_membership_and_keeps_user_status(self):
        with patch.object(customers, "db") as database:
            database.session.scalar.return_value = 0
            database.session.scalars.return_value.all.return_value = []
            result = customers.customer_account_directory(
                2,
                10,
                tenant_id="hotel-a",
                role="FRONT_DESK",
                active=False,
            )
            count_statement = database.session.scalar.call_args.args[0]
            rows_statement = database.session.scalars.call_args.args[0]
        self.assertEqual(
            result,
            {
                "users": [],
                "pagination": {"page": 2, "pageSize": 10, "totalItems": 0},
            },
        )
        for statement in (count_statement, rows_statement):
            compiled = statement.compile(dialect=postgresql.dialect())
            sql = str(compiled)
            self.assertEqual(sql.count("EXISTS"), 1)
            self.assertIn("tenant_users.user_id = users.id", sql)
            self.assertIn("tenant_users.tenant_id =", sql)
            self.assertIn("tenant_users.role =", sql)
            self.assertIn("users.active IS false", sql)
            self.assertEqual(compiled.params["global_role_1"], "USER")
            self.assertEqual(compiled.params["tenant_id_1"], "hotel-a")
            self.assertEqual(compiled.params["role_1"], "FRONT_DESK")

    def test_batched_membership_serialization_exposes_only_safe_identity_fields(self):
        user = SimpleNamespace(
            id="owner",
            name="Owner",
            email="owner@example.test",
            active=False,
            created_at=datetime(2026, 11, 1, tzinfo=UTC),
            password_hash="must-not-serialize",
        )
        membership = SimpleNamespace(user_id="owner", role="HOTEL_OWNER", active=False)
        hotel = SimpleNamespace(id="hotel-a", name="Hotel A")
        with patch.object(customers, "db") as database:
            database.session.execute.return_value = [(membership, hotel)]
            result = customers.customer_accounts_json([user])
            database.session.execute.assert_called_once()
        self.assertEqual(
            set(result[0]), {"id", "name", "email", "active", "createdAt", "memberships"}
        )
        self.assertEqual(
            result[0]["memberships"],
            [
                {
                    "tenantId": "hotel-a",
                    "tenantName": "Hotel A",
                    "role": "HOTEL_OWNER",
                    "active": False,
                }
            ],
        )
        self.assertNotIn("must-not-serialize", str(result))


class CustomerDirectoryIntegrationTests(DomainTestCase):
    path = "/api/admin/customer-accounts/directory"

    def setUp(self):
        super().setUp()
        self.manager, _ = self.login("manager@test.local")

    def test_permissions_customer_identity_shape_and_disabled_accounts(self):
        with self.app.app_context():
            set_context(is_system=True)
            db.session.get(User, "owner-b").active = False
            db.session.commit()
        for actor in ("admin", "manager"):
            client, _ = self.login(actor + "@test.local")
            response = client.get(self.path)
            self.assertEqual(response.status_code, 200, response.json)
            self.assertEqual(
                {row["id"] for row in response.json["users"]},
                {
                    "owner-a",
                    "owner-b",
                    "frontdesk",
                    "hk",
                    "accountant",
                },
            )
            self.assertEqual(
                response.json["pagination"], {"page": 1, "pageSize": 20, "totalItems": 5}
            )
            for row in response.json["users"]:
                self.assertEqual(
                    set(row), {"id", "name", "email", "active", "createdAt", "memberships"}
                )
            self.assertNotIn("password", str(response.json).lower())
        self.assertEqual(self.app.test_client().get(self.path).status_code, 401)
        for email in ("owner-a@test.local", "frontdesk@test.local"):
            client, _ = self.login(email)
            self.assertEqual(client.get(self.path).status_code, 403)
        inactive = self.manager.get(self.path, query_string={"active": "false"}).json
        self.assertEqual([row["id"] for row in inactive["users"]], ["owner-b"])

    def test_same_membership_filters_and_revoked_memberships_without_duplicates(self):
        with self.app.app_context():
            set_context(is_system=True)
            db.session.add(
                TenantUser(
                    tenant_id=self.other_tenant_id,
                    user_id="owner-a",
                    role="FRONT_DESK",
                    active=False,
                )
            )
            db.session.commit()
        response = self.manager.get(self.path, query_string={"search": "owner-a"})
        self.assertEqual(response.json["pagination"]["totalItems"], 1)
        self.assertEqual(len(response.json["users"]), 1)
        self.assertEqual(len(response.json["users"][0]["memberships"]), 2)
        for tenant_id, role, matches in (
            (self.tenant_id, "FRONT_DESK", {"frontdesk"}),
            (self.other_tenant_id, "FRONT_DESK", {"owner-a"}),
            (self.other_tenant_id, "HOTEL_OWNER", {"owner-b"}),
        ):
            response = self.manager.get(
                self.path, query_string={"tenantId": tenant_id, "role": role}
            )
            self.assertEqual({row["id"] for row in response.json["users"]}, matches)
        revoked = self.manager.get(self.path, query_string={"search": "owner-a"}).json["users"][0]
        self.assertTrue(any(not row["active"] for row in revoked["memberships"]))

    def test_pagination_literal_search_short_search_and_empty_pages(self):
        first = self.manager.get(self.path, query_string={"pageSize": 2}).json
        second = self.manager.get(self.path, query_string={"page": 2, "pageSize": 2}).json
        self.assertEqual(first["pagination"]["totalItems"], 5)
        self.assertEqual(len(first["users"]), 2)
        self.assertTrue(
            {row["id"] for row in first["users"]}.isdisjoint(
                {row["id"] for row in second["users"]},
            )
        )
        self.assertEqual(self.manager.get(self.path, query_string={"page": 100}).json["users"], [])
        with self.app.app_context():
            set_context(is_system=True)
            db.session.get(User, "frontdesk").name = "100%_literal"
            db.session.commit()
        response = self.manager.get(self.path, query_string={"search": "%_"})
        self.assertEqual([row["id"] for row in response.json["users"]], ["frontdesk"])
        response = self.manager.get(self.path, query_string={"search": "O"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json["users"])
        self.assertEqual(
            self.manager.get(self.path, query_string={"search": "missing"}).json["users"], []
        )
        self.assertEqual(
            self.manager.get(self.path, query_string={"tenantId": "missing"}).status_code, 404
        )

    def test_unassigned_customer_is_listed_but_not_matched_to_a_hotel(self):
        with self.app.app_context():
            set_context(is_system=True)
            password_hash = db.session.get(User, self.owner_id).password_hash
            db.session.add(
                User(
                    id="unassigned",
                    name="New account",
                    email="new@test.local",
                    password_hash=password_hash,
                )
            )
            db.session.commit()
        response = self.manager.get(self.path, query_string={"search": "new@test.local"})
        self.assertEqual(response.json["users"][0]["memberships"], [])
        response = self.manager.get(
            self.path, query_string={"search": "new@test.local", "tenantId": self.tenant_id}
        )
        self.assertEqual(response.json["users"], [])
