"""Advanced pricing catalogs and explicit immutable accounting FX snapshots."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from pms_api.rls import append_only, protect_table, unprotect_table

revision = "0009_pricing"
down_revision = "0008_inventory"
branch_labels = None
depends_on = None

TABLES = (
    "pricing_rules",
    "pricing_promotions",
    "pricing_vouchers",
    "voucher_redemptions",
    "exchange_rates",
)
MONEY_TABLES = (
    "reservations",
    "reservation_nights",
    "charges",
    "payments",
    "refunds",
    "ledger_entries",
    "pos_invoices",
    "pos_invoice_items",
    "pos_payments",
    "pos_refunds",
    "cash_documents",
)


def scoped(name, *columns):
    op.create_table(
        name,
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("tenant_id", sa.String(40), sa.ForeignKey("tenants.id"), nullable=False),
        *columns,
        sa.UniqueConstraint("tenant_id", "id"),
    )
    protect_table(name)


def config():
    return sa.Column("config", JSONB(), nullable=False)


def active():
    return sa.Column("active", sa.Boolean(), nullable=False)


def named():
    return sa.Column("name", sa.String(160), nullable=False)


def ref(column, target):
    return sa.ForeignKeyConstraint(["tenant_id", column], [f"{target}.tenant_id", f"{target}.id"])


def upgrade():
    scoped(
        "pricing_rules",
        named(),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("room_type_id", sa.String(40)),
        sa.Column("priority", sa.Integer(), nullable=False),
        config(),
        active(),
        ref("room_type_id", "room_types"),
        sa.CheckConstraint("kind IN ('weekend','los')", name="kind"),
        sa.CheckConstraint("priority BETWEEN 0 AND 1000", name="priority"),
    )
    scoped(
        "pricing_promotions",
        named(),
        sa.Column("kind", sa.String(20), nullable=False),
        config(),
        active(),
        sa.CheckConstraint("kind IN ('earlybird','lastminute','staypay')", name="kind"),
    )
    scoped(
        "pricing_vouchers",
        named(),
        sa.Column("code", sa.String(40), nullable=False),
        sa.Column("discount_type", sa.String(20), nullable=False),
        sa.Column("value", sa.Numeric(19, 4), nullable=False),
        config(),
        sa.Column("usage_limit", sa.Integer()),
        sa.Column("used_count", sa.Integer(), nullable=False),
        active(),
        sa.UniqueConstraint("tenant_id", "code", name="uq_pricing_vouchers_code"),
        sa.CheckConstraint("discount_type IN ('percent','fixed')", name="discount_type"),
        sa.CheckConstraint(
            "value >= 0 AND (discount_type != 'percent' OR value <= 100)", name="value"
        ),
        sa.CheckConstraint(
            "used_count >= 0 AND (usage_limit IS NULL OR usage_limit >= used_count AND usage_limit > 0)",
            name="usage",
        ),
    )
    scoped(
        "voucher_redemptions",
        sa.Column("voucher_id", sa.String(40), nullable=False),
        sa.Column("reservation_id", sa.String(40), nullable=False),
        sa.Column("discount", sa.Numeric(19, 4), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        ref("voucher_id", "pricing_vouchers"),
        ref("reservation_id", "reservations"),
        sa.UniqueConstraint(
            "tenant_id", "reservation_id", name="uq_voucher_redemptions_reservation"
        ),
        sa.CheckConstraint("discount >= 0", name="discount"),
    )
    append_only("voucher_redemptions")
    scoped(
        "exchange_rates",
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("base_currency", sa.String(3), nullable=False),
        sa.Column("rate", sa.Numeric(19, 8), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "currency", name="uq_exchange_rates_currency"),
        sa.CheckConstraint(
            "currency IN ('VND','USD') AND base_currency IN ('VND','USD')", name="currencies"
        ),
        sa.CheckConstraint("rate > 0", name="rate"),
    )

    op.execute("SELECT set_config('app.is_system', 'true', true)")
    for table in MONEY_TABLES:
        op.add_column(table, sa.Column("base_currency", sa.String(3)))
        op.add_column(table, sa.Column("exchange_rate", sa.Numeric(19, 8)))
        op.add_column(table, sa.Column("base_amount", sa.Numeric(19, 4)))
        # Migration owner backfills legacy history once; application triggers stay
        # enabled at runtime and no conversion history is invented for old rows.
        op.execute(f'ALTER TABLE "{table}" DISABLE TRIGGER USER')
        if table == "reservations":
            op.execute(
                "UPDATE reservations r SET base_currency=currency, exchange_rate=1, base_amount=(SELECT coalesce(sum(price),0) FROM reservation_nights n WHERE n.tenant_id=r.tenant_id AND n.reservation_id=r.id)"
            )
        elif table == "reservation_nights":
            op.execute(
                "UPDATE reservation_nights n SET base_currency=r.currency, exchange_rate=1, base_amount=n.price FROM reservations r WHERE n.tenant_id=r.tenant_id AND n.reservation_id=r.id"
            )
        elif table == "pos_invoice_items":
            op.execute(
                "UPDATE pos_invoice_items i SET base_currency=p.currency, exchange_rate=1, base_amount=i.amount FROM pos_invoices p WHERE i.tenant_id=p.tenant_id AND i.invoice_id=p.id"
            )
        else:
            amount = "total" if table == "pos_invoices" else "amount"
            op.execute(
                f'UPDATE "{table}" SET base_currency=currency, exchange_rate=1, base_amount={amount}'
            )
        op.execute(f'ALTER TABLE "{table}" ENABLE TRIGGER USER')
        for column in ("base_currency", "exchange_rate", "base_amount"):
            op.alter_column(table, column, nullable=False)
        op.create_check_constraint(
            op.f(f"ck_{table}_fx_snapshot"),
            table,
            "base_currency IN ('VND','USD') AND exchange_rate > 0",
        )
    op.add_column("reservations", sa.Column("pricing_snapshot", JSONB()))
    op.execute(
        "UPDATE reservations SET pricing_snapshot=jsonb_build_object('version',0,'rules','[]'::jsonb,'discount',NULL)"
    )
    op.alter_column("reservations", "pricing_snapshot", nullable=False)


def downgrade():
    op.execute("SELECT set_config('app.is_system', 'true', true)")
    for table in TABLES:
        op.execute(f"""DO $$ BEGIN IF EXISTS (SELECT 1 FROM {table}) THEN
            RAISE EXCEPTION 'Pricing configuration or voucher history exists; downgrade refused';
            END IF; END $$""")
    op.execute("""DO $$ BEGIN IF EXISTS (
        SELECT 1 FROM reservations WHERE coalesce((pricing_snapshot->>'version')::integer,0) >= 1
    ) THEN RAISE EXCEPTION 'Priced booking history exists; downgrade refused'; END IF; END $$""")
    for table in MONEY_TABLES:
        predicate = "exchange_rate != 1"
        if table not in ("reservation_nights", "pos_invoice_items"):
            predicate += " OR base_currency != currency"
        op.execute(f"""DO $$ BEGIN IF EXISTS (SELECT 1 FROM {table} WHERE {predicate}) THEN
            RAISE EXCEPTION 'Foreign money snapshots exist; downgrade refused';
            END IF; END $$""")
    op.drop_column("reservations", "pricing_snapshot")
    for table in reversed(MONEY_TABLES):
        op.drop_constraint(op.f(f"ck_{table}_fx_snapshot"), table, type_="check")
        for column in ("base_amount", "exchange_rate", "base_currency"):
            op.drop_column(table, column)
    for table in reversed(TABLES):
        unprotect_table(table)
        op.drop_table(table)
