"""Record no-show as a terminal stay state without rewriting financial history."""

import sqlalchemy as sa
from alembic import op

revision = "0020_no_show"
down_revision = "0019_cash_categories"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("reservations", sa.Column("no_show_at", sa.DateTime(timezone=True)))
    op.drop_constraint(op.f("ck_reservations_status"), "reservations", type_="check")
    op.create_check_constraint(
        op.f("ck_reservations_status"),
        "reservations",
        "status IN ('CONFIRMED','IN_HOUSE','CHECKED_OUT','CANCELLED','NO_SHOW')",
    )


def downgrade():
    op.execute("SELECT set_config('app.is_system','true',true)")
    op.execute("""DO $$ BEGIN IF EXISTS (
        SELECT 1 FROM reservations WHERE status = 'NO_SHOW' OR no_show_at IS NOT NULL
    ) THEN RAISE EXCEPTION 'No-show history exists; downgrade refused'; END IF; END $$""")
    op.drop_constraint(op.f("ck_reservations_status"), "reservations", type_="check")
    op.create_check_constraint(
        op.f("ck_reservations_status"),
        "reservations",
        "status IN ('CONFIRMED','IN_HOUSE','CHECKED_OUT','CANCELLED')",
    )
    op.drop_column("reservations", "no_show_at")
