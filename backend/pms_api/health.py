from alembic.runtime.migration import MigrationContext
from flask import current_app, jsonify
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from common import CommonMethodView

from .extensions import db
from .security import require_system


def database_status():
    try:
        with db.engine.connect() as connection:
            connection.execute(text("SET LOCAL statement_timeout = '3s'"))
            connection.execute(text("SELECT 1")).scalar_one()
            if current_app.config["APP_ENV"] == "production":
                role = connection.execute(
                    text("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")
                ).one()
                if role.rolsuper or role.rolbypassrls:
                    return {"status": "error", "database": "unsafe_role"}
            heads = set(MigrationContext.configure(connection).get_current_heads())
            if heads != current_app.extensions["migration_heads"]:
                return {"status": "error", "database": "ok", "schema": "pending"}
        return {"status": "ok", "database": "ok", "schema": "ok"}
    except SQLAlchemyError as error:
        current_app.logger.warning("database_unavailable (%s)", type(error).__name__)
        return {"status": "error", "database": "unavailable"}


class LivenessView(CommonMethodView):
    @staticmethod
    def dispatch_request():
        return jsonify(status="ok", message="Backend is running")


class ReadinessView(CommonMethodView):
    @staticmethod
    def dispatch_request():
        status = database_status()
        return jsonify(status), 200 if status["status"] == "ok" else 503


class OperationsView(CommonMethodView):
    @staticmethod
    @require_system()
    def dispatch_request():
        from .worker_health import operations_status

        return operations_status()


def __getattr__(name):
    if name == "database_check":
        from .commands import database_check

        return database_check
    if name in {"URL", "health"}:
        from importlib import import_module

        return getattr(import_module(".health_urls", __package__), name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
