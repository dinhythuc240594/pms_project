"""Runtime environment takes precedence; production never reads a local .env."""

import os
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import dotenv_values
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

BACKEND_DIR = Path(__file__).resolve().parents[1]


class ConfigurationError(ValueError):
    """A configuration error safe to display without credentials."""
    pass


def postgres_url(value, name="DATABASE_URL"):
    if not value:
        raise ConfigurationError(f"{name} is required; configure it in the runtime environment.")
    try:
        url = make_url(value)
        if url.drivername not in ("postgres", "postgresql", "postgresql+psycopg"):
            raise ValueError
        if not url.host or not url.database or not url.username:
            raise ValueError
        if url.port is not None and not 1 <= url.port <= 65535:
            raise ValueError
        return url.set(drivername="postgresql+psycopg")
    except (ArgumentError, ValueError, TypeError):
        raise ConfigurationError(
            f"{name} must be a valid PostgreSQL URL with username, host and database."
        ) from None


def cors_origins(value):
    if not isinstance(value, str):
        raise ConfigurationError("CORS_ORIGINS must contain exact HTTP(S) origins.")
    origins = [item.strip() for item in value.split(",") if item.strip()]
    for origin in origins:
        try:
            parsed = urlsplit(origin)
            if (
                parsed.scheme not in ("http", "https")
                or not parsed.hostname
                or "*" in origin
                or parsed.username
                or parsed.password
                or parsed.path
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError
            if parsed.port is not None and not 1 <= parsed.port <= 65535:
                raise ValueError
        except ValueError:
            raise ConfigurationError("CORS_ORIGINS must contain exact HTTP(S) origins.") from None
    return origins


def webhook_base_url(value):
    if value is None or value == "":
        return None
    try:
        if not isinstance(value, str) or any(ord(char) <= 32 or ord(char) > 126 for char in value):
            raise ValueError
        parsed = urlsplit(value)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path not in {"", "/"}
            or "?" in value
            or "#" in value
            or (parsed.port is not None and not 1 <= parsed.port <= 65535)
        ):
            raise ValueError
        return "https://" + parsed.netloc
    except (ValueError, TypeError):
        raise ConfigurationError(
            "CHANNEX_WEBHOOK_BASE_URL must be an exact HTTPS origin."
        ) from None


def trusted_proxy_count(value):
    """Number of reverse proxies (e.g. Coolify/Traefik) in front of the API.

    0 (default) ignores X-Forwarded-* entirely so clients cannot spoof their IP.
    Set it to exactly the number of proxy hops; a larger value lets clients
    forge X-Forwarded-For and bypass per-IP login throttling.
    """
    if value is None or value == "":
        return 0
    try:
        count = int(value)
        if str(count) != str(value).strip() or not 0 <= count <= 5:
            raise ValueError
        return count
    except (ValueError, TypeError):
        raise ConfigurationError("TRUSTED_PROXY_COUNT must be an integer from 0 to 5.") from None


def load_config(environ=None, *, env_file=BACKEND_DIR / ".env"):
    runtime = dict(os.environ if environ is None else environ)
    values = {}
    if runtime.get("APP_ENV", "development") != "production" and env_file is not None:
        values.update(dotenv_values(env_file, interpolate=False))
    values.update(runtime)
    environment = values.get("APP_ENV", "development")
    if environment not in ("development", "testing", "production"):
        raise ConfigurationError("APP_ENV must be development, testing or production.")
    if environment == "production":
        values = runtime
    database_url = postgres_url(values.get("DATABASE_URL"))
    migration_url = postgres_url(
        values.get("DATABASE_MIGRATION_URL") or values.get("DATABASE_URL"),
        "DATABASE_MIGRATION_URL",
    )
    try:
        port = int(values.get("PORT", "5000"))
        if not 1 <= port <= 65535:
            raise ValueError
    except (ValueError, TypeError):
        raise ConfigurationError("PORT must be between 1 and 65535.") from None
    default_origins = (
        "http://localhost:5173,http://127.0.0.1:5173" if environment != "production" else ""
    )
    return {
        "APP_ENV": environment,
        "DEBUG": False,
        "TESTING": environment == "testing",
        "PORT": port,
        "TRUSTED_PROXY_COUNT": trusted_proxy_count(values.get("TRUSTED_PROXY_COUNT")),
        "CHANNEX_ENCRYPTION_KEY": values.get("CHANNEX_ENCRYPTION_KEY"),
        "CHANNEX_MANAGER_API_KEY_STAGING": values.get("CHANNEX_MANAGER_API_KEY_STAGING"),
        "CHANNEX_MANAGER_API_KEY_PRODUCTION": values.get("CHANNEX_MANAGER_API_KEY_PRODUCTION"),
        "CHANNEX_WEBHOOK_BASE_URL": webhook_base_url(values.get("CHANNEX_WEBHOOK_BASE_URL")),
        "CORS_ORIGINS": cors_origins(values.get("CORS_ORIGINS", default_origins)),
        "SQLALCHEMY_DATABASE_URI": database_url,
        "DATABASE_MIGRATION_URL": migration_url,
        "SQLALCHEMY_TRACK_MODIFICATIONS": False,
        "SQLALCHEMY_ENGINE_OPTIONS": {
            "pool_pre_ping": True,
            "pool_size": 5,
            "max_overflow": 5,
            "pool_timeout": 5,
            "pool_recycle": 1800,
            "hide_parameters": True,
            "connect_args": {"connect_timeout": 3},
        },
    }
