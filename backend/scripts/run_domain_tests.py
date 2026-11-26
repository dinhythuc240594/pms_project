"""Run integration tests in a disposable database on the managed local cluster."""

import os
import subprocess
import sys
import uuid
from pathlib import Path

from local_postgres import SetupError, connect, credentials
from psycopg import sql
from sqlalchemy import URL


def main():
    stored = credentials(create=False)
    database = "pms_test_" + uuid.uuid4().hex
    created = False
    try:
        with connect(stored) as connection:
            connection.execute(
                sql.SQL("CREATE DATABASE {} OWNER pms_migrator").format(sql.Identifier(database))
            )
            created = True
        with connect(stored, database) as connection:
            connection.execute(
                sql.SQL("REVOKE ALL ON DATABASE {} FROM PUBLIC").format(sql.Identifier(database))
            )
            connection.execute(
                sql.SQL("GRANT CONNECT ON DATABASE {} TO pms_app").format(sql.Identifier(database))
            )
            connection.execute("REVOKE CREATE ON SCHEMA public FROM PUBLIC")
            connection.execute("GRANT USAGE ON SCHEMA public TO pms_app")
            connection.execute(
                "ALTER DEFAULT PRIVILEGES FOR ROLE pms_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pms_app"
            )
            connection.execute(
                "ALTER DEFAULT PRIVILEGES FOR ROLE pms_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO pms_app"
            )
        environment = dict(os.environ)
        for variable, role in (
            ("TEST_DATABASE_URL", "pms_app"),
            ("TEST_DATABASE_MIGRATION_URL", "pms_migrator"),
        ):
            environment[variable] = URL.create(
                "postgresql+psycopg",
                username=role,
                password=stored[role],
                host="127.0.0.1",
                port=stored["port"],
                database=database,
            ).render_as_string(hide_password=False)
        result = subprocess.run(
            [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"],
            cwd=Path(__file__).resolve().parents[1],
            env=environment,
        )
        return result.returncode
    finally:
        # Only the unique database created by this invocation is disposable.
        if created:
            with connect(stored) as connection:
                connection.execute(
                    sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(database))
                )


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SetupError:
        raise SystemExit(
            "Managed local PostgreSQL is unavailable; no existing database was changed."
        ) from None
