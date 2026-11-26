"""System-only SaaS invoices, immutable payments and private idempotency records."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from pms_api.rls import SYSTEM, append_only, protect_table

revision = "0013_manager_billing"
down_revision = "0012_manager_features"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "saas_invoices",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("number", sa.BigInteger, sa.Identity(), nullable=False, unique=True),
        sa.Column("tenant_id", sa.String(40), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("description", sa.String(500), nullable=False),
        sa.Column("amount", sa.Numeric(19, 4), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("due_date", sa.Date),
        sa.Column("user_id", sa.String(40), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("voided_at", sa.DateTime(timezone=True)),
        sa.Column("voided_by", sa.String(40), sa.ForeignKey("users.id")),
        sa.Column("void_reason", sa.String(1000)),
        sa.UniqueConstraint("tenant_id", "id"),
        sa.CheckConstraint("amount > 0 AND amount <= 999999999999999.9999", name="positive_amount"),
        sa.CheckConstraint("currency IN ('VND','USD')", name="currency"),
        sa.CheckConstraint("length(trim(description)) > 0", name="description"),
        sa.CheckConstraint(
            "(voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL) OR "
            "(voided_at IS NOT NULL AND voided_by IS NOT NULL AND "
            "void_reason IS NOT NULL AND length(trim(void_reason)) > 0)",
            name="void_details",
        ),
    )
    op.create_index("ix_saas_invoices_tenant_created", "saas_invoices", ["tenant_id", "created_at"])
    op.create_index("ix_saas_invoices_created", "saas_invoices", ["created_at"])
    op.create_table(
        "saas_payments",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("tenant_id", sa.String(40), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("invoice_id", sa.String(40), nullable=False),
        sa.Column("amount", sa.Numeric(19, 4), nullable=False),
        sa.Column("method", sa.String(12), nullable=False),
        sa.Column("reference", sa.String(160), nullable=False),
        sa.Column("note", sa.String(1000), nullable=False),
        sa.Column("user_id", sa.String(40), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["tenant_id", "invoice_id"], ["saas_invoices.tenant_id", "saas_invoices.id"]
        ),
        sa.CheckConstraint("amount > 0 AND amount <= 999999999999999.9999", name="positive_amount"),
        sa.CheckConstraint("method IN ('bank','cash')", name="method"),
    )
    op.create_index("ix_saas_payments_invoice", "saas_payments", ["tenant_id", "invoice_id"])
    op.create_index("ix_saas_payments_created", "saas_payments", ["created_at"])
    op.create_table(
        "saas_idempotency_records",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("tenant_id", sa.String(40), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("key", sa.String(128), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("response", JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "key"),
    )
    for table in ("saas_invoices", "saas_payments", "saas_idempotency_records"):
        protect_table(table)
        op.execute(f"DROP POLICY tenant_scope ON {table}")
        op.execute(f"CREATE POLICY system_scope ON {table} USING ({SYSTEM}) WITH CHECK ({SYSTEM})")
    append_only("saas_payments")
    append_only("saas_idempotency_records")
    # SQL writers share the same invoice lock as API payments and void operations.
    op.execute("""CREATE FUNCTION pms_saas_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE invoice_total numeric; voided timestamptz; paid numeric;
        BEGIN
            SELECT amount,voided_at INTO invoice_total,voided FROM saas_invoices
                WHERE tenant_id=NEW.tenant_id AND id=NEW.invoice_id FOR UPDATE;
            IF NOT FOUND OR voided IS NOT NULL THEN
                RAISE EXCEPTION 'Invoice is unavailable or void' USING ERRCODE='23514';
            END IF;
            SELECT coalesce(sum(amount),0) INTO paid FROM saas_payments
                WHERE tenant_id=NEW.tenant_id AND invoice_id=NEW.invoice_id;
            IF paid + NEW.amount > invoice_total THEN
                RAISE EXCEPTION 'Payment exceeds invoice balance' USING ERRCODE='23514';
            END IF;
            RETURN NEW;
        END $$""")
    op.execute("""CREATE TRIGGER saas_payment_balance BEFORE INSERT ON saas_payments
        FOR EACH ROW EXECUTE FUNCTION pms_saas_payment_guard()""")
    op.execute("""CREATE FUNCTION pms_saas_invoice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'Invoice history is immutable' USING ERRCODE='42501';
            END IF;
            IF ROW(NEW.id,NEW.number,NEW.tenant_id,NEW.description,NEW.amount,NEW.currency,
                   NEW.due_date,NEW.user_id,NEW.created_at) IS DISTINCT FROM
               ROW(OLD.id,OLD.number,OLD.tenant_id,OLD.description,OLD.amount,OLD.currency,
                   OLD.due_date,OLD.user_id,OLD.created_at)
               OR OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL THEN
                RAISE EXCEPTION 'Invoice history is immutable' USING ERRCODE='42501';
            END IF;
            IF EXISTS (SELECT 1 FROM saas_payments WHERE tenant_id=OLD.tenant_id AND invoice_id=OLD.id) THEN
                RAISE EXCEPTION 'Paid invoice cannot be voided' USING ERRCODE='23514';
            END IF;
            RETURN NEW;
        END $$""")
    op.execute("""CREATE TRIGGER saas_invoice_immutable BEFORE UPDATE OR DELETE ON saas_invoices
        FOR EACH ROW EXECUTE FUNCTION pms_saas_invoice_guard()""")


def downgrade():
    op.execute("SELECT set_config('app.is_system','true',true)")
    for table in ("saas_invoices", "saas_payments", "saas_idempotency_records"):
        op.execute(f"""DO $$ BEGIN IF EXISTS (SELECT 1 FROM {table}) THEN
            RAISE EXCEPTION 'SaaS billing records exist; downgrade refused';
            END IF; END $$""")
    op.drop_table("saas_idempotency_records")
    op.drop_table("saas_payments")
    op.drop_table("saas_invoices")
    op.execute("DROP FUNCTION pms_saas_payment_guard()")
    op.execute("DROP FUNCTION pms_saas_invoice_guard()")
