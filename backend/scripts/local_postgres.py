"""Manage a private development cluster; never change the system PostgreSQL service."""

import argparse
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import quote

BACKEND = Path(__file__).resolve().parents[1]
CLUSTER = BACKEND / ".local-postgres"
DATA = CLUSTER / "data"
ADMIN = "pms_dev_admin"
DATABASE = "pms_local"
MARKER = "pms-local-postgres-v1"


class SetupError(Exception):
    """A safe, actionable error that does not contain credentials."""


def find_bin():
    candidates = [Path(os.environ["PG_BIN"])] if os.environ.get("PG_BIN") else []
    candidates.append(Path("C:/Program Files/PostgreSQL/18/bin"))
    if executable := shutil.which("initdb"):
        candidates.append(Path(executable).parent)
    suffix = ".exe" if os.name == "nt" else ""
    for candidate in candidates:
        if all((candidate / (name + suffix)).is_file() for name in ("initdb", "pg_ctl")):
            return candidate
    raise SetupError(
        "PostgreSQL binaries not found. Set PG_BIN to the directory containing initdb and pg_ctl."
    )


def run(pg_bin, name, *args, accepted=(0,)):
    executable = pg_bin / (name + (".exe" if os.name == "nt" else ""))
    # A detached postgres process may inherit PIPE handles on Windows. Use a
    # regular log file so completion waits only for pg_ctl, never daemon output.
    with (CLUSTER / "setup.log").open("a", encoding="utf-8") as output:
        result = subprocess.run(
            [str(executable), *map(str, args)],
            stdout=output,
            stderr=subprocess.STDOUT,
            timeout=45,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    if result.returncode not in accepted:
        raise SetupError(
            f"{name} failed (exit {result.returncode}). Check .local-postgres/setup.log and server.log; no data was deleted."
        )
    return result.returncode


def validate_paths():
    if CLUSTER.resolve().parent != BACKEND or DATA.resolve().parent != CLUSTER.resolve():
        raise SetupError("Refusing a cluster path that resolves outside the backend directory.")


def credentials(port=None, create=False):
    path = CLUSTER / "credentials.json"
    if path.resolve().parent != CLUSTER.resolve():
        raise SetupError("Refusing a credentials path outside the managed cluster.")
    if path.exists():
        stored = json.loads(path.read_text(encoding="utf-8"))
        if (
            stored.get("managed_by") != MARKER
            or not isinstance(stored.get("port"), int)
            or not 1024 <= stored["port"] <= 65535
            or stored["port"] == 5432
        ):
            raise SetupError("Existing credentials do not identify a managed PMS cluster.")
        if not all(
            isinstance(stored.get(role), str) and stored[role]
            for role in (ADMIN, "pms_migrator", "pms_app")
        ):
            raise SetupError(
                "Cluster credentials are incomplete. Restore the original credentials file."
            )
        if port is not None and port != stored["port"]:
            raise SetupError(
                "This cluster uses a different port. Use its original port; credentials were preserved."
            )
        return stored
    if not create:
        raise SetupError(
            "Cluster credentials are missing. Refusing to manage an unidentified cluster."
        )
    if DATA.exists():
        raise SetupError(
            "Existing data has no PMS credentials. Refusing to initialize or modify it."
        )
    CLUSTER.mkdir(parents=True, exist_ok=True)
    stored = {"managed_by": MARKER, "port": port or 15432}
    stored.update({role: secrets.token_urlsafe(32) for role in (ADMIN, "pms_migrator", "pms_app")})
    with path.open("x", encoding="utf-8") as handle:
        json.dump(stored, handle, indent=2)
    path.chmod(0o600)
    return stored


def require_free_port(port):
    with socket.socket() as listener:
        if os.name == "nt":
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try:
            listener.bind(("127.0.0.1", port))
        except OSError:
            raise SetupError(
                f"Port {port} is already in use. Choose a free --port; no existing server was changed."
            ) from None


def connect(stored, database="postgres"):
    import psycopg

    connection = psycopg.connect(
        host="127.0.0.1",
        port=stored["port"],
        dbname=database,
        user=ADMIN,
        password=stored[ADMIN],
        connect_timeout=5,
        application_name="pms_local_setup",
        autocommit=True,
    )
    with connection.cursor() as cursor:
        cursor.execute("SHOW data_directory")
        if Path(cursor.fetchone()[0]).resolve() != DATA.resolve():
            connection.close()
            raise SetupError(
                "Connected server has a different data directory. Refusing to modify or stop it."
            )
    return connection


def is_running(stored):
    from psycopg import OperationalError

    try:
        with connect(stored):
            pass
        return True
    except OperationalError as error:
        # Restricted Windows process inspection can misreport pg_ctl status.
        # Authenticate first; only a demonstrably free port means stopped.
        if error.sqlstate:
            raise SetupError(
                "Could not authenticate or verify the local cluster. Existing server was preserved."
            ) from None
        try:
            require_free_port(stored["port"])
        except SetupError:
            raise SetupError(
                "The local PostgreSQL port is occupied but its cluster identity could not be verified. Existing server was preserved."
            ) from None
        return False


def initialize(pg_bin, stored):
    if (DATA / "PG_VERSION").is_file():
        return
    if DATA.exists() and any(DATA.iterdir()):
        raise SetupError(
            "Cluster initialization is incomplete. Existing files were preserved for inspection."
        )
    descriptor, filename = tempfile.mkstemp(prefix=".initdb-password-", dir=CLUSTER)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(stored[ADMIN] + "\n")
        run(
            pg_bin,
            "initdb",
            "-D",
            DATA,
            "-U",
            ADMIN,
            "--auth=scram-sha-256",
            "--encoding=UTF8",
            "--locale=C",
            "--pwfile",
            filename,
        )
    finally:
        Path(filename).unlink(missing_ok=True)


def provision(stored):
    from psycopg import sql

    with connect(stored) as connection, connection.cursor() as cursor:
        for role in ("pms_migrator", "pms_app"):
            cursor.execute(
                "SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = %s",
                (role,),
            )
            flags = cursor.fetchone()
            if not flags:
                cursor.execute(
                    sql.SQL(
                        "CREATE ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD {}"
                    ).format(sql.Identifier(role), sql.Literal(stored[role]))
                )
            elif flags != (False, False, False, False, False, True):
                raise SetupError(
                    "Existing application roles have unexpected privileges. Configuration was preserved."
                )
        cursor.execute(
            "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = %s", (DATABASE,)
        )
        owner = cursor.fetchone()
        if not owner:
            cursor.execute(
                sql.SQL("CREATE DATABASE {} OWNER {}").format(
                    sql.Identifier(DATABASE), sql.Identifier("pms_migrator")
                )
            )
        elif owner[0] != "pms_migrator":
            raise SetupError("pms_local has an unexpected owner. Its configuration was preserved.")
    with connect(stored, DATABASE) as connection, connection.cursor() as cursor:
        cursor.execute(
            sql.SQL("REVOKE ALL ON DATABASE {} FROM PUBLIC").format(sql.Identifier(DATABASE))
        )
        cursor.execute(
            sql.SQL("GRANT CONNECT ON DATABASE {} TO pms_app").format(sql.Identifier(DATABASE))
        )
        cursor.execute("REVOKE CREATE ON SCHEMA public FROM PUBLIC")
        cursor.execute("GRANT USAGE ON SCHEMA public TO pms_app")
        cursor.execute(
            "ALTER DEFAULT PRIVILEGES FOR ROLE pms_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pms_app"
        )
        cursor.execute(
            "ALTER DEFAULT PRIVILEGES FOR ROLE pms_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO pms_app"
        )


def write_env(stored):
    def url(role):
        return f"postgresql+psycopg://{role}:{quote(stored[role], safe='')}@127.0.0.1:{stored['port']}/{DATABASE}"

    try:
        with (BACKEND / ".env").open("x", encoding="utf-8") as handle:
            handle.write(
                "APP_ENV=development\nPORT=5000\nCORS_ORIGINS=http://127.0.0.1:5173,http://localhost:5173\n"
            )
            handle.write(
                f"DATABASE_URL={url('pms_app')}\nDATABASE_MIGRATION_URL={url('pms_migrator')}\n"
            )
        (BACKEND / ".env").chmod(0o600)
        print("Created backend/.env with local database URLs (credentials are hidden).")
    except FileExistsError:
        print("Existing backend/.env was preserved; ensure it points to this local cluster.")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("start", "stop", "status"))
    parser.add_argument(
        "--port",
        type=int,
        help="Local port on first start (default: 15432); later commands reuse it.",
    )
    args = parser.parse_args(argv)
    if args.port is not None and (not 1024 <= args.port <= 65535 or args.port == 5432):
        parser.error(
            "Use a port from 1024 to 65535 other than 5432 (reserved for the system service)."
        )
    try:
        validate_paths()
        if args.command != "start" and not (DATA / "PG_VERSION").exists():
            print("PMS local PostgreSQL is not initialized.")
            return 0
        pg_bin = find_bin()
        if args.command == "start" and not (CLUSTER / "credentials.json").exists():
            require_free_port(args.port or 15432)
        stored = credentials(args.port, create=args.command == "start")
        running = (DATA / "PG_VERSION").exists() and is_running(stored)
        if args.command == "start":
            if not running:
                require_free_port(stored["port"])
                initialize(pg_bin, stored)
                run(
                    pg_bin,
                    "pg_ctl",
                    "start",
                    "-D",
                    DATA,
                    "-l",
                    CLUSTER / "server.log",
                    "-o",
                    f"-h 127.0.0.1 -p {stored['port']}",
                    "-w",
                    "-t",
                    "30",
                )
            provision(stored)
            write_env(stored)
            print(f"PMS local PostgreSQL is ready at 127.0.0.1:{stored['port']} / {DATABASE}.")
        elif args.command == "stop" and running:
            with connect(stored):
                pass  # Verify cluster identity before asking pg_ctl to stop it.
            run(pg_bin, "pg_ctl", "stop", "-D", DATA, "-m", "fast", "-w", "-t", "30")
            print("PMS local PostgreSQL stopped; database files were preserved.")
        else:
            if running:
                with connect(stored):
                    pass
            print(
                f"PMS local PostgreSQL is {'running' if running else 'stopped'} at 127.0.0.1:{stored['port']}."
            )
        return 0
    except (OSError, ValueError, subprocess.TimeoutExpired, SetupError) as error:
        print(
            str(error)
            if isinstance(error, SetupError)
            else "Local setup failed. Check file permissions and PostgreSQL logs; credentials were not printed.",
            file=sys.stderr,
        )
        return 1
    except Exception:
        print(
            "Database provisioning failed. Check PostgreSQL availability and installed backend dependencies; credentials were not printed.",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
