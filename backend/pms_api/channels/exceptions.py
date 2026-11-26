"""Durable OTA incidents and explicit reconciliation of otherwise unsupported revisions."""

import hashlib
import json
from datetime import UTC, datetime

from flask import g, request
from sqlalchemy import func, select

from common import CommonMethodView

from ..bookings.models import Charge, ReservationNight
from ..bookings.routes import (
    begin_write,
    find_reservation,
    money_value,
    require_booking_version,
    string_value,
    totals,
)
from ..core_models import TenantUser, User, utcnow
from ..extensions import db
from ..finance.routes import begin, finish, pagination
from ..security import ApiError, audit, payload, require_tenant
from .access import require_channel_access
from .client import ChannexClient, ProviderError, remote_id
from .credentials import load_credentials
from .importer import review_details, revision_identity
from .models import (
    ChannelActionReceipt,
    ChannelBooking,
    ChannelBookingReview,
    ChannelConnection,
    ChannelJob,
    ChannelReviewResolution,
    ChannelRevision,
    ChannelSyncIncident,
)

INCIDENT_EVENTS = {"sync_error", "sync_warning", "rate_error"}


def incident_json(row):
    return {
        "id": row.id,
        "eventCode": row.event_code,
        "channelId": row.channel_id,
        "channelEventId": row.channel_event_id,
        "channelName": row.channel_name,
        "errorType": row.error_type,
        "details": row.details,
        "assigneeId": row.assignee_id,
        "createdAt": row.created_at.astimezone(UTC).isoformat(),
        "resolvedAt": row.resolved_at.astimezone(UTC).isoformat() if row.resolved_at else None,
        "resolvedBy": row.resolved_by,
        "resolutionNote": row.resolution_note,
    }


def receive_incident(tenant_id, data):
    body = data.get("payload") or {}
    if (
        not isinstance(body, dict)
        or body.get("property_id", data["property_id"]) != data["property_id"]
    ):
        raise ApiError(422, "invalid_channel_webhook", "Nội dung webhook không hợp lệ.")
    details = {}
    for name in ("channel_id", "channel_event_id", "rate_plan_id", "room_type_id"):
        if body.get(name) is not None:
            try:
                details[name] = remote_id(body[name])
            except ProviderError:
                raise ApiError(
                    422, "invalid_channel_webhook", "Mã sự kiện/kênh không hợp lệ."
                ) from None
    for name in ("channel_name", "channel", "error_type", "date", "start_date", "end_date"):
        if body.get(name) is not None:
            details[name] = string_value(body[name], "Thông tin lỗi kênh", 160)
    timestamp = data.get("timestamp")
    if timestamp is not None:
        try:
            if not isinstance(timestamp, str) or len(timestamp) > 60:
                raise ValueError
            stamp = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            if stamp.tzinfo is None:
                raise ValueError
            details["timestamp"] = stamp.astimezone(UTC).isoformat()
        except (ValueError, TypeError, OverflowError):
            raise ApiError(
                422, "invalid_channel_webhook", "Thời điểm sự kiện không hợp lệ."
            ) from None
    identity = details.get("channel_event_id") or json.dumps(details, sort_keys=True)
    fingerprint = hashlib.sha256((data["event"] + ":" + identity).encode()).hexdigest()
    row = db.session.scalar(
        select(ChannelSyncIncident).where(
            ChannelSyncIncident.tenant_id == tenant_id,
            ChannelSyncIncident.fingerprint == fingerprint,
        )
    )
    if row is not None:
        return row
    row = ChannelSyncIncident(
        tenant_id=tenant_id,
        fingerprint=fingerprint,
        event_code=data["event"],
        channel_id=details.get("channel_id"),
        channel_event_id=details.get("channel_event_id"),
        channel_name=details.get("channel_name", details.get("channel", "")),
        error_type=details.get("error_type", ""),
        details=details,
    )
    db.session.add(row)
    db.session.flush()
    audit(
        "channel.sync_error",
        "channel_incident",
        row.id,
        {"eventCode": row.event_code, "channelId": row.channel_id, "status": "failed"},
    )
    return row


class IncidentsView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.view")
    def dispatch_request(tenant_id):
        if set(request.args) - {"status", "page", "pageSize"}:
            raise ApiError(422, "invalid_query", "Bộ lọc sự cố không hợp lệ.")
        status = request.args.get("status", "open")
        if status not in {"open", "resolved", "all"}:
            raise ApiError(422, "invalid_query", "Trạng thái sự cố không hợp lệ.")
        page, size = pagination()
        scope = [ChannelSyncIncident.tenant_id == tenant_id]
        if status != "all":
            scope.append(
                ChannelSyncIncident.resolved_at.is_(None)
                if status == "open"
                else ChannelSyncIncident.resolved_at.is_not(None)
            )
        total = db.session.scalar(
            select(func.count()).select_from(ChannelSyncIncident).where(*scope)
        )
        rows = db.session.scalars(
            select(ChannelSyncIncident)
            .where(*scope)
            .order_by(ChannelSyncIncident.created_at.desc(), ChannelSyncIncident.id)
            .offset((page - 1) * size)
            .limit(size)
        )
        assignees = db.session.execute(
            select(User.id, User.name)
            .join(TenantUser, TenantUser.user_id == User.id)
            .where(
                TenantUser.tenant_id == tenant_id,
                TenantUser.active.is_(True),
                User.active.is_(True),
                TenantUser.role.in_(["HOTEL_OWNER", "FRONT_DESK"]),
            )
        ).all()
        return {
            "items": [incident_json(row) for row in rows],
            "assignees": [{"id": user_id, "name": name} for user_id, name in assignees],
            "pagination": {
                "page": page,
                "pageSize": size,
                "totalItems": total,
                "totalPages": (total + size - 1) // size,
            },
        }


class IncidentActionView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.write")
    def dispatch_request(tenant_id, incident_id):
        data = payload()
        if (
            set(data) - {"action", "assigneeId", "reason", "verified"}
            or not isinstance(data.get("action"), str)
            or data["action"] not in {"assign", "resolve", "reopen"}
        ):
            raise ApiError(422, "invalid_incident_action", "Thao tác sự cố không hợp lệ.")
        key, fingerprint, replay = begin_write(tenant_id, data, record_model=ChannelActionReceipt)
        if replay is not None:
            return replay
        row = db.session.scalar(
            select(ChannelSyncIncident)
            .where(
                ChannelSyncIncident.tenant_id == tenant_id,
                ChannelSyncIncident.id == incident_id,
            )
            .with_for_update()
        )
        if row is None:
            raise ApiError(404, "not_found", "Không tìm thấy sự cố kênh.")
        reason = string_value(data.get("reason"), "Kết quả kiểm tra", 1000, required=True)
        action = data["action"]
        if action == "assign":
            assignee_id = data.get("assigneeId")
            if assignee_id is not None:
                assignee_id = string_value(assignee_id, "Người xử lý", 40, required=True)
                member = db.session.scalar(
                    select(TenantUser.id)
                    .join(User, User.id == TenantUser.user_id)
                    .where(
                        TenantUser.tenant_id == tenant_id,
                        TenantUser.user_id == assignee_id,
                        TenantUser.active.is_(True),
                        User.active.is_(True),
                        TenantUser.role.in_(["HOTEL_OWNER", "FRONT_DESK"]),
                    )
                )
                if member is None:
                    raise ApiError(
                        422, "invalid_assignee", "Chọn người đang có quyền xử lý tại khách sạn."
                    )
            row.assignee_id = assignee_id
        elif action == "resolve":
            if data.get("verified") is not True:
                raise ApiError(
                    422, "verification_required", "Xác nhận đã kiểm tra kết quả thực tế trên kênh."
                )
            row.resolved_at, row.resolved_by, row.resolution_note = utcnow(), g.user.id, reason
        else:
            row.resolved_at, row.resolved_by, row.resolution_note = None, None, ""
        audit(
            "channel.incident_" + action,
            "channel_incident",
            row.id,
            {
                "reason": reason,
                "assigneeId": row.assignee_id,
                "verified": data.get("verified") is True,
            },
        )
        db.session.flush()
        response = incident_json(row)
        db.session.add(
            ChannelActionReceipt(
                tenant_id=tenant_id, key=key, fingerprint=fingerprint, response=response
            )
        )
        db.session.flush()
        return response


class ResolveBookingReviewView(CommonMethodView):
    @staticmethod
    @require_tenant("channels.write")
    def dispatch_request(tenant_id, review_id):
        data = payload()
        if (
            set(data)
            - {
                "reservationId",
                "expectedVersion",
                "reason",
                "providerTotal",
                "expectedTotal",
                "confirm",
            }
            or data.get("confirm") is not True
        ):
            raise ApiError(
                422,
                "review_confirmation_required",
                "Xác nhận booking và đối chiếu đầy đủ số tiền trước khi hoàn tất.",
            )
        key, fingerprint, replay = begin(tenant_id, data)
        if replay is not None:
            return replay
        reason = string_value(data.get("reason"), "Kết quả đối soát", 1000, required=True)
        review = db.session.scalar(
            select(ChannelBookingReview)
            .where(
                ChannelBookingReview.tenant_id == tenant_id,
                ChannelBookingReview.id == review_id,
            )
            .with_for_update()
        )
        if review is None:
            raise ApiError(404, "not_found", "Không tìm thấy cập nhật cần xử lý.")
        if review.resolved_at is not None:
            raise ApiError(409, "review_resolved", "Cập nhật đã được xử lý; tải lại lịch sử.")
        booking = find_reservation(
            tenant_id,
            string_value(data.get("reservationId"), "Đặt phòng", 40, required=True),
            locked=True,
        )
        require_booking_version(booking, data)
        link = db.session.scalar(
            select(ChannelBooking)
            .where(
                ChannelBooking.tenant_id == tenant_id,
                ChannelBooking.booking_id == review.booking_id,
            )
            .with_for_update()
        )
        if link is None or link.latest_revision_id != review.revision_id:
            raise ApiError(
                409, "review_superseded", "Có cập nhật mới hơn; xử lý bản mới nhất trước."
            )
        other = db.session.scalar(
            select(ChannelBooking.id).where(
                ChannelBooking.tenant_id == tenant_id,
                ChannelBooking.reservation_id == booking.id,
                ChannelBooking.id != link.id,
            )
        )
        if other or (link.reservation_id is not None and link.reservation_id != booking.id):
            raise ApiError(
                409, "booking_already_linked", "Booking đã được liên kết; không thay thế lịch sử."
            )
        configuration = db.session.scalar(
            select(ChannelConnection).where(ChannelConnection.tenant_id == tenant_id)
        )
        if configuration is None or not configuration.active:
            raise ApiError(409, "channel_inactive", "Kết nối Channex chưa hoạt động.")
        try:
            client = ChannexClient(
                configuration.environment, load_credentials(configuration)["apiKey"]
            )
            entity = client.revision(review.revision_id)
            identity = revision_identity(entity, configuration.property_id)
            if (
                identity["id"],
                identity["bookingId"],
                identity["status"],
                identity["insertedAt"],
            ) != (
                review.revision_id,
                review.booking_id,
                review.provider_status,
                review.revision_at,
            ):
                raise ProviderError("provider_invalid_response")
        except ProviderError as error:
            raise ApiError(
                503 if error.retryable else 422,
                error.code,
                "Chưa xác minh được cập nhật gốc từ Channex.",
            ) from None
        raw = entity["attributes"]
        provider_total = money_value(raw.get("amount"), allow_zero=True)
        total, _, _ = totals(booking)
        if (
            money_value(data.get("providerTotal"), allow_zero=True) != provider_total
            or money_value(data.get("expectedTotal"), allow_zero=True) != total
        ):
            raise ApiError(
                409, "review_totals_changed", "Số tiền PMS hoặc Channex đã khác bản đối chiếu."
            )
        cancelled = review.provider_status == "cancelled"
        if (
            booking.currency != raw.get("currency")
            or (cancelled and booking.status not in {"CANCELLED", "NO_SHOW", "CHECKED_OUT"})
            or (not cancelled and booking.status not in {"CONFIRMED", "IN_HOUSE", "CHECKED_OUT"})
        ):
            raise ApiError(
                409,
                "review_booking_mismatch",
                "Tiền tệ hoặc trạng thái booking chưa được xử lý phù hợp.",
            )
        if not cancelled:
            raw_rooms = raw.get("rooms")
            room_counts = (
                select(func.count(ReservationNight.id).label("rooms"))
                .where(
                    ReservationNight.tenant_id == tenant_id,
                    ReservationNight.reservation_id == booking.id,
                )
                .group_by(ReservationNight.date)
                .subquery()
            )
            room_count = db.session.scalar(select(func.max(room_counts.c.rooms)))
            if (
                (booking.check_in.isoformat(), booking.check_out.isoformat())
                != (raw.get("arrival_date"), raw.get("departure_date"))
                or not isinstance(raw_rooms, list)
                or len(raw_rooms) != room_count
            ):
                raise ApiError(
                    409,
                    "review_stay_mismatch",
                    "Sửa ngày và phân bổ phòng trong booking PMS trước khi đối soát.",
                )
        room_total = db.session.scalar(
            select(func.coalesce(func.sum(ReservationNight.price), 0)).where(
                ReservationNight.tenant_id == tenant_id,
                ReservationNight.reservation_id == booking.id,
            )
        )
        charges = db.session.execute(
            select(Charge.kind, func.sum(Charge.amount))
            .where(
                Charge.tenant_id == tenant_id,
                Charge.reservation_id == booking.id,
            )
            .group_by(Charge.kind)
        ).all()
        snapshot = {
            "provider": review_details(entity),
            "providerTotal": str(provider_total),
            "hotelTotal": str(total),
            "difference": str(total - provider_total),
            "roomNet": str(room_total),
            "charges": {kind: str(amount) for kind, amount in charges},
            "bookingVersion": booking.version,
            "status": booking.status,
        }
        resolution = ChannelReviewResolution(
            tenant_id=tenant_id,
            review_id=review.id,
            reservation_id=booking.id,
            actor_id=g.user.id,
            reason=reason,
            snapshot=snapshot,
        )
        db.session.add(resolution)
        db.session.flush()
        pricing = dict(booking.pricing_snapshot or {})
        channel = dict(pricing.get("channel") or {})
        channel.update(
            provider="channex",
            bookingId=review.booking_id,
            revisionId=review.revision_id,
            lastManualResolutionId=resolution.id,
            amount=str(provider_total),
            hotelAmount=str(total),
            paymentCollect=raw.get("payment_collect")
            if isinstance(raw.get("payment_collect"), str)
            and raw["payment_collect"] in {"ota", "property"}
            else None,
        )
        pricing["channel"] = channel
        if raw.get("ota_commission") is not None:
            commission = dict(pricing.get("commission") or {})
            commission.update(
                providerAmount=str(
                    money_value(raw["ota_commission"], allow_zero=True, limit=provider_total)
                ),
                providerRevisionId=review.revision_id,
                basis="provider_amount",
            )
            pricing["commission"] = commission
        booking.pricing_snapshot = pricing
        link.reservation_id = booking.id
        if cancelled:
            link.cancellation_verified_at = utcnow()
        receipt = ChannelRevision(
            tenant_id=tenant_id,
            revision_id=review.revision_id,
            booking_id=review.booking_id,
            reservation_id=booking.id,
            outcome="cancelled" if cancelled else "imported",
            money_snapshot={**snapshot, "resolutionId": resolution.id},
        )
        db.session.add(receipt)
        pending = list(
            db.session.scalars(
                select(ChannelBookingReview).where(
                    ChannelBookingReview.tenant_id == tenant_id,
                    ChannelBookingReview.booking_id == review.booking_id,
                    ChannelBookingReview.resolved_at.is_(None),
                    ChannelBookingReview.revision_at <= review.revision_at,
                )
            )
        )
        from .service import queue_job

        for pending_review in pending:
            pending_review.resolved_at = utcnow()
            if pending_review.id != review.id:
                db.session.add(
                    ChannelRevision(
                        tenant_id=tenant_id,
                        revision_id=pending_review.revision_id,
                        booking_id=review.booking_id,
                        reservation_id=booking.id,
                        outcome="stale",
                    )
                )
            for job in db.session.scalars(
                select(ChannelJob).where(
                    ChannelJob.tenant_id == tenant_id,
                    ChannelJob.kind == "pull_bookings",
                    ChannelJob.payload["revisionId"].astext == pending_review.revision_id,
                )
            ):
                job.status, job.error_code, job.completed_at = "succeeded", None, utcnow()
            queue_job(
                tenant_id,
                g.user.id,
                "ack_revision",
                {"revisionId": pending_review.revision_id},
                "ack:" + pending_review.revision_id,
                retry_failed=True,
            )
        audit(
            "channel.review_resolved",
            "channel_review_resolution",
            resolution.id,
            {
                "bookingId": booking.id,
                "reviewId": review.id,
                "reason": reason,
                "snapshot": snapshot,
            },
        )
        response = {
            "id": resolution.id,
            "reviewId": review.id,
            "reservationId": booking.id,
            "snapshot": snapshot,
            "ackQueued": True,
        }
        return finish(tenant_id, key, fingerprint, response, status=200)
