"""Room tasks retain their generation; work logs are append-only."""

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB

from ..core_models import uid, utcnow
from ..extensions import db


class HousekeepingStaff(db.Model):
    __tablename__ = "housekeeping_staff"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    name = db.Column(db.String(160), nullable=False)
    phone = db.Column(db.String(40), nullable=False, default="")
    user_id = db.Column(db.String(40))
    active = db.Column(db.Boolean, nullable=False, default=True)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        UniqueConstraint("tenant_id", "user_id"),
        ForeignKeyConstraint(
            ["tenant_id", "user_id"], ["tenant_users.tenant_id", "tenant_users.user_id"]
        ),
    )


class HousekeepingShift(db.Model):
    __tablename__ = "housekeeping_shifts"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    staff_id = db.Column(db.String(40), nullable=False)
    date = db.Column(db.Date, nullable=False)
    start_time = db.Column(db.Time, nullable=False)
    end_time = db.Column(db.Time, nullable=False)
    note = db.Column(db.String(500), nullable=False, default="")
    active = db.Column(db.Boolean, nullable=False, default=True)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        UniqueConstraint("tenant_id", "id", "staff_id"),
        ForeignKeyConstraint(
            ["tenant_id", "staff_id"], ["housekeeping_staff.tenant_id", "housekeeping_staff.id"]
        ),
        CheckConstraint("end_time > start_time", name="positive_shift"),
    )


class HousekeepingTask(db.Model):
    __tablename__ = "housekeeping_tasks"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    room_id = db.Column(db.String(40), nullable=False)
    reservation_id = db.Column(db.String(40))
    staff_id = db.Column(db.String(40))
    shift_id = db.Column(db.String(40))
    date = db.Column(db.Date, nullable=False)
    kind = db.Column(db.String(20), nullable=False)
    source_key = db.Column(db.String(160), nullable=False)
    status = db.Column(db.String(20), nullable=False, default="pending")
    note = db.Column(db.String(1000), nullable=False, default="")
    room_revision = db.Column(db.Integer, nullable=False)
    revision = db.Column(db.Integer, nullable=False, default=1)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    started_at = db.Column(db.DateTime(timezone=True))
    completed_at = db.Column(db.DateTime(timezone=True))
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        UniqueConstraint("tenant_id", "source_key"),
        ForeignKeyConstraint(
            ["tenant_id", "room_id"], ["physical_rooms.tenant_id", "physical_rooms.id"]
        ),
        ForeignKeyConstraint(
            ["tenant_id", "reservation_id"], ["reservations.tenant_id", "reservations.id"]
        ),
        ForeignKeyConstraint(
            ["tenant_id", "staff_id"], ["housekeeping_staff.tenant_id", "housekeeping_staff.id"]
        ),
        ForeignKeyConstraint(
            ["tenant_id", "shift_id", "staff_id"],
            [
                "housekeeping_shifts.tenant_id",
                "housekeeping_shifts.id",
                "housekeeping_shifts.staff_id",
            ],
        ),
        CheckConstraint(
            "kind IN ('arrival','departure','stayover','dirty','checkout')", name="kind"
        ),
        CheckConstraint(
            "status IN ('pending','in_progress','inspection','completed','cancelled')",
            name="status",
        ),
        CheckConstraint("revision > 0 AND room_revision >= 0", name="positive_revision"),
        CheckConstraint("shift_id IS NULL OR staff_id IS NOT NULL", name="assigned_shift"),
    )


class HousekeepingLog(db.Model):
    __tablename__ = "housekeeping_logs"
    id = db.Column(db.String(40), primary_key=True, default=uid)
    tenant_id = db.Column(db.String(40), db.ForeignKey("tenants.id"), nullable=False)
    task_id = db.Column(db.String(40))
    room_id = db.Column(db.String(40))
    user_id = db.Column(db.String(40), db.ForeignKey("users.id"), nullable=False)
    event = db.Column(db.String(80), nullable=False)
    details = db.Column(JSONB, nullable=False, default=dict)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        ForeignKeyConstraint(
            ["tenant_id", "task_id"], ["housekeeping_tasks.tenant_id", "housekeeping_tasks.id"]
        ),
        ForeignKeyConstraint(
            ["tenant_id", "room_id"], ["physical_rooms.tenant_id", "physical_rooms.id"]
        ),
    )
