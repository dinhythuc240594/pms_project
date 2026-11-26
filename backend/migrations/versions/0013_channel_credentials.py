"""Encrypt tenant Channex credentials without changing existing environment settings."""

import sqlalchemy as sa
from alembic import op

revision = "0013_channel_credentials"
down_revision = "0012_manager_features"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("channel_connections", sa.Column("secrets_ciphertext", sa.Text()))
    op.add_column("channel_connections", sa.Column("verified_at", sa.DateTime(timezone=True)))
    op.add_column("channel_connections", sa.Column("webhook_id", sa.String(36)))
    op.drop_constraint(op.f("ck_channel_jobs_kind"), "channel_jobs", type_="check")
    op.create_check_constraint(
        op.f("ck_channel_jobs_kind"),
        "channel_jobs",
        "kind IN ('push_ari','pull_bookings','ack_revision','setup_webhook')",
    )


def downgrade():
    op.execute("SELECT set_config('app.is_system','true',true)")
    op.execute("""DO $$ BEGIN IF EXISTS (
        SELECT 1 FROM channel_connections WHERE secrets_ciphertext IS NOT NULL
        ) OR EXISTS (SELECT 1 FROM channel_jobs WHERE kind='setup_webhook')
        THEN RAISE EXCEPTION 'Encrypted channel credentials or webhook jobs exist; downgrade refused';
        END IF; END $$""")
    op.drop_constraint(op.f("ck_channel_jobs_kind"), "channel_jobs", type_="check")
    op.create_check_constraint(
        op.f("ck_channel_jobs_kind"),
        "channel_jobs",
        "kind IN ('push_ari','pull_bookings','ack_revision')",
    )
    op.drop_column("channel_connections", "webhook_id")
    op.drop_column("channel_connections", "verified_at")
    op.drop_column("channel_connections", "secrets_ciphertext")
