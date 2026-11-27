"""Store explicit room floor and area without changing room IDs or assignments."""

import sqlalchemy as sa
from alembic import op

revision = "0032_room_locations"
down_revision = "0031_channel_onboarding"
branch_labels = None
depends_on = None


def upgrade():
    # Existing rooms remain unassigned; room numbers do not imply their location.
    for column in ("floor", "area"):
        op.add_column("physical_rooms", sa.Column(column, sa.String(120), nullable=True))
        op.create_check_constraint(
            f"valid_{column}",
            "physical_rooms",
            f"{column} IS NULL OR ({column} = btrim({column}) AND length({column}) > 0)",
        )


def downgrade():
    op.execute("SELECT set_config('app.is_system','true',true)")
    op.execute("""DO $$ BEGIN IF EXISTS (
        SELECT 1 FROM physical_rooms WHERE floor IS NOT NULL OR area IS NOT NULL
    ) THEN RAISE EXCEPTION 'Room locations exist; downgrade refused'; END IF; END $$""")
    for column in ("area", "floor"):
        op.drop_constraint(f"valid_{column}", "physical_rooms", type_="check")
        op.drop_column("physical_rooms", column)
