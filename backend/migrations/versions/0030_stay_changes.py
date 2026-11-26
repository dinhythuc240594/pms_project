"""Snapshot room type per night so room moves cannot rewrite historical reports."""

import sqlalchemy as sa
from alembic import op

revision = "0030_stay_changes"
down_revision = "0029_channel_dirty_ari"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("reservation_nights", sa.Column("room_type_id", sa.String(40)))
    op.execute("SELECT set_config('app.is_system','true',true)")
    op.execute("""UPDATE reservation_nights AS night SET room_type_id=room.room_type_id
        FROM reservation_rooms AS room WHERE night.tenant_id=room.tenant_id
        AND night.reservation_id=room.reservation_id AND night.room_id=room.room_id""")
    op.execute("""UPDATE reservation_nights AS night SET room_type_id=room.room_type_id
        FROM physical_rooms AS room WHERE night.tenant_id=room.tenant_id
        AND night.room_id=room.id AND night.room_type_id IS NULL""")
    op.alter_column("reservation_nights", "room_type_id", nullable=False)
    op.create_foreign_key(
        "fk_reservation_nights_type",
        "reservation_nights",
        "room_types",
        ["tenant_id", "room_type_id"],
        ["tenant_id", "id"],
    )


def downgrade():
    op.execute("SELECT set_config('app.is_system','true',true)")
    op.execute("""DO $$ BEGIN IF EXISTS (SELECT 1 FROM reservation_nights) THEN
        RAISE EXCEPTION 'Nightly room-type history exists; downgrade refused';
        END IF; END $$""")
    op.drop_constraint("fk_reservation_nights_type", "reservation_nights", type_="foreignkey")
    op.drop_column("reservation_nights", "room_type_id")
