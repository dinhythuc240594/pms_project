"""Session protected configuration; authenticated provider webhook is an outbox trigger."""

import hashlib
import hmac
import secrets

from sqlalchemy import func, select

from pms_api.composition import channel_adapter
from pms_api.ports import runtime

from ..catalog.models import RoomType
from ..core_models import utcnow
from ..extensions import db
from ..security import GLOBAL_ROLES, ApiError, audit, set_context
from ..subscriptions import lock_tenant
from .client import BASES, ProviderError, remote_id
from .credentials import encrypt_credentials, load_credentials, storage_available, valid_secret
from .models import (
    ChannelBooking,
    ChannelBookingReview,
    ChannelConnection,
    ChannelJob,
    ChannelMapping,
)
from .onboarding import invalidate_inventory, onboarding_json, require_reconciled

PREFIX = "/api/tenants/<tenant_id>/channels"


def expected_refs(tenant_id):
    suffix = hashlib.sha256(tenant_id.encode()).hexdigest()[:16].upper()
    return "CHANNEX_API_KEY_" + suffix, "CHANNEX_WEBHOOK_SECRET_" + suffix


def connection(tenant_id, *, active=False):
    row = db.session.scalar(
        select(ChannelConnection).where(ChannelConnection.tenant_id == tenant_id)
    )
    if active and (not row or not row.active):
        raise ApiError(409, "channel_inactive", "Kết nối Channex chưa hoạt động.")
    return row


def uuid_input(value):
    try:
        return remote_id(value)
    except ProviderError:
        raise ApiError(422, "invalid_channel_config", "Mã Channex phải là UUID.") from None


def mapping_json(row):
    return {
        "id": row.id,
        "roomTypeId": row.room_type_id,
        "channexRoomTypeId": row.remote_room_type_id,
        "channexRatePlanId": row.remote_rate_plan_id,
        "inboundRatePlanIds": row.inbound_rate_plan_ids or [],
        "active": row.active,
        "targetLocked": row.used_at is not None,
        "pauseRequested": row.pause_requested,
    }


def job_json(row):
    details = row.payload if isinstance(row.payload, dict) else {}

    def public_text(key, maximum):
        value = details.get(key)
        return value if isinstance(value, str) and len(value) <= maximum else None

    return {
        "id": row.id,
        "kind": row.kind,
        "channelId": public_text("channelId", 36),
        "revisionId": public_text("revisionId", 36),
        "status": row.status,
        "attempts": row.attempts,
        "errorCode": row.error_code,
        "start": public_text("start", 10),
        "end": public_text("end", 10),
        "createdAt": row.created_at.isoformat(),
        "completedAt": row.completed_at.isoformat() if row.completed_at else None,
    }


def connection_json(row):
    error_code = None
    try:
        credentials = load_credentials(row)
    except ProviderError as error:
        credentials, error_code = {}, error.code
    return {
        "environment": row.environment,
        "propertyId": row.property_id,
        "credentialRef": row.credential_ref,
        "webhookSecretRef": row.webhook_secret_ref,
        "active": row.active,
        "credentialsConfigured": valid_secret(credentials.get("apiKey")),
        "webhookConfigured": valid_secret(credentials.get("webhookSecret"), 32),
        "webhookRegistered": bool(row.webhook_id),
        "credentialSource": "encrypted" if row.secrets_ciphertext is not None else "environment",
        "credentialError": error_code,
        "verifiedAt": row.verified_at.isoformat() if row.verified_at else None,
        "inventoryReconciledAt": row.inventory_reconciled_at.isoformat()
        if row.inventory_reconciled_at
        else None,
    }


def config_provider_error(error):
    storage_error = error.code in {"credential_storage_unavailable", "credentials_unavailable"}
    raise ApiError(
        503 if storage_error or error.retryable else 422,
        error.code,
        "Chưa thể đọc hoặc lưu khóa OTA. Vui lòng kiểm tra cấu hình mã hóa của hệ thống."
        if storage_error
        else "Không xác minh được khách sạn Channex. Kiểm tra API key, Property ID và môi trường.",
    ) from None


def handle_snapshot(tenant_id):
    row = connection(tenant_id)
    refs = expected_refs(tenant_id)
    return {
        "credentialStorageAvailable": storage_available(),
        "webhookRegistrationAvailable": bool(runtime().config.get("CHANNEX_WEBHOOK_BASE_URL")),
        "expectedCredentialRef": refs[0],
        "expectedWebhookSecretRef": refs[1],
        "connection": connection_json(row) if row else None,
        "onboarding": onboarding_json(row),
        "mappings": [
            mapping_json(m)
            for m in db.session.scalars(
                select(ChannelMapping)
                .where(ChannelMapping.tenant_id == tenant_id)
                .order_by(ChannelMapping.room_type_id)
            )
        ],
        "jobs": [
            job_json(j)
            for j in db.session.scalars(
                select(ChannelJob)
                .where(ChannelJob.tenant_id == tenant_id)
                .order_by(ChannelJob.created_at.desc(), ChannelJob.id.desc())
                .limit(50)
            )
        ],
        "bookingReviewCount": db.session.scalar(
            select(func.count())
            .select_from(ChannelBookingReview)
            .where(
                ChannelBookingReview.tenant_id == tenant_id,
                ChannelBookingReview.resolved_at.is_(None),
            )
        ),
        "roomTypes": [
            {"id": r.id, "name": r.name}
            for r in db.session.scalars(
                select(RoomType)
                .where(RoomType.tenant_id == tenant_id, RoomType.active.is_(True))
                .order_by(RoomType.name)
            )
        ],
    }


def handle_booking_reviews(tenant_id):
    from pms_api.admin.channex_remote_application import page_number, query_values

    args = query_values({"page", "pageSize"})
    page, size = page_number(args.get("page", "1")), page_number(args.get("pageSize", "25"))
    if size > 100:
        raise ApiError(422, "invalid_pagination", "Mỗi trang tối đa 100 hồ sơ cần xử lý.")
    pending = select(ChannelBookingReview).where(
        ChannelBookingReview.tenant_id == tenant_id,
        ChannelBookingReview.resolved_at.is_(None),
    )
    count = db.session.scalar(select(func.count()).select_from(pending.subquery()))
    reviews = list(
        db.session.scalars(
            pending.order_by(
                ChannelBookingReview.created_at.desc(),
                ChannelBookingReview.id.desc(),
            )
            .offset((page - 1) * size)
            .limit(size)
        )
    )
    revision_ids = [row.revision_id for row in reviews]
    jobs = {}
    if revision_ids:
        for job in db.session.scalars(
            select(ChannelJob)
            .where(
                ChannelJob.tenant_id == tenant_id,
                ChannelJob.kind == "pull_bookings",
                ChannelJob.payload["revisionId"].astext.in_(revision_ids),
            )
            .order_by(ChannelJob.created_at.desc(), ChannelJob.id.desc())
        ):
            jobs.setdefault(job.payload["revisionId"], job)
    return {
        "items": [
            {
                "id": row.id,
                "revisionId": row.revision_id,
                "bookingId": row.booking_id,
                "jobId": jobs[row.revision_id].id if row.revision_id in jobs else None,
                "jobStatus": jobs[row.revision_id].status if row.revision_id in jobs else None,
                "errorCode": row.error_code,
                "providerStatus": row.provider_status,
                "revisionAt": row.revision_at.isoformat(),
                "createdAt": row.created_at.isoformat(),
                "details": row.details,
            }
            for row in reviews
        ],
        "pagination": {
            "page": page,
            "pageSize": size,
            "totalItems": count,
            "totalPages": (count + size - 1) // size,
        },
    }


def handle_catalog(tenant_id):
    from .service import catalog_options

    row = connection(tenant_id)
    if row is None:
        raise ApiError(409, "channel_unconfigured", "Khách sạn chưa cấu hình Channex.")
    try:
        credentials = load_credentials(row)
        if not valid_secret(credentials.get("apiKey")):
            raise ProviderError("credentials_unavailable")
        client = channel_adapter(row.environment, credentials["apiKey"])
        return catalog_options(
            row, client, (runtime().state.tenant.settings or {}).get("currency", "VND")
        )
    except ProviderError as error:
        if error.code in {"credential_storage_unavailable", "credentials_unavailable"}:
            raise ApiError(
                503, error.code, "Chưa thể đọc khóa OTA. Vui lòng kiểm tra cấu hình kết nối."
            ) from None
        if error.code == "channel_catalog_too_large":
            raise ApiError(
                422, error.code, "Danh mục Channex vượt giới hạn 100 loại phòng hoặc gói giá."
            ) from None
        raise ApiError(
            503 if error.retryable else 502,
            error.code,
            "Chưa thể tải danh mục Channex hợp lệ cho khách sạn này. Vui lòng thử lại hoặc kiểm tra kết nối.",
        ) from None


def manager_source_config(tenant_id, data):
    # Only system managers can reuse server-owned credentials. Tenant users
    # still supply their own key and cannot enumerate or select other sources.
    if runtime().state.user.global_role not in GLOBAL_ROLES:
        raise ApiError(403, "forbidden", "Chỉ quản trị hệ thống được chọn nguồn Channex.")
    if set(data) != {"accountId", "propertyId", "active"} or not isinstance(data["active"], bool):
        raise ApiError(422, "invalid_channel_config", "Cấu hình Channex không hợp lệ.")
    from pms_api.admin.channex_remote_application import MANAGER_KEYS, account_client

    account_id = data["accountId"]
    if not isinstance(account_id, str) or (
        account_id not in MANAGER_KEYS and account_id != "hotel:" + tenant_id
    ):
        raise ApiError(
            422,
            "invalid_channel_source",
            "Chọn tài khoản hệ thống hoặc nguồn của chính khách sạn này.",
        )
    existing = connection(tenant_id)
    if (
        account_id in MANAGER_KEYS
        and not (runtime().request.endpoint or "").startswith("channels.support_")
        and (
            existing is None
            or existing.property_id != uuid_input(data["propertyId"])
            or existing.environment != MANAGER_KEYS[account_id][0]
        )
    ):
        raise ApiError(
            403,
            "invalid_channel_source",
            "Nguồn hệ thống chỉ được dùng cho kết nối khách sạn đã được cấp quyền.",
        )
    environment, source = account_client(account_id)
    if account_id.startswith("hotel:"):
        if uuid_input(data["propertyId"]) != existing.property_id:
            raise ApiError(
                422,
                "invalid_channel_source",
                "Nguồn khách sạn chỉ dùng cho khách sạn Channex đã liên kết.",
            )
    return {
        "environment": environment,
        "propertyId": data["propertyId"],
        "active": data["active"],
        "apiKey": source.api_key,
    }


def handle_save_config(tenant_id):
    data = runtime().payload()
    if "accountId" in data:
        data = manager_source_config(tenant_id, data)
    legacy_fields = {"environment", "propertyId", "credentialRef", "webhookSecretRef", "active"}
    fields = {"environment", "propertyId", "active"}
    legacy = set(data) == legacy_fields
    if (
        (not legacy and (not fields <= set(data) or set(data) - fields - {"apiKey"}))
        or not isinstance(data["environment"], str)
        or data["environment"] not in BASES
        or not isinstance(data["active"], bool)
        or (
            legacy and (data["credentialRef"], data["webhookSecretRef"]) != expected_refs(tenant_id)
        )
        or (
            "apiKey" in data
            and (
                not isinstance(data["apiKey"], str)
                or len(data["apiKey"]) > 1024
                or any(ord(char) < 32 or ord(char) > 126 for char in data["apiKey"])
            )
        )
    ):
        raise ApiError(422, "invalid_channel_config", "Cấu hình Channex không hợp lệ.")
    property_id = uuid_input(data["propertyId"])
    row = connection(tenant_id)
    same_target = bool(
        row and (row.property_id, row.environment) == (property_id, data["environment"])
    )
    reactivated = bool(same_target and not row.active and data["active"])
    if row and not same_target:
        if db.session.scalar(
            select(ChannelBooking.id).where(ChannelBooking.tenant_id == tenant_id).limit(1)
        ) or db.session.scalar(
            select(ChannelJob.id).where(ChannelJob.tenant_id == tenant_id).limit(1)
        ):
            raise ApiError(
                409,
                "channel_has_history",
                "Không đổi khách sạn hoặc môi trường sau khi có lịch sử đồng bộ.",
            )
    api_key = data.get("apiKey", "").strip()
    # A server-held legacy key cannot authorize a caller-selected property.
    if not same_target and (legacy or not api_key):
        raise ApiError(422, "channel_api_key_required", "Nhập API key để xác minh khách sạn này.")
    ciphertext = row.secrets_ciphertext if same_target else None
    verified_at = row.verified_at if same_target else None
    try:
        if not legacy and api_key:
            if not storage_available():
                raise ProviderError("credential_storage_unavailable")
            prior = load_credentials(row) if same_target else {}
            webhook_secret = prior.get("webhookSecret", "")
            if not valid_secret(webhook_secret, 32):
                webhook_secret = secrets.token_urlsafe(32)
            channel_adapter(data["environment"], api_key).property(property_id)
            ciphertext = encrypt_credentials(
                tenant_id, data["environment"], property_id, api_key, webhook_secret
            )
            verified_at = utcnow()
        elif reactivated and (not legacy or row.secrets_ciphertext is not None):
            credentials = load_credentials(row)
            channel_adapter(data["environment"], credentials["apiKey"]).property(property_id)
            verified_at = utcnow()
    except ProviderError as error:
        config_provider_error(error)
    if row is None:
        row = ChannelConnection(tenant_id=tenant_id)
        db.session.add(row)
    (
        row.environment,
        row.property_id,
        row.credential_ref,
        row.webhook_secret_ref,
        row.active,
        row.actor_id,
        row.secrets_ciphertext,
        row.verified_at,
        row.webhook_id,
    ) = (
        data["environment"],
        property_id,
        *expected_refs(tenant_id),
        data["active"],
        runtime().state.user.id,
        ciphertext,
        verified_at,
        row.webhook_id if same_target else None,
    )
    db.session.flush()
    if not same_target or reactivated:
        invalidate_inventory(row)
    if (
        row.active
        and row.secrets_ciphertext is not None
        and (api_key or reactivated)
        and runtime().config.get("CHANNEX_WEBHOOK_BASE_URL")
    ):
        from .service import queue_job

        queue_job(tenant_id, row.actor_id, "setup_webhook", {})
    audit(
        "channel.configured",
        "channel_connection",
        row.id,
        {"environment": row.environment, "active": row.active},
    )
    return {"saved": True}


def handle_save_mapping(tenant_id):
    data = runtime().payload()
    if (
        not {"roomTypeId", "channexRoomTypeId", "channexRatePlanId", "active"} <= set(data)
        or set(data)
        - {"roomTypeId", "channexRoomTypeId", "channexRatePlanId", "active", "inboundRatePlanIds"}
        or not isinstance(data["active"], bool)
        or not isinstance(data["roomTypeId"], str)
    ):
        raise ApiError(422, "invalid_channel_mapping", "Ánh xạ loại phòng không hợp lệ.")
    configuration = connection(tenant_id)
    room_type = db.session.scalar(
        select(RoomType).where(RoomType.tenant_id == tenant_id, RoomType.id == data["roomTypeId"])
    )
    if not room_type:
        raise ApiError(404, "not_found", "Không tìm thấy loại phòng.")
    row = db.session.scalar(
        select(ChannelMapping).where(
            ChannelMapping.tenant_id == tenant_id, ChannelMapping.room_type_id == room_type.id
        )
    )
    remote_room, remote_rate = (
        uuid_input(data["channexRoomTypeId"]),
        uuid_input(data["channexRatePlanId"]),
    )
    inbound = data.get("inboundRatePlanIds", row.inbound_rate_plan_ids if row else [])
    if (
        not isinstance(inbound, list)
        or len(inbound) > 99
        or any(not isinstance(identifier, str) for identifier in inbound)
        or len(set(inbound)) != len(inbound)
        or remote_rate in inbound
    ):
        raise ApiError(422, "invalid_channel_mapping", "Danh sách gói nhận đặt phòng không hợp lệ.")
    inbound = sorted(uuid_input(identifier) for identifier in inbound)
    if len(set(inbound)) != len(inbound) or remote_rate in inbound:
        raise ApiError(422, "invalid_channel_mapping", "Danh sách gói nhận đặt phòng bị trùng.")
    inbound_changed = row is not None and inbound != sorted(row.inbound_rate_plan_ids or [])
    target_changed = row and (row.remote_room_type_id, row.remote_rate_plan_id) != (
        remote_room,
        remote_rate,
    )
    if target_changed and row.used_at is not None:
        raise ApiError(
            409,
            "channel_mapping_has_history",
            "Ghép nối có dữ liệu hoặc lịch sử gửi cần bảo vệ; không thể đổi mã phòng/gói giá. Có thể yêu cầu tạm dừng để đóng bán.",
        )
    if row and row.used_at and not set(row.inbound_rate_plan_ids or []) <= set(inbound):
        raise ApiError(
            409,
            "channel_mapping_has_history",
            "Không bỏ gói nhận đặt phòng khỏi ghép nối đã sử dụng; cần giữ lịch sử đồng bộ.",
        )
    if row and row.pause_requested:
        if target_changed or inbound_changed or data["active"]:
            raise ApiError(
                409,
                "channel_mapping_pause_pending",
                "Đang đóng bán trên Channex. Theo dõi hoặc thử lại tác vụ tại Lịch sử đồng bộ trước khi bật lại.",
            )
        return mapping_json(row)
    if row and row.active and not data["active"] and row.used_at is not None:
        if inbound_changed:
            raise ApiError(
                409,
                "channel_mapping_has_history",
                "Giữ nguyên các gói đã ghép khi yêu cầu đóng bán.",
            )
        from .service import queue_job

        connection(tenant_id, active=True)
        queue_job(tenant_id, runtime().state.user.id, "pause_mapping", {"mappingId": row.id})
        row.pause_requested = True
        audit("channel.pause_requested", "room_type", room_type.id)
        return mapping_json(row)
    target_modified = (
        row is None or target_changed or inbound_changed or (data["active"] and not row.active)
    )
    if data["active"] or target_modified:
        if not configuration:
            raise ApiError(409, "channel_inactive", "Thiết lập kết nối trước khi ghép gói giá.")
        from .service import validate_mapping_target

        try:
            client = channel_adapter(
                configuration.environment, load_credentials(configuration)["apiKey"]
            )
            validate_mapping_target(
                configuration,
                client,
                remote_room,
                remote_rate,
                inbound,
                (runtime().state.tenant.settings or {}).get("currency", "VND"),
            )
        except ProviderError as error:
            raise ApiError(
                503 if error.retryable or error.code == "credentials_unavailable" else 422,
                error.code,
                "Chưa xác minh được ghép nối. Kiểm tra khách sạn, phòng, gói giá và tiền tệ Channex.",
            ) from None
    if configuration and target_modified:
        invalidate_inventory(configuration)
    if row is None:
        row = ChannelMapping(tenant_id=tenant_id, room_type_id=room_type.id)
        db.session.add(row)
    row.remote_room_type_id, row.remote_rate_plan_id, row.active = (
        remote_room,
        remote_rate,
        data["active"],
    )
    row.inbound_rate_plan_ids = inbound
    db.session.flush()
    audit("channel.mapped", "room_type", room_type.id)
    return mapping_json(row)


def handle_create_job(tenant_id):
    from .service import queue_job, window

    data = runtime().payload()
    kind = data.get("kind")
    if (
        not isinstance(kind, str)
        or kind not in {"push_ari", "pull_bookings"}
        or set(data) - {"kind", "start", "end"}
    ):
        raise ApiError(422, "invalid_channel_job", "Tác vụ đồng bộ không hợp lệ.")
    configuration = connection(tenant_id, active=True)
    details = {}
    if kind == "push_ari":
        require_reconciled(configuration)
        days = window(data.get("start"), data.get("end"))
        details = {"start": days[0].isoformat(), "end": data["end"]}
    elif set(data) != {"kind"}:
        raise ApiError(422, "invalid_channel_job", "Đồng bộ đặt phòng không nhận khoảng ngày.")
    else:
        details = {"retryFailed": True}
    row = queue_job(tenant_id, runtime().state.user.id, kind, details)
    db.session.flush()
    audit("channel.queued", "channel_job", row.id, {"kind": kind})
    return job_json(row), 202


def handle_retry_job(tenant_id, job_id):
    from ..core_models import utcnow

    if runtime().payload():
        raise ApiError(422, "invalid_channel_job", "Thử lại không nhận tham số.")
    row = db.session.scalar(
        select(ChannelJob)
        .where(ChannelJob.tenant_id == tenant_id, ChannelJob.id == job_id)
        .with_for_update()
    )
    if not row:
        raise ApiError(404, "not_found", "Không tìm thấy tác vụ.")
    if row.status not in {"failed", "needs_review"}:
        raise ApiError(409, "channel_job_not_failed", "Tác vụ chưa ở trạng thái lỗi.")
    configuration = connection(tenant_id, active=True)
    if row.kind == "load_bookings":
        invalidate_inventory(configuration)
    if row.status == "needs_review":
        row.payload = {**row.payload, "retryReview": True}
    (
        row.status,
        row.error_code,
        row.completed_at,
        row.available_at,
        row.attempts,
        row.actor_id,
    ) = (
        "queued",
        None,
        None,
        utcnow(),
        0,
        runtime().state.user.id,
    )
    audit("channel.retried", "channel_job", row.id)
    return job_json(row), 202


def handle_reconcile_inventory(tenant_id):
    from .service import drain_pending_ari

    data = runtime().payload()
    if set(data) != {"revision", "confirm"} or data["confirm"] is not True:
        raise ApiError(
            422,
            "channel_confirmation_required",
            "Xác nhận đã nhập đủ booking tương lai và đối chiếu tồn phòng với các OTA.",
        )
    row = connection(tenant_id, active=True)
    state = onboarding_json(row)
    if not isinstance(data["revision"], str) or data["revision"] != state["revision"]:
        raise ApiError(
            409,
            "channel_onboarding_changed",
            "Thiết lập đã thay đổi. Tải lại và đối chiếu trước khi xác nhận.",
        )
    if state["pendingBookings"] or state["reviewCount"]:
        raise ApiError(
            409,
            "channel_onboarding_busy",
            "Còn tác vụ booking hoặc hồ sơ cần đối soát. Xử lý xong trước khi xác nhận tồn phòng.",
        )
    if row.inventory_reconciled_at is None:
        row.inventory_reconciled_at = utcnow()
        audit(
            "channel.inventory_reconciled",
            "channel_connection",
            row.id,
            {"propertyId": row.property_id, "revision": row.inventory_revision},
        )
    drain_pending_ari(row)
    return {"onboarding": onboarding_json(row)}


def handle_webhook(tenant_id):
    from .service import queue_job

    # The registered custom header authenticates this callback before reading JSON.
    set_context(tenant_id=tenant_id)
    row = connection(tenant_id, active=True)
    try:
        secret = load_credentials(row)["webhookSecret"]
    except ProviderError:
        raise ApiError(401, "invalid_webhook_secret", "Webhook không được xác thực.") from None
    supplied = runtime().request.headers.get("X-Channex-Webhook-Secret", "")
    if (
        len(secret) < 32
        or len(supplied) > 1024
        or not supplied.isascii()
        or not hmac.compare_digest(secret.encode(), supplied.encode())
    ):
        raise ApiError(401, "invalid_webhook_secret", "Webhook không được xác thực.")
    if runtime().request.content_length is None or runtime().request.content_length > 131072:
        raise ApiError(413, "webhook_too_large", "Webhook vượt giới hạn.")
    data = runtime().payload()
    if not isinstance(data.get("event"), str) or data.get("property_id") != row.property_id:
        raise ApiError(422, "invalid_channel_webhook", "Webhook không đúng khách sạn hoặc sự kiện.")
    from pms_api.channels.exceptions_application import INCIDENT_EVENTS, receive_incident

    from .service import authorize_actor

    runtime().state.tenant = lock_tenant(tenant_id)
    authorize_actor(tenant_id, row.actor_id, operation="pull_bookings")
    if data["event"] in INCIDENT_EVENTS:
        incident = receive_incident(tenant_id, data)
        return {"accepted": True, "incidentId": incident.id}, 202
    if data["event"] not in {
        "booking",
        "booking_new",
        "booking_modification",
        "booking_cancellation",
        "non_acked_booking",
    }:
        return {"accepted": True, "ignored": True}, 202
    body = data.get("payload") or {}
    if not isinstance(body, dict) or body.get("property_id", row.property_id) != row.property_id:
        raise ApiError(422, "invalid_channel_webhook", "Nội dung webhook không hợp lệ.")
    revision = body.get("revision_id") or body.get("booking_revision_id")
    details = {"revisionId": uuid_input(revision)} if revision else {}
    queue_job(
        tenant_id,
        row.actor_id,
        "pull_bookings",
        details,
        "revision:" + details["revisionId"] if revision else None,
    )
    return {"accepted": True}, 202
