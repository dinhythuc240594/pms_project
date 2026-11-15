"""Operator commands: additive schema installation and a separately managed AI worker."""

import time

import click
from flask import current_app
from flask.cli import with_appcontext
from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError

from ..extensions import db


@click.command("install-marketing-schema")
@with_appcontext
def install_marketing_schema():
    from .schema import install_schema

    migration_url = current_app.config["DATABASE_MIGRATION_URL"]
    runtime_role = make_url(current_app.config["SQLALCHEMY_DATABASE_URI"]).username
    engine = create_engine(migration_url, hide_parameters=True)
    try:
        changed = install_schema(engine, runtime_role)
    except (ValueError, SQLAlchemyError) as error:
        message = (
            str(error)
            if isinstance(error, ValueError)
            else "Database migration failed; no schema changes committed."
        )
        raise click.ClickException(message) from None
    finally:
        engine.dispose()
    click.echo("Marketing schema installed." if changed else "Marketing schema is already current.")


@click.command("process-marketing-jobs")
@click.option("--tenant", help="Process only this tenant.")
@click.option("--limit", type=click.IntRange(1, 100), default=10, show_default=True)
@click.option("--watch", is_flag=True, help="Poll as a separate worker service.")
@click.option("--interval", type=click.IntRange(5, 60), default=10, show_default=True)
@with_appcontext
def process_marketing_jobs(tenant, limit, watch, interval):
    from ..security import set_context
    from .generation import process_one
    from .models import MarketingGeneration

    while True:
        try:
            set_context(is_service=True)
            query = (
                select(MarketingGeneration.tenant_id)
                .where(
                    MarketingGeneration.status.in_(("queued", "running")),
                )
                .distinct()
                .order_by(MarketingGeneration.tenant_id)
            )
            if tenant:
                query = query.where(MarketingGeneration.tenant_id == tenant)
            tenant_ids = db.session.scalars(query).all()
            db.session.rollback()
            count = 0
            for tenant_id in tenant_ids:
                for _ in range(limit):
                    if count >= limit or not process_one(tenant_id):
                        break
                    count += 1
            if count or not watch:
                click.echo(f"Processed {count} marketing jobs.")
        except SQLAlchemyError:
            db.session.rollback()
            if not watch:
                raise click.ClickException("Marketing worker database is unavailable.") from None
            click.echo("Marketing worker database unavailable; waiting to retry.", err=True)
        finally:
            db.session.remove()
        if not watch:
            return
        time.sleep(interval)


def register_marketing_commands(app):
    app.cli.add_command(install_marketing_schema)
    app.cli.add_command(process_marketing_jobs)
