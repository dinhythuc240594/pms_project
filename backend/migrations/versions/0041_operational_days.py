"""Immutable revenue recognition and real closed-day write protection."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from pms_api.rls import append_only, pms_scope

revision = "0041_operational_days"
down_revision = "0040_channel_exceptions"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "night_audits",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("tenant_id", sa.String(40), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("business_date", sa.Date, nullable=False),
        sa.Column("timezone", sa.String(80), nullable=False),
        sa.Column("actor_id", sa.String(40), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("actor_name", sa.String(160), nullable=False),
        sa.Column("reason", sa.String(1000), nullable=False),
        sa.Column("snapshot", JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "id"),
        sa.UniqueConstraint("tenant_id", "business_date"),
    )
    op.create_table(
        "revenue_recognitions",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("tenant_id", sa.String(40), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("audit_id", sa.String(40), nullable=False),
        sa.Column("business_date", sa.Date, nullable=False),
        sa.Column("source_kind", sa.String(16), nullable=False),
        sa.Column("source_id", sa.String(40), nullable=False),
        sa.Column("source_date", sa.Date, nullable=False),
        sa.Column("amount", sa.Numeric(19, 4), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("base_amount", sa.Numeric(19, 4), nullable=False),
        sa.Column("base_currency", sa.String(3), nullable=False),
        sa.Column("details", JSONB, nullable=False),
        sa.UniqueConstraint("tenant_id", "id"),
        sa.UniqueConstraint("tenant_id", "audit_id", "source_kind", "source_id"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "audit_id"], ["night_audits.tenant_id", "night_audits.id"]
        ),
    )
    for table in ("night_audits", "revenue_recognitions"):
        op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')
        op.execute(f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY')
        scope = pms_scope(table)
        op.execute(f'CREATE POLICY tenant_scope ON "{table}" USING ({scope}) WITH CHECK ({scope})')
        append_only(table)
    op.create_index(
        "ix_revenue_recognitions_day",
        "revenue_recognitions",
        ["tenant_id", "business_date", "currency"],
    )
    op.execute("""CREATE FUNCTION pms_guard_closed_day() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE hotel text; closed date; target date; zone text;
    BEGIN
      hotel := CASE WHEN TG_OP='DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
      SELECT coalesce(settings->>'timezone','Asia/Ho_Chi_Minh') INTO zone FROM tenants WHERE id=hotel FOR UPDATE;
      SELECT max(business_date) INTO closed FROM night_audits WHERE tenant_id=hotel;
      IF closed IS NOT NULL THEN
        IF TG_TABLE_NAME='reservation_nights' THEN
          IF TG_OP <> 'INSERT' AND OLD.date <= closed THEN
            RAISE EXCEPTION 'Closed hotel day cannot be rewritten' USING ERRCODE='23514';
          END IF;
          IF TG_OP <> 'DELETE' AND NEW.date <= closed THEN
            RAISE EXCEPTION 'Closed hotel day cannot be rewritten' USING ERRCODE='23514';
          END IF;
        ELSE
          IF TG_TABLE_NAME='ledger_entries' THEN
            target := coalesce(NEW.booked_at,(NEW.created_at AT TIME ZONE zone)::date);
          ELSE
            target := (NEW.created_at AT TIME ZONE zone)::date;
          END IF;
          IF target <= closed THEN
            RAISE EXCEPTION 'Closed hotel day cannot receive backdated money' USING ERRCODE='23514';
          END IF;
        END IF;
      END IF;
      IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END $$""")
    op.execute(
        "CREATE TRIGGER closed_day_guard BEFORE INSERT OR UPDATE OR DELETE ON reservation_nights FOR EACH ROW EXECUTE FUNCTION pms_guard_closed_day()"
    )
    for table in ("ledger_entries", "charges", "payments", "refunds"):
        op.execute(
            f'CREATE TRIGGER closed_day_guard BEFORE INSERT ON "{table}" FOR EACH ROW EXECUTE FUNCTION pms_guard_closed_day()'
        )


def downgrade():
    op.execute("SELECT set_config('app.is_service','true',true)")
    op.execute("""DO $$ BEGIN IF EXISTS(SELECT 1 FROM night_audits) OR EXISTS(SELECT 1 FROM revenue_recognitions) THEN
      RAISE EXCEPTION 'Night audit history exists; downgrade refused'; END IF; END $$""")
    for table in ("reservation_nights", "ledger_entries", "charges", "payments", "refunds"):
        op.execute(f'DROP TRIGGER closed_day_guard ON "{table}"')
    op.execute("DROP FUNCTION pms_guard_closed_day()")
    op.drop_table("revenue_recognitions")
    op.drop_table("night_audits")
