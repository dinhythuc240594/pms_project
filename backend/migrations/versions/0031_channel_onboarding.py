"""Require booking and inventory reconciliation before PMS inventory publication."""

import sqlalchemy as sa
from alembic import op

revision = "0031_channel_onboarding"
down_revision = "0030_stay_changes"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "channel_connections",
        sa.Column(
            "inventory_revision",
            sa.String(40),
            nullable=False,
            server_default=sa.text("gen_random_uuid()::text"),
        ),
    )
    op.add_column(
        "channel_connections", sa.Column("inventory_reconciled_at", sa.DateTime(timezone=True))
    )
    op.drop_constraint(op.f("ck_channel_jobs_kind"), "channel_jobs", type_="check")
    op.create_check_constraint(
        "kind",
        "channel_jobs",
        "kind IN ('push_ari','pull_bookings','ack_revision','setup_webhook','pause_mapping','load_bookings')",
    )


def downgrade():
    op.execute("SELECT set_config('app.is_system','true',true)")
    op.execute("""DO $$ BEGIN IF EXISTS (SELECT 1 FROM channel_jobs WHERE kind='load_bookings')
        THEN RAISE EXCEPTION 'OTA booking-load history exists; downgrade refused'; END IF; END $$""")
    op.drop_constraint(op.f("ck_channel_jobs_kind"), "channel_jobs", type_="check")
    op.create_check_constraint(
        "kind",
        "channel_jobs",
        "kind IN ('push_ari','pull_bookings','ack_revision','setup_webhook','pause_mapping')",
    )
    op.drop_column("channel_connections", "inventory_reconciled_at")
    op.drop_column("channel_connections", "inventory_revision")
