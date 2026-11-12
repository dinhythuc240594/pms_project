"""Normalized stays, guests and append-only financial records."""

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB

from ..core_models import uid, utcnow
from ..extensions import db
from ..pricing.models import MoneySnapshot


class Guest(db.Model):
    __tablename__ = "guests"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    name = db.Column(db.String(160), nullable=False)
    phone = db.Column(db.String(40), nullable=False, default="")
    email = db.Column(db.String(254), nullable=False, default="")
    identity_number = db.Column(db.String(80), nullable=False, default="")
    nationality = db.Column(db.String(80), nullable=False, default="")
    active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (UniqueConstraint("tenant_id", "id"),)


class Reservation(MoneySnapshot, db.Model):
    __tablename__ = "reservations"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    version = db.Column(db.Integer, nullable=False, default=1, server_default="1", server_onupdate=db.FetchedValue())
    __mapper_args__ = {"eager_defaults": True}
    status = db.Column(db.String(20), nullable=False, default="CONFIRMED")
    check_in = db.Column(db.Date, nullable=False)
    check_out = db.Column(db.Date, nullable=False)
    source_id = db.Column(db.String(40))
    source_name = db.Column(db.String(160), nullable=False, default="Direct")
    currency = db.Column(db.String(3), nullable=False)
    pricing_snapshot = db.Column(JSONB, nullable=False)
    guest_name = db.Column(db.String(160), nullable=False)
    guest_phone = db.Column(db.String(40), nullable=False, default="")
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    checked_in_at = db.Column(db.DateTime(timezone=True))
    checked_out_at = db.Column(db.DateTime(timezone=True))
    cancelled_at = db.Column(db.DateTime(timezone=True))
    no_show_at = db.Column(db.DateTime(timezone=True))
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        CheckConstraint("version > 0", name="positive_version"),
        ForeignKeyConstraint(["tenant_id", "source_id"], ["masters.tenant_id", "masters.id"]),
        CheckConstraint("check_out > check_in", name="positive_stay"),
        CheckConstraint(
            "status IN ('CONFIRMED','IN_HOUSE','CHECKED_OUT','CANCELLED','NO_SHOW')", name="status"
        ),
    )


class ReservationRoom(db.Model):
    __tablename__ = "reservation_rooms"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    reservation_id = db.Column(db.String(40), nullable=False)
    room_id = db.Column(db.String(40), nullable=False)
    room_number = db.Column(db.String(40), nullable=False)
    room_type_id = db.Column(db.String(40), nullable=False)
    check_in = db.Column(db.Date, nullable=False)
    check_out = db.Column(db.Date, nullable=False)
    active = db.Column(db.Boolean, nullable=False, default=True)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        UniqueConstraint(
            "tenant_id", "reservation_id", "room_id", name="uq_reservation_rooms_booking_room"
        ),
        ForeignKeyConstraint(
            ["tenant_id", "reservation_id"], ["reservations.tenant_id", "reservations.id"]
        ),
        ForeignKeyConstraint(
            ["tenant_id", "room_id"], ["physical_rooms.tenant_id", "physical_rooms.id"]
        ),
        ForeignKeyConstraint(
            ["tenant_id", "room_type_id"], ["room_types.tenant_id", "room_types.id"]
        ),
        CheckConstraint("check_out > check_in", name="positive_stay"),
    )


class ReservationGuest(db.Model):
    __tablename__ = "reservation_guests"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    reservation_id = db.Column(db.String(40), nullable=False)
    guest_id = db.Column(db.String(40), nullable=False)
    is_primary = db.Column(db.Boolean, nullable=False, default=False)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        UniqueConstraint(
            "tenant_id", "reservation_id", "guest_id", name="uq_reservation_guests_booking_guest"
        ),
        ForeignKeyConstraint(
            ["tenant_id", "reservation_id"], ["reservations.tenant_id", "reservations.id"]
        ),
        ForeignKeyConstraint(["tenant_id", "guest_id"], ["guests.tenant_id", "guests.id"]),
    )


class ReservationNight(MoneySnapshot, db.Model):
    __tablename__ = "reservation_nights"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    reservation_id = db.Column(db.String(40), nullable=False)
    room_id = db.Column(db.String(40), nullable=False)
    room_number = db.Column(db.String(40), nullable=False)
    room_type_id = db.Column(db.String(40), nullable=False)
    date = db.Column(db.Date, nullable=False)
    price = db.Column(db.Numeric(19, 4), nullable=False)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        UniqueConstraint(
            "tenant_id",
            "reservation_id",
            "room_id",
            "date",
            name="uq_reservation_nights_booking_room_date",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "room_type_id"], ["room_types.tenant_id", "room_types.id"]
        ),
        ForeignKeyConstraint(
            ["tenant_id", "reservation_id"], ["reservations.tenant_id", "reservations.id"]
        ),
        ForeignKeyConstraint(
            ["tenant_id", "room_id"], ["physical_rooms.tenant_id", "physical_rooms.id"]
        ),
        CheckConstraint("price >= 0", name="nonnegative_price"),
    )


class Charge(MoneySnapshot, db.Model):
    __tablename__ = "charges"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    reservation_id = db.Column(db.String(40), nullable=False)
    service_id = db.Column(db.String(40))
    description = db.Column(db.String(240), nullable=False)
    kind = db.Column(db.String(20), nullable=False)
    quantity = db.Column(db.Numeric(12, 4), nullable=False)
    unit_price = db.Column(db.Numeric(19, 4), nullable=False)
    amount = db.Column(db.Numeric(19, 4), nullable=False)
    currency = db.Column(db.String(3), nullable=False)
    user_id = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        ForeignKeyConstraint(
            ["tenant_id", "reservation_id"], ["reservations.tenant_id", "reservations.id"]
        ),
        ForeignKeyConstraint(["tenant_id", "service_id"], ["masters.tenant_id", "masters.id"]),
        CheckConstraint("kind IN ('service','fee','tax','discount')", name="kind"),
        CheckConstraint("quantity > 0 AND unit_price >= 0", name="positive_values"),
        CheckConstraint(
            "(kind = 'discount' AND amount <= 0) OR (kind != 'discount' AND amount >= 0)",
            name="amount_sign",
        ),
    )


class Payment(MoneySnapshot, db.Model):
    __tablename__ = "payments"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    reservation_id = db.Column(db.String(40), nullable=False)
    method_id = db.Column(db.String(40), nullable=False)
    fund_id = db.Column(db.String(40), nullable=False)
    method_name = db.Column(db.String(160), nullable=False)
    fund_name = db.Column(db.String(160), nullable=False)
    amount = db.Column(db.Numeric(19, 4), nullable=False)
    currency = db.Column(db.String(3), nullable=False)
    note = db.Column(db.String(500), nullable=False, default="")
    user_id = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        ForeignKeyConstraint(
            ["tenant_id", "reservation_id"], ["reservations.tenant_id", "reservations.id"]
        ),
        ForeignKeyConstraint(["tenant_id", "method_id"], ["masters.tenant_id", "masters.id"]),
        ForeignKeyConstraint(["tenant_id", "fund_id"], ["masters.tenant_id", "masters.id"]),
        CheckConstraint("amount > 0", name="positive_amount"),
    )


class Refund(MoneySnapshot, db.Model):
    __tablename__ = "refunds"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    reservation_id = db.Column(db.String(40), nullable=False)
    payment_id = db.Column(db.String(40), nullable=False)
    amount = db.Column(db.Numeric(19, 4), nullable=False)
    currency = db.Column(db.String(3), nullable=False)
    reason = db.Column(db.String(500), nullable=False)
    user_id = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        ForeignKeyConstraint(
            ["tenant_id", "reservation_id"], ["reservations.tenant_id", "reservations.id"]
        ),
        ForeignKeyConstraint(["tenant_id", "payment_id"], ["payments.tenant_id", "payments.id"]),
        CheckConstraint("amount > 0", name="positive_amount"),
    )


class LedgerEntry(MoneySnapshot, db.Model):
    __tablename__ = "ledger_entries"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    reservation_id = db.Column(db.String(40))
    payment_id = db.Column(db.String(40))
    refund_id = db.Column(db.String(40))
    pos_invoice_id = db.Column(db.String(40))
    pos_payment_id = db.Column(db.String(40))
    pos_refund_id = db.Column(db.String(40))
    cash_document_id = db.Column(db.String(40))
    reversal_of_id = db.Column(db.String(40))
    booked_at = db.Column(db.Date)
    fund_id = db.Column(db.String(40), nullable=False)
    kind = db.Column(db.String(20), nullable=False)
    amount = db.Column(db.Numeric(19, 4), nullable=False)
    currency = db.Column(db.String(3), nullable=False)
    description = db.Column(db.String(500), nullable=False)
    user_id = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        UniqueConstraint("tenant_id", "refund_id", name="uq_ledger_entries_refund"),
        UniqueConstraint("tenant_id", "reversal_of_id", name="uq_ledger_entries_reversal"),
        UniqueConstraint("tenant_id", "pos_payment_id", name="uq_ledger_entries_pos_payment"),
        UniqueConstraint("tenant_id", "pos_refund_id", name="uq_ledger_entries_pos_refund"),
        ForeignKeyConstraint(
            ["tenant_id", "reservation_id"], ["reservations.tenant_id", "reservations.id"]
        ),
        ForeignKeyConstraint(["tenant_id", "payment_id"], ["payments.tenant_id", "payments.id"]),
        ForeignKeyConstraint(["tenant_id", "refund_id"], ["refunds.tenant_id", "refunds.id"]),
        ForeignKeyConstraint(["tenant_id", "fund_id"], ["masters.tenant_id", "masters.id"]),
        ForeignKeyConstraint(
            ["tenant_id", "pos_invoice_id"], ["pos_invoices.tenant_id", "pos_invoices.id"]
        ),
        ForeignKeyConstraint(
            ["tenant_id", "pos_payment_id"], ["pos_payments.tenant_id", "pos_payments.id"]
        ),
        ForeignKeyConstraint(
            ["tenant_id", "pos_refund_id"], ["pos_refunds.tenant_id", "pos_refunds.id"]
        ),
        ForeignKeyConstraint(
            ["tenant_id", "cash_document_id"], ["cash_documents.tenant_id", "cash_documents.id"]
        ),
        ForeignKeyConstraint(
            ["tenant_id", "reversal_of_id"], ["ledger_entries.tenant_id", "ledger_entries.id"]
        ),
        CheckConstraint(
            "(kind IN ('payment','pos_payment','receipt','transfer_in') AND amount > 0) "
            "OR (kind IN ('refund','pos_refund','expense','withdrawal','transfer_out') AND amount < 0) "
            "OR (kind = 'opening' AND amount >= 0) OR (kind = 'reversal' AND amount != 0)",
            name="amount_sign",
        ),
    )


class BookingNote(db.Model):
    __tablename__ = "booking_notes"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    reservation_id = db.Column(db.String(40), nullable=False)
    text = db.Column(db.String(2000), nullable=False)
    user_id = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        ForeignKeyConstraint(
            ["tenant_id", "reservation_id"], ["reservations.tenant_id", "reservations.id"]
        ),
    )


class IdempotencyRecord(db.Model):
    __tablename__ = "idempotency_records"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    key = db.Column(db.String(128), nullable=False)
    fingerprint = db.Column(db.String(64), nullable=False)
    response = db.Column(JSONB, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        UniqueConstraint("tenant_id", "key", name="uq_idempotency_records_key"),
    )
