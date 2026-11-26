"""Fail a required DB test gate on missing PostgreSQL configuration or any skip."""

import os
import sys
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


def require_database_urls(environment):
    if not all(
        environment.get(key) for key in ("TEST_DATABASE_URL", "TEST_DATABASE_MIGRATION_URL")
    ):
        raise ValueError(
            "CI requires both dedicated PostgreSQL test URLs; refusing to skip domain tests."
        )


class RequiredTestResult(unittest.TextTestResult):
    def wasSuccessful(self):
        return super().wasSuccessful() and not self.skipped


class RequiredTestRunner(unittest.TextTestRunner):
    resultclass = RequiredTestResult


def main():
    require_database_urls(os.environ)
    suite = unittest.defaultTestLoader.discover(str(BACKEND / "tests"), top_level_dir=str(BACKEND))
    result = RequiredTestRunner(verbosity=2).run(suite)
    if result.skipped:
        print("Required CI suite skipped tests; gate failed.", file=sys.stderr)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValueError as error:
        raise SystemExit(str(error)) from None
