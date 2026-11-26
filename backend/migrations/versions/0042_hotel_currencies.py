"""Expand hotel currencies without rewriting recorded money or exchange rates."""

from alembic import op

revision = "0042_hotel_currencies"
down_revision = "0041_operational_days"
branch_labels = None
depends_on = None

# Keep historical migration behavior independent of future application catalogs.
CURRENCIES = (
    "VND",
    "USD",
    "EUR",
    "GBP",
    "JPY",
    "KRW",
    "CNY",
    "HKD",
    "SGD",
    "THB",
    "AUD",
    "CAD",
    "CHF",
    "NZD",
    "MYR",
    "IDR",
    "PHP",
    "INR",
    "AED",
    "TWD",
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


def allowed(column, codes):
    return column + " IN (" + ",".join("'" + code + "'" for code in codes) + ")"


def replace_constraints(codes):
    for table in MONEY_TABLES:
        name = op.f(f"ck_{table}_fx_snapshot")
        op.drop_constraint(name, table, type_="check")
        op.create_check_constraint(
            name, table, allowed("base_currency", codes) + " AND exchange_rate > 0"
        )
    op.drop_constraint(op.f("ck_exchange_rates_currencies"), "exchange_rates", type_="check")
    op.create_check_constraint(
        op.f("ck_exchange_rates_currencies"),
        "exchange_rates",
        allowed("currency", codes) + " AND " + allowed("base_currency", codes),
    )
    op.drop_constraint(
        op.f("ck_commission_settlements_currency_snapshot"), "commission_settlements", type_="check"
    )
    op.create_check_constraint(
        op.f("ck_commission_settlements_currency_snapshot"),
        "commission_settlements",
        allowed("currency", codes)
        + " AND "
        + allowed("base_currency", codes)
        + " AND exchange_rate > 0",
    )


def upgrade():
    replace_constraints(CURRENCIES)


def downgrade():
    # Read all tenant scopes as the migration role, preserving every money row.
    op.execute("SELECT set_config('app.is_service','true',true)")
    op.execute("SELECT set_config('app.is_system','true',true)")
    checks = [
        "EXISTS (SELECT 1 FROM tenants WHERE settings->>'currency' NOT IN ('VND','USD'))",
        "EXISTS (SELECT 1 FROM masters WHERE catalog='funds' "
        "AND data->>'currency' NOT IN ('VND','USD'))",
    ]
    for table in (
        *MONEY_TABLES,
        "commission_settlements",
        "exchange_rates",
        "revenue_recognitions",
    ):
        predicate = "base_currency NOT IN ('VND','USD')"
        if table not in {"reservation_nights", "pos_invoice_items"}:
            predicate += " OR currency NOT IN ('VND','USD')"
        checks.append(f"EXISTS (SELECT 1 FROM {table} WHERE {predicate})")
    checks.append("EXISTS (SELECT 1 FROM inventory_documents WHERE currency NOT IN ('VND','USD'))")
    op.execute(
        "DO $$ BEGIN IF " + " OR ".join(checks) + " THEN "
        "RAISE EXCEPTION 'Extended hotel currencies exist; downgrade refused'; "
        "END IF; END $$"
    )
    replace_constraints(("VND", "USD"))
