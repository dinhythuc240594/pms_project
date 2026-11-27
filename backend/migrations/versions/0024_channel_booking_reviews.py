"""Retain booking exceptions and cancellation watermarks without rewriting receipts."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from pms_api.rls import protect_table, unprotect_table

revision = "0024_channel_booking_reviews"
down_revision = "0023_channel_ari_pacing"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SELECT set_config('app.is_system','true',true)")
    op.alter_column(
        "channel_bookings", "reservation_id", existing_type=sa.String(40), nullable=True
    )
    op.add_column("channel_bookings", sa.Column("latest_revision_id", sa.String(36)))
    op.add_column(
        "channel_bookings",
        sa.Column("latest_status", sa.String(12), server_default="new", nullable=False),
    )
    op.execute("""UPDATE channel_bookings AS cb SET latest_status = 'cancelled'
        FROM reservations AS r WHERE r.tenant_id = cb.tenant_id
        AND r.id = cb.reservation_id AND r.status = 'CANCELLED'""")
    op.create_check_constraint(
        "latest_status", "channel_bookings", "latest_status IN ('new','modified','cancelled')"
    )
    op.create_table(
        "channel_booking_reviews",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("tenant_id", sa.String(40), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("revision_id", sa.String(36), nullable=False),
        sa.Column("booking_id", sa.String(36), nullable=False),
        sa.Column("provider_status", sa.String(12), nullable=False),
        sa.Column("revision_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("error_code", sa.String(80), nullable=False),
        sa.Column("details", JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("tenant_id", "id"),
        sa.UniqueConstraint("tenant_id", "revision_id"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "booking_id"],
            ["channel_bookings.tenant_id", "channel_bookings.booking_id"],
        ),
        sa.CheckConstraint(
            "provider_status IN ('new','modified','cancelled')", name="provider_status"
        ),
    )
    protect_table("channel_booking_reviews")
    op.create_index(
        "ix_channel_booking_reviews_pending",
        "channel_booking_reviews",
        ["tenant_id", "resolved_at", "created_at"],
    )
    op.drop_constraint(op.f("ck_channel_jobs_status"), "channel_jobs", type_="check")
    op.create_check_constraint(
        "status",
        "channel_jobs",
        "status IN ('queued','processing','succeeded','failed','needs_review')",
    )
    op.drop_constraint(op.f("ck_channel_revisions_outcome"), "channel_revisions", type_="check")
    op.create_check_constraint(
        "outcome", "channel_revisions", "outcome IN ('imported','stale','cancelled')"
    )


def downgrade():
    op.execute("SELECT set_config('app.is_system','true',true)")
    op.execute("""DO $$ BEGIN IF EXISTS (SELECT 1 FROM channel_booking_reviews)
        OR EXISTS (SELECT 1 FROM channel_bookings WHERE reservation_id IS NULL)
        OR EXISTS (SELECT 1 FROM channel_revisions WHERE outcome = 'cancelled')
        OR EXISTS (SELECT 1 FROM channel_jobs WHERE status = 'needs_review') THEN
        RAISE EXCEPTION 'Booking reconciliation history exists; downgrade refused';
        END IF; END $$""")
    op.drop_constraint(op.f("ck_channel_revisions_outcome"), "channel_revisions", type_="check")
    op.create_check_constraint("outcome", "channel_revisions", "outcome IN ('imported','stale')")
    op.drop_constraint(op.f("ck_channel_jobs_status"), "channel_jobs", type_="check")
    op.create_check_constraint(
        "status", "channel_jobs", "status IN ('queued','processing','succeeded','failed')"
    )
    unprotect_table("channel_booking_reviews")
    op.drop_table("channel_booking_reviews")
    op.drop_constraint(op.f("ck_channel_bookings_latest_status"), "channel_bookings", type_="check")
    op.drop_column("channel_bookings", "latest_status")
    op.drop_column("channel_bookings", "latest_revision_id")
    op.alter_column(
        "channel_bookings", "reservation_id", existing_type=sa.String(40), nullable=False
    )
