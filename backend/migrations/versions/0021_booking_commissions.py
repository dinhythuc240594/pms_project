"""Retain reconciled room-net commissions and their immutable cash payout links."""

import sqlalchemy as sa
from alembic import op

from pms_api.rls import append_only, protect_table, unprotect_table

revision = "0021_booking_commissions"
down_revision = "0020_no_show"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "commission_settlements",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("tenant_id", sa.String(40), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("reservation_id", sa.String(40), nullable=False),
        sa.Column("source_id", sa.String(40)),
        sa.Column("source_name", sa.String(160), nullable=False),
        sa.Column("percent", sa.Numeric(7, 4), nullable=False),
        sa.Column("room_net", sa.Numeric(19, 4), nullable=False),
        sa.Column("base_room_net", sa.Numeric(19, 4), nullable=False),
        sa.Column("amount", sa.Numeric(19, 4), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("base_amount", sa.Numeric(19, 4), nullable=False),
        sa.Column("base_currency", sa.String(3), nullable=False),
        sa.Column("exchange_rate", sa.Numeric(19, 8), nullable=False),
        sa.Column("business_date", sa.Date, nullable=False),
        sa.Column("user_id", sa.String(40), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "id"),
        sa.UniqueConstraint("tenant_id", "reservation_id"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "reservation_id"], ["reservations.tenant_id", "reservations.id"]
        ),
        sa.CheckConstraint("percent BETWEEN 0 AND 100", name="percent"),
        sa.CheckConstraint(
            "room_net >= 0 AND base_room_net >= 0 AND amount >= 0 AND base_amount >= 0",
            name="nonnegative_amounts",
        ),
        sa.CheckConstraint(
            "currency IN ('VND','USD') AND base_currency IN ('VND','USD') AND exchange_rate > 0",
            name="currency_snapshot",
        ),
    )
    op.create_table(
        "commission_payouts",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("tenant_id", sa.String(40), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("commission_id", sa.String(40), nullable=False),
        sa.Column("cash_document_id", sa.String(40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "id"),
        sa.UniqueConstraint("tenant_id", "cash_document_id"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "commission_id"],
            ["commission_settlements.tenant_id", "commission_settlements.id"],
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "cash_document_id"], ["cash_documents.tenant_id", "cash_documents.id"]
        ),
    )
    for table in ("commission_settlements", "commission_payouts"):
        protect_table(table)
        append_only(table)


def downgrade():
    op.execute("SELECT set_config('app.is_system','true',true)")
    op.execute("""DO $$ BEGIN IF EXISTS (SELECT 1 FROM commission_settlements) THEN
        RAISE EXCEPTION 'Commission accounting history exists; downgrade refused'; END IF; END $$""")
    for table in ("commission_payouts", "commission_settlements"):
        unprotect_table(table)
        op.drop_table(table)
