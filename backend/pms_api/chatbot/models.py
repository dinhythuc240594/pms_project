"""Durable request reservations prevent a reconnect from triggering a second paid call."""

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import CheckConstraint, Index, UniqueConstraint

from ..extensions import db


def utcnow():
    return datetime.now(UTC)


class ChatbotRequest(db.Model):
    __tablename__ = "chatbot_requests"
    id = db.Column(db.String(40), primary_key=True, default=lambda: str(uuid4()))
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    user_id = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    intent = db.Column(db.String(100), nullable=False)
    input_hash = db.Column(db.String(64), nullable=False)
    model = db.Column(db.String(120), nullable=False)
    status = db.Column(db.String(20), nullable=False, default="running")
    answer = db.Column(db.Text)
    error_code = db.Column(db.String(50))
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", "intent"),
        Index("ix_chatbot_actor_time", "tenant_id", "user_id", "created_at"),
        CheckConstraint("status IN ('running','completed','failed','unknown')", name="chat_status"),
    )
