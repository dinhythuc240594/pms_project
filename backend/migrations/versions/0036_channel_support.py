"""Allow scoped OTA support without granting access to the PMS workspace."""

from alembic import op

revision = "0036_channel_support"
down_revision = "0035_owner_saas_billing"
branch_labels = None
depends_on = None

CHANNEL_TABLES = (
    "channel_booking_reviews",
    "channel_bookings",
    "channel_connections",
    "channel_jobs",
    "channel_mappings",
    "channel_revisions",
)
CATALOG_TABLES = ("room_types", "physical_rooms")
SUPPORT = """(tenant_id=nullif(current_setting('app.tenant_id',true),'')
    AND coalesce(current_setting('app.channel_support',true),'')='true'
    AND EXISTS (SELECT 1 FROM users actor
        WHERE actor.id=nullif(current_setting('app.user_id',true),'') AND actor.active
        AND actor.global_role IN ('SUPER_ADMIN','SYSTEM_MANAGER')))"""


def upgrade():
    for table in CHANNEL_TABLES:
        op.execute(
            f'CREATE POLICY channel_support ON "{table}" USING ({SUPPORT}) WITH CHECK ({SUPPORT})'
        )
    for table in CATALOG_TABLES:
        op.execute(f'CREATE POLICY channel_support ON "{table}" FOR SELECT USING ({SUPPORT})')
    audit = f"({SUPPORT} AND (event LIKE 'channel.%' OR event LIKE 'channex.%'))"
    op.execute(f"CREATE POLICY channel_support ON audit_logs USING ({audit}) WITH CHECK ({audit})")


def downgrade():
    for table in (*CHANNEL_TABLES, *CATALOG_TABLES, "audit_logs"):
        op.execute(f'DROP POLICY channel_support ON "{table}"')
