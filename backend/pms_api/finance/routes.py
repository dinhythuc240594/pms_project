"""Atomic POS and cashbook operations over the shared append-only tenant ledger."""

import unicodedata
from datetime import date
from decimal import Decimal
from zoneinfo import ZoneInfo

from flask import g, request
from sqlalchemy import func, or_, select, text

from common import CommonMethodView, RequestData

from ..bookings.models import Charge, LedgerEntry
from ..bookings.routes import (
    ACTIVE,
    MONEY_LIMIT,
    begin_write,
    decimal_text,
    find_reservation,
    finish_write,
    iso,
    master,
    money_value,
    string_value,
    totals,
)
from ..catalog.models import Master
from ..core_models import Tenant, User, utcnow
from ..currencies import is_hotel_currency
from ..extensions import db
from ..pricing.engine import exchange_snapshot, money_json, snapshot_money
from ..security import ApiError, audit, payload, require_tenant
from ..subscriptions import feature_enabled
from .models import CashDocument, PosInvoice, PosInvoiceItem, PosPayment, PosRefund

PREFIX = "/api/tenants/<tenant_id>"
SNAPSHOT_LIMIT = 100


def line_amount(quantity, unit_price):
    amount = quantity * unit_price
    if amount > MONEY_LIMIT or amount != amount.quantize(Decimal("0.0001")):
        raise ApiError(
            422, "invalid_amount", "Thành tiền vượt giới hạn hoặc có hơn 4 số thập phân."
        )
    return amount.quantize(Decimal("0.0001"))


def tenant_currency(tenant_id):
    tenant = db.session.scalar(
        select(Tenant)
        .where(Tenant.id == tenant_id)
        .with_for_update(read=True)
        .execution_options(populate_existing=True)
    )
    return (tenant.settings or {}).get("currency", "VND")


def local_date(timestamp=None):
    timezone = (g.tenant.settings or {}).get("timezone", "Asia/Ho_Chi_Minh")
    return (timestamp or utcnow()).astimezone(ZoneInfo(timezone)).date()


def parse_date(value):
    try:
        return date.fromisoformat(str(value))
    except (ValueError, TypeError):
        raise ApiError(422, "invalid_dates", "Ngày không hợp lệ.") from None


def lock_funds(tenant_id, fund_ids, currency, *, allow_inactive=False):
    """Every writer, including reservation refunds, must use these ordered fund locks."""
    result = {}
    for fund_id in sorted(set(fund_ids)):
        db.session.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),
            {"key": f"{tenant_id}:fund:{fund_id}"},
        )
        statement = select(Master).where(
            Master.tenant_id == tenant_id, Master.catalog == "funds", Master.id == fund_id
        )
        if not allow_inactive:
            statement = statement.where(Master.active.is_(True))
        row = db.session.scalar(
            statement.with_for_update(read=True).execution_options(populate_existing=True)
        )
        if not row:
            raise ApiError(422, "invalid_fund", "Quỹ không tồn tại hoặc đã ngừng sử dụng.")
        configured = (row.data or {}).get(
            "currency", (g.tenant.settings or {}).get("currency", "VND")
        )
        if configured != currency:
            raise ApiError(409, "currency_mismatch", "Quỹ và chứng từ phải cùng loại tiền tệ.")
        currencies = db.session.scalars(
            select(LedgerEntry.currency)
            .where(LedgerEntry.tenant_id == tenant_id, LedgerEntry.fund_id == row.id)
            .distinct()
        ).all()
        if any(value != currency for value in currencies):
            raise ApiError(409, "currency_mismatch", "Quỹ đã có giao dịch bằng loại tiền khác.")
        result[row.id] = row
    return result


def fund_balance(tenant_id, fund_id, currency):
    return Decimal(
        db.session.scalar(
            select(func.coalesce(func.sum(LedgerEntry.amount), 0)).where(
                LedgerEntry.tenant_id == tenant_id,
                LedgerEntry.fund_id == fund_id,
                LedgerEntry.currency == currency,
            )
        )
    )


def ensure_available(tenant_id, fund_id, currency, amount):
    if amount > fund_balance(tenant_id, fund_id, currency):
        raise ApiError(409, "insufficient_fund", "Số dư quỹ không đủ cho giao dịch này.")


def finish(tenant_id, key, fingerprint, response, status=201):
    return finish_write(tenant_id, key, fingerprint, response, status=status)


def begin(tenant_id, data):
    return begin_write(tenant_id, data, legacy_money=True)


def ledger(tenant_id, fund_id, currency, amount, kind, description, *, source=None, **references):
    from ..reconciliation.business_days import posting_date

    booked_at = posting_date(tenant_id, references.pop("booked_at", local_date()))
    snapshot = snapshot_money(tenant_id, currency, amount, source)
    if "base_amount" in references:
        snapshot["base_amount"] = references.pop("base_amount")
    db.session.add(
        LedgerEntry(
            tenant_id=tenant_id,
            fund_id=fund_id,
            currency=currency,
            amount=amount,
            kind=kind,
            description=description,
            user_id=g.user.id,
            booked_at=booked_at,
            **snapshot,
            **references,
        )
    )


def invoice_row(tenant_id, invoice_id, *, locked=False):
    statement = select(PosInvoice).where(
        PosInvoice.tenant_id == tenant_id, PosInvoice.id == invoice_id
    )
    if locked:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    row = db.session.scalar(statement)
    if not row:
        raise ApiError(404, "not_found", "Không tìm thấy hóa đơn POS.")
    return row


def invoice_items(tenant_id, data):
    if not isinstance(data, list) or not 1 <= len(data) <= 100:
        raise ApiError(422, "invalid_items", "Hóa đơn cần từ 1 đến 100 dòng dịch vụ.")
    items = []
    for item in data:
        if not isinstance(item, dict):
            raise ApiError(422, "invalid_items", "Dòng dịch vụ không hợp lệ.")
        service = master(tenant_id, "services", item.get("serviceId"), read_lock=True)
        quantity = money_value(item.get("quantity"), limit=Decimal("99999999.9999"))
        price = money_value(
            item.get("unitPrice", (service.data or {}).get("price", 0)), allow_zero=True
        )
        amount = line_amount(quantity, price)
        items.append(
            {
                "serviceId": service.id,
                "description": service.name,
                "quantity": decimal_text(quantity),
                "unitPrice": decimal_text(price),
                "amount": decimal_text(amount),
            }
        )
    if sum((Decimal(item["amount"]) for item in items), Decimal(0)) > MONEY_LIMIT:
        raise ApiError(422, "invalid_amount", "Tổng hóa đơn vượt giới hạn.")
    return items


def payment_totals(row):
    paid = db.session.scalar(
        select(func.coalesce(func.sum(PosPayment.amount), 0)).where(
            PosPayment.tenant_id == row.tenant_id, PosPayment.invoice_id == row.id
        )
    )
    refunded = db.session.scalar(
        select(func.coalesce(func.sum(PosRefund.amount), 0)).where(
            PosRefund.tenant_id == row.tenant_id, PosRefund.invoice_id == row.id
        )
    )
    return Decimal(paid), Decimal(refunded)


def invoice_json(row, data=None):
    items = row.draft_items
    if row.posted_at:
        items = [
            {
                "id": item.id,
                **money_json(item),
                "serviceId": item.service_id,
                "chargeId": item.charge_id,
                "description": item.description,
                "quantity": decimal_text(item.quantity),
                "unitPrice": decimal_text(item.unit_price),
                "amount": decimal_text(item.amount),
            }
            for item in (
                data["items"].get(row.id, [])
                if data is not None
                else db.session.scalars(
                    select(PosInvoiceItem)
                    .where(
                        PosInvoiceItem.tenant_id == row.tenant_id,
                        PosInvoiceItem.invoice_id == row.id,
                    )
                    .order_by(PosInvoiceItem.id)
                )
            )
        ]
    refunds = (
        data["refunds"].get(row.id, [])
        if data is not None
        else list(
            db.session.scalars(
                select(PosRefund)
                .where(PosRefund.tenant_id == row.tenant_id, PosRefund.invoice_id == row.id)
                .order_by(PosRefund.created_at, PosRefund.id)
            )
        )
    )
    payment_rows = (
        data["payments"].get(row.id, [])
        if data is not None
        else list(
            db.session.scalars(
                select(PosPayment)
                .where(PosPayment.tenant_id == row.tenant_id, PosPayment.invoice_id == row.id)
                .order_by(PosPayment.created_at, PosPayment.id)
            )
        )
    )
    payments = [
        {
            "id": payment.id,
            **money_json(payment),
            "amount": decimal_text(payment.amount),
            "methodId": payment.method_id,
            "method": payment.method_name,
            "fundId": payment.fund_id,
            "fund": payment.fund_name,
            "currency": payment.currency,
            "createdAt": iso(payment.created_at),
            "note": payment.note,
            "actorId": payment.user_id,
            "refunded": decimal_text(
                sum(
                    (refund.amount for refund in refunds if refund.payment_id == payment.id),
                    Decimal(0),
                )
            ),
            "refunds": [
                {
                    "id": refund.id,
                    **money_json(refund),
                    "amount": decimal_text(refund.amount),
                    "reason": refund.reason,
                    "createdAt": iso(refund.created_at),
                    "actorId": refund.user_id,
                }
                for refund in refunds
                if refund.payment_id == payment.id
            ],
        }
        for payment in payment_rows
    ]
    paid = sum((payment.amount for payment in payment_rows), Decimal(0))
    refunded = sum((refund.amount for refund in refunds), Decimal(0))
    return {
        "id": row.id,
        **money_json(row),
        "status": row.status,
        "customerName": row.customer_name,
        "note": row.note,
        "currency": row.currency,
        "items": items,
        "total": decimal_text(row.total),
        "paid": decimal_text(paid - refunded),
        "refunded": decimal_text(refunded),
        "balance": decimal_text(
            Decimal(0)
            if row.reservation_id or row.status == "CANCELLED"
            else row.total - paid + refunded
        ),
        "bookingId": row.reservation_id,
        "createdAt": iso(row.created_at),
        "postedAt": iso(row.posted_at),
        "cancelledAt": iso(row.cancelled_at),
        "cancellationReason": row.cancellation_reason,
        "actorId": row.user_id,
        "payments": payments,
    }


def invoice_list_json(rows):
    """Load immutable children once for a page rather than once for every invoice."""
    rows = list(rows)
    if not rows:
        return []
    tenant_id, ids = rows[0].tenant_id, [row.id for row in rows]
    data = {}
    for key, model, ordering in (
        ("items", PosInvoiceItem, (PosInvoiceItem.id,)),
        ("payments", PosPayment, (PosPayment.created_at, PosPayment.id)),
        ("refunds", PosRefund, (PosRefund.created_at, PosRefund.id)),
    ):
        grouped = {}
        for child in db.session.scalars(
            select(model)
            .where(model.tenant_id == tenant_id, model.invoice_id.in_(ids))
            .order_by(*ordering)
        ):
            grouped.setdefault(child.invoice_id, []).append(child)
        data[key] = grouped
    return [invoice_json(row, data) for row in rows]


def pagination():
    try:
        page, size = int(request.args.get("page", "1")), int(request.args.get("pageSize", "100"))
    except ValueError:
        raise ApiError(422, "invalid_pagination", "Phân trang không hợp lệ.") from None
    if not 1 <= page <= 100000 or not 1 <= size <= 500:
        raise ApiError(422, "invalid_pagination", "Kích thước trang phải từ 1 đến 500.")
    return page, size


def invoice_snapshot(tenant_id):
    return {
        "posInvoices": invoice_list_json(
            db.session.scalars(
                select(PosInvoice)
                .where(PosInvoice.tenant_id == tenant_id)
                .order_by(PosInvoice.created_at.desc(), PosInvoice.id)
                .limit(SNAPSHOT_LIMIT)
            )
        )
    }


class ListInvoicesView(CommonMethodView):
    @staticmethod
    @require_tenant("pos.view")
    def dispatch_request(tenant_id):
        page, size = pagination()
        conditions = [PosInvoice.tenant_id == tenant_id]
        query = string_value(request.args.get("q", ""), "Tìm kiếm", 160)
        if query:
            conditions.append(
                or_(
                    PosInvoice.id.icontains(query, autoescape=True),
                    PosInvoice.customer_name.icontains(query, autoescape=True),
                    PosInvoice.note.icontains(query, autoescape=True),
                )
            )
        if request.args.get("status"):
            status = request.args["status"]
            if status not in {"DRAFT", "POSTED", "CANCELLED"}:
                raise ApiError(422, "invalid_status", "Trạng thái hóa đơn không hợp lệ.")
            conditions.append(PosInvoice.status == status)
        total = db.session.scalar(select(func.count()).select_from(PosInvoice).where(*conditions))
        rows = db.session.scalars(
            select(PosInvoice)
            .where(*conditions)
            .order_by(PosInvoice.created_at.desc(), PosInvoice.id)
            .offset((page - 1) * size)
            .limit(size)
        )
        return {
            "posInvoices": invoice_list_json(rows),
            "pagination": {"page": page, "pageSize": size, "totalItems": total},
        }


class GetInvoiceView(CommonMethodView):
    @staticmethod
    @require_tenant("pos.view")
    def dispatch_request(tenant_id, invoice_id):
        return invoice_json(invoice_row(tenant_id, invoice_id))


class CreateInvoiceView(CommonMethodView):
    @staticmethod
    @require_tenant("pos.write")
    def dispatch_request(tenant_id):
        data = payload()
        key, fingerprint, replay = begin(tenant_id, data)
        if replay is not None:
            return replay, 201
        currency = tenant_currency(tenant_id)
        if data.get("currency", currency) != currency:
            raise ApiError(409, "currency_mismatch", "Hóa đơn phải dùng loại tiền của khách sạn.")
        items = invoice_items(tenant_id, data.get("items"))
        row = PosInvoice(
            tenant_id=tenant_id,
            currency=currency,
            draft_items=items,
            total=sum((Decimal(item["amount"]) for item in items), Decimal(0)),
            customer_name=string_value(data.get("customerName", ""), "Tên khách", 160),
            note=string_value(data.get("note", ""), "Ghi chú", 500),
            user_id=g.user.id,
            **snapshot_money(
                tenant_id, currency, sum((Decimal(item["amount"]) for item in items), Decimal(0))
            ),
        )
        db.session.add(row)
        db.session.flush()
        audit("pos.create", "pos_invoice", row.id, {"total": decimal_text(row.total)})
        return finish(tenant_id, key, fingerprint, invoice_json(row))


class EditInvoiceView(CommonMethodView):
    @staticmethod
    @require_tenant("pos.write")
    def dispatch_request(tenant_id, invoice_id):
        data = payload()
        row = invoice_row(tenant_id, invoice_id, locked=True)
        key, fingerprint, replay = begin(tenant_id, data)
        if replay is not None:
            return replay, 200
        if row.status != "DRAFT":
            raise ApiError(409, "invoice_posted", "Hóa đơn đã ghi sổ không thể sửa.")
        if set(data) - {"items", "customerName", "note"}:
            raise ApiError(
                422, "invalid_input", "Chỉ được sửa dịch vụ, tên khách và ghi chú bản nháp."
            )
        if "items" in data:
            row.draft_items = invoice_items(tenant_id, data["items"])
            row.total = sum((Decimal(item["amount"]) for item in row.draft_items), Decimal(0))
            row.base_amount = snapshot_money(tenant_id, row.currency, row.total, row)["base_amount"]
        for key_name, field, limit in [
            ("customerName", "customer_name", 160),
            ("note", "note", 500),
        ]:
            if key_name in data:
                setattr(row, field, string_value(data[key_name], key_name, limit))
        db.session.flush()
        audit("pos.edit", "pos_invoice", row.id)
        return finish(tenant_id, key, fingerprint, invoice_json(row), 200)


class PostInvoiceView(CommonMethodView):
    @staticmethod
    @require_tenant("pos.write")
    def dispatch_request(tenant_id, invoice_id):
        data = payload()
        booking_id = string_value(data.get("bookingId"), "Đặt phòng", 40) or None
        # Reservation first matches booking writes and prevents a checkout/post race.
        booking = find_reservation(tenant_id, booking_id, locked=True) if booking_id else None
        row = invoice_row(tenant_id, invoice_id, locked=True)
        key, fingerprint, replay = begin(tenant_id, data)
        if replay is not None:
            return replay, 201
        if row.status != "DRAFT":
            raise ApiError(409, "invoice_posted", "Hóa đơn đã ghi sổ hoặc đã hủy.")
        if booking and (booking.status not in ACTIVE or booking.currency != row.currency):
            raise ApiError(409, "invalid_booking", "Chỉ ghi vào đặt phòng đang mở và cùng tiền tệ.")
        row.reservation_id = booking.id if booking else None
        for item in row.draft_items:
            master(tenant_id, "services", item["serviceId"], read_lock=True)
            charge = None
            if booking:
                charge = Charge(
                    tenant_id=tenant_id,
                    reservation_id=booking.id,
                    service_id=item["serviceId"],
                    description=item["description"],
                    kind="service",
                    quantity=Decimal(item["quantity"]),
                    unit_price=Decimal(item["unitPrice"]),
                    amount=Decimal(item["amount"]),
                    currency=row.currency,
                    user_id=g.user.id,
                    **snapshot_money(tenant_id, row.currency, Decimal(item["amount"]), booking),
                )
                db.session.add(charge)
                db.session.flush()
            db.session.add(
                PosInvoiceItem(
                    tenant_id=tenant_id,
                    invoice_id=row.id,
                    service_id=item["serviceId"],
                    charge_id=charge.id if charge else None,
                    description=item["description"],
                    quantity=Decimal(item["quantity"]),
                    unit_price=Decimal(item["unitPrice"]),
                    amount=Decimal(item["amount"]),
                    **snapshot_money(tenant_id, row.currency, Decimal(item["amount"]), row),
                )
            )
        from ..inventory.routes import consume_pos

        consume_pos(row)
        row.status, row.posted_at = "POSTED", utcnow()
        db.session.flush()
        audit("pos.post", "pos_invoice", row.id, {"bookingId": row.reservation_id})
        if booking:
            audit(
                "reservation.pos",
                "reservation",
                booking.id,
                {"invoiceId": row.id, "amount": decimal_text(row.total)},
            )
        return finish(tenant_id, key, fingerprint, invoice_json(row))


def retail_open(row):
    if row.status != "POSTED" or row.reservation_id:
        raise ApiError(409, "invoice_closed", "Chỉ thu/hoàn tiền hóa đơn bán lẻ đã ghi sổ.")


class PayInvoiceView(CommonMethodView):
    @staticmethod
    @require_tenant("payments.write")
    def dispatch_request(tenant_id, invoice_id):
        data = payload()
        row = invoice_row(tenant_id, invoice_id, locked=True)
        key, fingerprint, replay = begin(tenant_id, data)
        if replay is not None:
            return replay, 201
        retail_open(row)
        amount = money_value(data.get("amount"))
        paid, refunded = payment_totals(row)
        if amount > row.total - paid + refunded:
            raise ApiError(409, "overpayment", "Số tiền vượt phần còn phải thu.")
        method = master(tenant_id, "paymentMethods", data.get("methodId"), read_lock=True)
        fund_id = string_value(data.get("fundId"), "Quỹ", 40, required=True)
        fund = lock_funds(tenant_id, [fund_id], row.currency)[fund_id]
        payment = PosPayment(
            tenant_id=tenant_id,
            invoice_id=row.id,
            amount=amount,
            currency=row.currency,
            method_id=method.id,
            method_name=method.name,
            fund_id=fund.id,
            fund_name=fund.name,
            note=string_value(data.get("note", ""), "Ghi chú", 500),
            user_id=g.user.id,
            **snapshot_money(tenant_id, row.currency, amount, row),
        )
        db.session.add(payment)
        db.session.flush()
        ledger(
            tenant_id,
            fund.id,
            row.currency,
            amount,
            "pos_payment",
            payment.note or f"Thu POS {row.id}",
            pos_invoice_id=row.id,
            pos_payment_id=payment.id,
            source=payment,
        )
        db.session.flush()
        audit(
            "pos.payment",
            "pos_invoice",
            row.id,
            {"paymentId": payment.id, "amount": decimal_text(amount)},
        )
        return finish(tenant_id, key, fingerprint, invoice_json(row))


def refund_pos(row, payment, amount, reason):
    refunded = Decimal(
        db.session.scalar(
            select(func.coalesce(func.sum(PosRefund.amount), 0)).where(
                PosRefund.tenant_id == row.tenant_id, PosRefund.payment_id == payment.id
            )
        )
    )
    if amount > payment.amount - refunded:
        raise ApiError(409, "over_refund", "Số hoàn vượt khoản thanh toán còn lại.")
    ensure_available(row.tenant_id, payment.fund_id, row.currency, amount)
    refund = PosRefund(
        tenant_id=row.tenant_id,
        invoice_id=row.id,
        payment_id=payment.id,
        amount=amount,
        currency=row.currency,
        reason=reason,
        user_id=g.user.id,
        **snapshot_money(row.tenant_id, row.currency, amount, payment),
    )
    refunded_base = db.session.scalar(
        select(func.coalesce(func.sum(PosRefund.base_amount), 0)).where(
            PosRefund.tenant_id == row.tenant_id, PosRefund.payment_id == payment.id
        )
    )
    remaining_base = payment.base_amount - refunded_base
    cumulative_base = snapshot_money(row.tenant_id, row.currency, refunded + amount, payment)[
        "base_amount"
    ]
    refund.base_amount = (
        remaining_base
        if amount == payment.amount - refunded
        else min(remaining_base, max(Decimal(0), cumulative_base - refunded_base))
    )
    db.session.add(refund)
    db.session.flush()
    ledger(
        row.tenant_id,
        payment.fund_id,
        row.currency,
        -amount,
        "pos_refund",
        reason,
        pos_invoice_id=row.id,
        pos_refund_id=refund.id,
        source=payment,
        base_amount=-refund.base_amount,
    )
    db.session.flush()
    return refund


class RefundInvoiceView(CommonMethodView):
    @staticmethod
    @require_tenant("payments.write")
    def dispatch_request(tenant_id, invoice_id, payment_id):
        data = payload()
        row = invoice_row(tenant_id, invoice_id, locked=True)
        key, fingerprint, replay = begin(tenant_id, data)
        if replay is not None:
            return replay, 201
        retail_open(row)
        payment = db.session.scalar(
            select(PosPayment).where(
                PosPayment.tenant_id == tenant_id,
                PosPayment.invoice_id == row.id,
                PosPayment.id == payment_id,
            )
        )
        if not payment:
            raise ApiError(404, "not_found", "Không tìm thấy khoản thanh toán POS.")
        amount = money_value(data.get("amount"))
        reason = string_value(data.get("reason"), "Lý do", 500, required=True)
        lock_funds(tenant_id, [payment.fund_id], row.currency, allow_inactive=True)
        refund = refund_pos(row, payment, amount, reason)
        audit(
            "pos.refund",
            "pos_invoice",
            row.id,
            {"refundId": refund.id, "paymentId": payment.id, "amount": decimal_text(amount)},
        )
        return finish(tenant_id, key, fingerprint, invoice_json(row))


class CancelInvoiceView(CommonMethodView):
    @staticmethod
    @require_tenant("pos.cancel")
    def dispatch_request(tenant_id, invoice_id):
        data = payload()
        existing = invoice_row(tenant_id, invoice_id)
        booking_id = existing.reservation_id
        booking = find_reservation(tenant_id, booking_id, locked=True) if booking_id else None
        row = invoice_row(tenant_id, invoice_id, locked=True)
        key, fingerprint, replay = begin(tenant_id, data)
        if replay is not None:
            return replay, 201
        if row.reservation_id != booking_id:
            raise ApiError(
                409, "invoice_changed", "Hóa đơn vừa được chuyển vào đặt phòng. Vui lòng thử lại."
            )
        if row.status == "CANCELLED":
            raise ApiError(409, "invoice_closed", "Hóa đơn đã hủy.")
        reason = string_value(data.get("reason"), "Lý do hủy", 500, required=True)
        if booking:
            if booking.status not in ACTIVE:
                raise ApiError(
                    409, "stay_closed", "Đặt phòng đã đóng; không thể hủy POS đã chuyển vào phòng."
                )
            total, paid, _ = totals(booking)
            if total - row.total < paid:
                raise ApiError(
                    409, "refund_required", "Cần hoàn tiền đặt phòng trước khi hủy dịch vụ POS."
                )
            for item in db.session.scalars(
                select(PosInvoiceItem).where(
                    PosInvoiceItem.tenant_id == tenant_id, PosInvoiceItem.invoice_id == row.id
                )
            ):
                if item.amount:
                    db.session.add(
                        Charge(
                            tenant_id=tenant_id,
                            reservation_id=booking.id,
                            kind="discount",
                            description=f"Hủy POS {row.id}: {item.description}"[:240],
                            quantity=item.quantity,
                            unit_price=item.unit_price,
                            amount=-item.amount,
                            currency=row.currency,
                            user_id=g.user.id,
                            **snapshot_money(tenant_id, row.currency, -item.amount, item),
                        )
                    )
            audit(
                "reservation.pos_cancel",
                "reservation",
                booking.id,
                {"invoiceId": row.id, "reason": reason, "amount": decimal_text(-row.total)},
            )
        elif row.status == "POSTED":
            payments = list(
                db.session.scalars(
                    select(PosPayment)
                    .where(PosPayment.tenant_id == tenant_id, PosPayment.invoice_id == row.id)
                    .order_by(PosPayment.created_at, PosPayment.id)
                )
            )
            lock_funds(
                tenant_id,
                [payment.fund_id for payment in payments],
                row.currency,
                allow_inactive=True,
            )
            for payment in payments:
                refunded = Decimal(
                    db.session.scalar(
                        select(func.coalesce(func.sum(PosRefund.amount), 0)).where(
                            PosRefund.tenant_id == tenant_id, PosRefund.payment_id == payment.id
                        )
                    )
                )
                if payment.amount > refunded:
                    refund_pos(row, payment, payment.amount - refunded, reason)
        from ..inventory.routes import cancel_pos_stock

        cancel_pos_stock(row, reason)
        row.status, row.cancelled_at, row.cancellation_reason = "CANCELLED", utcnow(), reason
        db.session.flush()
        audit("pos.cancel", "pos_invoice", row.id, {"reason": reason})
        return finish(tenant_id, key, fingerprint, invoice_json(row))


def document_json(row):
    return {
        "id": row.id,
        **money_json(row),
        "type": row.kind,
        "fundId": row.fund_id,
        "fund": row.fund_name,
        "toFundId": row.to_fund_id,
        "toFund": row.to_fund_name,
        "amount": decimal_text(row.amount),
        "currency": row.currency,
        "description": row.description,
        "date": iso(row.effective_date),
        "createdAt": iso(row.created_at),
        "actorId": row.user_id,
        "reversalOfId": row.reversal_of_id,
        "categoryId": row.category_id,
        "categoryName": row.category_name,
        "categoryType": row.category_type,
    }


def cash_category(tenant_id, kind, category_id):
    if category_id is None:
        return None
    if kind not in {"receipt", "expense"}:
        raise ApiError(422, "invalid_category", "Chỉ phiếu thu và phiếu chi có danh mục.")
    category_id = string_value(category_id, "Danh mục thu chi", 40, required=True)
    category = db.session.scalar(
        select(Master)
        .where(
            Master.tenant_id == tenant_id,
            Master.catalog == "cashbookCategories",
            Master.id == category_id,
            Master.active.is_(True),
        )
        .with_for_update(read=True)
        .execution_options(populate_existing=True)
    )
    direction = "INCOME" if kind == "receipt" else "EXPENSE"
    if category is None or category.data.get("type") != direction:
        raise ApiError(
            422,
            "invalid_category",
            "Danh mục không tồn tại, đã ngừng hoặc sai loại thu chi.",
        )
    return category


class CreateDocumentView(CommonMethodView):
    @staticmethod
    @require_tenant("cashbook.write")
    def dispatch_request(tenant_id):
        data = payload()
        key, fingerprint, replay = begin(tenant_id, data)
        if replay is not None:
            return replay, 201
        kind = data.get("type")
        if not isinstance(kind, str) or kind not in {
            "receipt",
            "expense",
            "withdrawal",
            "transfer",
            "opening",
        }:
            raise ApiError(422, "invalid_type", "Loại chứng từ không hợp lệ.")
        category = cash_category(tenant_id, kind, data.get("categoryId"))
        base_currency = tenant_currency(tenant_id)
        currency = data.get("currency", base_currency)
        if currency != base_currency and not feature_enabled("MULTI_CURRENCY", for_write=True):
            raise ApiError(403, "feature_disabled", "Gói chưa bật đa tiền tệ.")
        exchange_snapshot(tenant_id, currency)
        amount = money_value(data.get("amount"), allow_zero=kind == "opening")
        fund_id = string_value(data.get("fundId"), "Quỹ", 40, required=True)
        to_fund_id = (
            string_value(data.get("toFundId"), "Quỹ nhận", 40, required=kind == "transfer") or None
        )
        if kind != "transfer" and to_fund_id or kind == "transfer" and fund_id == to_fund_id:
            raise ApiError(422, "invalid_funds", "Chuyển quỹ cần hai quỹ khác nhau.")
        funds = lock_funds(tenant_id, [fund_id, to_fund_id] if to_fund_id else [fund_id], currency)
        effective_date = local_date()
        if kind == "opening":
            effective_date = parse_date(data.get("date", effective_date.isoformat()))
            if effective_date > local_date():
                raise ApiError(422, "invalid_dates", "Số dư đầu kỳ không được ở ngày tương lai.")
            existing = db.session.scalar(
                select(CashDocument.id).where(
                    CashDocument.tenant_id == tenant_id,
                    CashDocument.fund_id == fund_id,
                    CashDocument.currency == currency,
                    CashDocument.kind == "opening",
                )
            )
            if existing:
                raise ApiError(409, "opening_exists", "Quỹ đã nhập số dư đầu kỳ.")
            historical = list(
                db.session.scalars(
                    select(LedgerEntry).where(
                        LedgerEntry.tenant_id == tenant_id,
                        LedgerEntry.fund_id == fund_id,
                        LedgerEntry.currency == currency,
                    )
                )
            )
            if any(
                effective_date >= (entry.booked_at or local_date(entry.created_at))
                for entry in historical
            ):
                raise ApiError(
                    409, "opening_date", "Ngày đầu kỳ phải trước mọi giao dịch đã có của quỹ."
                )
        elif "date" in data:
            raise ApiError(422, "invalid_dates", "Chỉ số dư đầu kỳ cho phép chọn ngày ghi sổ.")
        description = string_value(data.get("description"), "Diễn giải", 500, required=True)
        if kind in {"expense", "withdrawal", "transfer"}:
            ensure_available(tenant_id, fund_id, currency, amount)
        row = CashDocument(
            tenant_id=tenant_id,
            kind=kind,
            fund_id=fund_id,
            to_fund_id=to_fund_id,
            fund_name=funds[fund_id].name,
            to_fund_name=funds[to_fund_id].name if to_fund_id else None,
            amount=amount,
            currency=currency,
            description=description,
            effective_date=effective_date,
            category_id=category.id if category else None,
            category_name=category.name if category else None,
            category_type=category.data["type"] if category else None,
            user_id=g.user.id,
            **snapshot_money(tenant_id, currency, amount),
        )
        db.session.add(row)
        db.session.flush()
        entry_kind = "transfer_out" if kind == "transfer" else kind
        sign = -1 if kind in {"expense", "withdrawal", "transfer"} else 1
        ledger(
            tenant_id,
            fund_id,
            currency,
            sign * amount,
            entry_kind,
            description,
            cash_document_id=row.id,
            booked_at=effective_date,
            source=row,
        )
        if to_fund_id:
            ledger(
                tenant_id,
                to_fund_id,
                currency,
                amount,
                "transfer_in",
                description,
                cash_document_id=row.id,
                booked_at=effective_date,
                source=row,
            )
        audit(
            "cash.create",
            "cash_document",
            row.id,
            {
                "type": kind,
                "amount": decimal_text(amount),
                "fundId": fund_id,
                "toFundId": to_fund_id,
            },
        )
        return finish(tenant_id, key, fingerprint, document_json(row))


class ReverseDocumentView(CommonMethodView):
    @staticmethod
    @require_tenant("cashbook.reverse")
    def dispatch_request(tenant_id, document_id):
        data = payload()
        original = db.session.scalar(
            select(CashDocument)
            .where(CashDocument.tenant_id == tenant_id, CashDocument.id == document_id)
            .with_for_update()
        )
        if not original:
            raise ApiError(404, "not_found", "Không tìm thấy chứng từ.")
        key, fingerprint, replay = begin(tenant_id, data)
        if replay is not None:
            return replay, 201
        if original.kind == "reversal" or original.amount == 0:
            raise ApiError(409, "invalid_reversal", "Không thể đảo chứng từ này.")
        if db.session.scalar(
            select(CashDocument.id).where(
                CashDocument.tenant_id == tenant_id, CashDocument.reversal_of_id == original.id
            )
        ):
            raise ApiError(409, "already_reversed", "Chứng từ đã được đảo.")
        reason = string_value(data.get("reason"), "Lý do đảo", 500, required=True)
        entries = list(
            db.session.scalars(
                select(LedgerEntry).where(
                    LedgerEntry.tenant_id == tenant_id, LedgerEntry.cash_document_id == original.id
                )
            )
        )
        lock_funds(
            tenant_id, [entry.fund_id for entry in entries], original.currency, allow_inactive=True
        )
        for entry in entries:
            if entry.amount > 0:
                ensure_available(tenant_id, entry.fund_id, original.currency, entry.amount)
        row = CashDocument(
            tenant_id=tenant_id,
            kind="reversal",
            fund_id=original.fund_id,
            to_fund_id=original.to_fund_id,
            fund_name=original.fund_name,
            to_fund_name=original.to_fund_name,
            amount=original.amount,
            currency=original.currency,
            description=reason,
            effective_date=local_date(),
            reversal_of_id=original.id,
            category_id=original.category_id,
            category_name=original.category_name,
            category_type=original.category_type,
            user_id=g.user.id,
            **snapshot_money(tenant_id, original.currency, original.amount, original),
        )
        db.session.add(row)
        db.session.flush()
        for entry in entries:
            ledger(
                tenant_id,
                entry.fund_id,
                entry.currency,
                -entry.amount,
                "reversal",
                reason,
                cash_document_id=row.id,
                reversal_of_id=entry.id,
                source=entry,
                base_amount=-entry.base_amount,
            )
        audit(
            "cash.reverse", "cash_document", row.id, {"reversalOfId": original.id, "reason": reason}
        )
        return finish(tenant_id, key, fingerprint, document_json(row))


def ledger_json(row):
    return {
        "id": row.id,
        **money_json(row),
        "bookingId": row.reservation_id,
        "paymentId": row.payment_id,
        "refundId": row.refund_id,
        "posInvoiceId": row.pos_invoice_id,
        "posPaymentId": row.pos_payment_id,
        "posRefundId": row.pos_refund_id,
        "cashDocumentId": row.cash_document_id,
        "reversalOfId": row.reversal_of_id,
        "fundId": row.fund_id,
        "type": row.kind,
        "amount": decimal_text(row.amount),
        "currency": row.currency,
        "description": row.description,
        "userId": row.user_id,
        "createdAt": iso(row.created_at),
        "date": iso(row.booked_at or local_date(row.created_at)),
    }


def finance_snapshot(tenant_id):
    return {
        **invoice_snapshot(tenant_id),
        "cashbookActors": [
            {"id": actor.id, "name": actor.name}
            for actor in db.session.scalars(
                select(User)
                .where(
                    User.id.in_(
                        select(LedgerEntry.user_id).where(LedgerEntry.tenant_id == tenant_id)
                    )
                )
                .order_by(User.name)
            )
        ],
        "cashDocuments": [
            document_json(row)
            for row in db.session.scalars(
                select(CashDocument)
                .where(CashDocument.tenant_id == tenant_id)
                .order_by(CashDocument.created_at.desc(), CashDocument.id)
                .limit(SNAPSHOT_LIMIT)
            )
        ],
        "ledger": [
            ledger_json(row)
            for row in db.session.scalars(
                select(LedgerEntry)
                .where(LedgerEntry.tenant_id == tenant_id)
                .order_by(LedgerEntry.created_at.desc(), LedgerEntry.id)
                .limit(SNAPSHOT_LIMIT)
            )
        ],
    }


CASHBOOK_SEARCH_LIMIT = 160
CASHBOOK_SEARCH_FIELDS = (
    "description",
    "id",
    "cash_document_id",
    "reservation_id",
    "pos_invoice_id",
    "payment_id",
    "refund_id",
    "pos_payment_id",
    "pos_refund_id",
    "reversal_of_id",
)


def cashbook_search_key(value):
    """Literal caseless key: NFC before and after casefold so composed forms compare equal."""
    return unicodedata.normalize("NFC", unicodedata.normalize("NFC", value).casefold())


def cashbook_search_query():
    """Validate the raw ``q`` argument without touching the database."""
    values = request.args.getlist("q")
    if len(values) > 1:
        raise ApiError(422, "invalid_filter", "Chỉ được gửi một từ khóa tìm kiếm.")
    raw = values[0] if values else ""
    if any(unicodedata.category(character) == "Cc" for character in raw):
        raise ApiError(422, "invalid_filter", "Từ khóa tìm kiếm chứa ký tự điều khiển.")
    query = unicodedata.normalize("NFC", raw.strip())
    if len(query) > CASHBOOK_SEARCH_LIMIT:
        raise ApiError(422, "invalid_filter", "Từ khóa tìm kiếm tối đa 160 ký tự.")
    return query


def cashbook_search_match(row, needle):
    return any(
        needle in cashbook_search_key(value)
        for value in (getattr(row, field) for field in CASHBOOK_SEARCH_FIELDS)
        if value
    )


class CashbookView(CommonMethodView):
    @staticmethod
    @require_tenant("cashbook.view")
    def dispatch_request(tenant_id):
        page, size = pagination()
        search = cashbook_search_query()
        currency = request.args.get("currency", (g.tenant.settings or {}).get("currency", "VND"))
        if not is_hotel_currency(currency):
            raise ApiError(422, "invalid_currency", "Loại tiền tệ không hợp lệ.")
        start_value, end_value = RequestData.date_range(aliases=("startDate", "endDate"))
        start = parse_date(start_value) if start_value else None
        end = (
            parse_date(end_value)
            if end_value
            else None
            if request.args.get("documentId")
            else local_date()
        )
        if start and end and end < start:
            raise ApiError(422, "invalid_dates", "Ngày kết thúc phải từ ngày bắt đầu.")
        conditions = [LedgerEntry.tenant_id == tenant_id, LedgerEntry.currency == currency]
        fund_type = request.args.get("fundType")
        fund_conditions = [Master.tenant_id == tenant_id, Master.catalog == "funds"]
        if fund_type:
            if fund_type not in {"cash", "bank"}:
                raise ApiError(422, "invalid_fund_type", "Loại quỹ phải là cash hoặc bank.")
            fund_conditions.append(func.coalesce(Master.data["type"].astext, "cash") == fund_type)
            conditions.append(LedgerEntry.fund_id.in_(select(Master.id).where(*fund_conditions)))
        if request.args.get("fundId"):
            fund_conditions.append(Master.id == request.args["fundId"])
        for query, column in [("fundId", LedgerEntry.fund_id), ("actorId", LedgerEntry.user_id)]:
            if request.args.get(query):
                conditions.append(
                    column == string_value(request.args[query], query, 40, required=True)
                )
        if request.args.get("documentId"):
            document_id = string_value(
                request.args["documentId"], "Phiếu thu chi", 40, required=True
            )
            conditions.append(
                LedgerEntry.cash_document_id.in_(
                    select(CashDocument.id).where(
                        CashDocument.tenant_id == tenant_id,
                        or_(
                            CashDocument.id == document_id,
                            CashDocument.reversal_of_id == document_id,
                        ),
                    )
                )
            )
        if request.args.get("categoryId"):
            category_id = string_value(
                request.args["categoryId"], "Danh mục thu chi", 40, required=True
            )
            documents = select(CashDocument.id).where(CashDocument.tenant_id == tenant_id)
            if category_id == "uncategorized":
                categorized = documents.where(CashDocument.category_id.is_not(None))
                conditions.append(
                    or_(
                        LedgerEntry.cash_document_id.is_(None),
                        LedgerEntry.cash_document_id.not_in(categorized),
                    )
                )
            else:
                category = db.session.scalar(
                    select(Master.id).where(
                        Master.tenant_id == tenant_id,
                        Master.catalog == "cashbookCategories",
                        Master.id == category_id,
                    )
                )
                if category is None:
                    raise ApiError(
                        422, "invalid_category", "Danh mục thu chi không tồn tại ở khách sạn này."
                    )
                conditions.append(
                    LedgerEntry.cash_document_id.in_(
                        documents.where(CashDocument.category_id == category_id)
                    )
                )
        rows = list(
            db.session.scalars(
                select(LedgerEntry)
                .where(*conditions)
                .order_by(LedgerEntry.created_at, LedgerEntry.id)
            )
        )
        opening = sum(
            (
                row.amount
                for row in rows
                if start and (row.booked_at or local_date(row.created_at)) < start
            ),
            Decimal(0),
        )
        period = [
            row
            for row in rows
            if (not start or (row.booked_at or local_date(row.created_at)) >= start)
            and (not end or (row.booked_at or local_date(row.created_at)) <= end)
        ]
        income = sum((row.amount for row in period if row.amount > 0), Decimal(0))
        outflow = -sum((row.amount for row in period if row.amount < 0), Decimal(0))
        funds = list(db.session.scalars(select(Master).where(*fund_conditions).order_by(Master.id)))
        period_items = len(period)
        if search:
            # Search narrows the listed rows over the whole period; totals above stay period-wide.
            needle = cashbook_search_key(search)
            period = [row for row in period if cashbook_search_match(row, needle)]
        period.reverse()
        page_rows = period[(page - 1) * size : page * size]
        document_ids = {row.cash_document_id for row in page_rows if row.cash_document_id}
        documents = list(
            db.session.scalars(
                select(CashDocument)
                .where(
                    CashDocument.tenant_id == tenant_id,
                    CashDocument.currency == currency,
                    or_(
                        CashDocument.id.in_(document_ids),
                        CashDocument.reversal_of_id.in_(document_ids),
                    ),
                )
                .order_by(CashDocument.created_at.desc(), CashDocument.id)
            )
        )
        result = {
            "ledger": [ledger_json(row) for row in page_rows],
            "cashDocuments": [document_json(row) for row in documents],
            "summary": {
                "opening": decimal_text(opening),
                "income": decimal_text(income),
                "outflow": decimal_text(outflow),
                "closing": decimal_text(opening + income - outflow),
                "currency": currency,
                "startDate": iso(start),
                "endDate": iso(end),
            },
            "fundBalances": [
                {
                    "fundId": fund.id,
                    "fund": fund.name,
                    "currency": currency,
                    "balance": decimal_text(fund_balance(tenant_id, fund.id, currency)),
                }
                for fund in funds
            ],
            "pagination": {"page": page, "pageSize": size, "totalItems": len(period)},
        }
        if search:
            result["search"] = {
                "q": search,
                "scope": "ledger_entries",
                "summaryFiltered": False,
                "totalPeriodItems": period_items,
            }
        return result


def __getattr__(name):
    if name in {"URL", "finance"}:
        from importlib import import_module

        return getattr(import_module(".urls", __package__), name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
