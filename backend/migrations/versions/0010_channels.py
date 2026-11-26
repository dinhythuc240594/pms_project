"""Tenant channel mappings, durable work and idempotent booking receipts."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from pms_api.rls import append_only, protect_table, unprotect_table

revision = "0010_channels"
down_revision = "0009_pricing"
branch_labels = None
depends_on = None
TABLES = (
    "channel_connections",
    "channel_mappings",
    "channel_jobs",
    "channel_bookings",
    "channel_revisions",
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


def ref(column, target):
    return sa.ForeignKeyConstraint(["tenant_id", column], [f"{target}.tenant_id", f"{target}.id"])


def upgrade():
    scoped(
        "channel_connections",
        sa.Column("environment", sa.String(12), nullable=False),
        sa.Column("property_id", sa.String(36), nullable=False),
        sa.Column("credential_ref", sa.String(120), nullable=False),
        sa.Column("webhook_secret_ref", sa.String(120), nullable=False),
        sa.Column("actor_id", sa.String(40), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("active", sa.Boolean, nullable=False),
        sa.UniqueConstraint("tenant_id"),
        sa.UniqueConstraint("environment", "property_id"),
        sa.CheckConstraint("environment IN ('staging','production')", name="environment"),
    )
    scoped(
        "channel_mappings",
        sa.Column("room_type_id", sa.String(40), nullable=False),
        sa.Column("remote_room_type_id", sa.String(36), nullable=False),
        sa.Column("remote_rate_plan_id", sa.String(36), nullable=False),
        sa.Column("active", sa.Boolean, nullable=False),
        sa.UniqueConstraint("tenant_id", "room_type_id"),
        sa.UniqueConstraint("tenant_id", "remote_room_type_id"),
        sa.UniqueConstraint("tenant_id", "remote_rate_plan_id"),
        ref("room_type_id", "room_types"),
    )
    scoped(
        "channel_jobs",
        sa.Column("actor_id", sa.String(40), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("dedupe_key", sa.String(100)),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("attempts", sa.Integer, nullable=False),
        sa.Column("error_code", sa.String(80)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("available_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("tenant_id", "dedupe_key"),
        sa.CheckConstraint("kind IN ('push_ari','pull_bookings','ack_revision')", name="kind"),
        sa.CheckConstraint("status IN ('queued','processing','succeeded','failed')", name="status"),
        sa.CheckConstraint("attempts >= 0", name="attempts"),
    )
    op.create_index(
        "ix_channel_jobs_ready", "channel_jobs", ["tenant_id", "status", "available_at"]
    )
    scoped(
        "channel_bookings",
        sa.Column("booking_id", sa.String(36), nullable=False),
        sa.Column("reservation_id", sa.String(40), nullable=False),
        sa.Column("latest_revision_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "booking_id"),
        sa.UniqueConstraint("tenant_id", "reservation_id"),
        ref("reservation_id", "reservations"),
    )
    scoped(
        "channel_revisions",
        sa.Column("revision_id", sa.String(36), nullable=False),
        sa.Column("booking_id", sa.String(36), nullable=False),
        sa.Column("reservation_id", sa.String(40)),
        sa.Column("outcome", sa.String(12), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "revision_id"),
        ref("reservation_id", "reservations"),
        sa.CheckConstraint("outcome IN ('imported','stale')", name="outcome"),
    )
    append_only("channel_revisions")


def downgrade():
    op.execute("SELECT set_config('app.is_system','true',true)")
    for table in TABLES:
        op.execute(f"""DO $$ BEGIN IF EXISTS (SELECT 1 FROM {table}) THEN
            RAISE EXCEPTION 'Channel configuration or history exists; downgrade refused';
            END IF; END $$""")
    for table in reversed(TABLES):
        unprotect_table(table)
        op.drop_table(table)
