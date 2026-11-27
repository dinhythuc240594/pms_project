"""Capture client IP separately from event details on new audit records."""

import sqlalchemy as sa
from alembic import op

revision = "0044_audit_ip"
down_revision = "0043_plan_room_pricing"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("audit_logs", sa.Column("ip_address", sa.String(45), nullable=True))
    op.add_column("audit_logs", sa.Column("ip_source", sa.String(20), nullable=True))


def downgrade():
    op.drop_column("audit_logs", "ip_source")
    op.drop_column("audit_logs", "ip_address")
