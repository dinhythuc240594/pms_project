"""Retain cancellation verification without rewriting existing booking history."""

import sqlalchemy as sa
from alembic import op

revision = "0025_channel_cancel_verify"
down_revision = "0024_channel_booking_reviews"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "channel_bookings", sa.Column("cancellation_verified_at", sa.DateTime(timezone=True))
    )


def downgrade():
    op.execute("SELECT set_config('app.is_system','true',true)")
    op.execute("""DO $$ BEGIN IF EXISTS (
        SELECT 1 FROM channel_bookings WHERE cancellation_verified_at IS NOT NULL
    ) THEN RAISE EXCEPTION 'Cancellation verification history exists; downgrade refused';
    END IF; END $$""")
    op.drop_column("channel_bookings", "cancellation_verified_at")
