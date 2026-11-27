"""Persist room-type floor defaults and tenant-scoped bed types."""

import sqlalchemy as sa
from alembic import op

revision = "0045_room_type_details"
down_revision = "0044_audit_ip"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("room_types", sa.Column("floor", sa.String(120), nullable=True))
    op.add_column("room_types", sa.Column("bed_type_id", sa.String(40), nullable=True))
    op.create_check_constraint(
        "valid_floor",
        "room_types",
        "floor IS NULL OR (floor = btrim(floor) AND length(floor) > 0)",
    )
    op.create_foreign_key(
        "fk_room_types_tenant_id_bed_type_id_masters",
        "room_types",
        "masters",
        ["tenant_id", "bed_type_id"],
        ["tenant_id", "id"],
    )


def downgrade():
    op.execute("SELECT set_config('app.is_system','true',true)")
    op.execute("""DO $$ BEGIN IF EXISTS (
        SELECT 1 FROM room_types WHERE floor IS NOT NULL OR bed_type_id IS NOT NULL
    ) THEN RAISE EXCEPTION 'Room-type details exist; downgrade refused'; END IF; END $$""")
    op.drop_constraint(
        "fk_room_types_tenant_id_bed_type_id_masters", "room_types", type_="foreignkey"
    )
    op.drop_constraint("valid_floor", "room_types", type_="check")
    op.drop_column("room_types", "bed_type_id")
    op.drop_column("room_types", "floor")
