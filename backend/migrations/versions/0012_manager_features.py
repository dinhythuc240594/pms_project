"""Finite global switches and system-controlled tenant feature grants with forced RLS."""

import sqlalchemy as sa
from alembic import op

from pms_api.rls import SYSTEM, TENANT

revision = "0012_manager_features"
down_revision = "0011_notifications"
branch_labels = None
depends_on = None

KNOWN_CODE = """code IN ('DASHBOARD','ROOM_DIAGRAM','RESERVATION_VIEW','RESERVATION_CREATE',
'TAPE_CHART','ARI_MANAGEMENT','HOUSEKEEPING','POS_SALES','CASHBOOK','REPORTS_BASIC','OTA_SYNC',
'REPORTS_ADVANCED','INVENTORY_WAREHOUSE','MULTI_CURRENCY','VOUCHER_PROMO','API_EXTERNAL')"""


def upgrade():
    op.create_table(
        "feature_controls",
        sa.Column("code", sa.String(40), primary_key=True),
        sa.Column("enabled_global", sa.Boolean, nullable=False),
        sa.CheckConstraint(KNOWN_CODE, name="known_code"),
    )
    op.create_table(
        "tenant_feature_overrides",
        sa.Column("tenant_id", sa.String(40), sa.ForeignKey("tenants.id"), primary_key=True),
        sa.Column("code", sa.String(40), primary_key=True),
        sa.Column("enabled", sa.Boolean, nullable=False),
        sa.Column("is_trial", sa.Boolean, nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("notes", sa.String(1000), nullable=False),
        sa.Column("granted_by", sa.String(40), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(KNOWN_CODE, name="known_code"),
        sa.CheckConstraint(
            "NOT is_trial OR (enabled AND expires_at IS NOT NULL)", name="bounded_trial"
        ),
    )
    for table in ("feature_controls", "tenant_feature_overrides"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute("CREATE POLICY feature_read ON feature_controls FOR SELECT USING (true)")
    super_admin = f"""{SYSTEM} AND EXISTS (SELECT 1 FROM users
        WHERE id=nullif(current_setting('app.user_id',true),'')
        AND active AND global_role='SUPER_ADMIN')"""
    op.execute(
        f"CREATE POLICY feature_admin ON feature_controls USING ({super_admin}) WITH CHECK ({super_admin})"
    )
    op.execute(
        f"CREATE POLICY override_read ON tenant_feature_overrides FOR SELECT USING ({TENANT} OR {SYSTEM})"
    )
    for operation in ("INSERT", "UPDATE", "DELETE"):
        using = f"USING ({SYSTEM})" if operation != "INSERT" else ""
        check = f"WITH CHECK ({SYSTEM})" if operation != "DELETE" else ""
        op.execute(
            f"CREATE POLICY override_{operation.lower()} ON tenant_feature_overrides FOR {operation} {using} {check}"
        )


def downgrade():
    op.execute("SELECT set_config('app.is_system','true',true)")
    for table in ("tenant_feature_overrides", "feature_controls"):
        op.execute(f"""DO $$ BEGIN IF EXISTS (SELECT 1 FROM {table}) THEN
            RAISE EXCEPTION 'Feature controls exist; downgrade refused';
            END IF; END $$""")
    op.drop_table("tenant_feature_overrides")
    op.drop_table("feature_controls")
