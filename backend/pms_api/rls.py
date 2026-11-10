"""Migration-only helpers. Context settings are LOCAL to each transaction."""

import re

from alembic import op

SYSTEM = "coalesce(current_setting('app.is_system', true),'') = 'true'"
TENANT = "tenant_id = nullif(current_setting('app.tenant_id', true),'')"
SERVICE = "coalesce(current_setting('app.is_service', true),'') = 'true'"


def pms_scope(table):
    """PMS scope for new policies; SYSTEM is only for SaaS metadata.

    Background jobs/webhooks can use an explicit tenant without a user. HTTP
    actors must still hold a current, active membership in that tenant.
    protect_table below is retained for reproducible historical migrations.
    """
    if not re.fullmatch(r"[a-z_]+", table):
        raise ValueError("Invalid migration identifier")
    return f"""({SERVICE} OR ({TENANT} AND (
        nullif(current_setting('app.user_id', true),'') IS NULL OR EXISTS (
            SELECT 1 FROM tenant_users m JOIN users u ON u.id=m.user_id
            WHERE m.tenant_id={table}.tenant_id
            AND m.user_id=nullif(current_setting('app.user_id', true),'')
            AND m.active AND u.active))))"""


def protect_table(table):
    if not re.fullmatch(r"[a-z_]+", table):
        raise ValueError("Invalid migration identifier")
    op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')
    op.execute(f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY')
    op.execute(
        f'CREATE POLICY tenant_scope ON "{table}" USING ({TENANT} OR {SYSTEM}) WITH CHECK ({TENANT} OR {SYSTEM})'
    )


def unprotect_table(table):
    if not re.fullmatch(r"[a-z_]+", table):
        raise ValueError("Invalid migration identifier")
    op.execute(f'DROP POLICY IF EXISTS tenant_scope ON "{table}"')
    op.execute(f'ALTER TABLE "{table}" DISABLE ROW LEVEL SECURITY')


def append_only(table):
    if not re.fullmatch(r"[a-z_]+", table):
        raise ValueError("Invalid migration identifier")
    op.execute("""CREATE OR REPLACE FUNCTION pms_reject_mutation() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Append-only record' USING ERRCODE='42501'; END $$""")
    op.execute(
        f'CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON "{table}" FOR EACH ROW EXECUTE FUNCTION pms_reject_mutation()'
    )
