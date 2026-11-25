"""System-managed SaaS invoicing and tenant-owner billing reads; no plan grants."""

import re
from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal

from flask import g, request
from sqlalchemy import case, func, select, union_all

from common import CommonMethodView, RequestData

from ..bookings.routes import (
    begin_money,
    begin_write,
    decimal_text,
    finish_write,
    iso,
    money_value,
    string_value,
)
from ..core_models import Plan, Subscription, SubscriptionHistory, Tenant, User, utcnow
from ..extensions import db
from ..finance.routes import pagination
from ..security import ApiError, audit, payload, require_system, require_tenant
from ..subscriptions import (
    entitlement,
    lock_tenant,
    operational_access,
    plan_code,
    subscription_history_json,
    subscription_json,
    timestamp,
)
from .models import (
    SaaSIdempotencyRecord,
    SaaSInvoice,
    SaaSOperationalAccess,
    SaaSPayment,
    SaaSRefund,
)

PREFIX = "/api/billing/invoices"


def parse_date(value):
    try:
        if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError
        return date.fromisoformat(value)
    except ValueError:
        raise ApiError(422, "invalid_dates", "Ngày phải có định dạng YYYY-MM-DD.") from None


def window(*, default_month=False):
    start_value, end_value = RequestData.date_range()
    today = utcnow().date()
    first = today.replace(day=1)
    next_month = (first.replace(day=28) + timedelta(days=4)).replace(day=1)
    start = parse_date(start_value) if start_value is not None else first if default_month else None
    end = parse_date(end_value) if end_value is not None else next_month if default_month else None
    if start and end and start >= end:
        raise ApiError(422, "invalid_dates", "Ngày kết thúc phải sau ngày bắt đầu.")
    return (
        datetime.combine(start, time.min, UTC) if start else None,
        datetime.combine(end, time.min, UTC) if end else None,
    )


def allowed_fields(data, fields):
    if data.keys() - fields:
        raise ApiError(422, "invalid_input", "Nội dung có trường không được hỗ trợ.")


def payment_totals(tenant_id=None):
    payments = select(SaaSPayment.invoice_id, SaaSPayment.amount)
    refunds = select(SaaSRefund.invoice_id, (-SaaSRefund.amount).label("amount"))
    if tenant_id is not None:
        payments = payments.where(SaaSPayment.tenant_id == tenant_id)
        refunds = refunds.where(SaaSRefund.tenant_id == tenant_id)
    movements = union_all(payments, refunds).subquery()
    return (
        select(movements.c.invoice_id, func.sum(movements.c.amount).label("paid"))
        .group_by(movements.c.invoice_id)
        .subquery()
    )


def invoice_query(tenant_id=None):
    totals = payment_totals(tenant_id)
    paid = func.coalesce(totals.c.paid, 0)
    query = (
        select(SaaSInvoice, Tenant.name, paid)
        .join(Tenant, Tenant.id == SaaSInvoice.tenant_id)
        .outerjoin(totals, totals.c.invoice_id == SaaSInvoice.id)
    )
    if tenant_id is not None:
        query = query.where(SaaSInvoice.tenant_id == tenant_id)
    return query, paid


def invoice_status(row, paid):
    return (
        "void"
        if row.voided_at
        else "paid"
        if paid == row.amount
        else "partial"
        if paid
        else "unpaid"
    )


def invoice_json(row, tenant_name, payments, refunds=()):
    refunded = sum((refund.amount for refund in refunds), Decimal(0))
    paid = sum((payment.amount for payment in payments), Decimal(0)) - refunded
    refunds_by_payment = defaultdict(Decimal)
    for refund in refunds:
        refunds_by_payment[refund.payment_id] += refund.amount
    return {
        "id": row.id,
        "number": f"SAAS-{row.number:06d}",
        "tenantId": row.tenant_id,
        "tenantName": tenant_name,
        "description": row.description,
        "amount": decimal_text(row.amount),
        "currency": row.currency,
        "dueDate": iso(row.due_date),
        "status": invoice_status(row, paid),
        "paid": decimal_text(paid),
        "refunded": decimal_text(refunded),
        "balance": decimal_text(0 if row.voided_at else row.amount - paid),
        "createdAt": iso(row.created_at),
        "voidedAt": iso(row.voided_at),
        "voidReason": row.void_reason,
        "payments": [
            {
                "id": payment.id,
                "amount": decimal_text(payment.amount),
                "refunded": decimal_text(refunds_by_payment[payment.id]),
                "refundable": decimal_text(payment.amount - refunds_by_payment[payment.id]),
                "method": payment.method,
                "reference": payment.reference,
                "note": payment.note,
                "createdAt": iso(payment.created_at),
            }
            for payment in payments
        ],
        "refunds": [
            {
                "id": refund.id,
                "paymentId": refund.payment_id,
                "amount": decimal_text(refund.amount),
                "reason": refund.reason,
                "createdAt": iso(refund.created_at),
            }
            for refund in refunds
        ],
    }


def invoice_response(row):
    payments = db.session.scalars(
        select(SaaSPayment)
        .where(SaaSPayment.tenant_id == row.tenant_id, SaaSPayment.invoice_id == row.id)
        .order_by(SaaSPayment.created_at, SaaSPayment.id)
    ).all()
    refunds = db.session.scalars(
        select(SaaSRefund)
        .where(SaaSRefund.tenant_id == row.tenant_id, SaaSRefund.invoice_id == row.id)
        .order_by(SaaSRefund.created_at, SaaSRefund.id)
    ).all()
    return invoice_json(row, db.session.get(Tenant, row.tenant_id).name, payments, refunds)


def find_invoice(invoice_id, *, tenant_id=None, locked=False):
    query = select(SaaSInvoice).where(SaaSInvoice.id == invoice_id)
    if tenant_id is not None:
        query = query.where(SaaSInvoice.tenant_id == tenant_id)
    if locked:
        query = query.with_for_update().execution_options(populate_existing=True)
    row = db.session.scalar(query)
    if not row:
        raise ApiError(404, "not_found", "Không tìm thấy hóa đơn SaaS.")
    return row


def invoice_page(tenant_id=None):
    page, size = pagination()
    query, paid = invoice_query(tenant_id)
    start, end = window()
    if start:
        query = query.where(SaaSInvoice.created_at >= start)
    if end:
        query = query.where(SaaSInvoice.created_at < end)
    if request.args.get("status"):
        status = request.args["status"]
        if status not in {"unpaid", "partial", "paid", "void"}:
            raise ApiError(422, "invalid_status", "Trạng thái hóa đơn không hợp lệ.")
        if status == "void":
            query = query.where(SaaSInvoice.voided_at.is_not(None))
        else:
            condition = (
                paid == 0
                if status == "unpaid"
                else paid == SaaSInvoice.amount
                if status == "paid"
                else (paid > 0) & (paid < SaaSInvoice.amount)
            )
            query = query.where(SaaSInvoice.voided_at.is_(None), condition)
    count = db.session.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.session.execute(
        query.order_by(SaaSInvoice.created_at.desc(), SaaSInvoice.number.desc())
        .offset((page - 1) * size)
        .limit(size)
    ).all()
    grouped, grouped_refunds = defaultdict(list), defaultdict(list)
    if rows:
        payments = select(SaaSPayment).where(
            SaaSPayment.invoice_id.in_([row.id for row, _, _ in rows])
        )
        if tenant_id is not None:
            payments = payments.where(SaaSPayment.tenant_id == tenant_id)
        for payment in db.session.scalars(
            payments.order_by(SaaSPayment.created_at, SaaSPayment.id)
        ):
            grouped[payment.invoice_id].append(payment)
        refunds = select(SaaSRefund).where(
            SaaSRefund.invoice_id.in_([row.id for row, _, _ in rows])
        )
        if tenant_id is not None:
            refunds = refunds.where(SaaSRefund.tenant_id == tenant_id)
        for refund in db.session.scalars(refunds.order_by(SaaSRefund.created_at, SaaSRefund.id)):
            grouped_refunds[refund.invoice_id].append(refund)
    return {
        "invoices": [
            invoice_json(row, name, grouped[row.id], grouped_refunds[row.id])
            for row, name, _ in rows
        ],
        "pagination": {"page": page, "pageSize": size, "totalItems": count},
    }


class ListInvoicesView(CommonMethodView):
    @staticmethod
    @require_system()
    def dispatch_request():
        return invoice_page(request.args.get("tenantId") or None)


class TenantBillingView(CommonMethodView):
    @staticmethod
    @require_tenant("billing.view")
    def dispatch_request(tenant_id):
        value = entitlement(tenant_id)
        totals = payment_totals(tenant_id)
        paid = func.coalesce(totals.c.paid, 0)
        rows = db.session.execute(
            select(
                SaaSInvoice.currency,
                func.sum(SaaSInvoice.amount),
                func.sum(paid),
                func.sum(SaaSInvoice.amount - paid),
            )
            .outerjoin(totals, totals.c.invoice_id == SaaSInvoice.id)
            .where(SaaSInvoice.tenant_id == tenant_id, SaaSInvoice.voided_at.is_(None))
            .group_by(SaaSInvoice.currency)
            .order_by(SaaSInvoice.currency)
        ).all()
        return {
            "subscription": subscription_json(value["subscription"], value["plan"]),
            "summary": [
                {
                    "currency": currency,
                    "amount": decimal_text(amount),
                    "paid": decimal_text(received),
                    "balance": decimal_text(balance),
                }
                for currency, amount, received, balance in rows
            ],
        }


class TenantInvoicesView(CommonMethodView):
    @staticmethod
    @require_tenant("billing.view")
    def dispatch_request(tenant_id):
        return invoice_page(tenant_id)


class TenantInvoiceView(CommonMethodView):
    @staticmethod
    @require_tenant("billing.view")
    def dispatch_request(tenant_id, invoice_id):
        # The same immutable document and payment values shown in Manager.
        return invoice_response(find_invoice(invoice_id, tenant_id=tenant_id))


class TenantBillingHistoryView(CommonMethodView):
    @staticmethod
    @require_tenant("billing.view")
    def dispatch_request(tenant_id):
        page, size = pagination()
        query = (
            select(SubscriptionHistory, Plan)
            .join(Plan, Plan.id == SubscriptionHistory.plan_id)
            .where(SubscriptionHistory.tenant_id == tenant_id)
        )
        count = db.session.scalar(select(func.count()).select_from(query.subquery()))
        rows = db.session.execute(
            query.order_by(SubscriptionHistory.created_at.desc(), SubscriptionHistory.id)
            .offset((page - 1) * size)
            .limit(size)
        ).all()
        return {
            "history": [subscription_history_json(row, plan) for row, plan in rows],
            "pagination": {"page": page, "pageSize": size, "totalItems": count},
        }


class CreateInvoiceView(CommonMethodView):
    @staticmethod
    @require_system()
    def dispatch_request():
        data = payload()
        allowed_fields(data, {"tenantId", "description", "amount", "currency", "dueDate"})
        tenant_id = string_value(data.get("tenantId"), "Khách sạn", 40, required=True)
        if db.session.get(Tenant, tenant_id) is None:
            raise ApiError(422, "invalid_tenant", "Khách sạn không tồn tại.")
        currency = data.get("currency")
        if not isinstance(currency, str) or currency not in {"VND", "USD"}:
            raise ApiError(422, "invalid_currency", "Tiền tệ phải là VND hoặc USD.")
        row = SaaSInvoice(
            tenant_id=tenant_id,
            description=string_value(data.get("description"), "Nội dung", 500, required=True),
            amount=money_value(data.get("amount")),
            currency=currency,
            due_date=parse_date(data["dueDate"]) if data.get("dueDate") is not None else None,
            user_id=g.user.id,
        )
        key, fingerprint, replay = begin_money(row, data, record_model=SaaSIdempotencyRecord)
        if replay is not None:
            return replay, 201
        db.session.add(row)
        db.session.flush()
        audit(
            "saas.invoice_created",
            "saas_invoice",
            row.id,
            {
                "tenantId": row.tenant_id,
                "number": f"SAAS-{row.number:06d}",
                "amount": decimal_text(row.amount),
                "currency": row.currency,
            },
        )
        return finish_write(
            row.tenant_id,
            key,
            fingerprint,
            invoice_response(row),
            status=201,
            record_model=SaaSIdempotencyRecord,
        )


class AddPaymentView(CommonMethodView):
    @staticmethod
    @require_system()
    def dispatch_request(invoice_id):
        data = payload()
        allowed_fields(data, {"amount", "method", "reference", "note"})
        row = find_invoice(invoice_id)
        key, fingerprint, replay = begin_money(row, data, record_model=SaaSIdempotencyRecord)
        if replay is not None:
            return replay, 201
        row = find_invoice(invoice_id, locked=True)
        amount = money_value(data.get("amount"))
        method = data.get("method")
        if not isinstance(method, str) or method not in {"bank", "cash"}:
            raise ApiError(422, "invalid_method", "Phương thức phải là bank hoặc cash.")
        paid = Decimal(invoice_response(row)["paid"])
        if row.voided_at:
            raise ApiError(409, "invoice_void", "Không thể thu tiền hóa đơn đã hủy.")
        if amount > row.amount - paid:
            raise ApiError(409, "overpayment", "Số tiền vượt số dư hóa đơn.")
        payment = SaaSPayment(
            tenant_id=row.tenant_id,
            invoice_id=row.id,
            amount=amount,
            method=method,
            reference=string_value(data.get("reference"), "Mã tham chiếu", 160),
            note=string_value(data.get("note"), "Ghi chú", 1000),
            user_id=g.user.id,
        )
        db.session.add(payment)
        db.session.flush()
        audit(
            "saas.payment_recorded",
            "saas_invoice",
            row.id,
            {
                "tenantId": row.tenant_id,
                "paymentId": payment.id,
                "amount": decimal_text(amount),
                "currency": row.currency,
            },
        )
        return finish_write(
            row.tenant_id,
            key,
            fingerprint,
            invoice_response(row),
            status=201,
            record_model=SaaSIdempotencyRecord,
        )


class VoidInvoiceView(CommonMethodView):
    @staticmethod
    @require_system()
    def dispatch_request(invoice_id):
        data = payload()
        allowed_fields(data, {"reason"})
        reason = string_value(data.get("reason"), "Lý do", 1000, required=True)
        row = find_invoice(invoice_id, locked=True)
        paid = Decimal(invoice_response(row)["paid"])
        if row.voided_at or paid:
            raise ApiError(409, "invoice_not_unpaid", "Chỉ hủy được hóa đơn chưa thu tiền.")
        row.voided_at, row.voided_by, row.void_reason = utcnow(), g.user.id, reason
        db.session.flush()
        audit(
            "saas.invoice_voided",
            "saas_invoice",
            row.id,
            {"tenantId": row.tenant_id, "reason": reason},
        )
        return invoice_response(row)


class RefundPaymentView(CommonMethodView):
    @staticmethod
    @require_system()
    def dispatch_request(invoice_id, payment_id):
        data = payload()
        allowed_fields(data, {"amount", "reason"})
        row = find_invoice(invoice_id)
        key, fingerprint, replay = begin_money(row, data, record_model=SaaSIdempotencyRecord)
        if replay is not None:
            return replay, 201
        row = find_invoice(invoice_id, locked=True)
        payment = db.session.scalar(
            select(SaaSPayment).where(
                SaaSPayment.tenant_id == row.tenant_id,
                SaaSPayment.invoice_id == row.id,
                SaaSPayment.id == payment_id,
            )
        )
        if payment is None:
            raise ApiError(404, "not_found", "Không tìm thấy khoản thu của hóa đơn này.")
        amount = money_value(data.get("amount"))
        reason = string_value(data.get("reason"), "Lý do hoàn/đảo thu", 1000, required=True)
        refunded = db.session.scalar(
            select(func.coalesce(func.sum(SaaSRefund.amount), 0)).where(
                SaaSRefund.tenant_id == row.tenant_id, SaaSRefund.payment_id == payment.id
            )
        )
        if row.voided_at or amount > payment.amount - refunded:
            raise ApiError(
                409,
                "refund_exceeds_payment",
                "Số tiền vượt phần còn có thể hoàn/đảo của khoản thu.",
            )
        refund = SaaSRefund(
            tenant_id=row.tenant_id,
            invoice_id=row.id,
            payment_id=payment.id,
            amount=amount,
            reason=reason,
            user_id=g.user.id,
        )
        db.session.add(refund)
        db.session.flush()
        audit(
            "saas.payment_refunded",
            "saas_invoice",
            row.id,
            {
                "tenantId": row.tenant_id,
                "paymentId": payment.id,
                "refundId": refund.id,
                "amount": decimal_text(amount),
                "currency": row.currency,
                "reason": reason,
            },
        )
        return finish_write(
            row.tenant_id,
            key,
            fingerprint,
            invoice_response(row),
            status=201,
            record_model=SaaSIdempotencyRecord,
        )


class OperationalAccessView(CommonMethodView):
    @staticmethod
    @require_system()
    def dispatch_request(tenant_id):
        tenant = lock_tenant(tenant_id)
        if request.method == "GET":
            return {"access": operational_access(tenant_id, include_inactive=True)}
        data = payload()
        allowed_fields(data, {"until", "reason"})
        key, fingerprint, replay = begin_write(tenant_id, data, record_model=SaaSIdempotencyRecord)
        if replay is not None:
            return replay, 201
        reason = string_value(data.get("reason"), "Lý do", 1000, required=True)
        if "until" not in data:
            raise ApiError(422, "invalid_dates", "Cần thời hạn vận hành hoặc null để thu hồi.")
        now = utcnow()
        until = timestamp(data["until"], "Hạn vận hành") if data["until"] is not None else None
        value = entitlement(tenant_id)
        sub = value["subscription"]
        if sub is None:
            raise ApiError(409, "subscription_required", "Khách sạn chưa có thuê bao.")
        if until is not None:
            if not now < until <= now + timedelta(days=7):
                raise ApiError(422, "invalid_dates", "Thời hạn vận hành phải trong 7 ngày tới.")
            if (
                tenant.status != "active"
                or sub.status != "active"
                or value["blockedReason"] != "expired"
            ):
                raise ApiError(
                    409,
                    "operational_access_unavailable",
                    "Chỉ cấp vận hành tạm cho thuê bao đang hoạt động đã hết hạn của khách sạn không bị khóa.",
                )
        record = SaaSOperationalAccess(
            tenant_id=tenant_id,
            subscription_id=sub.id,
            plan_id=sub.plan_id,
            subscription_end=sub.end_date,
            until=until,
            reason=reason,
            user_id=g.user.id,
            created_at=now,
        )
        db.session.add(record)
        db.session.flush()
        audit(
            "subscription.operational_access",
            "tenant",
            tenant_id,
            {"tenantId": tenant_id, "accessId": record.id, "until": iso(until), "reason": reason},
        )
        response = {"access": operational_access(tenant_id, include_inactive=True)}
        return finish_write(
            tenant_id,
            key,
            fingerprint,
            response,
            status=201,
            record_model=SaaSIdempotencyRecord,
        )


class OverviewView(CommonMethodView):
    @staticmethod
    @require_system()
    def dispatch_request():
        start, end = window(default_month=True)
        now = utcnow()
        tenants = dict(
            db.session.execute(select(Tenant.status, func.count()).group_by(Tenant.status)).all()
        )
        total = sum(tenants.values())
        plans = {"FREE": 0, "PRO": 0, "unassigned": total}
        for plan, count in db.session.execute(
            select(Plan, func.count())
            .join(Subscription, Subscription.plan_id == Plan.id)
            .where(
                Plan.active.is_(True),
                Subscription.status == "active",
                Subscription.start_date <= now,
                (Subscription.end_date.is_(None)) | (Subscription.end_date > now),
            )
            .group_by(Plan.id)
        ):
            code = plan_code(plan)
            if code:
                plans[code] = plans.get(code, 0) + count
                plans["unassigned"] -= count
        totals = payment_totals()
        balance = SaaSInvoice.amount - func.coalesce(totals.c.paid, 0)
        invoiced_period = (SaaSInvoice.created_at >= start) & (SaaSInvoice.created_at < end)
        sums = db.session.execute(
            select(
                SaaSInvoice.currency,
                func.sum(case((invoiced_period, SaaSInvoice.amount), else_=0)),
                func.sum(balance),
                func.sum(case((SaaSInvoice.due_date < now.date(), balance), else_=0)),
            )
            .outerjoin(totals, totals.c.invoice_id == SaaSInvoice.id)
            .where(SaaSInvoice.voided_at.is_(None))
            .group_by(SaaSInvoice.currency)
        ).all()
        received = dict(
            db.session.execute(
                select(SaaSInvoice.currency, func.sum(SaaSPayment.amount))
                .join(SaaSInvoice, SaaSInvoice.id == SaaSPayment.invoice_id)
                .where(SaaSPayment.created_at >= start, SaaSPayment.created_at < end)
                .group_by(SaaSInvoice.currency)
            ).all()
        )
        refunded = dict(
            db.session.execute(
                select(SaaSInvoice.currency, func.sum(SaaSRefund.amount))
                .join(SaaSInvoice, SaaSInvoice.id == SaaSRefund.invoice_id)
                .where(SaaSRefund.created_at >= start, SaaSRefund.created_at < end)
                .group_by(SaaSInvoice.currency)
            ).all()
        )
        recent = db.session.execute(
            select(SaaSPayment, SaaSInvoice.number, SaaSInvoice.currency, Tenant.name)
            .join(SaaSInvoice, SaaSInvoice.id == SaaSPayment.invoice_id)
            .join(Tenant, Tenant.id == SaaSPayment.tenant_id)
            .where(SaaSPayment.created_at >= start, SaaSPayment.created_at < end)
            .order_by(SaaSPayment.created_at.desc(), SaaSPayment.id)
            .limit(10)
        ).all()
        balances = {
            currency: (invoiced, outstanding, overdue)
            for currency, invoiced, outstanding, overdue in sums
        }
        currencies = []
        for currency in sorted(balances.keys() | received.keys() | refunded.keys()):
            invoiced, outstanding, overdue = balances.get(currency, (0, 0, 0))
            currencies.append(
                {
                    "currency": currency,
                    "invoiced": decimal_text(invoiced),
                    "received": decimal_text(received.get(currency, 0) - refunded.get(currency, 0)),
                    "refunded": decimal_text(refunded.get(currency, 0)),
                    "outstanding": decimal_text(outstanding),
                    "overdue": decimal_text(overdue),
                }
            )
        return {
            "start": start.date().isoformat(),
            "end": end.date().isoformat(),
            "tenants": {
                "total": total,
                "active": tenants.get("active", 0),
                "suspended": tenants.get("suspended", 0),
            },
            "users": {
                "active": db.session.scalar(
                    select(func.count()).select_from(User).where(User.active.is_(True))
                )
            },
            "plans": plans,
            "currencies": currencies,
            "recentPayments": [
                {
                    "invoiceNumber": f"SAAS-{number:06d}",
                    "tenantName": name,
                    "amount": decimal_text(payment.amount),
                    "currency": currency,
                    "createdAt": iso(payment.created_at),
                }
                for payment, number, currency, name in recent
            ],
        }


def __getattr__(name):
    if name in {"URL", "billing"}:
        from importlib import import_module

        return getattr(import_module(".urls", __package__), name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
