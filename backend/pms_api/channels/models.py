"""Tenant scoped channel settings, durable jobs and minimal revision receipts."""

from sqlalchemy.dialects.postgresql import JSONB

from ..core_models import uid, utcnow
from ..extensions import db


def ref(column, target):
    return db.ForeignKeyConstraint(["tenant_id", column], [f"{target}.tenant_id", f"{target}.id"])


class ChannelConnection(db.Model):
    __tablename__ = "channel_connections"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False, unique=True)
    environment = db.Column(db.String(12), nullable=False)
    property_id = db.Column(db.String(36), nullable=False)
    credential_ref = db.Column(db.String(120), nullable=False)
    webhook_secret_ref = db.Column(db.String(120), nullable=False)
    secrets_ciphertext = db.Column(db.Text)
    verified_at = db.Column(db.DateTime(timezone=True))
    inventory_revision = db.Column(db.String(40), nullable=False, default=uid)
    inventory_reconciled_at = db.Column(db.DateTime(timezone=True))
    ari_available_at = db.Column(db.DateTime(timezone=True))
    pending_ari_start = db.Column(db.Date)
    pending_ari_end = db.Column(db.Date)
    pending_ari_since = db.Column(db.DateTime(timezone=True))
    webhook_id = db.Column(db.String(36))
    actor_id = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    active = db.Column(db.Boolean, nullable=False, default=False)
    __table_args__ = (
        db.UniqueConstraint("tenant_id", "id"),
        db.UniqueConstraint("environment", "property_id"),
        db.CheckConstraint("environment IN ('staging','production')", name="environment"),
        db.CheckConstraint(
            "(pending_ari_start IS NULL AND pending_ari_end IS NULL AND pending_ari_since IS NULL) "
            "OR (pending_ari_start IS NOT NULL AND pending_ari_end IS NOT NULL "
            "AND pending_ari_end > pending_ari_start AND pending_ari_since IS NOT NULL)",
            name="pending_ari_range",
        ),
    )


class ChannelMapping(db.Model):
    __tablename__ = "channel_mappings"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    room_type_id = db.Column(db.String(40), nullable=False)
    remote_room_type_id = db.Column(db.String(36), nullable=False)
    remote_rate_plan_id = db.Column(db.String(36), nullable=False)
    inbound_rate_plan_ids = db.Column(JSONB, nullable=False, default=list, server_default="[]")
    active = db.Column(db.Boolean, nullable=False, default=True)
    used_at = db.Column(db.DateTime(timezone=True))
    published_ranges = db.Column(JSONB, nullable=False, default=list)
    pause_requested = db.Column(db.Boolean, nullable=False, default=False)
    __table_args__ = (
        db.UniqueConstraint("tenant_id", "id"),
        db.UniqueConstraint("tenant_id", "room_type_id"),
        db.UniqueConstraint("tenant_id", "remote_room_type_id"),
        db.UniqueConstraint("tenant_id", "remote_rate_plan_id"),
        ref("room_type_id", "room_types"),
    )


class ChannelJob(db.Model):
    __tablename__ = "channel_jobs"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    actor_id = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    kind = db.Column(db.String(20), nullable=False)
    dedupe_key = db.Column(db.String(100))
    payload = db.Column(JSONB, nullable=False, default=dict)
    status = db.Column(db.String(12), nullable=False, default="queued")
    attempts = db.Column(db.Integer, nullable=False, default=0)
    error_code = db.Column(db.String(80))
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    available_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    completed_at = db.Column(db.DateTime(timezone=True))
    __table_args__ = (
        db.UniqueConstraint("tenant_id", "id"),
        db.UniqueConstraint("tenant_id", "dedupe_key"),
        db.CheckConstraint(
            "kind IN ('push_ari','pull_bookings','ack_revision','setup_webhook','pause_mapping','load_bookings')",
            name="kind",
        ),
        db.CheckConstraint(
            "status IN ('queued','processing','succeeded','failed','needs_review')", name="status"
        ),
        db.CheckConstraint("attempts >= 0", name="attempts"),
        db.Index("ix_channel_jobs_ready", "tenant_id", "status", "available_at"),
        db.Index("ix_channel_jobs_history", "tenant_id", "created_at", "id"),
        db.Index("ix_channel_jobs_revision", "tenant_id", payload["revisionId"].astext),
    )


class ChannelBooking(db.Model):
    __tablename__ = "channel_bookings"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    booking_id = db.Column(db.String(36), nullable=False)
    reservation_id = db.Column(db.String(40))
    latest_revision_at = db.Column(db.DateTime(timezone=True), nullable=False)
    latest_revision_id = db.Column(db.String(36))
    latest_status = db.Column(db.String(12), nullable=False, default="new", server_default="new")
    cancellation_verified_at = db.Column(db.DateTime(timezone=True))
    __table_args__ = (
        db.UniqueConstraint("tenant_id", "id"),
        db.UniqueConstraint("tenant_id", "booking_id"),
        db.UniqueConstraint("tenant_id", "reservation_id"),
        ref("reservation_id", "reservations"),
        db.CheckConstraint("latest_status IN ('new','modified','cancelled')", name="latest_status"),
    )


class ChannelBookingReview(db.Model):
    __tablename__ = "channel_booking_reviews"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    revision_id = db.Column(db.String(36), nullable=False)
    booking_id = db.Column(db.String(36), nullable=False)
    provider_status = db.Column(db.String(12), nullable=False)
    revision_at = db.Column(db.DateTime(timezone=True), nullable=False)
    error_code = db.Column(db.String(80), nullable=False)
    details = db.Column(JSONB, nullable=False, default=dict)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    resolved_at = db.Column(db.DateTime(timezone=True))
    __table_args__ = (
        db.UniqueConstraint("tenant_id", "id"),
        db.UniqueConstraint("tenant_id", "revision_id"),
        db.ForeignKeyConstraint(
            ["tenant_id", "booking_id"],
            ["channel_bookings.tenant_id", "channel_bookings.booking_id"],
        ),
        db.CheckConstraint(
            "provider_status IN ('new','modified','cancelled')", name="provider_status"
        ),
        db.Index("ix_channel_booking_reviews_pending", "tenant_id", "resolved_at", "created_at"),
    )

    @property
    def outcome(self):
        return "needs_review"


class ChannelRevision(db.Model):
    __tablename__ = "channel_revisions"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    revision_id = db.Column(db.String(36), nullable=False)
    booking_id = db.Column(db.String(36), nullable=False)
    reservation_id = db.Column(db.String(40))
    outcome = db.Column(db.String(12), nullable=False)
    money_snapshot = db.Column(JSONB, nullable=False, default=dict, server_default="{}")
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        db.UniqueConstraint("tenant_id", "id"),
        db.UniqueConstraint("tenant_id", "revision_id"),
        ref("reservation_id", "reservations"),
        db.CheckConstraint("outcome IN ('imported','stale','cancelled')", name="outcome"),
    )


class ChannelReviewResolution(db.Model):
    __tablename__ = "channel_review_resolutions"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    review_id = db.Column(db.String(40), nullable=False)
    reservation_id = db.Column(db.String(40), nullable=False)
    actor_id = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    reason = db.Column(db.String(1000), nullable=False)
    snapshot = db.Column(JSONB, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        db.UniqueConstraint("tenant_id", "id"),
        db.UniqueConstraint("tenant_id", "review_id"),
        ref("review_id", "channel_booking_reviews"),
        ref("reservation_id", "reservations"),
        db.CheckConstraint("length(btrim(reason)) > 0", name="reason"),
    )


class ChannelSyncIncident(db.Model):
    __tablename__ = "channel_sync_incidents"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    fingerprint = db.Column(db.String(64), nullable=False)
    event_code = db.Column(db.String(20), nullable=False)
    channel_id = db.Column(db.String(36))
    channel_event_id = db.Column(db.String(36))
    channel_name = db.Column(db.String(160), nullable=False, default="")
    error_type = db.Column(db.String(160), nullable=False, default="")
    details = db.Column(JSONB, nullable=False, default=dict)
    assignee_id = db.Column(db.String(40), db.ForeignKey("users.id"))
    resolved_at = db.Column(db.DateTime(timezone=True))
    resolved_by = db.Column(db.String(40), db.ForeignKey("users.id"))
    resolution_note = db.Column(db.String(1000), nullable=False, default="")
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        db.UniqueConstraint("tenant_id", "id"),
        db.UniqueConstraint("tenant_id", "fingerprint"),
        db.CheckConstraint("event_code IN ('sync_error','sync_warning','rate_error')", name="event"),
        db.Index("ix_channel_sync_incidents_pending", "tenant_id", "resolved_at", "created_at"),
    )


class ChannelActionReceipt(db.Model):
    __tablename__ = "channel_action_receipts"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    key = db.Column(db.String(128), nullable=False)
    fingerprint = db.Column(db.String(64), nullable=False)
    response = db.Column(JSONB, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (db.UniqueConstraint("tenant_id", "id"), db.UniqueConstraint("tenant_id", "key"))
