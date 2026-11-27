import unittest

from pms_api import create_app


class HealthTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(
            {
                "APP_ENV": "testing",
                "DATABASE_URL": "postgres://pms_app:hidden-password@127.0.0.1:1/pms",
            },
            env_file=None,
        )
        self.client = self.app.test_client()

    def tearDown(self):
        with self.app.app_context():
            self.app.extensions["sqlalchemy"].engine.dispose()

    def test_liveness_does_not_require_a_database_connection(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["status"], "ok")

    def test_readiness_fails_without_exposing_database_credentials(self):
        response = self.client.get("/api/ready")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json, {"status": "error", "database": "unavailable"})
        self.assertNotIn("hidden-password", response.get_data(as_text=True))
        self.assertNotIn("127.0.0.1", response.get_data(as_text=True))

    def test_database_check_command_fails_when_database_is_unavailable(self):
        result = self.app.test_cli_runner().invoke(args=["db-check"])
        self.assertNotEqual(result.exit_code, 0)
        self.assertNotIn("hidden-password", result.output)

    def test_cors_allows_only_configured_origin(self):
        allowed = self.client.get("/api/health", headers={"Origin": "http://localhost:5173"})
        rejected = self.client.get("/api/health", headers={"Origin": "https://unknown.example"})
        self.assertEqual(
            allowed.headers.get("Access-Control-Allow-Origin"), "http://localhost:5173"
        )
        self.assertIsNone(rejected.headers.get("Access-Control-Allow-Origin"))


if __name__ == "__main__":
    unittest.main()
