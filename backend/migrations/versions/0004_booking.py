"""Multiroom stays, guests, nightly snapshots and financial ledger with tenant RLS."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from pms_api.rls import protect_table, unprotect_table

revision = "0004_booking"
down_revision = "0003_catalog"
branch_labels = None
depends_on = None

TABLES = (
    "guests",
    "reservations",
    "reservation_rooms",
    "reservation_guests",
    "reservation_nights",
    "charges",
    "payments",
    "refunds",
    "ledger_entries",
    "booking_notes",
    "idempotency_records",
)


def ref(columns, table, targets=None):
    return sa.ForeignKeyConstraint(
        ["tenant_id", *columns],
        [f"{table}.tenant_id", *[f"{table}.{column}" for column in (targets or columns)]],
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


def created():
    return sa.Column("created_at", sa.DateTime(timezone=True), nullable=False)


def actor():
    return sa.Column("user_id", sa.String(40), sa.ForeignKey("users.id"), nullable=False)


def upgrade():
    # btree_gist is trusted in supported PostgreSQL versions; the database owner can install it.
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")
    scoped(
        "guests",
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("phone", sa.String(40), nullable=False),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("identity_number", sa.String(80), nullable=False),
        sa.Column("nationality", sa.String(80), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        created(),
    )
    scoped(
        "reservations",
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("check_in", sa.Date(), nullable=False),
        sa.Column("check_out", sa.Date(), nullable=False),
        sa.Column("source_id", sa.String(40)),
        sa.Column("source_name", sa.String(160), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("guest_name", sa.String(160), nullable=False),
        sa.Column("guest_phone", sa.String(40), nullable=False),
        created(),
        sa.Column("checked_in_at", sa.DateTime(timezone=True)),
        sa.Column("checked_out_at", sa.DateTime(timezone=True)),
        sa.Column("cancelled_at", sa.DateTime(timezone=True)),
        ref(["source_id"], "masters", ["id"]),
        sa.CheckConstraint("check_out > check_in", name="positive_stay"),
        sa.CheckConstraint(
            "status IN ('CONFIRMED','IN_HOUSE','CHECKED_OUT','CANCELLED')", name="status"
        ),
    )
    scoped(
        "reservation_rooms",
        sa.Column("reservation_id", sa.String(40), nullable=False),
        sa.Column("room_id", sa.String(40), nullable=False),
        sa.Column("room_number", sa.String(40), nullable=False),
        sa.Column("room_type_id", sa.String(40), nullable=False),
        sa.Column("check_in", sa.Date(), nullable=False),
        sa.Column("check_out", sa.Date(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.UniqueConstraint(
            "tenant_id", "reservation_id", "room_id", name="uq_reservation_rooms_booking_room"
        ),
        ref(["reservation_id"], "reservations", ["id"]),
        ref(["room_id"], "physical_rooms", ["id"]),
        ref(["room_type_id"], "room_types", ["id"]),
        sa.CheckConstraint("check_out > check_in", name="positive_stay"),
    )
    op.execute("""ALTER TABLE reservation_rooms ADD CONSTRAINT reservation_rooms_no_overlap
        EXCLUDE USING gist (tenant_id WITH =, room_id WITH =,
        daterange(check_in, check_out, '[)') WITH &&) WHERE (active)""")
    scoped(
        "reservation_guests",
        sa.Column("reservation_id", sa.String(40), nullable=False),
        sa.Column("guest_id", sa.String(40), nullable=False),
        sa.Column("is_primary", sa.Boolean(), nullable=False),
        sa.UniqueConstraint(
            "tenant_id", "reservation_id", "guest_id", name="uq_reservation_guests_booking_guest"
        ),
        ref(["reservation_id"], "reservations", ["id"]),
        ref(["guest_id"], "guests", ["id"]),
    )
    scoped(
        "reservation_nights",
        sa.Column("reservation_id", sa.String(40), nullable=False),
        sa.Column("room_id", sa.String(40), nullable=False),
        sa.Column("room_number", sa.String(40), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("price", sa.Numeric(19, 4), nullable=False),
        sa.UniqueConstraint(
            "tenant_id",
            "reservation_id",
            "room_id",
            "date",
            name="uq_reservation_nights_booking_room_date",
        ),
        ref(["reservation_id"], "reservations", ["id"]),
        ref(["room_id"], "physical_rooms", ["id"]),
        sa.CheckConstraint("price >= 0", name="nonnegative_price"),
    )
    scoped(
        "charges",
        sa.Column("reservation_id", sa.String(40), nullable=False),
        sa.Column("service_id", sa.String(40)),
        sa.Column("description", sa.String(240), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("quantity", sa.Numeric(12, 4), nullable=False),
        sa.Column("unit_price", sa.Numeric(19, 4), nullable=False),
        sa.Column("amount", sa.Numeric(19, 4), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        actor(),
        created(),
        ref(["reservation_id"], "reservations", ["id"]),
        ref(["service_id"], "masters", ["id"]),
        sa.CheckConstraint("kind IN ('service','fee','tax','discount')", name="kind"),
        sa.CheckConstraint("quantity > 0 AND unit_price >= 0", name="positive_values"),
        sa.CheckConstraint(
            "(kind = 'discount' AND amount <= 0) OR (kind != 'discount' AND amount >= 0)",
            name="amount_sign",
        ),
    )
    scoped(
        "payments",
        sa.Column("reservation_id", sa.String(40), nullable=False),
        sa.Column("method_id", sa.String(40), nullable=False),
        sa.Column("fund_id", sa.String(40), nullable=False),
        sa.Column("method_name", sa.String(160), nullable=False),
        sa.Column("fund_name", sa.String(160), nullable=False),
        sa.Column("amount", sa.Numeric(19, 4), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("note", sa.String(500), nullable=False),
        actor(),
        created(),
        ref(["reservation_id"], "reservations", ["id"]),
        ref(["method_id"], "masters", ["id"]),
        ref(["fund_id"], "masters", ["id"]),
        sa.CheckConstraint("amount > 0", name="positive_amount"),
    )
    scoped(
        "refunds",
        sa.Column("reservation_id", sa.String(40), nullable=False),
        sa.Column("payment_id", sa.String(40), nullable=False),
        sa.Column("amount", sa.Numeric(19, 4), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("reason", sa.String(500), nullable=False),
        actor(),
        created(),
        ref(["reservation_id"], "reservations", ["id"]),
        ref(["payment_id"], "payments", ["id"]),
        sa.CheckConstraint("amount > 0", name="positive_amount"),
    )
    scoped(
        "ledger_entries",
        sa.Column("reservation_id", sa.String(40), nullable=False),
        sa.Column("payment_id", sa.String(40), nullable=False),
        sa.Column("refund_id", sa.String(40)),
        sa.Column("fund_id", sa.String(40), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("amount", sa.Numeric(19, 4), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("description", sa.String(500), nullable=False),
        actor(),
        created(),
        sa.UniqueConstraint("tenant_id", "refund_id", name="uq_ledger_entries_refund"),
        ref(["reservation_id"], "reservations", ["id"]),
        ref(["payment_id"], "payments", ["id"]),
        ref(["refund_id"], "refunds", ["id"]),
        ref(["fund_id"], "masters", ["id"]),
        sa.CheckConstraint(
            "(kind = 'payment' AND amount > 0) OR (kind = 'refund' AND amount < 0)",
            name="amount_sign",
        ),
    )
    scoped(
        "booking_notes",
        sa.Column("reservation_id", sa.String(40), nullable=False),
        sa.Column("text", sa.String(2000), nullable=False),
        actor(),
        created(),
        ref(["reservation_id"], "reservations", ["id"]),
    )
    scoped(
        "idempotency_records",
        sa.Column("key", sa.String(128), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("response", JSONB(), nullable=False),
        created(),
        sa.UniqueConstraint("tenant_id", "key", name="uq_idempotency_records_key"),
    )
    op.execute("""CREATE FUNCTION pms_reject_record_change() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'This accounting record is append-only' USING ERRCODE = '55000'; END; $$""")
    for name in (
        "charges",
        "payments",
        "refunds",
        "ledger_entries",
        "booking_notes",
        "idempotency_records",
    ):
        op.execute(
            f"CREATE TRIGGER {name}_append_only BEFORE UPDATE OR DELETE ON {name} "
            "FOR EACH ROW EXECUTE FUNCTION pms_reject_record_change()"
        )
    op.create_index(
        "ix_reservations_tenant_dates", "reservations", ["tenant_id", "check_in", "check_out"]
    )
    op.create_index(
        "ix_ledger_entries_tenant_created", "ledger_entries", ["tenant_id", "created_at"]
    )
    op.create_index(
        "ix_booking_notes_reservation", "booking_notes", ["tenant_id", "reservation_id"]
    )


def downgrade():
    for name in reversed(TABLES):
        unprotect_table(name)
        op.drop_table(name)
    op.execute("DROP FUNCTION pms_reject_record_change()")
    # btree_gist may be used by other applications; retain the extension.
