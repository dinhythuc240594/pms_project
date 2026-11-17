"""Immutable stock documents and movements; balances are transactional projections."""

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB

from ..core_models import uid, utcnow
from ..extensions import db


class InventoryControl(db.Model):
    __tablename__ = "inventory_controls"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False, unique=True)
    opening_locked = db.Column(db.Boolean, nullable=False, default=False)
    last_date = db.Column(db.Date)
    __table_args__ = (UniqueConstraint("tenant_id", "id"),)


class InventoryDocument(db.Model):
    __tablename__ = "inventory_documents"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    kind = db.Column(db.String(20), nullable=False)
    date = db.Column(db.Date, nullable=False)
    warehouse_id = db.Column(db.String(40), nullable=False)
    to_warehouse_id = db.Column(db.String(40))
    warehouse_name = db.Column(db.String(160), nullable=False)
    to_warehouse_name = db.Column(db.String(160))
    supplier_id = db.Column(db.String(40))
    supplier_name = db.Column(db.String(160))
    currency = db.Column(db.String(3), nullable=False)
    note = db.Column(db.String(500), nullable=False, default="")
    input_lines = db.Column(JSONB, nullable=False, default=list)
    reversal_of_id = db.Column(db.String(40))
    pos_invoice_id = db.Column(db.String(40))
    user_id = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        UniqueConstraint("tenant_id", "reversal_of_id", name="uq_inventory_documents_reversal"),
        ForeignKeyConstraint(["tenant_id", "warehouse_id"], ["masters.tenant_id", "masters.id"]),
        ForeignKeyConstraint(["tenant_id", "to_warehouse_id"], ["masters.tenant_id", "masters.id"]),
        ForeignKeyConstraint(["tenant_id", "supplier_id"], ["masters.tenant_id", "masters.id"]),
        ForeignKeyConstraint(
            ["tenant_id", "reversal_of_id"],
            ["inventory_documents.tenant_id", "inventory_documents.id"],
        ),
        ForeignKeyConstraint(
            ["tenant_id", "pos_invoice_id"], ["pos_invoices.tenant_id", "pos_invoices.id"]
        ),
        CheckConstraint(
            "kind IN ('opening','receipt','issue','transfer','count','reversal','pos_issue','pos_return')",
            name="kind",
        ),
        CheckConstraint(
            "kind != 'transfer' OR (to_warehouse_id IS NOT NULL AND to_warehouse_id != warehouse_id)",
            name="transfer",
        ),
    )


class StockBalance(db.Model):
    __tablename__ = "stock_balances"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    warehouse_id = db.Column(db.String(40), nullable=False)
    item_id = db.Column(db.String(40), nullable=False)
    quantity = db.Column(db.Numeric(19, 4), nullable=False, default=0)
    cost_value = db.Column(db.Numeric(38, 8), nullable=False, default=0)
    version = db.Column(db.Integer, nullable=False, default=0)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        UniqueConstraint("tenant_id", "warehouse_id", "item_id", name="uq_stock_balances_pair"),
        ForeignKeyConstraint(["tenant_id", "warehouse_id"], ["masters.tenant_id", "masters.id"]),
        ForeignKeyConstraint(["tenant_id", "item_id"], ["masters.tenant_id", "masters.id"]),
        CheckConstraint(
            "quantity >= 0 AND quantity < 'Infinity'::numeric AND cost_value >= 0 AND cost_value < 'Infinity'::numeric AND version >= 0",
            name="nonnegative",
        ),
        CheckConstraint("quantity != 0 OR cost_value = 0", name="zero_quantity_value"),
    )


class StockMovement(db.Model):
    __tablename__ = "stock_movements"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    document_id = db.Column(db.String(40), nullable=False)
    warehouse_id = db.Column(db.String(40), nullable=False)
    warehouse_name = db.Column(db.String(160), nullable=False)
    item_id = db.Column(db.String(40), nullable=False)
    item_name = db.Column(db.String(160), nullable=False)
    sku = db.Column(db.String(80), nullable=False)
    unit = db.Column(db.String(80), nullable=False)
    quantity = db.Column(db.Numeric(19, 4), nullable=False)
    unit_cost = db.Column(db.Numeric(19, 4), nullable=False)
    cost_value = db.Column(db.Numeric(38, 8), nullable=False)
    origin_movement_id = db.Column(db.String(40))
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        ForeignKeyConstraint(
            ["tenant_id", "document_id"],
            ["inventory_documents.tenant_id", "inventory_documents.id"],
        ),
        ForeignKeyConstraint(["tenant_id", "warehouse_id"], ["masters.tenant_id", "masters.id"]),
        ForeignKeyConstraint(["tenant_id", "item_id"], ["masters.tenant_id", "masters.id"]),
        ForeignKeyConstraint(
            ["tenant_id", "origin_movement_id"], ["stock_movements.tenant_id", "stock_movements.id"]
        ),
        CheckConstraint("unit_cost >= 0 AND unit_cost < 'Infinity'::numeric", name="unit_cost"),
        CheckConstraint(
            "(quantity > 0 AND cost_value >= 0) OR (quantity < 0 AND cost_value <= 0)", name="sign"
        ),
    )


class ServiceStockLink(db.Model):
    __tablename__ = "service_stock_links"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    service_id = db.Column(db.String(40), nullable=False)
    warehouse_id = db.Column(db.String(40), nullable=False)
    active = db.Column(db.Boolean, nullable=False, default=True)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        UniqueConstraint("tenant_id", "service_id", name="uq_service_stock_links_service"),
        ForeignKeyConstraint(["tenant_id", "service_id"], ["masters.tenant_id", "masters.id"]),
        ForeignKeyConstraint(["tenant_id", "warehouse_id"], ["masters.tenant_id", "masters.id"]),
    )


class ServiceStockIngredient(db.Model):
    __tablename__ = "service_stock_ingredients"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    link_id = db.Column(db.String(40), nullable=False)
    item_id = db.Column(db.String(40), nullable=False)
    quantity = db.Column(db.Numeric(19, 4), nullable=False)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        UniqueConstraint(
            "tenant_id", "link_id", "item_id", name="uq_service_stock_ingredients_item"
        ),
        ForeignKeyConstraint(
            ["tenant_id", "link_id"], ["service_stock_links.tenant_id", "service_stock_links.id"]
        ),
        ForeignKeyConstraint(["tenant_id", "item_id"], ["masters.tenant_id", "masters.id"]),
        CheckConstraint(
            "quantity > 0 AND quantity < 'Infinity'::numeric", name="positive_quantity"
        ),
    )
