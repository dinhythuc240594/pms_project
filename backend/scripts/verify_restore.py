"""Restore a supplied custom-format dump into a new local test DB and check invariants."""

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import psycopg
from ci_database import admin_config, disposable_database
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


def verify(environment, expected=None):
    from pms_api import create_app
    from pms_api.extensions import db
    from pms_api.health import database_status
    from pms_api.security import set_context

    app = create_app(
        {"APP_ENV": "production", "DATABASE_URL": environment["TEST_DATABASE_URL"]}, env_file=None
    )
    try:
        with app.app_context():
            if database_status()["status"] != "ok":
                raise ValueError("Restored migration/role readiness does not match this code")
            unsafe = db.session.execute(
                text("""SELECT count(*) FROM pg_class c
                JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname='public' AND c.relkind='r'
                AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)""")
            ).scalar_one()
            if unsafe:
                raise ValueError("Restore runtime must not own application tables")
            critical = (
                "reservations",
                "reservation_rooms",
                "payments",
                "audit_logs",
                "channel_jobs",
                "worker_heartbeats",
            )
            counts = {}
            for name in critical:
                protected = db.session.execute(
                    text(
                        "SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid=to_regclass(:name)"
                    ),
                    {"name": name},
                ).scalar_one_or_none()
                if not protected:
                    raise ValueError("Restored critical table lacks forced RLS")
                table = db.metadata.tables[name]
                set_context(is_system=True, is_service=True)
                counts[name] = db.session.scalar(select(db.func.count()).select_from(table))
                set_context()
                if db.session.scalar(select(db.func.count()).select_from(table)):
                    raise ValueError("Restored tenant data is visible without context")
            set_context(is_system=True, is_service=True)
            overlaps = db.session.execute(
                text("""SELECT count(*) FROM reservation_rooms a
                JOIN reservation_rooms b ON a.tenant_id=b.tenant_id AND a.room_id=b.room_id
                AND a.id<b.id AND a.active AND b.active
                AND a.check_in<b.check_out AND b.check_in<a.check_out""")
            ).scalar_one()
            if overlaps:
                raise ValueError("Restored active room stays overlap")
            if expected is not None and any(
                counts.get(key) != value for key, value in expected.items()
            ):
                raise ValueError("Restored table counts differ from the supplied backup manifest")
            return {
                "status": "ok",
                "schema": "ok",
                "forcedRls": "ok",
                "activeRoomOverlaps": 0,
                "tableCounts": counts,
            }
    finally:
        with app.app_context():
            db.session.remove()
            db.engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dump", type=Path, required=True, help="Local pg_dump -Fc archive")
    parser.add_argument(
        "--expected-counts",
        type=Path,
        help="JSON map of critical table counts captured with the backup",
    )
    args = parser.parse_args()
    if not args.dump.is_file():
        raise ValueError("Use an existing custom-format pg_dump archive")
    with args.dump.open("rb") as archive:
        if archive.read(5) != b"PGDMP":
            raise ValueError("Use an existing custom-format pg_dump archive")
    config = admin_config(os.environ.get("RESTORE_DATABASE_ADMIN_URL"))
    executable = shutil.which("pg_restore")
    if not executable:
        raise ValueError("pg_restore must be available on PATH")
    expected = json.loads(args.expected_counts.read_text()) if args.expected_counts else None
    if expected is not None and (
        not isinstance(expected, dict)
        or not expected
        or any(type(value) is not int or value < 0 for value in expected.values())
    ):
        raise ValueError("Expected counts must be a nonempty JSON object of nonnegative integers")
    with disposable_database(config, prefix="pms_restore_test_") as sandbox:
        result = subprocess.run(
            [
                executable,
                "--no-owner",
                "--no-acl",
                "--exit-on-error",
                "--single-transaction",
                "--host",
                config["host"],
                "--port",
                str(config["port"]),
                "--username",
                config["user"],
                "--role",
                sandbox["migrator"],
                "--dbname",
                sandbox["database"],
                str(args.dump.resolve()),
            ],
            env={**os.environ, "PGPASSWORD": config["password"]},
            capture_output=True,
            timeout=600,
        )
        if result.returncode:
            raise ValueError("Archive restore failed; no live target was selected")
        print(json.dumps(verify(sandbox["environment"], expected), sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, psycopg.Error, SQLAlchemyError, OSError, subprocess.TimeoutExpired):
        raise SystemExit(
            "Restore verification failed. Use a trusted dump, matching code and local PostgreSQL tools; no existing database was restored over."
        ) from None
