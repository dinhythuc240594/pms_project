import json
import re
import unittest
from pathlib import Path

from alembic.script import ScriptDirectory

from pms_api import create_app


class MigrationGraphTests(unittest.TestCase):
    def setUp(self):
        self.scripts = ScriptDirectory(str(Path(__file__).resolve().parents[1] / "migrations"))

    def test_upgrade_head_is_unambiguous(self):
        head = self.scripts.get_current_head()
        self.assertIsNotNone(head)
        self.assertEqual(self.scripts.get_heads(), [head])

    def test_revision_ids_fit_the_alembic_version_column(self):
        for revision in self.scripts.walk_revisions():
            with self.subTest(revision=revision.revision):
                self.assertLessEqual(len(revision.revision), 32)

    def test_both_branch_histories_upgrade_without_replaying_applied_revisions(self):
        merge = "0033_merge_room_history"
        history = "0032_channel_job_history"
        locations = "0032_room_locations"
        all_revisions = {
            revision.revision for revision in self.scripts.iterate_revisions(merge, "base")
        }
        cases = (
            ("base", all_revisions),
            ("0031_channel_onboarding", {history, locations, merge}),
            (history, {locations, merge}),
            (locations, {history, merge}),
            ((history, locations), {merge}),
            (merge, set()),
        )
        for current, expected in cases:
            with self.subTest(current=current):
                planned = list(self.scripts.iterate_revisions(merge, current, implicit_base=True))
                self.assertEqual({revision.revision for revision in planned}, expected)
                self.assertEqual(len(planned), len(expected))


class OfflineMigrationTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(
            {
                "APP_ENV": "testing",
                "DATABASE_URL": "postgresql://migration_test:unused@127.0.0.1:1/pms_test_offline",
            },
            env_file=None,
        )
        self.runner = self.app.test_cli_runner()

    def tearDown(self):
        with self.app.app_context():
            self.app.extensions["sqlalchemy"].engine.dispose()

    def test_room_type_details_upgrade_is_nullable_and_does_not_relocate_existing_rooms(self):
        result = self.runner.invoke(args=["db", "upgrade", "--sql", "0044_audit_ip:head"])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("ALTER TABLE room_types ADD COLUMN floor VARCHAR(120)", result.output)
        self.assertIn("ALTER TABLE room_types ADD COLUMN bed_type_id VARCHAR(40)", result.output)
        self.assertIn(
            "FOREIGN KEY(tenant_id, bed_type_id) REFERENCES masters (tenant_id, id)", result.output
        )
        self.assertNotIn("NOT NULL", result.output)
        self.assertNotIn("UPDATE physical_rooms", result.output)

    def test_upgrade_head_renders_only_pending_branch_ddl(self):
        cases = (
            ("0031_channel_onboarding", True, True),
            ("0032_channel_job_history", True, False),
            ("0032_room_locations", False, True),
        )
        for current, adds_locations, adds_indexes in cases:
            with self.subTest(current=current):
                result = self.runner.invoke(args=["db", "upgrade", "--sql", f"{current}:head"])
                self.assertEqual(result.exit_code, 0, result.output)
                self.assertEqual(
                    "ALTER TABLE physical_rooms ADD COLUMN floor" in result.output,
                    adds_locations,
                )
                self.assertEqual(
                    "CREATE INDEX ix_channel_jobs_history" in result.output,
                    adds_indexes,
                )
                self.assertIn("0033_merge_room_history", result.output)

    def test_room_pricing_upgrade_preserves_json_default_without_sql_parameters(self):
        result = self.runner.invoke(args=["db", "upgrade", "--sql", "0042_hotel_currencies:head"])
        self.assertEqual(result.exit_code, 0, result.output)
        statement = next(
            line
            for line in result.output.splitlines()
            if line.startswith("ALTER TABLE plans ADD COLUMN pricing_rules ")
        )
        literal = re.search(r"'((?:[^']|'')*)'", statement)
        self.assertIsNotNone(literal, statement)
        self.assertEqual(
            json.loads(literal.group(1).replace("''", "'")),
            {
                "baseRooms": 15,
                "extraRoomPrice": "0",
                "extraRoomPriceYear": "0",
                "adjustments": [
                    {"aboveRooms": 30, "percent": "0"},
                    {"aboveRooms": 50, "percent": "0"},
                    {"aboveRooms": 100, "percent": "0"},
                ],
            },
        )
        self.assertIn("NOT NULL", statement)
        self.assertNotIn("DROP TABLE", result.output)
        self.assertNotIn("UPDATE plans", result.output)


if __name__ == "__main__":
    unittest.main()
