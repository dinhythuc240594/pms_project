import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from pms_api.config import ConfigurationError, load_config


class ConfigurationTests(unittest.TestCase):
    def test_manager_channex_keys_are_optional_and_runtime_only_in_production(self):
        base = {"DATABASE_URL": "postgresql://app:secret@db/pms"}
        config = load_config(base, env_file=None)
        self.assertIsNone(config["CHANNEX_MANAGER_API_KEY_STAGING"])
        self.assertIsNone(config["CHANNEX_MANAGER_API_KEY_PRODUCTION"])
        config = load_config(
            {**base, "CHANNEX_MANAGER_API_KEY_STAGING": "fixture-manager-key"}, env_file=None
        )
        self.assertEqual(config["CHANNEX_MANAGER_API_KEY_STAGING"], "fixture-manager-key")
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env"
            env_file.write_text("CHANNEX_MANAGER_API_KEY_STAGING=private-local-key\n")
            config = load_config({**base, "APP_ENV": "production"}, env_file=env_file)
            self.assertIsNone(config["CHANNEX_MANAGER_API_KEY_STAGING"])

    def test_database_url_is_required_without_local_fallback(self):
        for environment in ("development", "production"):
            with self.subTest(environment=environment):
                with self.assertRaisesRegex(ConfigurationError, "DATABASE_URL"):
                    load_config({"APP_ENV": environment}, env_file=None)

    def test_runtime_environment_wins_over_local_file(self):
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env"
            env_file.write_text(
                "DATABASE_URL=postgresql://local:local@localhost/local_db\n",
                encoding="utf-8",
            )
            config = load_config(
                {"DATABASE_URL": "postgres://runtime:secret@database-host/pms"},
                env_file=env_file,
            )
            url = config["SQLALCHEMY_DATABASE_URI"]
            self.assertEqual((url.host, url.database), ("database-host", "pms"))

    def test_production_does_not_load_local_file(self):
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env"
            env_file.write_text(
                "DATABASE_URL=postgresql://local:secret@localhost/local_db\n",
                encoding="utf-8",
            )
            with self.assertRaises(ConfigurationError):
                load_config({"APP_ENV": "production"}, env_file=env_file)

    def test_coolify_url_preserves_encoded_password_and_query(self):
        config = load_config(
            {"DATABASE_URL": "postgres://app:p%40ss%2Fword%25@db:5432/pms?sslmode=require"},
            env_file=None,
        )
        url = config["SQLALCHEMY_DATABASE_URI"]
        self.assertEqual(url.drivername, "postgresql+psycopg")
        self.assertEqual(url.password, "p@ss/word%")
        self.assertEqual(url.query["sslmode"], "require")

    def test_migration_url_is_separate_from_runtime_url(self):
        config = load_config(
            {
                "DATABASE_URL": "postgresql://app:secret@db/pms",
                "DATABASE_MIGRATION_URL": "postgresql://migrator:secret@db/pms",
            },
            env_file=None,
        )
        self.assertEqual(config["SQLALCHEMY_DATABASE_URI"].username, "app")
        self.assertEqual(config["DATABASE_MIGRATION_URL"].username, "migrator")

    def test_invalid_url_errors_do_not_echo_credentials(self):
        for value in (
            "not-a-url-private-secret",
            "sqlite:///pms.db",
            "postgres://app:private-secret@db:wrong/pms",
            "postgresql://app:private-secret@db",
            "postgresql+psycopg2://app:private-secret@db/pms",
        ):
            with self.subTest(value=value):
                with self.assertRaises(ConfigurationError) as caught:
                    load_config({"DATABASE_URL": value}, env_file=None)
                self.assertNotIn("private-secret", str(caught.exception))
                self.assertNotIn(value, str(caught.exception))

    def test_production_has_no_implicit_cors_and_debug_is_disabled(self):
        config = load_config(
            {"APP_ENV": "production", "DATABASE_URL": "postgresql://app:secret@db/pms"},
            env_file=None,
        )
        self.assertEqual(config["CORS_ORIGINS"], [])
        self.assertFalse(config["DEBUG"])

    def test_cors_requires_exact_origins(self):
        for origin in (None, "*", "https://app.example.com/path", "https://*.example.com"):
            with self.subTest(origin=origin):
                with self.assertRaises(ConfigurationError):
                    load_config(
                        {"DATABASE_URL": "postgresql://app:secret@db/pms", "CORS_ORIGINS": origin},
                        env_file=None,
                    )

    def test_channex_callback_requires_trusted_https_origin_and_redacts_errors(self):
        base = {"DATABASE_URL": "postgresql://app:secret@db/pms"}
        for value in (None, ""):
            config = load_config({**base, "CHANNEX_WEBHOOK_BASE_URL": value}, env_file=None)
            self.assertIsNone(config["CHANNEX_WEBHOOK_BASE_URL"])
        config = load_config(
            {**base, "CHANNEX_WEBHOOK_BASE_URL": "https://api.example.com/"}, env_file=None
        )
        self.assertEqual(config["CHANNEX_WEBHOOK_BASE_URL"], "https://api.example.com")
        for value in (
            "http://api.example.com",
            "https://api.example.com/path",
            "https://user:private-secret@api.example.com",
            "https://api.example.com?",
            "https://api.example.com#",
            "https://api.example.com:bad",
            "https://api.example.com\n",
        ):
            with self.subTest(value=value), self.assertRaises(ConfigurationError) as caught:
                load_config({**base, "CHANNEX_WEBHOOK_BASE_URL": value}, env_file=None)
            self.assertNotIn("private-secret", str(caught.exception))

    def test_project_cli_does_not_autoload_local_urls_in_production(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, ".env").write_text(
                "DATABASE_URL=postgresql://app:private-secret@localhost/local_db\n",
                encoding="utf-8",
            )
            environment = dict(os.environ)
            for name in ("DATABASE_URL", "DATABASE_MIGRATION_URL", "FLASK_SKIP_DOTENV"):
                environment.pop(name, None)
            environment["APP_ENV"] = "production"
            result = subprocess.run(
                [
                    sys.executable,
                    str(Path(__file__).resolve().parents[1] / "manage.py"),
                    "db-check",
                ],
                cwd=directory,
                env=environment,
                capture_output=True,
                text=True,
                timeout=15,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("DATABASE_URL is required", result.stderr)
            self.assertNotIn("private-secret", result.stderr)


if __name__ == "__main__":
    unittest.main()
