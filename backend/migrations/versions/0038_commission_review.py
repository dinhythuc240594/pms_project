"""Retain commission review decisions and recovered overpayments."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from pms_api.rls import append_only, pms_scope, unprotect_table

revision = "0038_commission_review"
down_revision = "0037_channel_rate_safety"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "commission_reviews",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("tenant_id", sa.String(40), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("commission_id", sa.String(40), nullable=False),
        sa.Column("room_net", sa.Numeric(19, 4), nullable=False),
        sa.Column("base_room_net", sa.Numeric(19, 4), nullable=False),
        sa.Column("amount", sa.Numeric(19, 4), nullable=False),
        sa.Column("base_amount", sa.Numeric(19, 4), nullable=False),
        sa.Column("base_currency", sa.String(3), nullable=False),
        sa.Column("exchange_rate", sa.Numeric(19, 8), nullable=False),
        sa.Column("evidence", JSONB, nullable=False),
        sa.Column("allocations", JSONB, nullable=False),
        sa.Column("reason", sa.String(1000), nullable=False),
        sa.Column("user_id", sa.String(40), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "id"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "commission_id"],
            ["commission_settlements.tenant_id", "commission_settlements.id"],
        ),
        sa.CheckConstraint(
            "room_net >= 0 AND base_room_net >= 0 AND amount >= 0 AND base_amount >= 0 AND amount <= room_net",
            name="valid_amounts",
        ),
        sa.CheckConstraint(
            "exchange_rate > 0 AND length(btrim(reason)) > 0", name="review_details"
        ),
    )
    op.create_index(
        "ix_commission_reviews_latest",
        "commission_reviews",
        ["tenant_id", "commission_id", "created_at", "id"],
    )
    op.create_table(
        "commission_recoveries",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("tenant_id", sa.String(40), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("commission_id", sa.String(40), nullable=False),
        sa.Column("cash_document_id", sa.String(40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "id"),
        sa.UniqueConstraint("tenant_id", "cash_document_id"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "commission_id"],
            ["commission_settlements.tenant_id", "commission_settlements.id"],
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "cash_document_id"], ["cash_documents.tenant_id", "cash_documents.id"]
        ),
    )
    for table in ("commission_reviews", "commission_recoveries"):
        scope = pms_scope(table)
        op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')
        op.execute(f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY')
        op.execute(f'CREATE POLICY tenant_scope ON "{table}" USING ({scope}) WITH CHECK ({scope})')
        append_only(table)


def downgrade():
    op.execute("""DO $$ DECLARE previous_service text := coalesce(current_setting('app.is_service',true),'');
    BEGIN
        PERFORM set_config('app.is_service','true',true);
        IF EXISTS (SELECT 1 FROM commission_reviews) OR EXISTS (SELECT 1 FROM commission_recoveries) THEN
            RAISE EXCEPTION 'Commission correction history exists; downgrade refused';
        END IF;
        PERFORM set_config('app.is_service',previous_service,true);
    END $$""")
    for table in ("commission_recoveries", "commission_reviews"):
        unprotect_table(table)
        op.drop_table(table)
