"""Preserve exact incoming plans, accepted money and amount-based OTA commissions."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0037_channel_rate_safety"
down_revision = "0036_channel_support"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "channel_mappings",
        sa.Column("inbound_rate_plan_ids", JSONB, nullable=False, server_default="[]"),
    )
    op.add_column(
        "channel_revisions", sa.Column("money_snapshot", JSONB, nullable=False, server_default="{}")
    )
    op.alter_column(
        "commission_settlements", "percent", existing_type=sa.Numeric(7, 4), nullable=True
    )


def downgrade():
    op.execute("""DO $$ DECLARE
        previous_system text := coalesce(current_setting('app.is_system',true),'');
        previous_service text := coalesce(current_setting('app.is_service',true),'');
    BEGIN
        PERFORM set_config('app.is_system','true',true);
        PERFORM set_config('app.is_service','true',true);
        IF EXISTS (SELECT 1 FROM channel_mappings WHERE inbound_rate_plan_ids <> '[]'::jsonb)
            OR EXISTS (SELECT 1 FROM channel_revisions WHERE money_snapshot <> '{}'::jsonb)
            OR EXISTS (SELECT 1 FROM commission_settlements WHERE percent IS NULL) THEN
            RAISE EXCEPTION 'Downgrade would discard channel rates or provider money history';
        END IF;
        PERFORM set_config('app.is_system',previous_system,true);
        PERFORM set_config('app.is_service',previous_service,true);
    END $$""")
    op.alter_column(
        "commission_settlements", "percent", existing_type=sa.Numeric(7, 4), nullable=False
    )
    op.drop_column("channel_revisions", "money_snapshot")
    op.drop_column("channel_mappings", "inbound_rate_plan_ids")
