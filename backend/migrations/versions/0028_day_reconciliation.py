"""Retain immutable day reconciliation observations without closing periods."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from pms_api.rls import append_only, protect_table, unprotect_table

revision = "0028_day_reconciliation"
down_revision = "0027_worker_health"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "day_reconciliations",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("tenant_id", sa.String(40), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("business_date", sa.Date, nullable=False),
        sa.Column("timezone", sa.String(80), nullable=False),
        sa.Column("actor_id", sa.String(40), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("actor_name", sa.String(160), nullable=False),
        sa.Column("note", sa.String(1000), nullable=False),
        sa.Column("snapshot", JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "id"),
    )
    op.create_index(
        "ix_day_reconciliations_tenant_day",
        "day_reconciliations",
        ["tenant_id", "business_date", "created_at"],
    )
    protect_table("day_reconciliations")
    append_only("day_reconciliations")


def downgrade():
    op.execute("SELECT set_config('app.is_system','true',true)")
    op.execute("""DO $$ BEGIN IF EXISTS (SELECT 1 FROM day_reconciliations) THEN
        RAISE EXCEPTION 'Reconciliation history exists; downgrade refused';
        END IF; END $$""")
    unprotect_table("day_reconciliations")
    op.drop_table("day_reconciliations")
