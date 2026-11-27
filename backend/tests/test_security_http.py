"""Security failures must be observable without recording submitted secrets."""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

import psycopg
from flask import Flask, g
from sqlalchemy.exc import OperationalError, ProgrammingError

from common import ApiError
from pms_api.security import register_security


class SecurityHTTPTests(unittest.TestCase):
    def test_denials_are_logged_without_body_headers_or_query_secrets(self):
        app = Flask(__name__)
        app.config["APP_ENV"] = "testing"
        register_security(app)
        failure = {}

        @app.post("/api/security-probe")
        def security_probe():
            g.user = SimpleNamespace(id="actor-fixture")
            raise ApiError(failure["status"], failure["code"], "Request denied")

        with patch("pms_api.security.set_context"), patch("pms_api.security.db") as database:
            for status, code in (
                (401, "invalid_credentials"),
                (403, "csrf_failed"),
                (429, "rate_limited"),
            ):
                failure.update(status=status, code=code)
                with self.subTest(code=code), self.assertLogs(app.logger, level="WARNING") as logs:
                    response = app.test_client().post(
                        "/api/security-probe?api_key=query-secret",
                        json={"email": "private@example.com", "password": "password-secret"},
                        headers={
                            "X-CSRF-Token": "csrf-secret",
                            "Authorization": "Bearer token-secret",
                        },
                    )
                self.assertEqual(response.status_code, status)
                message = "\n".join(logs.output)
                for expected in (code, "security_probe", "POST", "actor-fixture"):
                    self.assertIn(expected, message)
                for secret in (
                    "query-secret",
                    "private@example.com",
                    "password-secret",
                    "csrf-secret",
                    "token-secret",
                ):
                    self.assertNotIn(secret, message)
            database.session.commit.assert_not_called()
            self.assertEqual(database.session.rollback.call_count, 3)


class DatabaseFailureHTTPTests(unittest.TestCase):
    def app_with_failure(self, path, endpoint, failure, *, method="GET"):
        app = Flask(__name__)
        app.config["APP_ENV"] = "testing"
        register_security(app)

        def fail():
            raise failure

        app.add_url_rule(path, endpoint, fail, methods=[method])
        return app

    def assert_private_diagnostics(self, logs, endpoint, method, phase, state, driver):
        self.assertEqual(len(logs.records), 1)
        record = logs.records[0]
        self.assertEqual(
            record.getMessage(),
            f"database_failure endpoint={endpoint} method={method} "
            f"phase={phase} sqlstate={state} driver_error={driver}",
        )
        self.assertIsNone(record.exc_info)
        self.assertIsNone(record.stack_info)

    def test_missing_schema_is_observable_at_both_plan_read_endpoints(self):
        for path, endpoint in (
            ("/api/plans", "admin.list_plans"),
            ("/api/manager/overview", "saas_billing.overview"),
        ):
            failure = ProgrammingError(
                "SELECT sql-secret FROM plans",
                {"password": "parameter-secret"},
                psycopg.errors.UndefinedColumn(
                    "column plans.pricing_rules does not exist; postgres://user:database-secret@host/db"
                ),
            )
            app = self.app_with_failure(path, endpoint, failure)
            with (
                self.subTest(endpoint=endpoint),
                patch("pms_api.security.set_context"),
                patch("pms_api.security.db") as database,
                self.assertLogs(app.logger, level="WARNING") as logs,
            ):
                response = app.test_client().get(
                    path + "?api_key=query-secret",
                    json={"password": "body-secret"},
                    headers={
                        "Authorization": "Bearer header-secret",
                        "X-CSRF-Token": "csrf-secret",
                    },
                )
            self.assertEqual(response.status_code, 503)
            self.assertEqual(
                response.json,
                {
                    "error": {
                        "code": "database_unavailable",
                        "message": "Không thể xử lý dữ liệu. Vui lòng thử lại.",
                    }
                },
            )
            self.assert_private_diagnostics(
                logs, endpoint, "GET", "query", "42703", "UndefinedColumn"
            )
            database.session.commit.assert_not_called()
            database.session.rollback.assert_called_once_with()

    def test_connection_errors_log_only_a_valid_sqlstate_or_unknown(self):
        for state in (
            "08006",
            None,
            42703,
            "4270",
            "427030",
            "42a03",
            "４２７０３",
            "42703\nsecret",
        ):
            driver = psycopg.OperationalError("postgres://user:password-secret@private-host/db")
            driver.sqlstate = state
            failure = OperationalError("SELECT sql-secret", {"token": "parameter-secret"}, driver)
            app = self.app_with_failure("/api/plans", "admin.list_plans", failure)
            with (
                self.subTest(sqlstate=state),
                patch("pms_api.security.set_context"),
                patch("pms_api.security.db") as database,
                self.assertLogs(app.logger, level="WARNING") as logs,
            ):
                response = app.test_client().get("/api/plans?token=query-secret")
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json["error"]["code"], "database_unavailable")
            self.assert_private_diagnostics(
                logs,
                "admin.list_plans",
                "GET",
                "query",
                "08006" if state == "08006" else "unknown",
                "OperationalError",
            )
            database.session.rollback.assert_called_once_with()

    def test_commit_failure_is_logged_and_rolled_back_without_exposing_secrets(self):
        app = Flask(__name__)
        app.config["APP_ENV"] = "testing"
        register_security(app)

        @app.post("/api/transaction-probe")
        def transaction_probe():
            return {"saved": True}, 201

        failure = OperationalError(
            "INSERT sql-secret",
            {"password": "parameter-secret"},
            psycopg.errors.ConnectionFailure("postgres://user:database-secret@private-host/db"),
        )
        with (
            patch("pms_api.security.set_context"),
            patch("pms_api.security.db") as database,
            self.assertLogs(app.logger, level="WARNING") as logs,
        ):
            database.session.commit.side_effect = failure
            response = app.test_client().post(
                "/api/transaction-probe?token=query-secret",
                json={"password": "body-secret"},
                headers={"Authorization": "Bearer header-secret"},
            )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.json,
            {
                "error": {
                    "code": "database_unavailable",
                    "message": "Chưa thể lưu dữ liệu. Vui lòng thử lại.",
                }
            },
        )
        self.assert_private_diagnostics(
            logs, "transaction_probe", "POST", "transaction", "08006", "ConnectionFailure"
        )
        database.session.commit.assert_called_once_with()
        database.session.rollback.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
