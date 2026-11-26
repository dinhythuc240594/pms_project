"""Index tenant history pagination and revision lookups without copying payloads."""

import sqlalchemy as sa
from alembic import op

revision = "0032_channel_job_history"
down_revision = "0031_channel_onboarding"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index("ix_channel_jobs_history", "channel_jobs", ["tenant_id", "created_at", "id"])
    op.create_index(
        "ix_channel_jobs_revision",
        "channel_jobs",
        ["tenant_id", sa.text("(payload ->> 'revisionId')")],
    )


def downgrade():
    op.drop_index("ix_channel_jobs_revision", table_name="channel_jobs")
    op.drop_index("ix_channel_jobs_history", table_name="channel_jobs")
