"""Required integration gates must not turn green because a fixture skipped."""

import importlib.util
import io
import unittest
from pathlib import Path


def runner_module():
    path = Path(__file__).resolve().parents[1] / "scripts" / "run_ci_tests.py"
    spec = importlib.util.spec_from_file_location("ci_runner", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CIRunnerTests(unittest.TestCase):
    def test_a_skipped_required_test_is_a_failed_gate(self):
        class Skipped(unittest.TestCase):
            @unittest.skip("fixture unavailable")
            def test_required(self):
                pass

        runner = runner_module()
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(Skipped)
        result = runner.RequiredTestRunner(stream=io.StringIO()).run(suite)
        self.assertFalse(result.wasSuccessful())

    def test_missing_test_urls_fail_before_discovery(self):
        with self.assertRaisesRegex(ValueError, "both"):
            runner_module().require_database_urls({})

    def test_database_bootstrap_rejects_remote_targets_and_libpq_overrides(self):
        from scripts.ci_database import admin_config

        for value in (
            "invalid-secret-bearing-input",
            "postgresql://admin:secret@db.example.com/postgres",
            "postgresql://admin:secret@localhost/pms_local",
            "postgresql://admin:secret@localhost/postgres?host=db.example.com",
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                admin_config(value)
        self.assertEqual(
            admin_config("postgresql://admin:secret@127.0.0.1:25432/postgres")["port"], 25432
        )
