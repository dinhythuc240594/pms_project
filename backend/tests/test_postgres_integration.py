"""Real PostgreSQL checks, restricted to an explicitly selected disposable database."""

import os
import unittest

from sqlalchemy import Column, Integer, MetaData, Table, Text, create_engine, select, text
from sqlalchemy.exc import DBAPIError

from pms_api import create_app
from pms_api.config import postgres_url
from pms_api.extensions import db

RUNTIME_URL = os.environ.get("TEST_DATABASE_URL")
MIGRATION_URL = os.environ.get("TEST_DATABASE_MIGRATION_URL")


@unittest.skipUnless(RUNTIME_URL and MIGRATION_URL, "Set both dedicated PostgreSQL test URLs.")
class PostgreSQLIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        runtime = postgres_url(RUNTIME_URL, "TEST_DATABASE_URL")
        migration = postgres_url(MIGRATION_URL, "TEST_DATABASE_MIGRATION_URL")
        targets = [(url.host, url.port or 5432, url.database) for url in (runtime, migration)]
        overrides = {"host", "hostaddr", "port", "dbname", "database", "service", "servicefile"}
        if (
            targets[0] != targets[1]
            or not runtime.database.startswith("pms_test_")
            or any(overrides.intersection(url.query) for url in (runtime, migration))
        ):
            raise ValueError("Test URLs must target the same dedicated pms_test_ database.")
        cls.environ = {
            "APP_ENV": "testing",
            "DATABASE_URL": RUNTIME_URL,
            "DATABASE_MIGRATION_URL": MIGRATION_URL,
        }
        cls.app = create_app(cls.environ, env_file=None)
        with cls.app.app_context():
            cls.runtime = db.engine
        cls.addClassCleanup(cls.runtime.dispose)
        cls.migrator = create_engine(
            migration, hide_parameters=True, connect_args={"connect_timeout": 3}
        )
        cls.addClassCleanup(cls.migrator.dispose)

    def migrate(self, direction, target=None):
        args = ["db", direction] + ([target] if target else [])
        result = self.app.test_cli_runner().invoke(args=args)
        self.assertEqual(
            result.exit_code, 0, "Test database migration failed; check its configuration."
        )

    def setUp(self):
        self.migrate("upgrade")
        self.addCleanup(self.migrate, "upgrade")

    def test_ready_and_database_check_succeed_after_migration(self):
        response = self.app.test_client().get("/api/ready")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {"status": "ok", "database": "ok", "schema": "ok"})
        result = self.app.test_cli_runner().invoke(args=["db-check"])
        self.assertEqual(result.exit_code, 0, "Database check failed.")
        self.assertIn("PostgreSQL connection and migrations: OK", result.output)

    def test_missing_revision_is_pending_until_upgrade(self):
        # Priced history intentionally blocks rollback; this schema roundtrip needs
        # an empty disposable database, independent of earlier domain fixtures.
        tables = ",".join('"' + table.name + '"' for table in db.metadata.sorted_tables)
        with self.migrator.begin() as connection:
            connection.execute(text(f"TRUNCATE {tables} CASCADE"))
        self.migrate("downgrade", "base")
        response = self.app.test_client().get("/api/ready")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json, {"status": "error", "database": "ok", "schema": "pending"})
        self.migrate("upgrade")
        self.assertEqual(self.app.test_client().get("/api/ready").status_code, 200)

    def test_repeated_upgrade_preserves_the_recorded_revision(self):
        with self.runtime.connect() as connection:
            before = (
                connection.execute(text("SELECT version_num FROM alembic_version")).scalars().all()
            )
        self.migrate("upgrade")
        with self.runtime.connect() as connection:
            after = (
                connection.execute(text("SELECT version_num FROM alembic_version")).scalars().all()
            )
        self.assertEqual(set(before), self.app.extensions["migration_heads"])
        self.assertEqual(after, before)

    def test_runtime_can_commit_and_rollback_data_in_migrator_table(self):
        probe = Table(
            "pms_test_connection_probe",
            MetaData(),
            Column("id", Integer, primary_key=True),
            Column("value", Text),
        )
        probe.create(self.migrator)
        try:
            with self.runtime.begin() as connection:
                connection.execute(probe.insert().values(id=1, value="committed"))
            with self.runtime.connect() as connection:
                connection.execute(probe.insert().values(id=2, value="rolled back"))
                self.assertEqual(
                    connection.execute(select(probe.c.id).order_by(probe.c.id)).scalars().all(),
                    [1, 2],
                )
                connection.rollback()
                self.assertEqual(
                    connection.execute(select(probe.c.value)).scalars().all(), ["committed"]
                )
        finally:
            probe.drop(self.migrator)

    def test_runtime_cannot_create_tables(self):
        with self.runtime.connect() as connection:
            try:
                with self.assertRaises(DBAPIError) as caught:
                    connection.execute(
                        text("CREATE TABLE pms_test_runtime_ddl_denied (id integer)")
                    )
                self.assertEqual(caught.exception.orig.sqlstate, "42501")
            finally:
                connection.rollback()

    def test_production_accepts_the_unprivileged_runtime_role(self):
        production = create_app({**self.environ, "APP_ENV": "production"}, env_file=None)
        try:
            self.assertEqual(production.test_client().get("/api/ready").status_code, 200)
        finally:
            with production.app_context():
                db.engine.dispose()
