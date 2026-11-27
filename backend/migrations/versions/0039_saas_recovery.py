"""Immutable SaaS refunds and explicit, bounded operational expiry recovery."""

import sqlalchemy as sa
from alembic import op

from pms_api.rls import SYSTEM, TENANT, append_only, pms_scope

revision = "0039_saas_recovery"
down_revision = "0038_commission_review"
branch_labels = None
depends_on = None


def upgrade():
    op.create_unique_constraint(
        "uq_saas_payments_tenant_id_id", "saas_payments", ["tenant_id", "id"]
    )
    op.create_table(
        "saas_refunds",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("tenant_id", sa.String(40), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("invoice_id", sa.String(40), nullable=False),
        sa.Column("payment_id", sa.String(40), nullable=False),
        sa.Column("amount", sa.Numeric(19, 4), nullable=False),
        sa.Column("reason", sa.String(1000), nullable=False),
        sa.Column("user_id", sa.String(40), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["tenant_id", "invoice_id"], ["saas_invoices.tenant_id", "saas_invoices.id"]
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "payment_id"], ["saas_payments.tenant_id", "saas_payments.id"]
        ),
        sa.CheckConstraint("amount > 0 AND amount <= 999999999999999.9999", name="positive_amount"),
        sa.CheckConstraint("length(trim(reason)) > 0", name="reason"),
    )
    op.create_index(
        "ix_saas_refunds_invoice", "saas_refunds", ["tenant_id", "invoice_id", "created_at"]
    )
    op.create_index("ix_saas_refunds_payment", "saas_refunds", ["tenant_id", "payment_id"])
    op.create_table(
        "saas_operational_access",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("tenant_id", sa.String(40), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column(
            "subscription_id", sa.String(40), sa.ForeignKey("subscriptions.id"), nullable=False
        ),
        sa.Column("plan_id", sa.String(40), sa.ForeignKey("plans.id"), nullable=False),
        sa.Column("subscription_end", sa.DateTime(timezone=True)),
        sa.Column("until", sa.DateTime(timezone=True)),
        sa.Column("reason", sa.String(1000), nullable=False),
        sa.Column("user_id", sa.String(40), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("length(trim(reason)) > 0", name="reason"),
        sa.CheckConstraint(
            "until IS NULL OR (until > created_at AND until <= created_at + interval '7 days')",
            name="bounded_access",
        ),
    )
    op.create_index(
        "ix_saas_operational_access_latest",
        "saas_operational_access",
        ["tenant_id", "created_at", "id"],
    )
    for table in ("saas_refunds", "saas_operational_access"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(f"CREATE POLICY system_scope ON {table} USING ({SYSTEM}) WITH CHECK ({SYSTEM})")
        append_only(table)
    op.execute(f"""CREATE POLICY owner_read ON saas_refunds FOR SELECT USING (
        {TENANT} AND EXISTS (SELECT 1 FROM tenant_users m JOIN users u ON u.id=m.user_id
            WHERE m.tenant_id=saas_refunds.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
            AND m.role='HOTEL_OWNER' AND m.active AND u.active))""")
    op.execute(
        f"CREATE POLICY tenant_read ON saas_operational_access FOR SELECT USING ({pms_scope('saas_operational_access')})"
    )
    op.execute("""CREATE FUNCTION pms_saas_refund_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE original numeric; already_refunded numeric;
        BEGIN
            PERFORM 1 FROM saas_invoices WHERE tenant_id=NEW.tenant_id AND id=NEW.invoice_id
                AND voided_at IS NULL FOR UPDATE;
            IF NOT FOUND THEN RAISE EXCEPTION 'Invoice is unavailable' USING ERRCODE='23514'; END IF;
            SELECT amount INTO original FROM saas_payments WHERE tenant_id=NEW.tenant_id
                AND invoice_id=NEW.invoice_id AND id=NEW.payment_id;
            IF NOT FOUND THEN RAISE EXCEPTION 'Payment does not belong to invoice' USING ERRCODE='23514'; END IF;
            SELECT coalesce(sum(amount),0) INTO already_refunded FROM saas_refunds
                WHERE tenant_id=NEW.tenant_id AND payment_id=NEW.payment_id;
            IF NEW.amount + already_refunded > original THEN
                RAISE EXCEPTION 'Refund exceeds payment' USING ERRCODE='23514'; END IF;
            RETURN NEW;
        END $$""")
    op.execute(
        "CREATE TRIGGER saas_refund_balance BEFORE INSERT ON saas_refunds FOR EACH ROW EXECUTE FUNCTION pms_saas_refund_guard()"
    )
    op.execute("""CREATE OR REPLACE FUNCTION pms_saas_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE invoice_total numeric; voided timestamptz; paid numeric; refunded numeric;
        BEGIN
            SELECT amount,voided_at INTO invoice_total,voided FROM saas_invoices
                WHERE tenant_id=NEW.tenant_id AND id=NEW.invoice_id FOR UPDATE;
            IF NOT FOUND OR voided IS NOT NULL THEN
                RAISE EXCEPTION 'Invoice is unavailable or void' USING ERRCODE='23514'; END IF;
            SELECT coalesce(sum(amount),0) INTO paid FROM saas_payments WHERE tenant_id=NEW.tenant_id AND invoice_id=NEW.invoice_id;
            SELECT coalesce(sum(amount),0) INTO refunded FROM saas_refunds WHERE tenant_id=NEW.tenant_id AND invoice_id=NEW.invoice_id;
            IF paid - refunded + NEW.amount > invoice_total THEN
                RAISE EXCEPTION 'Payment exceeds invoice balance' USING ERRCODE='23514'; END IF;
            RETURN NEW;
        END $$""")
    op.execute("""CREATE OR REPLACE FUNCTION pms_saas_invoice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE paid numeric; refunded numeric;
        BEGIN
            IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Invoice history is immutable' USING ERRCODE='42501'; END IF;
            IF ROW(NEW.id,NEW.number,NEW.tenant_id,NEW.description,NEW.amount,NEW.currency,NEW.due_date,NEW.user_id,NEW.created_at)
                IS DISTINCT FROM ROW(OLD.id,OLD.number,OLD.tenant_id,OLD.description,OLD.amount,OLD.currency,OLD.due_date,OLD.user_id,OLD.created_at)
                OR OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL THEN
                RAISE EXCEPTION 'Invoice history is immutable' USING ERRCODE='42501'; END IF;
            SELECT coalesce(sum(amount),0) INTO paid FROM saas_payments WHERE tenant_id=OLD.tenant_id AND invoice_id=OLD.id;
            SELECT coalesce(sum(amount),0) INTO refunded FROM saas_refunds WHERE tenant_id=OLD.tenant_id AND invoice_id=OLD.id;
            IF paid-refunded <> 0 THEN RAISE EXCEPTION 'Paid invoice cannot be voided' USING ERRCODE='23514'; END IF;
            RETURN NEW;
        END $$""")
    op.execute("""CREATE FUNCTION pms_saas_access_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        PERFORM 1 FROM subscriptions WHERE id=NEW.subscription_id AND tenant_id=NEW.tenant_id
            AND plan_id=NEW.plan_id AND end_date IS NOT DISTINCT FROM NEW.subscription_end;
        IF NOT FOUND THEN RAISE EXCEPTION 'Subscription does not belong to hotel' USING ERRCODE='23514'; END IF;
        RETURN NEW; END $$""")
    op.execute(
        "CREATE TRIGGER saas_access_tenant BEFORE INSERT ON saas_operational_access FOR EACH ROW EXECUTE FUNCTION pms_saas_access_guard()"
    )


def downgrade():
    op.execute("SELECT set_config('app.is_system','true',true)")
    op.execute("""DO $$ BEGIN IF EXISTS(SELECT 1 FROM saas_refunds) OR EXISTS(SELECT 1 FROM saas_operational_access) THEN
        RAISE EXCEPTION 'SaaS recovery history exists; downgrade refused'; END IF; END $$""")
    op.drop_table("saas_operational_access")
    op.drop_table("saas_refunds")
    op.execute("DROP FUNCTION pms_saas_refund_guard()")
    op.execute("DROP FUNCTION pms_saas_access_guard()")
    op.drop_constraint("uq_saas_payments_tenant_id_id", "saas_payments", type_="unique")
    op.execute("""CREATE OR REPLACE FUNCTION pms_saas_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE invoice_total numeric; voided timestamptz; paid numeric;
        BEGIN
            SELECT amount,voided_at INTO invoice_total,voided FROM saas_invoices
                WHERE tenant_id=NEW.tenant_id AND id=NEW.invoice_id FOR UPDATE;
            IF NOT FOUND OR voided IS NOT NULL THEN
                RAISE EXCEPTION 'Invoice is unavailable or void' USING ERRCODE='23514'; END IF;
            SELECT coalesce(sum(amount),0) INTO paid FROM saas_payments WHERE tenant_id=NEW.tenant_id AND invoice_id=NEW.invoice_id;
            IF paid + NEW.amount > invoice_total THEN
                RAISE EXCEPTION 'Payment exceeds invoice balance' USING ERRCODE='23514'; END IF;
            RETURN NEW;
        END $$""")
    op.execute("""CREATE OR REPLACE FUNCTION pms_saas_invoice_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Invoice history is immutable' USING ERRCODE='42501'; END IF;
        IF ROW(NEW.id,NEW.number,NEW.tenant_id,NEW.description,NEW.amount,NEW.currency,NEW.due_date,NEW.user_id,NEW.created_at)
            IS DISTINCT FROM ROW(OLD.id,OLD.number,OLD.tenant_id,OLD.description,OLD.amount,OLD.currency,OLD.due_date,OLD.user_id,OLD.created_at)
            OR OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL THEN
            RAISE EXCEPTION 'Invoice history is immutable' USING ERRCODE='42501'; END IF;
        IF EXISTS(SELECT 1 FROM saas_payments WHERE tenant_id=OLD.tenant_id AND invoice_id=OLD.id) THEN
            RAISE EXCEPTION 'Paid invoice cannot be voided' USING ERRCODE='23514'; END IF;
        RETURN NEW; END $$""")
