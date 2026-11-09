"""Safety checks for the isolated PostgreSQL setup, without starting a server."""

import contextlib
import importlib.util
import io
import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import psycopg

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "local_postgres.py"
spec = importlib.util.spec_from_file_location("local_postgres", SCRIPT)
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class LocalPostgresSafetyTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(
            prefix=".local-pg-test-", dir=Path(__file__).parent
        )
        self.addCleanup(self.directory.cleanup)
        self.backend = Path(self.directory.name).resolve()
        self.cluster = self.backend / ".local-postgres"
        for name, value in (
            ("BACKEND", self.backend),
            ("CLUSTER", self.cluster),
            ("DATA", self.cluster / "data"),
        ):
            patcher = patch.object(setup, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_restart_keeps_original_credentials_and_port(self):
        original = setup.credentials(15432, create=True)
        raw = (self.cluster / "credentials.json").read_bytes()
        self.assertEqual(setup.credentials(), original)
        with self.assertRaises(setup.SetupError):
            setup.credentials(15433, create=True)
        self.assertEqual((self.cluster / "credentials.json").read_bytes(), raw)

    def test_existing_env_is_never_overwritten(self):
        stored = setup.credentials(create=True)
        env = self.backend / ".env"
        env.write_text("DATABASE_URL=already-configured\n", encoding="utf-8")
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            setup.write_env(stored)
        self.assertEqual(env.read_text(encoding="utf-8"), "DATABASE_URL=already-configured\n")
        self.assertNotIn(stored["pms_app"], output.getvalue())

    def test_generated_urls_use_separate_roles_and_escape_password(self):
        stored = setup.credentials(create=True)
        stored["pms_app"] = "a:b@c/d?e#f"
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            setup.write_env(stored)
        env = (self.backend / ".env").read_text(encoding="utf-8")
        self.assertIn(
            "DATABASE_URL=postgresql+psycopg://pms_app:a%3Ab%40c%2Fd%3Fe%23f@127.0.0.1:15432/pms_local",
            env,
        )
        self.assertIn("DATABASE_MIGRATION_URL=postgresql+psycopg://pms_migrator:", env)
        self.assertNotIn(stored["pms_app"], output.getvalue())
        self.assertNotIn(stored["pms_migrator"], output.getvalue())

    def test_unidentified_existing_data_is_not_initialized(self):
        setup.DATA.mkdir(parents=True)
        existing = setup.DATA / "PG_VERSION"
        existing.write_text("18", encoding="utf-8")
        with self.assertRaises(setup.SetupError):
            setup.credentials(create=True)
        self.assertEqual(existing.read_text(encoding="utf-8"), "18")
        self.assertFalse((self.cluster / "credentials.json").exists())

    def test_port_collision_does_not_create_credentials_or_launch_process(self):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            port = listener.getsockname()[1]
            with (
                patch.object(setup, "find_bin", return_value=Path("unused")),
                patch.object(setup, "run") as run,
            ):
                with contextlib.redirect_stderr(io.StringIO()):
                    result = setup.main(["start", "--port", str(port)])
            self.assertEqual(result, 1)
            run.assert_not_called()
            self.assertFalse((self.cluster / "credentials.json").exists())

    def test_stop_refuses_a_server_with_unverified_identity(self):
        setup.DATA.mkdir(parents=True)
        (setup.DATA / "PG_VERSION").write_text("18", encoding="utf-8")
        with (
            patch.object(setup, "find_bin", return_value=Path("unused")),
            patch.object(setup, "credentials", return_value={"port": 15432}),
        ):
            with (
                patch.object(setup, "run", return_value=0) as run,
                patch.object(setup, "connect", side_effect=setup.SetupError("Unverified server")),
            ):
                with contextlib.redirect_stderr(io.StringIO()):
                    result = setup.main(["stop"])
        self.assertEqual(result, 1)
        run.assert_not_called()

    def test_status_uses_authenticated_connection_when_process_inspection_is_restricted(self):
        setup.DATA.mkdir(parents=True)
        (setup.DATA / "PG_VERSION").write_text("18", encoding="utf-8")
        output = io.StringIO()
        with (
            patch.object(setup, "find_bin", return_value=Path("unused")),
            patch.object(setup, "credentials", return_value={"port": 15432}),
            patch.object(setup, "connect", return_value=MagicMock()),
            patch.object(setup, "run", return_value=3) as run,
        ):
            with contextlib.redirect_stdout(output):
                result = setup.main(["status"])
        self.assertEqual(result, 0)
        self.assertIn("is running", output.getvalue())
        run.assert_not_called()

    def test_connection_failure_with_occupied_port_is_not_reported_stopped(self):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            port = listener.getsockname()[1]
            with patch.object(
                setup, "connect", side_effect=psycopg.OperationalError("connection failed")
            ):
                with self.assertRaises(setup.SetupError):
                    setup.is_running({"port": port})

    def test_connection_refused_is_stopped_only_when_port_is_free(self):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        with patch.object(
            setup, "connect", side_effect=psycopg.OperationalError("connection refused")
        ):
            self.assertFalse(setup.is_running({"port": port}))


if __name__ == "__main__":
    unittest.main()
