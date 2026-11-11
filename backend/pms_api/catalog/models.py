"""Hotel configuration and date-based sellable room inventory."""

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, UniqueConstraint, select
from sqlalchemy.dialects.postgresql import JSONB, insert

from ..core_models import uid
from ..extensions import db


class RoomType(db.Model):
    __tablename__ = "room_types"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False, index=True)
    code = db.Column(db.String(40))
    name = db.Column(db.String(120), nullable=False)
    base_price = db.Column(db.Numeric(19, 4), nullable=False, default=0)
    capacity = db.Column(db.Integer, nullable=False, default=2)
    active = db.Column(db.Boolean, nullable=False, default=True)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_room_types_tenant_id_id"),
        UniqueConstraint("tenant_id", "name", name="uq_room_types_tenant_name"),
        UniqueConstraint("tenant_id", "code", name="uq_room_types_tenant_code"),
        CheckConstraint(
            "code IS NULL OR (code = btrim(code) AND length(code) > 0)", name="valid_code"
        ),
        CheckConstraint("base_price >= 0", name="nonnegative_price"),
        CheckConstraint("capacity BETWEEN 1 AND 50", name="valid_capacity"),
    )


class PhysicalRoom(db.Model):
    __tablename__ = "physical_rooms"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False, index=True)
    room_type_id = db.Column(db.String(40), nullable=False)
    number = db.Column(db.String(40), nullable=False)
    floor = db.Column(db.String(120))
    area = db.Column(db.String(120))
    condition = db.Column(db.String(20), nullable=False, default="clean")
    housekeeping_revision = db.Column(db.Integer, nullable=False, default=0)
    active = db.Column(db.Boolean, nullable=False, default=True)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_physical_rooms_tenant_id_id"),
        UniqueConstraint("tenant_id", "number", name="uq_physical_rooms_tenant_number"),
        ForeignKeyConstraint(
            ["tenant_id", "room_type_id"], ["room_types.tenant_id", "room_types.id"]
        ),
        CheckConstraint(
            "floor IS NULL OR (floor = btrim(floor) AND length(floor) > 0)", name="valid_floor"
        ),
        CheckConstraint(
            "area IS NULL OR (area = btrim(area) AND length(area) > 0)", name="valid_area"
        ),
        CheckConstraint(
            "condition IN ('clean', 'dirty', 'inspection', 'maintenance')", name="valid_condition"
        ),
        CheckConstraint("housekeeping_revision >= 0", name="housekeeping_revision"),
    )


class Master(db.Model):
    __tablename__ = "masters"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False, index=True)
    catalog = db.Column(db.String(40), nullable=False)
    name = db.Column(db.String(160), nullable=False)
    data = db.Column(JSONB, nullable=False, default=dict)
    active = db.Column(db.Boolean, nullable=False, default=True)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_masters_tenant_id_id"),
        UniqueConstraint("tenant_id", "catalog", "name", name="uq_masters_tenant_catalog_name"),
    )


DEFAULT_UNITS = ("Cái", "Gói", "Chai", "Lon", "Hộp", "Bộ", "Kg", "Lít", "Lần", "Đêm")


def ensure_default_units(tenant_id):
    existing = {
        name.strip().casefold()
        for name in db.session.scalars(
            select(Master.name).where(Master.tenant_id == tenant_id, Master.catalog == "units")
        )
    }
    values = [
        {
            "id": uid(),
            "tenant_id": tenant_id,
            "catalog": "units",
            "name": name,
            "data": {},
            "active": True,
        }
        for name in DEFAULT_UNITS
        if name.casefold() not in existing
    ]
    if values:
        db.session.execute(
            insert(Master)
            .values(values)
            .on_conflict_do_nothing(constraint="uq_masters_tenant_catalog_name")
        )


class DailyRate(db.Model):
    __tablename__ = "daily_rates"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False, index=True)
    room_type_id = db.Column(db.String(40), nullable=False)
    date = db.Column(db.Date, nullable=False)
    price = db.Column(db.Numeric(19, 4), nullable=False)
    stop_sell = db.Column(db.Boolean, nullable=False, default=False)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_daily_rates_tenant_id_id"),
        UniqueConstraint(
            "tenant_id", "room_type_id", "date", name="uq_daily_rates_tenant_type_date"
        ),
        ForeignKeyConstraint(
            ["tenant_id", "room_type_id"], ["room_types.tenant_id", "room_types.id"]
        ),
        CheckConstraint("price >= 0", name="nonnegative_price"),
    )


class RoomBlock(db.Model):
    __tablename__ = "room_blocks"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False, index=True)
    room_id = db.Column(db.String(40), nullable=False)
    start_date = db.Column(db.Date, nullable=False)
    end_date = db.Column(db.Date, nullable=False)
    reason = db.Column(db.String(500), nullable=False)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_room_blocks_tenant_id_id"),
        ForeignKeyConstraint(
            ["tenant_id", "room_id"], ["physical_rooms.tenant_id", "physical_rooms.id"]
        ),
        CheckConstraint("end_date > start_date", name="valid_dates"),
    )


class RoomTypeAvailability(db.Model):
    __tablename__ = "room_type_availability"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False, index=True)
    room_type_id = db.Column(db.String(40), nullable=False)
    date = db.Column(db.Date, nullable=False)
    total_rooms = db.Column(db.Integer, nullable=False)
    booked_rooms = db.Column(db.Integer, nullable=False, default=0)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_room_type_availability_tenant_id_id"),
        UniqueConstraint(
            "tenant_id", "room_type_id", "date", name="uq_room_type_availability_tenant_type_date"
        ),
        ForeignKeyConstraint(
            ["tenant_id", "room_type_id"], ["room_types.tenant_id", "room_types.id"]
        ),
        CheckConstraint(
            "total_rooms >= 0 AND booked_rooms >= 0 AND booked_rooms <= total_rooms",
            name="valid_inventory",
        ),
    )
