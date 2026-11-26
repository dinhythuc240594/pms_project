"""Persist configurable room-based commercial subscription pricing."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0043_plan_room_pricing"
down_revision = "0042_hotel_currencies"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "plans",
        sa.Column(
            "pricing_rules",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.cast(
                sa.literal(
                    '{"baseRooms":15,"extraRoomPrice":"0","extraRoomPriceYear":"0",'
                    '"adjustments":[{"aboveRooms":30,"percent":"0"},'
                    '{"aboveRooms":50,"percent":"0"},{"aboveRooms":100,"percent":"0"}]}'
                ),
                postgresql.JSONB(),
            ),
        ),
    )


def downgrade():
    op.drop_column("plans", "pricing_rules")
