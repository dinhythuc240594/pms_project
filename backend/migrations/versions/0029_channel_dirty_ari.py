"""Retain unscheduled inventory changes when the bounded OTA queue is full."""

import sqlalchemy as sa
from alembic import op

revision = "0029_channel_dirty_ari"
down_revision = "0028_day_reconciliation"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("channel_connections", sa.Column("pending_ari_start", sa.Date()))
    op.add_column("channel_connections", sa.Column("pending_ari_end", sa.Date()))
    op.add_column("channel_connections", sa.Column("pending_ari_since", sa.DateTime(timezone=True)))
    op.create_check_constraint(
        "pending_ari_range",
        "channel_connections",
        "(pending_ari_start IS NULL AND pending_ari_end IS NULL AND pending_ari_since IS NULL) "
        "OR (pending_ari_start IS NOT NULL AND pending_ari_end IS NOT NULL AND pending_ari_end > pending_ari_start "
        "AND pending_ari_since IS NOT NULL)",
    )


def downgrade():
    op.execute("SELECT set_config('app.is_system','true',true)")
    op.execute("""DO $$ BEGIN IF EXISTS (
        SELECT 1 FROM channel_connections WHERE pending_ari_start IS NOT NULL
    ) THEN RAISE EXCEPTION 'Pending OTA inventory exists; downgrade refused';
    END IF; END $$""")
    op.drop_constraint("pending_ari_range", "channel_connections", type_="check")
    for column in ("pending_ari_since", "pending_ari_end", "pending_ari_start"):
        op.drop_column("channel_connections", column)
