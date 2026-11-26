"""Persist per-property ARI pacing across channel workers and restarts."""

import sqlalchemy as sa
from alembic import op

revision = "0023_channel_ari_pacing"
down_revision = "0022_merge_client_settings"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("channel_connections", sa.Column("ari_available_at", sa.DateTime(timezone=True)))


def downgrade():
    op.drop_column("channel_connections", "ari_available_at")
