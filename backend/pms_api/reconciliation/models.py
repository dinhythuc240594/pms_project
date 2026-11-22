"""Immutable observations, independent from financial posting and period locks."""

from sqlalchemy import ForeignKeyConstraint, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB

from ..core_models import uid, utcnow
from ..extensions import db


class DayReconciliation(db.Model):
    __tablename__ = "day_reconciliations"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    business_date = db.Column(db.Date, nullable=False)
    timezone = db.Column(db.String(80), nullable=False)
    actor_id = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    actor_name = db.Column(db.String(160), nullable=False)
    note = db.Column(db.String(1000), nullable=False, default="")
    snapshot = db.Column(JSONB, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (UniqueConstraint("tenant_id", "id"),)


class NightAudit(db.Model):
    __tablename__ = "night_audits"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    business_date = db.Column(db.Date, nullable=False)
    timezone = db.Column(db.String(80), nullable=False)
    actor_id = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    actor_name = db.Column(db.String(160), nullable=False)
    reason = db.Column(db.String(1000), nullable=False)
    snapshot = db.Column(JSONB, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (UniqueConstraint("tenant_id", "id"), UniqueConstraint("tenant_id", "business_date"))


class RevenueRecognition(db.Model):
    __tablename__ = "revenue_recognitions"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    audit_id = db.Column(db.String(40), nullable=False)
    business_date = db.Column(db.Date, nullable=False)
    source_kind = db.Column(db.String(16), nullable=False)
    source_id = db.Column(db.String(40), nullable=False)
    source_date = db.Column(db.Date, nullable=False)
    amount = db.Column(db.Numeric(19, 4), nullable=False)
    currency = db.Column(db.String(3), nullable=False)
    base_amount = db.Column(db.Numeric(19, 4), nullable=False)
    base_currency = db.Column(db.String(3), nullable=False)
    details = db.Column(JSONB, nullable=False)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        UniqueConstraint("tenant_id", "audit_id", "source_kind", "source_id"),
        ForeignKeyConstraint(["tenant_id", "audit_id"], ["night_audits.tenant_id", "night_audits.id"]),
    )
