"""Identity, memberships and transaction-scoped tenant policies."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from pms_api.rls import SYSTEM, append_only, protect_table

revision = "0002_identity"
down_revision = "0001_backend_baseline"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "users",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("email", sa.String(254), nullable=False, unique=True),
        sa.Column("password_hash", sa.Text, nullable=False),
        sa.Column("global_role", sa.String(30), nullable=False),
        sa.Column("active", sa.Boolean, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "global_role IN ('USER','SUPER_ADMIN','SYSTEM_MANAGER')", name="global_role"
        ),
    )
    op.create_table(
        "tenants",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("settings", JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('active','suspended')", name="status"),
    )
    op.create_table(
        "tenant_users",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("tenant_id", sa.String(40), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("user_id", sa.String(40), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("role", sa.String(30), nullable=False),
        sa.Column("active", sa.Boolean, nullable=False),
        sa.UniqueConstraint("tenant_id", "user_id"),
        sa.CheckConstraint(
            "role IN ('HOTEL_OWNER','FRONT_DESK','HOUSEKEEPING','ACCOUNTANT')", name="tenant_role"
        ),
    )
    op.create_table(
        "auth_sessions",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column("user_id", sa.String(40), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("csrf_token", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])
    op.create_table(
        "login_attempts",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer, nullable=False),
    )
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("tenant_id", sa.String(40), sa.ForeignKey("tenants.id")),
        sa.Column("user_id", sa.String(40), sa.ForeignKey("users.id")),
        sa.Column("event", sa.String(80), nullable=False),
        sa.Column("entity_type", sa.String(60), nullable=False),
        sa.Column("entity_id", sa.String(80), nullable=False),
        sa.Column("details", JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_audit_logs_tenant_id", "audit_logs", ["tenant_id"])
    protect_table("tenant_users")
    op.execute("""CREATE POLICY self_memberships ON tenant_users FOR SELECT
      USING (user_id = nullif(current_setting('app.user_id',true),''))""")
    op.execute("ALTER TABLE tenants ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE tenants FORCE ROW LEVEL SECURITY")
    op.execute(f"""CREATE POLICY tenant_access ON tenants USING (
      {SYSTEM} OR id = nullif(current_setting('app.tenant_id',true),'') OR
      EXISTS (SELECT 1 FROM tenant_users m WHERE m.tenant_id=tenants.id
        AND m.user_id=nullif(current_setting('app.user_id',true),'') AND m.active))
      WITH CHECK ({SYSTEM} OR id = nullif(current_setting('app.tenant_id',true),''))""")
    protect_table("audit_logs")
    append_only("audit_logs")


def downgrade():
    op.execute("DROP POLICY IF EXISTS tenant_access ON tenants")
    for table in (
        "audit_logs",
        "login_attempts",
        "auth_sessions",
        "tenant_users",
        "tenants",
        "users",
    ):
        op.drop_table(table)
    op.execute("DROP FUNCTION IF EXISTS pms_reject_mutation()")
