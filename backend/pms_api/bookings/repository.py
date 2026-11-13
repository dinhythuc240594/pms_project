"""Reservation persistence and read projections on the caller-owned SQLAlchemy session."""

from collections import defaultdict
from decimal import Decimal

from sqlalchemy import func, select

from common.errors import ApiError

from ..core_models import AuditLog, User
from .models import (
    BookingNote,
    Charge,
    Guest,
    Payment,
    Refund,
    Reservation,
    ReservationGuest,
    ReservationNight,
    ReservationRoom,
)


class SQLAlchemyReservationRepository:
    def __init__(self, session):
        self.session = session

    def find_reservation(self, tenant_id, reservation_id, *, locked=False):
        statement = select(Reservation).where(
            Reservation.tenant_id == tenant_id, Reservation.id == reservation_id
        )
        if locked:
            statement = statement.with_for_update().execution_options(populate_existing=True)
        row = self.session.execute(statement).scalar_one_or_none()
        if not row:
            raise ApiError(404, "not_found", "Không tìm thấy đặt phòng.")
        return row

    def rows_for(self, model, tenant_id, reservation_id=None):
        statement = select(model).where(model.tenant_id == tenant_id)
        if reservation_id:
            statement = statement.where(model.reservation_id == reservation_id)
        return self.session.execute(statement).scalars().all()

    def totals(self, row):
        room_total = self.session.scalar(
            select(func.coalesce(func.sum(ReservationNight.price), 0)).where(
                ReservationNight.tenant_id == row.tenant_id,
                ReservationNight.reservation_id == row.id,
            )
        )
        extra = self.session.scalar(
            select(func.coalesce(func.sum(Charge.amount), 0)).where(
                Charge.tenant_id == row.tenant_id, Charge.reservation_id == row.id
            )
        )
        paid = self.session.scalar(
            select(func.coalesce(func.sum(Payment.amount), 0)).where(
                Payment.tenant_id == row.tenant_id, Payment.reservation_id == row.id
            )
        )
        refunded = self.session.scalar(
            select(func.coalesce(func.sum(Refund.amount), 0)).where(
                Refund.tenant_id == row.tenant_id, Refund.reservation_id == row.id
            )
        )
        total, net_paid = Decimal(room_total) + Decimal(extra), Decimal(paid) - Decimal(refunded)
        return total, net_paid, total - net_paid

    def load_booking_data(self, tenant_id, reservation_id=None):
        models = (
            ReservationRoom,
            ReservationGuest,
            ReservationNight,
            Charge,
            Payment,
            Refund,
            BookingNote,
        )
        data = {}
        for model in models:
            grouped = defaultdict(list)
            for row in self.rows_for(model, tenant_id, reservation_id):
                grouped[row.reservation_id].append(row)
            data[model] = grouped
        data[Guest] = {row.id: row for row in self.rows_for(Guest, tenant_id)}
        audits = select(AuditLog).where(
            AuditLog.tenant_id == tenant_id, AuditLog.entity_type == "reservation"
        )
        if reservation_id:
            audits = audits.where(AuditLog.entity_id == reservation_id)
        history = defaultdict(list)
        for row in self.session.execute(audits.order_by(AuditLog.created_at)).scalars():
            history[row.entity_id].append(row)
        data[AuditLog] = history
        actor_ids = {row.user_id for rows in history.values() for row in rows}
        for model in (Charge, Payment, Refund, BookingNote):
            actor_ids.update(row.user_id for rows in data[model].values() for row in rows)
        data[User] = (
            {
                row.id: row.name
                for row in self.session.execute(
                    select(User).where(User.id.in_(actor_ids))
                ).scalars()
            }
            if actor_ids
            else {}
        )
        return data
