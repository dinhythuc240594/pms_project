"""Hotel owners manage other memberships without changing their own permissions."""

import unittest
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask, g
from sqlalchemy import func, select
from sqlalchemy.dialects import postgresql

from pms_api import security
from pms_api.admin import routes
from pms_api.core_models import AuditLog, TenantUser, User
from pms_api.extensions import db
from pms_api.security import ApiError, set_context
from tests.domain_fixture import DomainTestCase


class TenantUserPermissionPolicyTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)

    @contextmanager
    def route(self, body, *, target="owner", role="HOTEL_OWNER", active=True, owners=2):
        user = SimpleNamespace(id=target, name="Original name", email=f"{target}@example.test")
        membership = SimpleNamespace(role=role, active=active)
        with (
            self.app.test_request_context(json=body),
            patch.object(routes, "db") as database,
            patch.object(routes, "audit") as audit,
            patch.object(routes, "ensure_quota") as quota,
            patch.object(routes, "tenant_users_json", return_value=[{"id": target}]),
        ):
            g.user = SimpleNamespace(id="owner", global_role="USER")
            g.role = "HOTEL_OWNER"
            database.session.scalar.side_effect = [membership, owners]
            database.session.get.return_value = user
            yield SimpleNamespace(
                user=user,
                membership=membership,
                database=database,
                audit=audit,
                quota=quota,
                dispatch=lambda: routes.UpdateTenantUserView.dispatch_request.__wrapped__(
                    "hotel", target
                ),
            )

    def test_self_role_or_access_changes_are_denied_before_any_mutation(self):
        for body in (
            {"role": "FRONT_DESK"},
            {"active": False},
            {"role": "ACCOUNTANT", "active": False, "name": "Must not be saved"},
        ):
            with self.subTest(body=body), self.route(body) as request:
                with self.assertRaises(ApiError) as caught:
                    request.dispatch()
                self.assertEqual(
                    (caught.exception.status, caught.exception.code),
                    (403, "self_permissions_locked"),
                )
                self.assertEqual(
                    (request.membership.role, request.membership.active, request.user.name),
                    ("HOTEL_OWNER", True, "Original name"),
                )
                # Do not inspect owner counts or fetch/write profiles after rejecting self access.
                self.assertEqual(request.database.session.scalar.call_count, 1)
                request.database.session.get.assert_not_called()
                request.database.session.flush.assert_not_called()
                request.audit.assert_not_called()
                request.quota.assert_not_called()

    def test_idempotent_self_permissions_and_personal_profile_remain_allowed(self):
        with self.route({"role": "HOTEL_OWNER", "active": True, "name": "Updated name"}) as request:
            self.assertEqual(request.dispatch().json, {"id": "owner"})
            self.assertEqual(request.user.name, "Updated name")
            self.assertEqual(
                (request.membership.role, request.membership.active), ("HOTEL_OWNER", True)
            )
            request.database.session.flush.assert_called_once()
            request.audit.assert_called_once()

    def test_owner_can_grant_another_account_owner_role_or_revoke_staff_access(self):
        for body in ({"role": "HOTEL_OWNER"}, {"active": False}):
            with (
                self.subTest(body=body),
                self.route(body, target="staff", role="FRONT_DESK") as request,
            ):
                self.assertEqual(request.dispatch().json, {"id": "staff"})
                self.assertEqual(request.membership.role, body.get("role", "FRONT_DESK"))
                self.assertEqual(request.membership.active, body.get("active", True))
                request.database.session.flush.assert_called_once()
                request.audit.assert_called_once()

    def test_another_accounts_last_active_owner_membership_stays_protected(self):
        for body in ({"role": "FRONT_DESK"}, {"active": False}):
            with self.subTest(body=body), self.route(body, target="other", owners=1) as request:
                with self.assertRaises(ApiError) as caught:
                    request.dispatch()
                self.assertEqual(
                    (caught.exception.status, caught.exception.code), (409, "last_owner")
                )
                self.assertEqual(
                    (request.membership.role, request.membership.active), ("HOTEL_OWNER", True)
                )
                request.database.session.get.assert_not_called()
                request.database.session.flush.assert_not_called()
                request.audit.assert_not_called()

    def test_target_lookup_is_tenant_scoped_and_missing_membership_does_not_write(self):
        with self.route({"role": "ACCOUNTANT"}, target="outside") as request:
            request.database.session.scalar.side_effect = [None]
            with self.assertRaises(ApiError) as caught:
                request.dispatch()
            self.assertEqual((caught.exception.status, caught.exception.code), (404, "not_found"))
            query = request.database.session.scalar.call_args.args[0]
            compiled = query.compile(dialect=postgresql.dialect())
            self.assertEqual(set(compiled.params.values()), {"hotel", "outside"})
            self.assertIn("tenant_users.tenant_id =", str(compiled))
            self.assertIn("tenant_users.user_id =", str(compiled))
            request.database.session.get.assert_not_called()
            request.database.session.flush.assert_not_called()
            request.audit.assert_not_called()

    def test_staff_and_internal_owners_cannot_delegate_permissions(self):
        for global_role, hotel_role in (
            ("USER", "FRONT_DESK"),
            ("USER", "HOUSEKEEPING"),
            ("USER", "ACCOUNTANT"),
            ("SUPER_ADMIN", "HOTEL_OWNER"),
            ("SYSTEM_MANAGER", "HOTEL_OWNER"),
        ):
            with (
                self.subTest(global_role=global_role, hotel_role=hotel_role),
                self.route({"role": "HOTEL_OWNER"}, target="staff") as request,
            ):
                g.user.global_role, g.role = global_role, hotel_role
                with self.assertRaises(ApiError) as caught:
                    request.dispatch()
                self.assertEqual(
                    (caught.exception.status, caught.exception.code), (403, "owner_grant_required")
                )
                request.database.session.execute.assert_not_called()
                request.database.session.scalar.assert_not_called()
                request.audit.assert_not_called()


class TenantUserPermissionHttpBoundaryTests(unittest.TestCase):
    @contextmanager
    def client(self, *, grantor_role="HOTEL_OWNER", locked_role="HOTEL_OWNER"):
        app = Flask(__name__)
        app.config["APP_ENV"] = "testing"
        security.register_security(app)
        app.add_url_rule(
            "/api/tenants/<tenant_id>/users/<user_id>",
            view_func=routes.UpdateTenantUserView.dispatch_request,
            methods=["PATCH"],
        )
        actor = SimpleNamespace(id="owner", global_role="USER")
        membership = SimpleNamespace(role="HOTEL_OWNER", active=True)
        tenant = SimpleNamespace(id="hotel", status="active")

        def authenticate():
            g.user = actor
            return actor

        with (
            patch.object(security, "db") as database,
            patch.object(routes, "db", database),
            patch.object(security, "authenticate", side_effect=authenticate),
            patch.object(security, "set_context"),
            patch("pms_api.subscriptions.lock_tenant", return_value=tenant),
            patch("pms_api.subscriptions.enforce_entitlements"),
            patch.object(routes, "audit") as audit,
            patch.object(routes, "ensure_quota") as quota,
            patch.object(app.logger, "warning"),
        ):
            database.session.execute.return_value.scalar_one_or_none.return_value = (
                SimpleNamespace(role=grantor_role) if grantor_role is not None else None
            )
            database.session.get.return_value = tenant
            database.session.scalar.side_effect = [locked_role, membership]
            yield SimpleNamespace(
                client=app.test_client(),
                database=database,
                membership=membership,
                audit=audit,
                quota=quota,
            )

    def test_decorated_http_endpoint_rejects_own_role_and_access_changes(self):
        for body in ({"role": "FRONT_DESK"}, {"active": False}):
            with self.subTest(body=body), self.client() as request:
                response = request.client.patch("/api/tenants/hotel/users/owner", json=body)
                self.assertEqual(response.status_code, 403, response.json)
                self.assertEqual(response.json["error"]["code"], "self_permissions_locked")
                self.assertEqual(
                    (request.membership.role, request.membership.active), ("HOTEL_OWNER", True)
                )
                request.database.session.commit.assert_not_called()
                request.database.session.rollback.assert_called_once()
                request.database.session.flush.assert_not_called()
                request.audit.assert_not_called()
                request.quota.assert_not_called()

    def test_decorated_endpoint_rechecks_membership_before_target_or_profile_writes(self):
        for grantor_role, locked_role, code in (
            (None, "HOTEL_OWNER", "tenant_denied"),
            ("FRONT_DESK", "FRONT_DESK", "forbidden"),
            ("HOTEL_OWNER", None, "tenant_denied"),
            ("HOTEL_OWNER", "ACCOUNTANT", "forbidden"),
        ):
            with (
                self.subTest(grantor_role=grantor_role, locked_role=locked_role),
                self.client(grantor_role=grantor_role, locked_role=locked_role) as request,
            ):
                response = request.client.patch(
                    "/api/tenants/hotel/users/staff", json={"role": "HOTEL_OWNER"}
                )
                self.assertEqual(response.status_code, 403, response.json)
                self.assertEqual(response.json["error"]["code"], code)
                # The only execute is the actor's tenant-scoped membership lookup.
                self.assertEqual(request.database.session.execute.call_count, 1)
                request.database.session.commit.assert_not_called()
                request.database.session.flush.assert_not_called()
                request.audit.assert_not_called()
                request.quota.assert_not_called()


class TenantUserPermissionHttpTests(DomainTestCase):
    def test_owner_cannot_change_own_role_or_access_with_another_owner_present(self):
        promoted = self.request("PATCH", "/users/frontdesk", {"role": "HOTEL_OWNER"})
        self.assertEqual(promoted.status_code, 200, promoted.json)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            audits_before = db.session.scalar(select(func.count()).select_from(AuditLog))
        for body in (
            {"role": "ACCOUNTANT", "name": "Must not be saved"},
            {"active": False},
            {"role": "FRONT_DESK", "active": False},
        ):
            with self.subTest(body=body):
                response = self.request("PATCH", f"/users/{self.owner_id}", body)
                self.assertEqual(response.status_code, 403, response.json)
                self.assertEqual(response.json["error"]["code"], "self_permissions_locked")
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            membership = db.session.scalar(
                select(TenantUser).where(
                    TenantUser.tenant_id == self.tenant_id, TenantUser.user_id == self.owner_id
                )
            )
            self.assertEqual((membership.role, membership.active), ("HOTEL_OWNER", True))
            self.assertEqual(db.session.get(User, self.owner_id).name, self.owner_id)
            self.assertEqual(
                db.session.scalar(select(func.count()).select_from(AuditLog)), audits_before
            )
        repeated = self.request(
            "PATCH", f"/users/{self.owner_id}", {"role": "HOTEL_OWNER", "active": True}
        )
        self.assertEqual(repeated.status_code, 200, repeated.json)

    def test_owner_can_manage_other_users_but_staff_and_other_hotel_owners_cannot(self):
        updated = self.request("PATCH", "/users/frontdesk", {"role": "ACCOUNTANT"})
        self.assertEqual(updated.status_code, 200, updated.json)
        self.assertEqual(updated.json["role"], "ACCOUNTANT")
        for actor in ("frontdesk", "hk", "accountant", "owner-b"):
            client, headers = self.login(actor + "@test.local")
            response = self.request(
                "PATCH",
                "/users/frontdesk",
                {"role": "HOTEL_OWNER"},
                client=client,
                headers=headers,
            )
            self.assertEqual(response.status_code, 403, (actor, response.json))
        outside = self.request("PATCH", "/users/owner-b", {"role": "FRONT_DESK"})
        self.assertEqual(outside.status_code, 404, outside.json)
        revoked = self.request("PATCH", "/users/frontdesk", {"active": False})
        self.assertEqual(revoked.status_code, 200, revoked.json)
