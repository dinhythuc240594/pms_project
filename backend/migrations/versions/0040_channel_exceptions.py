"""Retain OTA incidents and explicit audited booking review resolutions."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from pms_api.rls import append_only, pms_scope, unprotect_table

revision = "0040_channel_exceptions"
down_revision = "0039_saas_recovery"
branch_labels = None
depends_on = None

SUPPORT = """(tenant_id=nullif(current_setting('app.tenant_id',true),'')
    AND coalesce(current_setting('app.channel_support',true),'')='true'
    AND EXISTS (SELECT 1 FROM users actor
        WHERE actor.id=nullif(current_setting('app.user_id',true),'') AND actor.active
        AND actor.global_role IN ('SUPER_ADMIN','SYSTEM_MANAGER')))"""


def upgrade():
    op.create_table(
        "channel_sync_incidents",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("tenant_id", sa.String(40), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("event_code", sa.String(20), nullable=False),
        sa.Column("channel_id", sa.String(36)),
        sa.Column("channel_event_id", sa.String(36)),
        sa.Column("channel_name", sa.String(160), nullable=False),
        sa.Column("error_type", sa.String(160), nullable=False),
        sa.Column("details", JSONB, nullable=False),
        sa.Column("assignee_id", sa.String(40), sa.ForeignKey("users.id")),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.Column("resolved_by", sa.String(40), sa.ForeignKey("users.id")),
        sa.Column("resolution_note", sa.String(1000), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "id"),
        sa.UniqueConstraint("tenant_id", "fingerprint"),
        sa.CheckConstraint(
            "event_code IN ('sync_error','sync_warning','rate_error')", name="event"
        ),
    )
    op.create_index(
        "ix_channel_sync_incidents_pending",
        "channel_sync_incidents",
        ["tenant_id", "resolved_at", "created_at"],
    )
    op.create_table(
        "channel_review_resolutions",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("tenant_id", sa.String(40), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("review_id", sa.String(40), nullable=False),
        sa.Column("reservation_id", sa.String(40), nullable=False),
        sa.Column("actor_id", sa.String(40), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("reason", sa.String(1000), nullable=False),
        sa.Column("snapshot", JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "id"),
        sa.UniqueConstraint("tenant_id", "review_id"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "review_id"],
            ["channel_booking_reviews.tenant_id", "channel_booking_reviews.id"],
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "reservation_id"], ["reservations.tenant_id", "reservations.id"]
        ),
        sa.CheckConstraint("length(btrim(reason)) > 0", name="reason"),
    )
    op.create_table(
        "channel_action_receipts",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("tenant_id", sa.String(40), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("key", sa.String(128), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("response", JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "id"),
        sa.UniqueConstraint("tenant_id", "key"),
    )
    for table in (
        "channel_sync_incidents",
        "channel_review_resolutions",
        "channel_action_receipts",
    ):
        op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')
        op.execute(f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY')
        scope = pms_scope(table)
        op.execute(f'CREATE POLICY tenant_scope ON "{table}" USING ({scope}) WITH CHECK ({scope})')
    op.execute(
        f"CREATE POLICY channel_support ON channel_sync_incidents USING ({SUPPORT}) WITH CHECK ({SUPPORT})"
    )
    op.execute(
        f"CREATE POLICY channel_support ON channel_action_receipts USING ({SUPPORT}) WITH CHECK ({SUPPORT})"
    )
    append_only("channel_review_resolutions")
    append_only("channel_action_receipts")


def downgrade():
    op.execute("SELECT set_config('app.is_service','true',true)")
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM channel_sync_incidents) OR EXISTS (SELECT 1 FROM channel_review_resolutions)
            OR EXISTS (SELECT 1 FROM channel_action_receipts) THEN
            RAISE EXCEPTION 'OTA exception history exists; downgrade refused';
        END IF;
        END $$""")
    op.execute("DROP POLICY channel_support ON channel_sync_incidents")
    op.execute("DROP POLICY channel_support ON channel_action_receipts")
    for table in (
        "channel_action_receipts",
        "channel_review_resolutions",
        "channel_sync_incidents",
    ):
        unprotect_table(table)
        op.drop_table(table)
