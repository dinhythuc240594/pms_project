"""Track mapping publication separately from webhook/feed jobs and support safe pauses."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0018_channel_mapping_lifecycle"
down_revision = "0017_merge_catalog_channels"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("channel_mappings", sa.Column("used_at", sa.DateTime(timezone=True)))
    op.add_column(
        "channel_mappings",
        sa.Column("published_ranges", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
    )
    op.add_column(
        "channel_mappings",
        sa.Column("pause_requested", sa.Boolean, nullable=False, server_default=sa.false()),
    )
    op.drop_constraint(op.f("ck_channel_jobs_kind"), "channel_jobs", type_="check")
    op.create_check_constraint(
        op.f("ck_channel_jobs_kind"),
        "channel_jobs",
        "kind IN ('push_ari','pull_bookings','ack_revision','setup_webhook','pause_mapping')",
    )
    op.execute("SELECT set_config('app.is_system','true',true)")
    # Legacy ARI jobs have no per-mapping footprint; preserve their possible published targets.
    op.execute("""
        UPDATE channel_mappings m SET used_at = CURRENT_TIMESTAMP
        WHERE EXISTS (
            SELECT 1 FROM channel_jobs j WHERE j.tenant_id = m.tenant_id
            AND j.kind = 'push_ari'
            AND (j.status IN ('queued','processing','succeeded') OR j.attempts > 0)
        ) OR EXISTS (
            SELECT 1 FROM channel_bookings b JOIN reservation_rooms r
            ON r.tenant_id = b.tenant_id AND r.reservation_id = b.reservation_id
            WHERE b.tenant_id = m.tenant_id AND r.room_type_id = m.room_type_id
        )
    """)
    op.execute("""
        UPDATE channel_mappings m SET published_ranges = COALESCE((
            SELECT jsonb_agg(DISTINCT windows.value) FROM (
                SELECT jsonb_build_object(
                    'start', j.payload->>'start', 'end', j.payload->>'end'
                ) AS value FROM channel_jobs j WHERE j.tenant_id = m.tenant_id
                AND j.kind = 'push_ari'
                AND j.payload->>'start' ~ '^\\d{4}-\\d{2}-\\d{2}$'
                AND j.payload->>'end' ~ '^\\d{4}-\\d{2}-\\d{2}$'
                UNION ALL
                SELECT jsonb_build_object('start', r.check_in::text, 'end', r.check_out::text)
                FROM channel_bookings b JOIN reservation_rooms r
                ON r.tenant_id = b.tenant_id AND r.reservation_id = b.reservation_id
                WHERE b.tenant_id = m.tenant_id AND r.room_type_id = m.room_type_id
            ) windows
        ), '[]'::jsonb) WHERE m.used_at IS NOT NULL
    """)


def downgrade():
    op.execute("SELECT set_config('app.is_system','true',true)")
    op.execute("""DO $$ BEGIN IF EXISTS (
        SELECT 1 FROM channel_mappings WHERE used_at IS NOT NULL OR pause_requested
    ) OR EXISTS (SELECT 1 FROM channel_jobs WHERE kind = 'pause_mapping') THEN
        RAISE EXCEPTION 'Mapping publication or pause history exists; downgrade refused';
    END IF; END $$""")
    op.drop_constraint(op.f("ck_channel_jobs_kind"), "channel_jobs", type_="check")
    op.create_check_constraint(
        op.f("ck_channel_jobs_kind"),
        "channel_jobs",
        "kind IN ('push_ari','pull_bookings','ack_revision','setup_webhook')",
    )
    op.drop_column("channel_mappings", "pause_requested")
    op.drop_column("channel_mappings", "published_ranges")
    op.drop_column("channel_mappings", "used_at")
