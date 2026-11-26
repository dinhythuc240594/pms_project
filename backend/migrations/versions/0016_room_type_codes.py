"""Separate room-type business codes from IDs and populate missing unit choices."""

from uuid import uuid4

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, insert

revision = "0016_room_type_codes"
down_revision = "0015_plan_room_limits"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("room_types", sa.Column("code", sa.String(40), nullable=True))
    op.create_unique_constraint("uq_room_types_tenant_code", "room_types", ["tenant_id", "code"])
    op.create_check_constraint(
        "valid_code", "room_types", "code IS NULL OR (code = btrim(code) AND length(code) > 0)"
    )
    op.execute("SELECT set_config('app.is_system','true',true)")
    connection = op.get_bind()
    masters = sa.table(
        "masters",
        sa.column("id", sa.String(40)),
        sa.column("tenant_id", sa.String(40)),
        sa.column("catalog", sa.String(40)),
        sa.column("name", sa.String(160)),
        sa.column("data", JSONB),
        sa.column("active", sa.Boolean),
    )
    existing = {
        (row.tenant_id, row.name.strip().casefold())
        for row in connection.execute(
            sa.select(masters.c.tenant_id, masters.c.name).where(masters.c.catalog == "units")
        )
    }
    values = [
        {
            "id": str(uuid4()),
            "tenant_id": tenant_id,
            "catalog": "units",
            "name": name,
            "data": {},
            "active": True,
        }
        for tenant_id in connection.execute(sa.text("SELECT id FROM tenants")).scalars()
        for name in ("Cái", "Gói", "Chai", "Lon", "Hộp", "Bộ", "Kg", "Lít", "Lần", "Đêm")
        if (tenant_id, name.casefold()) not in existing
    ]
    if values:
        connection.execute(
            insert(masters).on_conflict_do_nothing(constraint="uq_masters_tenant_catalog_name"),
            values,
        )


def downgrade():
    op.execute("SELECT set_config('app.is_system','true',true)")
    op.execute("""DO $$ BEGIN IF EXISTS (SELECT 1 FROM room_types WHERE code IS NOT NULL) THEN
        RAISE EXCEPTION 'Room-type codes exist; downgrade refused'; END IF; END $$""")
    op.drop_constraint("valid_code", "room_types", type_="check")
    op.drop_constraint("uq_room_types_tenant_code", "room_types", type_="unique")
    op.drop_column("room_types", "code")
    # Keep seeded units because services and inventory may already reference them.
