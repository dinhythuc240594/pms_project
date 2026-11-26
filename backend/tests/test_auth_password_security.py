"""Password-change abuse limits without a database or an external service."""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask, g

from pms_api.admin.routes import CreateTenantUserView, UpdateTenantUserView
from pms_api.auth.routes import ChangePasswordView
from pms_api.security import register_security


class PasswordChangeSecurityTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(APP_ENV="testing")
        register_security(self.app)
        self.app.add_url_rule(
            "/api/auth/change-password",
            view_func=ChangePasswordView.dispatch_request,
            methods=["POST"],
        )
        self.user = SimpleNamespace(id="password-fixture-user", password_hash="stored-hash")

        def authenticated_user():
            g.user = self.user
            g.auth_session = SimpleNamespace(token_hash="current-session-hash")
            return self.user

        self.enterContext(patch("pms_api.security.set_context"))
        self.transaction = self.enterContext(patch("pms_api.security.db"))
        self.database = self.enterContext(patch("pms_api.auth.routes.db"))
        self.enterContext(patch("pms_api.auth.routes.lock_current_user", authenticated_user))
        self.attempt = self.enterContext(patch("pms_api.auth.routes.count_attempt", return_value=1))
        self.verify = self.enterContext(
            patch("pms_api.auth.routes.check_password_hash", return_value=False)
        )
        self.hash_password = self.enterContext(
            patch("pms_api.auth.routes.generate_password_hash", return_value="new-hash")
        )
        self.client = self.app.test_client()

    def change(self, current="incorrect-password", new="New-fixture-password-2026!"):
        return self.client.post(
            "/api/auth/change-password",
            json={"currentPassword": current, "newPassword": new},
        )

    def test_wrong_password_attempt_is_counted_per_user_and_committed(self):
        response = self.change()
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json["error"]["code"], "invalid_password")
        self.attempt.assert_called_once_with("password-change:user:password-fixture-user")
        self.transaction.session.commit.assert_called_once_with()
        self.transaction.session.rollback.assert_not_called()
        self.assertEqual(self.user.password_hash, "stored-hash")
        self.database.session.query.assert_not_called()

    def test_limit_rejects_before_password_verification_or_session_mutation(self):
        self.attempt.return_value = 11
        response = self.change()
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json["error"]["code"], "rate_limited")
        self.verify.assert_not_called()
        self.hash_password.assert_not_called()
        self.database.session.query.assert_not_called()
        self.transaction.session.commit.assert_called_once_with()

    def test_success_at_limit_changes_hash_and_revokes_other_sessions(self):
        self.attempt.return_value = 10
        self.verify.return_value = True
        response = self.change(current="Correct-fixture-password!")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {"ok": True})
        self.assertEqual(self.user.password_hash, "new-hash")
        self.database.session.query.return_value.filter.return_value.delete.assert_called_once_with(
            synchronize_session=False
        )
        self.transaction.session.commit.assert_called_once_with()

    def test_invalid_current_password_is_bounded_before_expensive_hashing(self):
        for previous in (None, [], {}, 123, "", "x" * 129):
            with self.subTest(current=type(previous).__name__):
                response = self.change(current=previous)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.json["error"]["code"], "invalid_password")
        self.verify.assert_not_called()
        self.hash_password.assert_not_called()

    def test_invalid_replacement_rolls_back_without_changing_password_or_sessions(self):
        self.verify.return_value = True
        response = self.change(new="short")
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.user.password_hash, "stored-hash")
        self.hash_password.assert_not_called()
        self.database.session.query.assert_not_called()
        self.transaction.session.commit.assert_not_called()
        self.transaction.session.rollback.assert_called_once_with()


class MembershipRoleValidationTests(unittest.TestCase):
    def test_nonstring_roles_return_validation_errors_without_mutating_membership(self):
        app = Flask(__name__)
        app.config.update(APP_ENV="testing")
        register_security(app)
        app.add_url_rule(
            "/api/tenants/<tenant_id>/users",
            view_func=CreateTenantUserView.dispatch_request.__wrapped__,
            methods=["POST"],
        )
        app.add_url_rule(
            "/api/tenants/<tenant_id>/users/<user_id>",
            endpoint="update_user",
            view_func=UpdateTenantUserView.dispatch_request.__wrapped__,
            methods=["PATCH"],
        )

        @app.before_request
        def owner_context():
            g.role = "HOTEL_OWNER"
            g.user = SimpleNamespace(id="owner-fixture", global_role="USER")

        membership = SimpleNamespace(role="FRONT_DESK", active=True)
        with (
            patch("pms_api.security.set_context"),
            patch("pms_api.security.db"),
            patch("pms_api.admin.routes.db") as database,
        ):
            database.session.scalar.return_value = membership
            for role in ([], {}, None, True, 123, 1.5):
                for method, path, code in (
                    ("POST", "/api/tenants/hotel-fixture/users", "invalid_role"),
                    ("PATCH", "/api/tenants/hotel-fixture/users/staff", "invalid_membership"),
                ):
                    with self.subTest(role=role, method=method):
                        response = app.test_client().open(path, method=method, json={"role": role})
                        self.assertEqual(response.status_code, 422)
                        self.assertEqual(response.json["error"]["code"], code)
            self.assertEqual(membership.role, "FRONT_DESK")
            self.assertTrue(membership.active)
            database.session.add.assert_not_called()
            database.session.flush.assert_not_called()
