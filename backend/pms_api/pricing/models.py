from sqlalchemy import CheckConstraint, ForeignKeyConstraint, UniqueConstraint, column
from sqlalchemy.dialects.postgresql import JSONB

from ..core_models import uid, utcnow
from ..currencies import HOTEL_CURRENCIES
from ..extensions import db


class MoneySnapshot:
    """Stored accounting conversion; callers must explicitly supply all fields."""

    base_currency = db.Column(db.String(3), nullable=False)
    exchange_rate = db.Column(db.Numeric(19, 8), nullable=False)
    base_amount = db.Column(db.Numeric(19, 4), nullable=False)


class PricingRule(db.Model):
    __tablename__ = "pricing_rules"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    name = db.Column(db.String(160), nullable=False)
    kind = db.Column(db.String(20), nullable=False)
    room_type_id = db.Column(db.String(40))
    priority = db.Column(db.Integer, nullable=False, default=0)
    config = db.Column(JSONB, nullable=False)
    active = db.Column(db.Boolean, nullable=False, default=True)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        ForeignKeyConstraint(
            ["tenant_id", "room_type_id"], ["room_types.tenant_id", "room_types.id"]
        ),
        CheckConstraint("kind IN ('weekend','los')", name="kind"),
        CheckConstraint("priority BETWEEN 0 AND 1000", name="priority"),
    )


class Promotion(db.Model):
    __tablename__ = "pricing_promotions"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    name = db.Column(db.String(160), nullable=False)
    kind = db.Column(db.String(20), nullable=False)
    config = db.Column(JSONB, nullable=False)
    active = db.Column(db.Boolean, nullable=False, default=True)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        CheckConstraint("kind IN ('earlybird','lastminute','staypay')", name="kind"),
    )


class Voucher(db.Model):
    __tablename__ = "pricing_vouchers"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    code = db.Column(db.String(40), nullable=False)
    name = db.Column(db.String(160), nullable=False)
    discount_type = db.Column(db.String(20), nullable=False)
    value = db.Column(db.Numeric(19, 4), nullable=False)
    config = db.Column(JSONB, nullable=False)
    usage_limit = db.Column(db.Integer)
    used_count = db.Column(db.Integer, nullable=False, default=0)
    active = db.Column(db.Boolean, nullable=False, default=True)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        UniqueConstraint("tenant_id", "code", name="uq_pricing_vouchers_code"),
        CheckConstraint("discount_type IN ('percent','fixed')", name="discount_type"),
        CheckConstraint(
            "value >= 0 AND (discount_type != 'percent' OR value <= 100)", name="value"
        ),
        CheckConstraint(
            "used_count >= 0 AND (usage_limit IS NULL OR usage_limit >= used_count AND usage_limit > 0)",
            name="usage",
        ),
    )


class VoucherRedemption(db.Model):
    __tablename__ = "voucher_redemptions"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    voucher_id = db.Column(db.String(40), nullable=False)
    reservation_id = db.Column(db.String(40), nullable=False)
    discount = db.Column(db.Numeric(19, 4), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        UniqueConstraint("tenant_id", "reservation_id", name="uq_voucher_redemptions_reservation"),
        ForeignKeyConstraint(
            ["tenant_id", "voucher_id"], ["pricing_vouchers.tenant_id", "pricing_vouchers.id"]
        ),
        ForeignKeyConstraint(
            ["tenant_id", "reservation_id"], ["reservations.tenant_id", "reservations.id"]
        ),
        CheckConstraint("discount >= 0", name="discount"),
    )


class ExchangeRate(db.Model):
    __tablename__ = "exchange_rates"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    currency = db.Column(db.String(3), nullable=False)
    base_currency = db.Column(db.String(3), nullable=False)
    rate = db.Column(db.Numeric(19, 8), nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        UniqueConstraint("tenant_id", "currency", name="uq_exchange_rates_currency"),
        CheckConstraint(
            column("currency").in_(HOTEL_CURRENCIES)
            & column("base_currency").in_(HOTEL_CURRENCIES),
            name="currencies",
        ),
        CheckConstraint("rate > 0", name="rate"),
    )
