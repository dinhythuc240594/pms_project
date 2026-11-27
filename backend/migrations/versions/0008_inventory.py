"""Immutable tenant stock movements and transactional quantity/value projections."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from pms_api.rls import append_only, protect_table, unprotect_table

revision = "0008_inventory"
down_revision = "0007_subscription_controls"
branch_labels = None
depends_on = None
TABLES = (
    "inventory_controls",
    "inventory_documents",
    "stock_balances",
    "stock_movements",
    "service_stock_links",
    "service_stock_ingredients",
)


def scoped(name, *columns):
    op.create_table(
        name,
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("tenant_id", sa.String(40), sa.ForeignKey("tenants.id"), nullable=False),
        *columns,
        sa.UniqueConstraint("tenant_id", "id"),
    )
    protect_table(name)


def ref(column, table="masters"):
    return sa.ForeignKeyConstraint(["tenant_id", column], [f"{table}.tenant_id", f"{table}.id"])


def qty(name="quantity"):
    return sa.Column(name, sa.Numeric(19, 4), nullable=False)


def value():
    return sa.Column("cost_value", sa.Numeric(38, 8), nullable=False)


def upgrade():
    scoped(
        "inventory_controls",
        sa.Column("opening_locked", sa.Boolean(), nullable=False),
        sa.Column("last_date", sa.Date()),
        sa.UniqueConstraint("tenant_id"),
    )
    scoped(
        "inventory_documents",
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("warehouse_id", sa.String(40), nullable=False),
        sa.Column("to_warehouse_id", sa.String(40)),
        sa.Column("warehouse_name", sa.String(160), nullable=False),
        sa.Column("to_warehouse_name", sa.String(160)),
        sa.Column("supplier_id", sa.String(40)),
        sa.Column("supplier_name", sa.String(160)),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("note", sa.String(500), nullable=False),
        sa.Column("input_lines", JSONB(), nullable=False),
        sa.Column("reversal_of_id", sa.String(40)),
        sa.Column("pos_invoice_id", sa.String(40)),
        sa.Column("user_id", sa.String(40), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        ref("warehouse_id"),
        ref("to_warehouse_id"),
        ref("supplier_id"),
        ref("reversal_of_id", "inventory_documents"),
        ref("pos_invoice_id", "pos_invoices"),
        sa.UniqueConstraint("tenant_id", "reversal_of_id", name="uq_inventory_documents_reversal"),
        sa.CheckConstraint(
            "kind IN ('opening','receipt','issue','transfer','count','reversal','pos_issue','pos_return')",
            name="kind",
        ),
        sa.CheckConstraint(
            "kind != 'transfer' OR (to_warehouse_id IS NOT NULL AND to_warehouse_id != warehouse_id)",
            name="transfer",
        ),
    )
    op.create_index(
        "uq_inventory_documents_opening",
        "inventory_documents",
        ["tenant_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'opening'"),
    )
    scoped(
        "stock_balances",
        sa.Column("warehouse_id", sa.String(40), nullable=False),
        sa.Column("item_id", sa.String(40), nullable=False),
        qty(),
        value(),
        sa.Column("version", sa.Integer(), nullable=False),
        ref("warehouse_id"),
        ref("item_id"),
        sa.UniqueConstraint("tenant_id", "warehouse_id", "item_id", name="uq_stock_balances_pair"),
        sa.CheckConstraint(
            "quantity >= 0 AND quantity < 'Infinity'::numeric AND cost_value >= 0 AND cost_value < 'Infinity'::numeric AND version >= 0",
            name="nonnegative",
        ),
        sa.CheckConstraint("quantity != 0 OR cost_value = 0", name="zero_quantity_value"),
    )
    scoped(
        "stock_movements",
        sa.Column("document_id", sa.String(40), nullable=False),
        sa.Column("warehouse_id", sa.String(40), nullable=False),
        sa.Column("warehouse_name", sa.String(160), nullable=False),
        sa.Column("item_id", sa.String(40), nullable=False),
        sa.Column("item_name", sa.String(160), nullable=False),
        sa.Column("sku", sa.String(80), nullable=False),
        sa.Column("unit", sa.String(80), nullable=False),
        qty(),
        qty("unit_cost"),
        value(),
        sa.Column("origin_movement_id", sa.String(40)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        ref("document_id", "inventory_documents"),
        ref("warehouse_id"),
        ref("item_id"),
        ref("origin_movement_id", "stock_movements"),
        sa.CheckConstraint("unit_cost >= 0 AND unit_cost < 'Infinity'::numeric", name="unit_cost"),
        sa.CheckConstraint(
            "(quantity > 0 AND cost_value >= 0) OR (quantity < 0 AND cost_value <= 0)", name="sign"
        ),
    )
    scoped(
        "service_stock_links",
        sa.Column("service_id", sa.String(40), nullable=False),
        sa.Column("warehouse_id", sa.String(40), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        ref("service_id"),
        ref("warehouse_id"),
        sa.UniqueConstraint("tenant_id", "service_id", name="uq_service_stock_links_service"),
    )
    scoped(
        "service_stock_ingredients",
        sa.Column("link_id", sa.String(40), nullable=False),
        sa.Column("item_id", sa.String(40), nullable=False),
        qty(),
        ref("item_id"),
        ref("link_id", "service_stock_links"),
        sa.UniqueConstraint(
            "tenant_id", "link_id", "item_id", name="uq_service_stock_ingredients_item"
        ),
        sa.CheckConstraint(
            "quantity > 0 AND quantity < 'Infinity'::numeric", name="positive_quantity"
        ),
    )
    for table in ("inventory_documents", "stock_movements"):
        append_only(table)
    op.create_index(
        "ix_inventory_documents_tenant_date", "inventory_documents", ["tenant_id", "date"]
    )
    op.create_index(
        "ix_stock_movements_pair", "stock_movements", ["tenant_id", "warehouse_id", "item_id"]
    )
    op.create_index(
        "uq_masters_item_sku",
        "masters",
        ["tenant_id", sa.text("upper(data->>'sku')")],
        unique=True,
        postgresql_where=sa.text("catalog = 'items' AND coalesce(data->>'sku','') <> ''"),
    )
    op.create_index(
        "uq_masters_default_warehouse",
        "masters",
        ["tenant_id"],
        unique=True,
        postgresql_where=sa.text(
            "catalog = 'warehouses' AND active AND data->>'isDefault' = 'true'"
        ),
    )
    op.execute("""CREATE FUNCTION pms_protect_opening_lock() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF OLD.opening_locked AND NOT NEW.opening_locked THEN
      RAISE EXCEPTION 'Opening stock is permanently locked' USING ERRCODE='55000'; END IF; RETURN NEW; END $$""")
    op.execute(
        "CREATE TRIGGER inventory_opening_lock BEFORE UPDATE ON inventory_controls "
        "FOR EACH ROW EXECUTE FUNCTION pms_protect_opening_lock()"
    )


def downgrade():
    op.execute("SELECT set_config('app.is_system','true',true)")
    op.execute("""DO $$ BEGIN IF EXISTS (SELECT 1 FROM inventory_documents) THEN
      RAISE EXCEPTION 'Inventory history exists; downgrade would discard posted stock'; END IF; END $$""")
    for table in reversed(TABLES):
        unprotect_table(table)
        op.drop_table(table)
    op.execute("DROP FUNCTION pms_protect_opening_lock()")
    op.drop_index("uq_masters_default_warehouse", table_name="masters")
    op.drop_index("uq_masters_item_sku", table_name="masters")
