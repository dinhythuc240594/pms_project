"""Draft invoice headers; posted lines and cash movements are immutable snapshots."""

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, UniqueConstraint, column
from sqlalchemy.dialects.postgresql import JSONB

from ..core_models import uid, utcnow
from ..currencies import HOTEL_CURRENCIES
from ..extensions import db
from ..pricing.models import MoneySnapshot


class PosInvoice(MoneySnapshot, db.Model):
    __tablename__ = "pos_invoices"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    customer_name = db.Column(db.String(160), nullable=False, default="")
    note = db.Column(db.String(500), nullable=False, default="")
    status = db.Column(db.String(20), nullable=False, default="DRAFT")
    currency = db.Column(db.String(3), nullable=False)
    total = db.Column(db.Numeric(19, 4), nullable=False)
    draft_items = db.Column(JSONB, nullable=False)
    reservation_id = db.Column(db.String(40))
    user_id = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    posted_at = db.Column(db.DateTime(timezone=True))
    cancelled_at = db.Column(db.DateTime(timezone=True))
    cancellation_reason = db.Column(db.String(500), nullable=False, default="")
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        ForeignKeyConstraint(
            ["tenant_id", "reservation_id"], ["reservations.tenant_id", "reservations.id"]
        ),
        CheckConstraint("status IN ('DRAFT','POSTED','CANCELLED')", name="status"),
        CheckConstraint("total >= 0", name="nonnegative_total"),
    )


class PosInvoiceItem(MoneySnapshot, db.Model):
    __tablename__ = "pos_invoice_items"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    invoice_id = db.Column(db.String(40), nullable=False)
    service_id = db.Column(db.String(40), nullable=False)
    charge_id = db.Column(db.String(40))
    description = db.Column(db.String(240), nullable=False)
    quantity = db.Column(db.Numeric(12, 4), nullable=False)
    unit_price = db.Column(db.Numeric(19, 4), nullable=False)
    amount = db.Column(db.Numeric(19, 4), nullable=False)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        UniqueConstraint("tenant_id", "charge_id", name="uq_pos_invoice_items_charge"),
        ForeignKeyConstraint(
            ["tenant_id", "invoice_id"], ["pos_invoices.tenant_id", "pos_invoices.id"]
        ),
        ForeignKeyConstraint(["tenant_id", "service_id"], ["masters.tenant_id", "masters.id"]),
        ForeignKeyConstraint(["tenant_id", "charge_id"], ["charges.tenant_id", "charges.id"]),
        CheckConstraint("quantity > 0 AND unit_price >= 0 AND amount >= 0", name="values"),
    )


class PosPayment(MoneySnapshot, db.Model):
    __tablename__ = "pos_payments"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    invoice_id = db.Column(db.String(40), nullable=False)
    method_id = db.Column(db.String(40), nullable=False)
    fund_id = db.Column(db.String(40), nullable=False)
    method_name = db.Column(db.String(160), nullable=False)
    fund_name = db.Column(db.String(160), nullable=False)
    amount = db.Column(db.Numeric(19, 4), nullable=False)
    currency = db.Column(db.String(3), nullable=False)
    note = db.Column(db.String(500), nullable=False, default="")
    user_id = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        ForeignKeyConstraint(
            ["tenant_id", "invoice_id"], ["pos_invoices.tenant_id", "pos_invoices.id"]
        ),
        ForeignKeyConstraint(["tenant_id", "method_id"], ["masters.tenant_id", "masters.id"]),
        ForeignKeyConstraint(["tenant_id", "fund_id"], ["masters.tenant_id", "masters.id"]),
        CheckConstraint("amount > 0", name="positive_amount"),
    )


class PosRefund(MoneySnapshot, db.Model):
    __tablename__ = "pos_refunds"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    invoice_id = db.Column(db.String(40), nullable=False)
    payment_id = db.Column(db.String(40), nullable=False)
    amount = db.Column(db.Numeric(19, 4), nullable=False)
    currency = db.Column(db.String(3), nullable=False)
    reason = db.Column(db.String(500), nullable=False)
    user_id = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        ForeignKeyConstraint(
            ["tenant_id", "invoice_id"], ["pos_invoices.tenant_id", "pos_invoices.id"]
        ),
        ForeignKeyConstraint(
            ["tenant_id", "payment_id"], ["pos_payments.tenant_id", "pos_payments.id"]
        ),
        CheckConstraint("amount > 0", name="positive_amount"),
    )


class CashDocument(MoneySnapshot, db.Model):
    __tablename__ = "cash_documents"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    kind = db.Column(db.String(20), nullable=False)
    fund_id = db.Column(db.String(40), nullable=False)
    to_fund_id = db.Column(db.String(40))
    fund_name = db.Column(db.String(160), nullable=False)
    to_fund_name = db.Column(db.String(160))
    amount = db.Column(db.Numeric(19, 4), nullable=False)
    currency = db.Column(db.String(3), nullable=False)
    description = db.Column(db.String(500), nullable=False)
    effective_date = db.Column(db.Date, nullable=False)
    category_id = db.Column(db.String(40))
    category_name = db.Column(db.String(160))
    category_type = db.Column(db.String(7))
    reversal_of_id = db.Column(db.String(40))
    user_id = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        UniqueConstraint("tenant_id", "reversal_of_id", name="uq_cash_documents_reversal"),
        ForeignKeyConstraint(["tenant_id", "fund_id"], ["masters.tenant_id", "masters.id"]),
        ForeignKeyConstraint(["tenant_id", "to_fund_id"], ["masters.tenant_id", "masters.id"]),
        ForeignKeyConstraint(["tenant_id", "category_id"], ["masters.tenant_id", "masters.id"]),
        ForeignKeyConstraint(
            ["tenant_id", "reversal_of_id"], ["cash_documents.tenant_id", "cash_documents.id"]
        ),
        CheckConstraint(
            "kind IN ('receipt','expense','withdrawal','transfer','opening','reversal')",
            name="kind",
        ),
        CheckConstraint("amount >= 0 AND (amount > 0 OR kind = 'opening')", name="amount"),
        CheckConstraint(
            "(kind = 'transfer' AND to_fund_id IS NOT NULL AND to_fund_id != fund_id) "
            "OR kind != 'transfer'",
            name="transfer_funds",
        ),
        CheckConstraint(
            "(category_id IS NULL AND category_name IS NULL AND category_type IS NULL) OR "
            "(category_id IS NOT NULL AND category_name IS NOT NULL "
            "AND length(btrim(category_name)) > 0 AND category_type IS NOT NULL AND "
            "((kind = 'receipt' AND category_type = 'INCOME') "
            "OR (kind = 'expense' AND category_type = 'EXPENSE') "
            "OR (kind = 'reversal' AND category_type IN ('INCOME','EXPENSE'))))",
            name="category_snapshot",
        ),
    )


class CommissionSettlement(MoneySnapshot, db.Model):
    __tablename__ = "commission_settlements"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    reservation_id = db.Column(db.String(40), nullable=False)
    source_id = db.Column(db.String(40))
    source_name = db.Column(db.String(160), nullable=False)
    percent = db.Column(db.Numeric(7, 4))
    room_net = db.Column(db.Numeric(19, 4), nullable=False)
    base_room_net = db.Column(db.Numeric(19, 4), nullable=False)
    amount = db.Column(db.Numeric(19, 4), nullable=False)
    currency = db.Column(db.String(3), nullable=False)
    business_date = db.Column(db.Date, nullable=False)
    user_id = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        UniqueConstraint("tenant_id", "reservation_id"),
        ForeignKeyConstraint(["tenant_id", "reservation_id"], ["reservations.tenant_id", "reservations.id"]),
        CheckConstraint("percent BETWEEN 0 AND 100", name="percent"),
        CheckConstraint("room_net >= 0 AND base_room_net >= 0 AND amount >= 0 AND base_amount >= 0", name="nonnegative_amounts"),
        CheckConstraint(
            column("currency").in_(HOTEL_CURRENCIES)
            & column("base_currency").in_(HOTEL_CURRENCIES)
            & (column("exchange_rate") > 0),
            name="currency_snapshot",
        ),
    )


class CommissionPayout(db.Model):
    __tablename__ = "commission_payouts"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    commission_id = db.Column(db.String(40), nullable=False)
    cash_document_id = db.Column(db.String(40), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        UniqueConstraint("tenant_id", "cash_document_id"),
        ForeignKeyConstraint(["tenant_id", "commission_id"], ["commission_settlements.tenant_id", "commission_settlements.id"]),
        ForeignKeyConstraint(["tenant_id", "cash_document_id"], ["cash_documents.tenant_id", "cash_documents.id"]),
    )


class CommissionReview(MoneySnapshot, db.Model):
    __tablename__ = "commission_reviews"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    commission_id = db.Column(db.String(40), nullable=False)
    room_net = db.Column(db.Numeric(19, 4), nullable=False)
    base_room_net = db.Column(db.Numeric(19, 4), nullable=False)
    amount = db.Column(db.Numeric(19, 4), nullable=False)
    evidence = db.Column(JSONB, nullable=False)
    allocations = db.Column(JSONB, nullable=False)
    reason = db.Column(db.String(1000), nullable=False)
    user_id = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        ForeignKeyConstraint(["tenant_id", "commission_id"], ["commission_settlements.tenant_id", "commission_settlements.id"]),
        CheckConstraint("room_net >= 0 AND base_room_net >= 0 AND amount >= 0 AND base_amount >= 0 AND amount <= room_net", name="valid_amounts"),
        CheckConstraint("exchange_rate > 0 AND length(btrim(reason)) > 0", name="review_details"),
        db.Index("ix_commission_reviews_latest", "tenant_id", "commission_id", "created_at", "id"),
    )


class CommissionRecovery(db.Model):
    __tablename__ = "commission_recoveries"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    commission_id = db.Column(db.String(40), nullable=False)
    cash_document_id = db.Column(db.String(40), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        UniqueConstraint("tenant_id", "cash_document_id"),
        ForeignKeyConstraint(["tenant_id", "commission_id"], ["commission_settlements.tenant_id", "commission_settlements.id"]),
        ForeignKeyConstraint(["tenant_id", "cash_document_id"], ["cash_documents.tenant_id", "cash_documents.id"]),
    )
