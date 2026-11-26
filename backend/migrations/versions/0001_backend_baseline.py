"""Start migration history; business tables are added in later revisions.

Revision ID: 0001_backend_baseline
Revises:
"""

revision = "0001_backend_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    """Alembic records this baseline in alembic_version."""


def downgrade():
    """No business tables were introduced by this baseline."""
