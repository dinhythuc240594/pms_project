"""Keep private customer contacts and support notes outside tenant settings."""

import sqlalchemy as sa
from alembic import op

from pms_api.rls import SYSTEM

revision = "0014_manager_customers"
down_revision = "0013_manager_billing"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "tenant_client_profiles",
        sa.Column("tenant_id", sa.String(40), sa.ForeignKey("tenants.id"), primary_key=True),
        sa.Column("contact_name", sa.String(160)),
        sa.Column("contact_email", sa.String(254)),
        sa.Column("contact_phone", sa.String(40)),
        sa.Column("address", sa.String(500)),
        sa.Column("city", sa.String(160)),
        sa.Column("tax_id", sa.String(40)),
        sa.Column("domain", sa.String(253)),
        sa.Column("customer_notes", sa.String(4000)),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.execute("ALTER TABLE tenant_client_profiles ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE tenant_client_profiles FORCE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY system_clients ON tenant_client_profiles USING ({SYSTEM}) WITH CHECK ({SYSTEM})"
    )


def downgrade():
    op.execute("SELECT set_config('app.is_system','true',true)")
    op.execute("""DO $$ BEGIN IF EXISTS (SELECT 1 FROM tenant_client_profiles) THEN
        RAISE EXCEPTION 'Customer profiles exist; downgrade refused'; END IF; END $$""")
    op.drop_table("tenant_client_profiles")
