"""Notification ORM metadata independent of HTTP handlers."""

from .core_models import uid, utcnow
from .extensions import db


class NotificationSetting(db.Model):
    __tablename__ = "notification_settings"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    event_code = db.Column(db.String(40), nullable=False)
    roles = db.Column(db.JSON, nullable=False)
    __table_args__ = (db.UniqueConstraint("tenant_id", "event_code"),)


class Notification(db.Model):
    __tablename__ = "notifications"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    source_id = db.Column(db.String(40), nullable=False)
    recipient_user_id = db.Column(db.String(40), nullable=False)
    event_code = db.Column(db.String(40), nullable=False)
    title = db.Column(db.String(160), nullable=False)
    body = db.Column(db.String(500), nullable=False)
    entity_type = db.Column(db.String(60), nullable=False)
    entity_id = db.Column(db.String(80), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    read_at = db.Column(db.DateTime(timezone=True))
    __table_args__ = (
        db.ForeignKeyConstraint(
            ["tenant_id", "source_id"], ["audit_logs.tenant_id", "audit_logs.id"]
        ),
        db.ForeignKeyConstraint(
            ["tenant_id", "recipient_user_id"], ["tenant_users.tenant_id", "tenant_users.user_id"]
        ),
        db.UniqueConstraint("tenant_id", "source_id", "recipient_user_id"),
        db.Index("ix_notifications_inbox", "tenant_id", "recipient_user_id", "created_at", "id"),
    )
