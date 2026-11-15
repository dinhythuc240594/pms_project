"""Explicit additive installation; no guessed dependency on missing Alembic history."""

import click
from flask import current_app
from flask.cli import with_appcontext
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError

from ..extensions import db


def install_schema(engine, runtime_role):
    if engine.dialect.name != "postgresql" or not runtime_role:
        raise ValueError("Chatbot schema requires PostgreSQL and a runtime role.")
    from .models import ChatbotRequest

    with engine.begin() as connection:
        connection.execute(text("SELECT pg_advisory_xact_lock(74190019)"))
        inspector = inspect(connection)
        if not {"tenants", "tenant_users", "users"} <= set(inspector.get_table_names()):
            raise ValueError("Restore the core PMS schema before installing chatbot.")
        if inspector.has_table("chatbot_requests"):
            if set(ChatbotRequest.__table__.columns.keys()) != {
                c["name"] for c in inspector.get_columns("chatbot_requests")
            }:
                raise ValueError("Existing chatbot schema does not match the application.")
            if not connection.scalar(
                text(
                    "SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='chatbot_requests'::regclass"
                )
            ):
                raise ValueError("Existing chatbot table does not enforce row security.")
            return False
        db.metadata.create_all(connection, tables=[ChatbotRequest.__table__])
        connection.execute(text("ALTER TABLE chatbot_requests ENABLE ROW LEVEL SECURITY"))
        connection.execute(text("ALTER TABLE chatbot_requests FORCE ROW LEVEL SECURITY"))
        scope = """(tenant_id = nullif(current_setting('app.tenant_id',true),'')
            AND user_id = nullif(current_setting('app.user_id',true),'') AND EXISTS (
            SELECT 1 FROM tenant_users m JOIN users u ON u.id=m.user_id
            WHERE m.tenant_id=chatbot_requests.tenant_id AND m.user_id=chatbot_requests.user_id
            AND m.active AND u.active))"""
        connection.execute(
            text(
                f"CREATE POLICY chatbot_actor ON chatbot_requests USING ({scope}) WITH CHECK ({scope})"
            )
        )
        quoted = connection.dialect.identifier_preparer.quote(runtime_role)
        connection.execute(
            text(f"GRANT SELECT, INSERT, UPDATE, DELETE ON chatbot_requests TO {quoted}")
        )
    return True


@click.command("install-chatbot-schema")
@with_appcontext
def install_chatbot_schema():
    engine = create_engine(current_app.config["DATABASE_MIGRATION_URL"], hide_parameters=True)
    try:
        changed = install_schema(
            engine, make_url(current_app.config["SQLALCHEMY_DATABASE_URI"]).username
        )
    except (ValueError, SQLAlchemyError) as error:
        raise click.ClickException(
            str(error)
            if isinstance(error, ValueError)
            else "Chatbot schema installation failed; transaction rolled back."
        ) from None
    finally:
        engine.dispose()
    click.echo("Chatbot schema installed." if changed else "Chatbot schema is already current.")
