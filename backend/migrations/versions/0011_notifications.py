"""Recipient-scoped transactional notification inbox and role settings."""

import sqlalchemy as sa
from alembic import op

from pms_api.rls import SYSTEM, TENANT, protect_table

revision = "0011_notifications"
down_revision = "0010_channels"
branch_labels = None
depends_on = None


def upgrade():
    op.create_unique_constraint("uq_audit_logs_tenant_id_id", "audit_logs", ["tenant_id", "id"])
    op.create_table(
        "notification_settings",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("tenant_id", sa.String(40), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("event_code", sa.String(40), nullable=False),
        sa.Column("roles", sa.JSON(), nullable=False),
        sa.UniqueConstraint("tenant_id", "event_code"),
    )
    protect_table("notification_settings")
    op.create_table(
        "notifications",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("tenant_id", sa.String(40), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("source_id", sa.String(40), nullable=False),
        sa.Column("recipient_user_id", sa.String(40), nullable=False),
        sa.Column("event_code", sa.String(40), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("body", sa.String(500), nullable=False),
        sa.Column("entity_type", sa.String(60), nullable=False),
        sa.Column("entity_id", sa.String(80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(
            ["tenant_id", "source_id"], ["audit_logs.tenant_id", "audit_logs.id"]
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "recipient_user_id"], ["tenant_users.tenant_id", "tenant_users.user_id"]
        ),
        sa.UniqueConstraint("tenant_id", "source_id", "recipient_user_id"),
    )
    op.create_index(
        "ix_notifications_inbox",
        "notifications",
        ["tenant_id", "recipient_user_id", "created_at", "id"],
    )
    op.execute("ALTER TABLE notifications ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE notifications FORCE ROW LEVEL SECURITY")
    own = f"({TENANT} AND recipient_user_id = nullif(current_setting('app.user_id',true),'')) OR {SYSTEM}"
    op.execute(f"CREATE POLICY own_inbox ON notifications FOR SELECT USING ({own})")
    op.execute(
        f"CREATE POLICY own_read ON notifications FOR UPDATE USING ({own}) WITH CHECK ({own})"
    )
    op.execute(
        f"CREATE POLICY tenant_delivery ON notifications FOR INSERT WITH CHECK ({TENANT} OR {SYSTEM})"
    )


def downgrade():
    op.execute("SELECT set_config('app.is_system','true',true)")
    for table in ("notifications", "notification_settings"):
        op.execute(f"""DO $$ BEGIN IF EXISTS (SELECT 1 FROM {table}) THEN
            RAISE EXCEPTION 'Notification configuration or history exists; downgrade refused';
            END IF; END $$""")
    op.drop_table("notifications")
    op.drop_table("notification_settings")
    op.drop_constraint("uq_audit_logs_tenant_id_id", "audit_logs", type_="unique")
