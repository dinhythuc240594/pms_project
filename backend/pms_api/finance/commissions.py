"""Reconcile frozen room-net commissions and pay through the shared cash ledger."""

import hashlib
import json
from collections import defaultdict
from decimal import Decimal, InvalidOperation

from flask import g, request
from sqlalchemy import case, func, or_, select, union_all
from sqlalchemy.orm import aliased

from common import CommonMethodView, RequestData

from ..bookings.models import Charge, Refund, Reservation, ReservationNight
from ..bookings.routes import decimal_text, find_reservation, iso, money_value, string_value
from ..channels.models import ChannelBooking, ChannelBookingReview
from ..currencies import is_hotel_currency
from ..extensions import db
from ..pricing.engine import money_json, rounded, snapshot_money
from ..security import ApiError, audit, payload, require_tenant
from ..subscriptions import feature_enabled
from .models import (
    CashDocument,
    CommissionPayout,
    CommissionRecovery,
    CommissionReview,
    CommissionSettlement,
)
from .routes import (
    begin,
    cash_category,
    ensure_available,
    finish,
    ledger,
    local_date,
    lock_funds,
    pagination,
    parse_date,
)


def latest_review(column, tenant_id):
    return (
        select(column)
        .where(
            CommissionReview.tenant_id == tenant_id,
            CommissionReview.commission_id == CommissionSettlement.id,
        )
        .order_by(CommissionReview.created_at.desc(), CommissionReview.id.desc())
        .limit(1)
        .correlate(CommissionSettlement)
        .scalar_subquery()
    )


def reviewed_evidence(tenant_id):
    return (
        select(CommissionReview.evidence)
        .join(
            CommissionSettlement,
            (CommissionSettlement.tenant_id == CommissionReview.tenant_id)
            & (CommissionSettlement.id == CommissionReview.commission_id),
        )
        .where(
            CommissionReview.tenant_id == tenant_id,
            CommissionSettlement.reservation_id == Reservation.id,
        )
        .order_by(CommissionReview.created_at.desc(), CommissionReview.id.desc())
        .limit(1)
        .correlate(Reservation)
        .scalar_subquery()
    )


def pending_ota(tenant_id):
    return (
        select(ChannelBookingReview.id)
        .join(
            ChannelBooking,
            (ChannelBooking.tenant_id == ChannelBookingReview.tenant_id)
            & (ChannelBooking.booking_id == ChannelBookingReview.booking_id),
        )
        .where(
            ChannelBookingReview.tenant_id == tenant_id,
            ChannelBooking.reservation_id == Reservation.id,
            ChannelBookingReview.resolved_at.is_(None),
        )
        .correlate(Reservation)
        .exists()
    )


def review_condition(tenant_id):
    evidence = reviewed_evidence(tenant_id)
    resolution = Reservation.pricing_snapshot["channel"]["lastManualResolutionId"].astext
    after_checkout = func.coalesce(Reservation.checked_out_at, Reservation.created_at)
    return or_(
        Reservation.status != "CHECKED_OUT",
        resolution.is_not(None)
        & resolution.is_distinct_from(evidence["manualResolutionId"].astext),
        pending_ota(tenant_id),
        select(Charge.id)
        .where(
            Charge.tenant_id == tenant_id,
            Charge.reservation_id == Reservation.id,
            or_(Charge.created_at > after_checkout, Charge.kind == "discount"),
            ~func.coalesce(evidence["chargeIds"].op("?")(Charge.id), False),
        )
        .correlate(Reservation)
        .exists(),
        select(Refund.id)
        .where(
            Refund.tenant_id == tenant_id,
            Refund.reservation_id == Reservation.id,
            Refund.created_at > after_checkout,
            ~func.coalesce(evidence["refundIds"].op("?")(Refund.id), False),
        )
        .correlate(Reservation)
        .exists(),
    )


def review_booking_ids(bookings):
    return set(
        db.session.scalars(
            select(Reservation.id).where(
                Reservation.tenant_id == g.tenant.id,
                Reservation.id.in_([row.id for row in bookings]),
                review_condition(g.tenant.id),
            )
        )
    )


def cash_history(model, ids):
    rows = list(
        db.session.execute(
            select(model, CashDocument)
            .join(
                CashDocument,
                (CashDocument.tenant_id == model.tenant_id)
                & (CashDocument.id == model.cash_document_id),
            )
            .where(model.tenant_id == g.tenant.id, model.commission_id.in_(ids))
            .order_by(model.created_at, model.id)
        )
    )
    reversed_ids = set(
        db.session.scalars(
            select(CashDocument.reversal_of_id).where(
                CashDocument.tenant_id == g.tenant.id,
                CashDocument.reversal_of_id.in_([document.id for _, document in rows]),
            )
        )
    )
    histories, totals = defaultdict(list), defaultdict(lambda: Decimal(0))
    for link, document in rows:
        reversed_payment = document.id in reversed_ids
        if not reversed_payment:
            totals[link.commission_id] += document.amount
        histories[link.commission_id].append(
            {
                "id": link.id,
                "cashDocumentId": document.id,
                "fundId": document.fund_id,
                "amount": decimal_text(document.amount),
                "date": iso(document.effective_date),
                "note": document.description,
                "reversed": reversed_payment,
            }
        )
    return histories, totals


def commission_json(rows, bookings):
    by_booking = {row.id: row for row in bookings}
    ids = [row.id for row in rows]
    histories, paid = cash_history(CommissionPayout, ids)
    recoveries, recovered = cash_history(CommissionRecovery, ids)
    reviews = defaultdict(list)
    for decision in db.session.scalars(
        select(CommissionReview)
        .where(
            CommissionReview.tenant_id == g.tenant.id,
            CommissionReview.commission_id.in_(ids),
        )
        .order_by(CommissionReview.created_at, CommissionReview.id)
    ):
        reviews[decision.commission_id].append(decision)
    review = review_booking_ids(bookings)
    result = []
    for row in rows:
        latest = reviews[row.id][-1] if reviews[row.id] else row
        net_paid = paid[row.id] - recovered[row.id]
        remaining = latest.amount - net_paid
        needs_review = row.reservation_id in review
        status = (
            "NEEDS_REVIEW"
            if needs_review
            else "OVERPAID"
            if remaining < 0
            else "PAID"
            if remaining == 0
            else "PARTIAL"
            if net_paid > 0
            else "UNPAID"
        )
        booking = by_booking[row.reservation_id]
        result.append(
            {
                "id": row.id,
                "bookingId": row.reservation_id,
                "guestName": booking.guest_name,
                "sourceId": row.source_id,
                "sourceName": row.source_name,
                "percent": decimal_text(row.percent) if row.percent is not None else None,
                "calculationBasis": "provider_amount" if row.percent is None else "percent",
                "roomNet": decimal_text(latest.room_net),
                "baseRoomNet": decimal_text(latest.base_room_net),
                "amount": decimal_text(latest.amount),
                "currency": row.currency,
                **money_json(latest),
                "originalAmount": decimal_text(row.amount),
                "paid": decimal_text(net_paid),
                "balance": decimal_text(remaining),
                "recoveryDue": decimal_text(max(-remaining, Decimal(0))),
                "status": status,
                "needsReview": needs_review,
                "payments": histories[row.id],
                "recoveries": recoveries[row.id],
                "date": iso(row.business_date),
                "reviews": [
                    {
                        "id": decision.id,
                        "roomNet": decimal_text(decision.room_net),
                        "amount": decimal_text(decision.amount),
                        "reason": decision.reason,
                        "allocations": decision.allocations,
                        "actorId": decision.user_id,
                        "createdAt": iso(decision.created_at),
                    }
                    for decision in reviews[row.id]
                ],
            }
        )
    return result


def commission_row(tenant_id, commission_id):
    row = db.session.scalar(
        select(CommissionSettlement).where(
            CommissionSettlement.tenant_id == tenant_id,
            CommissionSettlement.id == commission_id,
        )
    )
    if row is None:
        raise ApiError(404, "not_found", "Không tìm thấy đối soát hoa hồng.")
    return row


def review_preview(row, booking):
    charges = list(
        db.session.scalars(
            select(Charge)
            .where(
                Charge.tenant_id == row.tenant_id,
                Charge.reservation_id == row.reservation_id,
            )
            .order_by(Charge.id)
        )
    )
    refunds = list(
        db.session.scalars(
            select(Refund)
            .where(
                Refund.tenant_id == row.tenant_id,
                Refund.reservation_id == row.reservation_id,
            )
            .order_by(Refund.id)
        )
    )
    nights = list(
        db.session.scalars(
            select(ReservationNight).where(
                ReservationNight.tenant_id == row.tenant_id,
                ReservationNight.reservation_id == row.reservation_id,
            )
        )
    )
    current = commission_json([row], [booking])[0]
    blocked = db.session.scalar(
        select(pending_ota(row.tenant_id))
        .select_from(Reservation)
        .where(
            Reservation.tenant_id == row.tenant_id,
            Reservation.id == booking.id,
        )
    )
    evidence = {
        "chargeIds": [charge.id for charge in charges],
        "refundIds": [refund.id for refund in refunds],
        "bookingVersion": booking.version,
        "manualResolutionId": (booking.pricing_snapshot.get("channel") or {}).get(
            "lastManualResolutionId"
        ),
        "providerCommission": booking.pricing_snapshot.get("commission"),
    }
    result = {
        "current": current,
        "evidence": evidence,
        "blockedByOta": bool(blocked),
        "roomSubtotal": decimal_text(sum((night.price for night in nights), Decimal(0))),
        "baseRoomSubtotal": decimal_text(sum((night.base_amount for night in nights), Decimal(0))),
        "charges": [
            {
                "id": charge.id,
                "kind": charge.kind,
                "description": charge.description,
                "amount": decimal_text(charge.amount),
                "baseAmount": decimal_text(charge.base_amount),
                "allocatable": charge.kind in {"fee", "discount"},
            }
            for charge in charges
        ],
        "refunds": [
            {"id": refund.id, "amount": decimal_text(refund.amount), "reason": refund.reason}
            for refund in refunds
        ],
    }
    token = hashlib.sha256(
        json.dumps(result, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()
    return {**result, "previewToken": token}


class CommissionReviewPreviewView(CommonMethodView):
    @staticmethod
    @require_tenant("cashbook.view")
    def dispatch_request(tenant_id, commission_id):
        row = commission_row(tenant_id, commission_id)
        return review_preview(row, find_reservation(tenant_id, row.reservation_id))


class ReviewCommissionView(CommonMethodView):
    @staticmethod
    @require_tenant("cashbook.write")
    def dispatch_request(tenant_id, commission_id):
        data = payload()
        if set(data) - {"previewToken", "allocations", "providerAmount", "reason"}:
            raise ApiError(
                422, "invalid_commission", "Thông tin đối soát có trường không được hỗ trợ."
            )
        key, fingerprint, replay = begin(tenant_id, data)
        if replay is not None:
            return replay, 201
        row = commission_row(tenant_id, commission_id)
        booking = find_reservation(tenant_id, row.reservation_id, locked=True)
        if booking.status != "CHECKED_OUT":
            raise ApiError(409, "stay_unsettled", "Chỉ đối soát hoa hồng sau khi trả phòng.")
        preview = review_preview(row, booking)
        if (
            not isinstance(data.get("previewToken"), str)
            or data["previewToken"] != preview["previewToken"]
        ):
            raise ApiError(
                409, "preview_changed", "Dữ liệu đã đổi. Tải lại bản xem trước để đối soát."
            )
        if preview["blockedByOta"]:
            raise ApiError(
                409, "commission_needs_review", "Cần xử lý booking OTA trước khi đối soát hoa hồng."
            )
        reason = string_value(data.get("reason"), "Lý do đối soát", 1000, required=True)
        expected = {charge["id"]: charge for charge in preview["charges"] if charge["allocatable"]}
        allocations = data.get("allocations")
        if not isinstance(allocations, list) or len(allocations) != len(expected):
            raise ApiError(
                422, "invalid_allocations", "Cần phân bổ từng khoản phí/giảm giá vào tiền phòng."
            )
        room_net, base_room_net = (
            Decimal(preview["roomSubtotal"]),
            Decimal(preview["baseRoomSubtotal"]),
        )
        seen, stored = set(), []
        for line in allocations:
            if (
                not isinstance(line, dict)
                or set(line) != {"chargeId", "roomAmount"}
                or not isinstance(line.get("chargeId"), str)
            ):
                raise ApiError(422, "invalid_allocations", "Phân bổ tiền phòng không hợp lệ.")
            charge = expected.get(line["chargeId"])
            if charge is None or line["chargeId"] in seen:
                raise ApiError(
                    422, "invalid_allocations", "Khoản phân bổ không thuộc lưu trú hoặc bị lặp."
                )
            try:
                amount = Decimal(str(line["roomAmount"]))
                if not amount.is_finite() or isinstance(line["roomAmount"], bool):
                    raise ValueError
                amount = money_value(abs(amount), allow_zero=True) * (-1 if amount < 0 else 1)
            except (InvalidOperation, TypeError, ValueError):
                raise ApiError(
                    422, "invalid_allocations", "Số tiền phân bổ không hợp lệ."
                ) from None
            original = Decimal(charge["amount"])
            if not min(original, Decimal(0)) <= amount <= max(original, Decimal(0)):
                raise ApiError(
                    422,
                    "invalid_allocations",
                    "Phần tiền phòng không được vượt khoản gốc hoặc trái dấu.",
                )
            base = (
                Decimal(charge["baseAmount"])
                if amount == original
                else rounded(amount * row.exchange_rate)
            )
            room_net += amount
            base_room_net += base
            seen.add(line["chargeId"])
            stored.append(
                {
                    "chargeId": line["chargeId"],
                    "roomAmount": decimal_text(amount),
                    "baseRoomAmount": decimal_text(base),
                }
            )
        if room_net < 0 or base_room_net < 0:
            raise ApiError(422, "invalid_allocations", "Tổng tiền phòng sau phân bổ không được âm.")
        money_value(room_net, allow_zero=True)
        money_value(base_room_net, allow_zero=True)
        if row.percent is None:
            amount = money_value(data.get("providerAmount"), allow_zero=True, limit=room_net)
        else:
            if "providerAmount" in data:
                raise ApiError(
                    422, "commission_rate_frozen", "Hoa hồng nguồn này dùng tỷ lệ đã lưu."
                )
            amount = rounded(room_net * row.percent / 100)
        money = snapshot_money(tenant_id, row.currency, amount, row)
        if row.percent is not None:
            money["base_amount"] = rounded(base_room_net * row.percent / 100)
        decision = CommissionReview(
            tenant_id=tenant_id,
            commission_id=row.id,
            room_net=room_net,
            base_room_net=base_room_net,
            amount=amount,
            reason=reason,
            evidence=preview["evidence"],
            allocations=stored,
            user_id=g.user.id,
            **money,
        )
        db.session.add(decision)
        db.session.flush()
        audit(
            "commission.reviewed",
            "commission",
            row.id,
            {
                "reviewId": decision.id,
                "reason": reason,
                "previousAmount": preview["current"]["amount"],
                "amount": decimal_text(amount),
            },
        )
        return finish(tenant_id, key, fingerprint, commission_json([row], [booking])[0])


class ListCommissionsView(CommonMethodView):
    @staticmethod
    @require_tenant("cashbook.view")
    def dispatch_request(tenant_id):
        page, size = pagination()
        currency = request.args.get("currency", (g.tenant.settings or {}).get("currency", "VND"))
        if not is_hotel_currency(currency):
            raise ApiError(422, "invalid_currency", "Tiền tệ không được hỗ trợ.")
        start_value, end_value = RequestData.date_range(aliases=("startDate", "endDate"))
        end = parse_date(end_value) if end_value else local_date()
        start = parse_date(start_value) if start_value else None
        if start and end < start:
            raise ApiError(422, "invalid_dates", "Ngày kết thúc phải từ ngày bắt đầu.")
        status = request.args.get("status", "")
        if status not in {"", "UNPAID", "PARTIAL", "PAID", "NEEDS_REVIEW", "OVERPAID"}:
            raise ApiError(422, "invalid_status", "Trạng thái hoa hồng không hợp lệ.")
        source_id = string_value(request.args.get("sourceId"), "Nguồn đặt phòng", 40)
        transactions = union_all(
            *[
                select(model.commission_id, (CashDocument.amount * direction).label("amount"))
                .join(
                    CashDocument,
                    (CashDocument.tenant_id == model.tenant_id)
                    & (CashDocument.id == model.cash_document_id),
                )
                .where(
                    model.tenant_id == tenant_id,
                    ~select(aliased_reversal.id)
                    .where(
                        aliased_reversal.tenant_id == tenant_id,
                        aliased_reversal.reversal_of_id == CashDocument.id,
                    )
                    .correlate(CashDocument)
                    .exists(),
                )
                for model, direction, aliased_reversal in (
                    (CommissionPayout, 1, aliased(CashDocument)),
                    (CommissionRecovery, -1, aliased(CashDocument)),
                )
            ]
        ).subquery()
        payouts = (
            select(transactions.c.commission_id, func.sum(transactions.c.amount).label("paid"))
            .group_by(transactions.c.commission_id)
            .subquery()
        )
        paid = func.coalesce(payouts.c.paid, 0)
        effective_amount = func.coalesce(
            latest_review(CommissionReview.amount, tenant_id), CommissionSettlement.amount
        )
        business_date = func.coalesce(
            CommissionSettlement.business_date,
            func.timezone(
                (g.tenant.settings or {}).get("timezone", "Asia/Ho_Chi_Minh"),
                Reservation.checked_out_at,
            ).cast(db.Date),
            Reservation.check_out,
        )
        conditions = [
            Reservation.tenant_id == tenant_id,
            Reservation.status == "CHECKED_OUT",
            Reservation.currency == currency,
            business_date <= end,
        ]
        if start:
            conditions.append(business_date >= start)
        if source_id:
            conditions.append(
                case(
                    (CommissionSettlement.id.is_not(None), CommissionSettlement.source_id),
                    else_=func.coalesce(
                        Reservation.pricing_snapshot["commission"]["sourceId"].astext,
                        Reservation.source_id,
                    ),
                )
                == source_id
            )
        if status:
            conditions.extend(
                [
                    CommissionSettlement.id.is_not(None),
                    case(
                        (review_condition(tenant_id), "NEEDS_REVIEW"),
                        (effective_amount < paid, "OVERPAID"),
                        (effective_amount == paid, "PAID"),
                        (paid > 0, "PARTIAL"),
                        else_="UNPAID",
                    )
                    == status,
                ]
            )
        query = (
            select(Reservation, CommissionSettlement)
            .select_from(Reservation)
            .outerjoin(
                CommissionSettlement,
                (CommissionSettlement.tenant_id == Reservation.tenant_id)
                & (CommissionSettlement.reservation_id == Reservation.id),
            )
            .outerjoin(payouts, payouts.c.commission_id == CommissionSettlement.id)
            .where(*conditions)
        )
        count, accrued, total_paid = db.session.execute(
            query.with_only_columns(
                func.count(),
                func.coalesce(func.sum(effective_amount), 0),
                func.coalesce(func.sum(paid), 0),
            )
        ).one()
        rows = list(
            db.session.execute(
                query.order_by(business_date.desc(), Reservation.id)
                .limit(size)
                .offset((page - 1) * size)
            )
        )
        bookings = [booking for booking, _ in rows]
        settlements = [settlement for _, settlement in rows if settlement is not None]
        candidates = []
        needs_review = review_booking_ids(bookings)
        for booking, settlement in rows:
            if settlement is not None:
                continue
            snapshot = (booking.pricing_snapshot or {}).get("commission") or {}
            provider_amount = snapshot.get("providerAmount")
            candidates.append(
                {
                    "bookingId": booking.id,
                    "guestName": booking.guest_name,
                    "sourceId": snapshot.get("sourceId", booking.source_id),
                    "sourceName": snapshot.get("sourceName", booking.source_name),
                    "percent": None if provider_amount is not None else snapshot.get("percent"),
                    "providerAmount": provider_amount,
                    "calculationBasis": "provider_amount"
                    if provider_amount is not None
                    else "percent",
                    "missingRate": provider_amount is None and "percent" not in snapshot,
                    "needsReview": booking.id in needs_review,
                    "currency": booking.currency,
                    "checkOut": iso(booking.check_out),
                }
            )
        return {
            "items": commission_json(settlements, bookings),
            "candidates": candidates,
            "summary": {
                "accrued": decimal_text(accrued),
                "paid": decimal_text(total_paid),
                "balance": decimal_text(accrued - total_paid),
                "currency": currency,
            },
            "pagination": {"page": page, "pageSize": size, "totalItems": count},
        }


class SettleCommissionView(CommonMethodView):
    @staticmethod
    @require_tenant("cashbook.write")
    def dispatch_request(tenant_id):
        data = payload()
        if set(data) - {"bookingId", "legacyPercent", "confirmLegacyRate"}:
            raise ApiError(
                422, "invalid_commission", "Thông tin đối soát có trường không được hỗ trợ."
            )
        booking = find_reservation(
            tenant_id,
            string_value(data.get("bookingId"), "Đặt phòng", 40, required=True),
            locked=True,
        )
        if booking.status != "CHECKED_OUT":
            raise ApiError(409, "stay_unsettled", "Chỉ đối soát hoa hồng sau khi trả phòng.")
        existing = db.session.scalar(
            select(CommissionSettlement).where(
                CommissionSettlement.tenant_id == tenant_id,
                CommissionSettlement.reservation_id == booking.id,
            )
        )
        if existing is not None:
            if (
                "legacyPercent" in data
                and money_value(data["legacyPercent"], allow_zero=True, limit=Decimal(100))
                != existing.percent
            ):
                raise ApiError(
                    409, "commission_frozen", "Hoa hồng đã đối soát; không đổi tỷ lệ đã chốt."
                )
            return commission_json([existing], [booking])[0], 200
        snapshot = (booking.pricing_snapshot or {}).get("commission")
        provider_amount = snapshot.get("providerAmount") if snapshot else None
        if provider_amount is None and (not snapshot or "percent" not in snapshot):
            if data.get("confirmLegacyRate") is not True or "legacyPercent" not in data:
                raise ApiError(
                    409,
                    "commission_rate_missing",
                    "Đặt phòng chưa có tỷ lệ; cần xác nhận tỷ lệ đối soát rõ ràng.",
                )
            snapshot = {
                "percent": data["legacyPercent"],
                "sourceId": booking.source_id,
                "sourceName": booking.source_name,
            }
            audit(
                "commission.legacy_rate_confirmed",
                "reservation",
                booking.id,
                {"percent": str(data["legacyPercent"])},
            )
        elif "legacyPercent" in data or "confirmLegacyRate" in data:
            raise ApiError(
                422,
                "commission_rate_frozen",
                "Đặt phòng đã lưu tỷ lệ; không thay bằng tỷ lệ thủ công.",
            )
        percent = (
            money_value(snapshot["percent"], allow_zero=True, limit=Decimal(100))
            if provider_amount is None
            else None
        )
        nights = list(
            db.session.scalars(
                select(ReservationNight).where(
                    ReservationNight.tenant_id == tenant_id,
                    ReservationNight.reservation_id == booking.id,
                )
            )
        )
        room_net = sum((night.price for night in nights), Decimal(0))
        base_room_net = sum((night.base_amount for night in nights), Decimal(0))
        amount = (
            money_value(provider_amount, allow_zero=True, limit=room_net)
            if provider_amount is not None
            else rounded(room_net * percent / 100)
        )
        base_amount = (
            snapshot_money(tenant_id, booking.currency, amount, source=booking)["base_amount"]
            if provider_amount is not None
            else rounded(base_room_net * percent / 100)
        )
        row = CommissionSettlement(
            tenant_id=tenant_id,
            reservation_id=booking.id,
            source_id=snapshot.get("sourceId"),
            source_name=snapshot.get("sourceName", booking.source_name),
            percent=percent,
            room_net=room_net,
            base_room_net=base_room_net,
            amount=amount,
            currency=booking.currency,
            base_amount=base_amount,
            base_currency=booking.base_currency,
            exchange_rate=booking.exchange_rate,
            business_date=local_date(booking.checked_out_at)
            if booking.checked_out_at
            else booking.check_out,
            user_id=g.user.id,
        )
        db.session.add(row)
        db.session.flush()
        audit(
            "commission.reconciled",
            "commission",
            row.id,
            {
                "bookingId": booking.id,
                "percent": decimal_text(percent) if percent is not None else None,
                "calculationBasis": "provider_amount" if percent is None else "percent",
                "roomNet": decimal_text(room_net),
                "amount": decimal_text(row.amount),
            },
        )
        return commission_json([row], [booking])[0], 201


def write_commission_cash(tenant_id, commission_id, *, recovering=False):
    data = payload()
    if set(data) - {"amount", "fundId", "categoryId", "note"}:
        raise ApiError(422, "invalid_payment", "Thanh toán hoa hồng chứa trường không được hỗ trợ.")
    key, fingerprint, replay = begin(tenant_id, data)
    if replay is not None:
        return replay, 201
    row = commission_row(tenant_id, commission_id)
    booking = find_reservation(tenant_id, row.reservation_id, locked=True)
    current = commission_json([row], [booking])[0]
    if current["needsReview"]:
        raise ApiError(
            409,
            "commission_needs_review",
            "Lưu trú có điều chỉnh hoặc booking OTA chưa đối soát; cần kiểm tra trước khi ghi tiền.",
        )
    amount = money_value(data.get("amount"))
    limit = Decimal(current["recoveryDue"] if recovering else current["balance"])
    if amount > limit:
        raise ApiError(
            409, "commission_overpayment", "Khoản tiền vượt số hoa hồng còn phải chi hoặc thu hồi."
        )
    if row.currency != (g.tenant.settings or {}).get("currency", "VND") and not feature_enabled(
        "MULTI_CURRENCY", for_write=True
    ):
        raise ApiError(403, "feature_disabled", "Gói chưa bật đa tiền tệ.")
    kind = "receipt" if recovering else "expense"
    category = cash_category(tenant_id, kind, data.get("categoryId"))
    fund_id = string_value(data.get("fundId"), "Quỹ", 40, required=True)
    fund = lock_funds(tenant_id, [fund_id], row.currency)[fund_id]
    if not recovering:
        ensure_available(tenant_id, fund_id, row.currency, amount)
    note = (
        string_value(data.get("note"), "Nội dung", 500, required=recovering)
        or f"Hoa hồng {row.source_name} · {row.reservation_id}"
    )
    document = CashDocument(
        tenant_id=tenant_id,
        kind=kind,
        fund_id=fund.id,
        fund_name=fund.name,
        amount=amount,
        currency=row.currency,
        description=note,
        effective_date=local_date(),
        category_id=category.id if category else None,
        category_name=category.name if category else None,
        category_type=category.data["type"] if category else None,
        user_id=g.user.id,
        **snapshot_money(tenant_id, row.currency, amount, row),
    )
    db.session.add(document)
    db.session.flush()
    ledger(
        tenant_id,
        fund.id,
        row.currency,
        amount if recovering else -amount,
        kind,
        note,
        cash_document_id=document.id,
        source=document,
    )
    model = CommissionRecovery if recovering else CommissionPayout
    db.session.add(model(tenant_id=tenant_id, commission_id=row.id, cash_document_id=document.id))
    db.session.flush()
    audit(
        "commission.recovery" if recovering else "commission.payment",
        "commission",
        row.id,
        {"cashDocumentId": document.id, "amount": decimal_text(amount), "fundId": fund.id},
    )
    return finish(tenant_id, key, fingerprint, commission_json([row], [booking])[0])


class PayCommissionView(CommonMethodView):
    @staticmethod
    @require_tenant("cashbook.write")
    def dispatch_request(tenant_id, commission_id):
        return write_commission_cash(tenant_id, commission_id)


class RecoverCommissionView(CommonMethodView):
    @staticmethod
    @require_tenant("cashbook.write")
    def dispatch_request(tenant_id, commission_id):
        return write_commission_cash(tenant_id, commission_id, recovering=True)
