"""Identity is global; hotel memberships and audit records are tenant scoped."""

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy.dialects.postgresql import JSONB

from .extensions import db
from .plan_pricing import default_pricing_rules


def uid():
    return str(uuid4())


def utcnow():
    return datetime.now(UTC)


class User(db.Model):
    __tablename__ = "users"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    name = db.Column(db.String(160), nullable=False)
    email = db.Column(db.String(254), nullable=False, unique=True)
    password_hash = db.Column(db.Text, nullable=False)
    global_role = db.Column(db.String(30), nullable=False, default="USER")
    active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        db.CheckConstraint(
            "global_role IN ('USER','SUPER_ADMIN','SYSTEM_MANAGER')", name="global_role"
        ),
    )


class Tenant(db.Model):
    __tablename__ = "tenants"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    name = db.Column(db.String(160), nullable=False)
    status = db.Column(db.String(20), nullable=False, default="active")
    settings = db.Column(
        JSONB,
        nullable=False,
        default=lambda: {
            "timezone": "Asia/Ho_Chi_Minh",
            "currency": "VND",
            "checkInTime": "14:00",
            "checkOutTime": "12:00",
        },
    )
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (db.CheckConstraint("status IN ('active','suspended')", name="status"),)


class TenantUser(db.Model):
    __tablename__ = "tenant_users"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    user_id = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    role = db.Column(db.String(30), nullable=False)
    active = db.Column(db.Boolean, nullable=False, default=True)
    __table_args__ = (
        db.UniqueConstraint("tenant_id", "user_id"),
        db.CheckConstraint(
            "role IN ('HOTEL_OWNER','FRONT_DESK','HOUSEKEEPING','ACCOUNTANT')", name="tenant_role"
        ),
    )


class AuthSession(db.Model):
    __tablename__ = "auth_sessions"
    token_hash = db.Column(db.String(64), primary_key=True)
    user_id = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False, index=True)
    csrf_token = db.Column(db.String(64), nullable=False)
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)


class LoginAttempt(db.Model):
    __tablename__ = "login_attempts"
    key = db.Column(db.String(64), primary_key=True)
    started_at = db.Column(db.DateTime(timezone=True), nullable=False)
    attempts = db.Column(db.Integer, nullable=False, default=0)


class AuditLog(db.Model):
    __tablename__ = "audit_logs"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=True, index=True)
    user_id = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=True)
    event = db.Column(db.String(80), nullable=False)
    entity_type = db.Column(db.String(60), nullable=False)
    entity_id = db.Column(db.String(80), nullable=False)
    details = db.Column(JSONB, nullable=False, default=dict)
    ip_address = db.Column(db.String(45), nullable=True)
    ip_source = db.Column(db.String(20), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (db.UniqueConstraint("tenant_id", "id"),)


class Plan(db.Model):
    __tablename__ = "plans"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    name = db.Column(db.String(100), nullable=False)
    code = db.Column(db.String(12))
    price = db.Column(db.Numeric(19, 4), nullable=False)
    price_year = db.Column(db.Numeric(19, 4))
    pricing_rules = db.Column(JSONB, nullable=False, default=default_pricing_rules)
    currency = db.Column(db.String(3), nullable=False, default="VND")
    max_rooms = db.Column(db.Integer)
    max_users = db.Column(db.Integer)
    features = db.Column(JSONB, nullable=False, default=dict)
    active = db.Column(db.Boolean, nullable=False, default=True)
    deleted = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)


class Subscription(db.Model):
    __tablename__ = "subscriptions"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False, unique=True)
    plan_id = db.Column(db.String(40), db.ForeignKey("plans.id"), nullable=False)
    status = db.Column(db.String(20), nullable=False, default="active")
    start_date = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    end_date = db.Column(db.DateTime(timezone=True))
    room_count = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        db.CheckConstraint("status IN ('active','expired','cancelled')", name="status"),
        db.CheckConstraint("room_count > 0", name="positive_room_count"),
    )


class SubscriptionHistory(db.Model):
    __tablename__ = "subscription_history"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    plan_id = db.Column(db.String(40), db.ForeignKey("plans.id"), nullable=False)
    action = db.Column(db.String(50), nullable=False)
    plan_name = db.Column(db.String(100))
    plan_code = db.Column(db.String(12))
    previous_plan_id = db.Column(db.String(40), db.ForeignKey("plans.id"))
    cycle = db.Column(db.String(12))
    status = db.Column(db.String(20))
    room_count = db.Column(db.Integer)
    amount = db.Column(db.Numeric(19, 4))
    currency = db.Column(db.String(3))
    effective_date = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    end_date = db.Column(db.DateTime(timezone=True))
    user_id = db.Column(db.String(40), db.ForeignKey("users.id"))
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        db.CheckConstraint("room_count IS NULL OR room_count > 0", name="positive_room_count"),
    )
