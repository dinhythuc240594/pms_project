"""POS snapshots and cash documents extend the immutable shared ledger."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from pms_api.rls import protect_table, unprotect_table

revision = "0005_finance"
down_revision = "0004_booking"
branch_labels = None
depends_on = None

TABLES = ("pos_invoices", "pos_invoice_items", "pos_payments", "pos_refunds", "cash_documents")
LEDGER_REFS = (
    ("pos_invoice_id", "pos_invoices"),
    ("pos_payment_id", "pos_payments"),
    ("pos_refund_id", "pos_refunds"),
    ("cash_document_id", "cash_documents"),
    ("reversal_of_id", "ledger_entries"),
)
AMOUNT_SIGN = (
    "(kind IN ('payment','pos_payment','receipt','transfer_in') AND amount > 0) "
    "OR (kind IN ('refund','pos_refund','expense','withdrawal','transfer_out') AND amount < 0) "
    "OR (kind = 'opening' AND amount >= 0) OR (kind = 'reversal' AND amount != 0)"
)


def ref(column, table):
    return sa.ForeignKeyConstraint(["tenant_id", column], [f"{table}.tenant_id", f"{table}.id"])


def scoped(name, *columns):
    op.create_table(
        name,
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("tenant_id", sa.String(40), sa.ForeignKey("tenants.id"), nullable=False),
        *columns,
        sa.UniqueConstraint("tenant_id", "id"),
    )
    protect_table(name)


def actor():
    return sa.Column("user_id", sa.String(40), sa.ForeignKey("users.id"), nullable=False)


def created():
    return sa.Column("created_at", sa.DateTime(timezone=True), nullable=False)


def money(name="amount"):
    return sa.Column(name, sa.Numeric(19, 4), nullable=False)


def upgrade():
    scoped(
        "pos_invoices",
        sa.Column("customer_name", sa.String(160), nullable=False),
        sa.Column("note", sa.String(500), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        money("total"),
        sa.Column("draft_items", JSONB(), nullable=False),
        sa.Column("reservation_id", sa.String(40)),
        actor(),
        created(),
        sa.Column("posted_at", sa.DateTime(timezone=True)),
        sa.Column("cancelled_at", sa.DateTime(timezone=True)),
        sa.Column("cancellation_reason", sa.String(500), nullable=False),
        ref("reservation_id", "reservations"),
        sa.CheckConstraint("status IN ('DRAFT','POSTED','CANCELLED')", name="status"),
        sa.CheckConstraint("total >= 0", name="nonnegative_total"),
    )
    scoped(
        "pos_invoice_items",
        sa.Column("invoice_id", sa.String(40), nullable=False),
        sa.Column("service_id", sa.String(40), nullable=False),
        sa.Column("charge_id", sa.String(40)),
        sa.Column("description", sa.String(240), nullable=False),
        sa.Column("quantity", sa.Numeric(12, 4), nullable=False),
        money("unit_price"),
        money(),
        ref("invoice_id", "pos_invoices"),
        ref("service_id", "masters"),
        ref("charge_id", "charges"),
        sa.UniqueConstraint("tenant_id", "charge_id", name="uq_pos_invoice_items_charge"),
        sa.CheckConstraint("quantity > 0 AND unit_price >= 0 AND amount >= 0", name="values"),
    )
    scoped(
        "pos_payments",
        sa.Column("invoice_id", sa.String(40), nullable=False),
        sa.Column("method_id", sa.String(40), nullable=False),
        sa.Column("fund_id", sa.String(40), nullable=False),
        sa.Column("method_name", sa.String(160), nullable=False),
        sa.Column("fund_name", sa.String(160), nullable=False),
        money(),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("note", sa.String(500), nullable=False),
        actor(),
        created(),
        ref("invoice_id", "pos_invoices"),
        ref("method_id", "masters"),
        ref("fund_id", "masters"),
        sa.CheckConstraint("amount > 0", name="positive_amount"),
    )
    scoped(
        "pos_refunds",
        sa.Column("invoice_id", sa.String(40), nullable=False),
        sa.Column("payment_id", sa.String(40), nullable=False),
        money(),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("reason", sa.String(500), nullable=False),
        actor(),
        created(),
        ref("invoice_id", "pos_invoices"),
        ref("payment_id", "pos_payments"),
        sa.CheckConstraint("amount > 0", name="positive_amount"),
    )
    scoped(
        "cash_documents",
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("fund_id", sa.String(40), nullable=False),
        sa.Column("to_fund_id", sa.String(40)),
        sa.Column("fund_name", sa.String(160), nullable=False),
        sa.Column("to_fund_name", sa.String(160)),
        money(),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("description", sa.String(500), nullable=False),
        sa.Column("effective_date", sa.Date(), nullable=False),
        sa.Column("reversal_of_id", sa.String(40)),
        actor(),
        created(),
        ref("fund_id", "masters"),
        ref("to_fund_id", "masters"),
        ref("reversal_of_id", "cash_documents"),
        sa.UniqueConstraint("tenant_id", "reversal_of_id", name="uq_cash_documents_reversal"),
        sa.CheckConstraint(
            "kind IN ('receipt','expense','withdrawal','transfer','opening','reversal')",
            name="kind",
        ),
        sa.CheckConstraint("amount >= 0 AND (amount > 0 OR kind = 'opening')", name="amount"),
        sa.CheckConstraint(
            "(kind = 'transfer' AND to_fund_id IS NOT NULL AND to_fund_id != fund_id) "
            "OR kind != 'transfer'",
            name="transfer_funds",
        ),
    )
    op.create_index(
        "uq_cash_documents_opening",
        "cash_documents",
        ["tenant_id", "fund_id", "currency"],
        unique=True,
        postgresql_where=sa.text("kind = 'opening'"),
    )
    op.alter_column("ledger_entries", "reservation_id", existing_type=sa.String(40), nullable=True)
    op.alter_column("ledger_entries", "payment_id", existing_type=sa.String(40), nullable=True)
    for column, table in LEDGER_REFS:
        op.add_column("ledger_entries", sa.Column(column, sa.String(40)))
        op.create_foreign_key(
            f"fk_ledger_entries_tenant_id_{column}_{table}",
            "ledger_entries",
            table,
            ["tenant_id", column],
            ["tenant_id", "id"],
        )
    op.add_column("ledger_entries", sa.Column("booked_at", sa.Date()))
    for column, name in [
        ("reversal_of_id", "reversal"),
        ("pos_payment_id", "pos_payment"),
        ("pos_refund_id", "pos_refund"),
    ]:
        op.create_unique_constraint(
            f"uq_ledger_entries_{name}", "ledger_entries", ["tenant_id", column]
        )
    op.drop_constraint(op.f("ck_ledger_entries_amount_sign"), "ledger_entries", type_="check")
    op.create_check_constraint(op.f("ck_ledger_entries_amount_sign"), "ledger_entries", AMOUNT_SIGN)
    for name in TABLES[1:]:
        op.execute(
            f"CREATE TRIGGER {name}_append_only BEFORE UPDATE OR DELETE ON {name} "
            "FOR EACH ROW EXECUTE FUNCTION pms_reject_record_change()"
        )
    op.execute("""CREATE FUNCTION pms_protect_posted_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'Invoice deletion is forbidden' USING ERRCODE='55000';
        END IF;
        IF OLD.status = 'CANCELLED' OR (OLD.status = 'POSTED' AND
           (NEW.status <> 'CANCELLED' OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
            NEW.id IS DISTINCT FROM OLD.id OR NEW.customer_name IS DISTINCT FROM OLD.customer_name OR
            NEW.note IS DISTINCT FROM OLD.note OR NEW.currency IS DISTINCT FROM OLD.currency OR
            NEW.total IS DISTINCT FROM OLD.total OR NEW.draft_items IS DISTINCT FROM OLD.draft_items OR
            NEW.reservation_id IS DISTINCT FROM OLD.reservation_id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR
            NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.posted_at IS DISTINCT FROM OLD.posted_at)) THEN
          RAISE EXCEPTION 'Posted invoice is immutable' USING ERRCODE='55000';
        END IF;
        RETURN NEW;
      END $$""")
    op.execute(
        "CREATE TRIGGER pos_invoices_posted_guard BEFORE UPDATE OR DELETE ON pos_invoices "
        "FOR EACH ROW EXECUTE FUNCTION pms_protect_posted_invoice()"
    )
    op.create_index("ix_pos_invoices_tenant_created", "pos_invoices", ["tenant_id", "created_at"])
    op.create_index(
        "ix_cash_documents_tenant_created", "cash_documents", ["tenant_id", "created_at"]
    )


def downgrade():
    # Refuse to discard posted accounting data. Export/retain it before rolling back this feature.
    op.execute("SELECT set_config('app.is_system','true',true)")
    op.execute("""DO $$ BEGIN IF EXISTS (SELECT 1 FROM ledger_entries WHERE payment_id IS NULL)
        OR EXISTS (SELECT 1 FROM pos_invoices) OR EXISTS (SELECT 1 FROM cash_documents)
        THEN RAISE EXCEPTION 'Finance data exists; downgrade would discard accounting history';
        END IF; END $$""")
    op.drop_constraint(op.f("ck_ledger_entries_amount_sign"), "ledger_entries", type_="check")
    op.create_check_constraint(
        op.f("ck_ledger_entries_amount_sign"),
        "ledger_entries",
        "(kind = 'payment' AND amount > 0) OR (kind = 'refund' AND amount < 0)",
    )
    for column, name in [
        ("reversal_of_id", "reversal"),
        ("pos_payment_id", "pos_payment"),
        ("pos_refund_id", "pos_refund"),
    ]:
        op.drop_constraint(f"uq_ledger_entries_{name}", "ledger_entries", type_="unique")
    for column, table in reversed(LEDGER_REFS):
        op.drop_constraint(
            f"fk_ledger_entries_tenant_id_{column}_{table}", "ledger_entries", type_="foreignkey"
        )
        op.drop_column("ledger_entries", column)
    op.drop_column("ledger_entries", "booked_at")
    op.alter_column("ledger_entries", "reservation_id", existing_type=sa.String(40), nullable=False)
    op.alter_column("ledger_entries", "payment_id", existing_type=sa.String(40), nullable=False)
    for name in reversed(TABLES):
        unprotect_table(name)
        op.drop_table(name)
    op.execute("DROP FUNCTION pms_protect_posted_invoice()")
