"""Allow account owners to append their own global profile and session audit events."""

from alembic import op

revision = "0019_self_service_audit"
down_revision = "0018_channel_mapping_lifecycle"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""CREATE POLICY self_service_audit ON audit_logs FOR INSERT WITH CHECK (
      tenant_id IS NULL
      AND user_id = nullif(current_setting('app.user_id', true), '')
      AND entity_type = 'user' AND entity_id = user_id
      AND event IN ('profile.updated', 'sessions.revoked')
    )""")


def downgrade():
    op.execute("DROP POLICY self_service_audit ON audit_logs")
