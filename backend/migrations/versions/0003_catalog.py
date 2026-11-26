"""Tenant hotel configuration, nightly rates and sellable inventory."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from pms_api.rls import protect_table

revision = "0003_catalog"
down_revision = "0002_identity"
branch_labels = None
depends_on = None


def base_columns(table):
    return [
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("tenant_id", sa.String(40), sa.ForeignKey("tenants.id"), nullable=False),
        sa.UniqueConstraint("tenant_id", "id", name=f"uq_{table}_tenant_id_id"),
    ]


def type_fk():
    return sa.ForeignKeyConstraint(
        ["tenant_id", "room_type_id"], ["room_types.tenant_id", "room_types.id"]
    )


def upgrade():
    op.create_table(
        "room_types",
        *base_columns("room_types"),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("base_price", sa.Numeric(19, 4), nullable=False),
        sa.Column("capacity", sa.Integer, nullable=False),
        sa.Column("active", sa.Boolean, nullable=False),
        sa.UniqueConstraint("tenant_id", "name", name="uq_room_types_tenant_name"),
        sa.CheckConstraint("base_price >= 0", name="nonnegative_price"),
        sa.CheckConstraint("capacity BETWEEN 1 AND 50", name="valid_capacity"),
    )
    op.create_table(
        "physical_rooms",
        *base_columns("physical_rooms"),
        sa.Column("room_type_id", sa.String(40), nullable=False),
        sa.Column("number", sa.String(40), nullable=False),
        sa.Column("condition", sa.String(20), nullable=False),
        sa.Column("active", sa.Boolean, nullable=False),
        type_fk(),
        sa.UniqueConstraint("tenant_id", "number", name="uq_physical_rooms_tenant_number"),
        sa.CheckConstraint("condition IN ('clean','dirty','maintenance')", name="valid_condition"),
    )
    op.create_table(
        "masters",
        *base_columns("masters"),
        sa.Column("catalog", sa.String(40), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("data", postgresql.JSONB, nullable=False),
        sa.Column("active", sa.Boolean, nullable=False),
        sa.UniqueConstraint("tenant_id", "catalog", "name", name="uq_masters_tenant_catalog_name"),
    )
    op.create_table(
        "daily_rates",
        *base_columns("daily_rates"),
        sa.Column("room_type_id", sa.String(40), nullable=False),
        sa.Column("date", sa.Date, nullable=False),
        sa.Column("price", sa.Numeric(19, 4), nullable=False),
        sa.Column("stop_sell", sa.Boolean, nullable=False),
        type_fk(),
        sa.UniqueConstraint(
            "tenant_id", "room_type_id", "date", name="uq_daily_rates_tenant_type_date"
        ),
        sa.CheckConstraint("price >= 0", name="nonnegative_price"),
    )
    op.create_table(
        "room_blocks",
        *base_columns("room_blocks"),
        sa.Column("room_id", sa.String(40), nullable=False),
        sa.Column("start_date", sa.Date, nullable=False),
        sa.Column("end_date", sa.Date, nullable=False),
        sa.Column("reason", sa.String(500), nullable=False),
        sa.ForeignKeyConstraint(
            ["tenant_id", "room_id"], ["physical_rooms.tenant_id", "physical_rooms.id"]
        ),
        sa.CheckConstraint("end_date > start_date", name="valid_dates"),
    )
    op.create_table(
        "room_type_availability",
        *base_columns("room_type_availability"),
        sa.Column("room_type_id", sa.String(40), nullable=False),
        sa.Column("date", sa.Date, nullable=False),
        sa.Column("total_rooms", sa.Integer, nullable=False),
        sa.Column("booked_rooms", sa.Integer, nullable=False),
        type_fk(),
        sa.UniqueConstraint(
            "tenant_id", "room_type_id", "date", name="uq_room_type_availability_tenant_type_date"
        ),
        sa.CheckConstraint(
            "total_rooms >= 0 AND booked_rooms >= 0 AND booked_rooms <= total_rooms",
            name="valid_inventory",
        ),
    )
    for table in [
        "room_types",
        "physical_rooms",
        "masters",
        "daily_rates",
        "room_blocks",
        "room_type_availability",
    ]:
        op.create_index(f"ix_{table}_tenant_id", table, ["tenant_id"])
        protect_table(table)
    op.create_index(
        "ix_room_blocks_room_dates",
        "room_blocks",
        ["tenant_id", "room_id", "start_date", "end_date"],
    )


def downgrade():
    for table in [
        "room_type_availability",
        "room_blocks",
        "daily_rates",
        "masters",
        "physical_rooms",
        "room_types",
    ]:
        op.drop_table(table)
