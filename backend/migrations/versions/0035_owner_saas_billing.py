"""Allow active hotel owners to read their tenant's SaaS billing records."""

from alembic import op

from pms_api.rls import TENANT

revision = "0035_owner_saas_billing"
down_revision = "0034_pms_tenant_authorization"
branch_labels = None
depends_on = None


def upgrade():
    # Existing system_scope remains the only policy permitting any billing writes.
    # A tenant context alone is insufficient: staff must not read SaaS receivables.
    for table in ("saas_invoices", "saas_payments"):
        op.execute(f"""CREATE POLICY owner_read ON {table} FOR SELECT USING (
            {TENANT} AND EXISTS (
                SELECT 1 FROM tenant_users membership
                JOIN users actor ON actor.id = membership.user_id
                WHERE membership.tenant_id = {table}.tenant_id
                  AND membership.user_id = nullif(current_setting('app.user_id', true), '')
                  AND membership.role = 'HOTEL_OWNER' AND membership.active AND actor.active
            )
        )""")


def downgrade():
    for table in ("saas_invoices", "saas_payments"):
        op.execute(f"DROP POLICY owner_read ON {table}")
