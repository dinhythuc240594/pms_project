"""System-managed SaaS receivables and immutable manual payment confirmations."""

from sqlalchemy.dialects.postgresql import JSONB

from ..core_models import uid, utcnow
from ..extensions import db


class SaaSInvoice(db.Model):
    __tablename__ = "saas_invoices"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    number = db.Column(db.BigInteger, db.Identity(), nullable=False, unique=True)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    description = db.Column(db.String(500), nullable=False)
    amount = db.Column(db.Numeric(19, 4), nullable=False)
    currency = db.Column(db.String(3), nullable=False)
    due_date = db.Column(db.Date)
    user_id = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    voided_at = db.Column(db.DateTime(timezone=True))
    voided_by = db.Column(db.String(40), db.ForeignKey("users.id"))
    void_reason = db.Column(db.String(1000))
    __table_args__ = (
        db.UniqueConstraint("tenant_id", "id"),
        db.CheckConstraint("amount > 0 AND amount <= 999999999999999.9999", name="positive_amount"),
        db.CheckConstraint("currency IN ('VND','USD')", name="currency"),
        db.CheckConstraint("length(trim(description)) > 0", name="description"),
        db.CheckConstraint(
            "(voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL) OR "
            "(voided_at IS NOT NULL AND voided_by IS NOT NULL AND "
            "void_reason IS NOT NULL AND length(trim(void_reason)) > 0)",
            name="void_details",
        ),
        db.Index("ix_saas_invoices_tenant_created", "tenant_id", "created_at"),
        db.Index("ix_saas_invoices_created", "created_at"),
    )


class SaaSPayment(db.Model):
    __tablename__ = "saas_payments"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    invoice_id = db.Column(db.String(40), nullable=False)
    amount = db.Column(db.Numeric(19, 4), nullable=False)
    method = db.Column(db.String(12), nullable=False)
    reference = db.Column(db.String(160), nullable=False, default="")
    note = db.Column(db.String(1000), nullable=False, default="")
    user_id = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        db.UniqueConstraint("tenant_id", "id"),
        db.ForeignKeyConstraint(
            ["tenant_id", "invoice_id"], ["saas_invoices.tenant_id", "saas_invoices.id"]
        ),
        db.CheckConstraint("amount > 0 AND amount <= 999999999999999.9999", name="positive_amount"),
        db.CheckConstraint("method IN ('bank','cash')", name="method"),
        db.Index("ix_saas_payments_invoice", "tenant_id", "invoice_id"),
        db.Index("ix_saas_payments_created", "created_at"),
    )


class SaaSRefund(db.Model):
    __tablename__ = "saas_refunds"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    invoice_id = db.Column(db.String(40), nullable=False)
    payment_id = db.Column(db.String(40), nullable=False)
    amount = db.Column(db.Numeric(19, 4), nullable=False)
    reason = db.Column(db.String(1000), nullable=False)
    user_id = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        db.ForeignKeyConstraint(
            ["tenant_id", "invoice_id"], ["saas_invoices.tenant_id", "saas_invoices.id"]
        ),
        db.ForeignKeyConstraint(
            ["tenant_id", "payment_id"], ["saas_payments.tenant_id", "saas_payments.id"]
        ),
        db.CheckConstraint("amount > 0 AND amount <= 999999999999999.9999", name="positive_amount"),
        db.CheckConstraint("length(trim(reason)) > 0", name="reason"),
        db.Index("ix_saas_refunds_invoice", "tenant_id", "invoice_id", "created_at"),
        db.Index("ix_saas_refunds_payment", "tenant_id", "payment_id"),
    )


class SaaSOperationalAccess(db.Model):
    __tablename__ = "saas_operational_access"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    subscription_id = db.Column(db.String(40), db.ForeignKey("subscriptions.id"), nullable=False)
    plan_id = db.Column(db.String(40), db.ForeignKey("plans.id"), nullable=False)
    subscription_end = db.Column(db.DateTime(timezone=True))
    until = db.Column(db.DateTime(timezone=True))
    reason = db.Column(db.String(1000), nullable=False)
    user_id = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        db.CheckConstraint("length(trim(reason)) > 0", name="reason"),
        db.CheckConstraint(
            "until IS NULL OR (until > created_at AND until <= created_at + interval '7 days')",
            name="bounded_access",
        ),
        db.Index("ix_saas_operational_access_latest", "tenant_id", "created_at", "id"),
    )


class SaaSIdempotencyRecord(db.Model):
    __tablename__ = "saas_idempotency_records"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    key = db.Column(db.String(128), nullable=False)
    fingerprint = db.Column(db.String(64), nullable=False)
    response = db.Column(JSONB, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (db.UniqueConstraint("tenant_id", "key"),)
