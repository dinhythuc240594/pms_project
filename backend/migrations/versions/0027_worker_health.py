"""Persist independently committed operational worker heartbeats."""

import sqlalchemy as sa
from alembic import op

from pms_api.rls import SYSTEM

revision = "0027_worker_health"
down_revision = "0026_booking_versions"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "worker_heartbeats",
        sa.Column("worker_key", sa.String(80), primary_key=True),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("tenant_id", sa.String(40)),
        sa.Column("interval_seconds", sa.Integer(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_success_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("kind IN ('channels','housekeeping')", name="kind"),
        sa.CheckConstraint("interval_seconds BETWEEN 5 AND 86400", name="interval"),
    )
    op.execute("ALTER TABLE worker_heartbeats ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE worker_heartbeats FORCE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY system_scope ON worker_heartbeats USING ({SYSTEM}) WITH CHECK ({SYSTEM})"
    )


def downgrade():
    op.drop_table("worker_heartbeats")
