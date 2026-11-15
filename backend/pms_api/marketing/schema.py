"""Explicit, additive schema extension for checkouts without the PMS Alembic history.

Never creates core tables or stamps a guessed Alembic revision. Run with migration
credentials after the core schema exists; the entire extension is transactional.
"""

from sqlalchemy import inspect, text

TABLE_NAMES = (
    "marketing_assets",
    "marketing_sites",
    "marketing_pages",
    "marketing_revisions",
    "marketing_render_artifacts",
    "marketing_reviews",
    "marketing_releases",
    "marketing_publications",
    "marketing_intents",
    "marketing_generation_jobs",
)
IMMUTABLE = (
    "marketing_assets",
    "marketing_revisions",
    "marketing_render_artifacts",
    "marketing_reviews",
    "marketing_releases",
)


def install_schema(engine, runtime_role):
    if engine.dialect.name != "postgresql":
        raise ValueError("Marketing schema installation requires PostgreSQL.")
    if not runtime_role:
        raise ValueError("A runtime database role is required.")
    from ..extensions import db

    with engine.begin() as connection:
        connection.execute(text("SELECT pg_advisory_xact_lock(74190018)"))
        inspector = inspect(connection)
        required = {"tenants", "tenant_users", "users", "audit_logs"}
        if not required <= set(inspector.get_table_names()):
            raise ValueError("Restore and migrate the core PMS schema before installing marketing.")
        existing = set(inspector.get_table_names()) & set(TABLE_NAMES)
        has_ledger = inspector.has_table("marketing_schema_versions")
        if existing and not has_ledger:
            raise ValueError("Unversioned marketing tables exist; inspect them before migration.")
        connection.execute(
            text("""CREATE TABLE IF NOT EXISTS marketing_schema_versions (
            version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())""")
        )
        version = connection.scalar(text("SELECT max(version) FROM marketing_schema_versions"))
        if version is not None:
            if version != 1 or existing != set(TABLE_NAMES):
                raise ValueError(
                    "Marketing schema version or table set does not match this application."
                )
            for name in TABLE_NAMES:
                if set(db.metadata.tables[name].columns.keys()) != {
                    column["name"] for column in inspector.get_columns(name)
                }:
                    raise ValueError("Marketing schema columns do not match this application.")
            return False
        db.metadata.create_all(
            connection, tables=[db.metadata.tables[name] for name in TABLE_NAMES]
        )
        quote = connection.dialect.identifier_preparer.quote
        role = quote(runtime_role)
        connection.execute(
            text("""CREATE OR REPLACE FUNCTION marketing_reject_mutation()
            RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
            RAISE EXCEPTION 'Marketing history is immutable' USING ERRCODE='42501'; END $$""")
        )
        for name in TABLE_NAMES:
            table = quote(name)
            scope = f"""(tenant_id = nullif(current_setting('app.tenant_id',true),'') AND (
                nullif(current_setting('app.user_id',true),'') IS NULL OR EXISTS (
                SELECT 1 FROM tenant_users m JOIN users u ON u.id=m.user_id
                WHERE m.tenant_id={table}.tenant_id
                AND m.user_id=nullif(current_setting('app.user_id',true),'')
                AND m.active AND u.active AND m.role='HOTEL_OWNER')))"""
            connection.execute(text(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY"))
            connection.execute(text(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY"))
            connection.execute(
                text(
                    f"CREATE POLICY marketing_tenant ON {table} USING ({scope}) WITH CHECK ({scope})"
                )
            )
            if name == "marketing_publications":
                # Projection has only public HTML. Status is rechecked before any HTTP response.
                connection.execute(
                    text(f"CREATE POLICY marketing_public_read ON {table} FOR SELECT USING (true)")
                )
            if name == "marketing_generation_jobs":
                connection.execute(
                    text(f"""CREATE POLICY marketing_worker_discovery ON {table}
                    FOR SELECT USING (coalesce(current_setting('app.is_service',true),'')='true')""")
                )
            connection.execute(text(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO {role}"))
            if name in IMMUTABLE:
                connection.execute(
                    text(f"""CREATE TRIGGER marketing_immutable BEFORE UPDATE OR DELETE
                    ON {table} FOR EACH ROW EXECUTE FUNCTION marketing_reject_mutation()""")
                )
        connection.execute(text("REVOKE ALL ON marketing_schema_versions FROM PUBLIC"))
        connection.execute(text("INSERT INTO marketing_schema_versions(version) VALUES (1)"))
    return True
