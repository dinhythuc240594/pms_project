"""A provider request is not proof that existing bookings reached the PMS."""

import hashlib
import json

from flask import g
from sqlalchemy import func, or_, select

from ..core_models import uid
from ..extensions import db
from ..security import ApiError, audit, set_context
from ..subscriptions import lock_tenant
from .models import ChannelBookingReview, ChannelConnection, ChannelJob


def require_reconciled(connection):
    if connection.inventory_reconciled_at is None:
        raise ApiError(
            409,
            "channel_inventory_unreconciled",
            "Nhập và đối chiếu booking tương lai, xác nhận tồn phòng trước khi gửi giá/phòng OTA.",
        )


def invalidate_inventory(connection):
    if db.session.scalar(
        select(ChannelJob.id)
        .where(
            ChannelJob.tenant_id == connection.tenant_id,
            ChannelJob.kind == "push_ari",
            ChannelJob.status == "processing",
        )
        .limit(1)
    ):
        raise ApiError(
            409,
            "channel_inventory_publishing",
            "Đang gửi giá hoặc tồn phòng. Chờ lượt gửi hoàn tất rồi thử lại.",
        )
    connection.inventory_reconciled_at = None
    connection.inventory_revision = uid()


def invalidate_linked_inventory(environment, property_id):
    connection = db.session.scalar(
        select(ChannelConnection).where(
            ChannelConnection.environment == environment,
            ChannelConnection.property_id == property_id,
        )
    )
    if connection is None:
        return
    tenant_id, actor_id = connection.tenant_id, g.user.id
    context_tenant = getattr(getattr(g, "tenant", None), "id", "")
    lock_tenant(tenant_id)
    db.session.refresh(connection)
    if (connection.environment, connection.property_id) != (environment, property_id):
        raise ApiError(
            409, "channel_onboarding_changed", "Kết nối đã thay đổi. Tải lại trước khi tiếp tục."
        )
    invalidate_inventory(connection)
    revision = connection.inventory_revision
    audit(
        "channel.inventory_invalidated",
        "channel_connection",
        connection.id,
        {"tenantId": tenant_id, "propertyId": property_id},
    )
    # The block must survive a process crash or an uncertain upstream mutation.
    db.session.commit()
    from .access import authorize_channel_support

    if g.user.global_role in {"SUPER_ADMIN", "SYSTEM_MANAGER"}:
        authorize_channel_support(context_tenant, "channels.write")
    else:
        set_context(actor_id, context_tenant)
    lock_tenant(tenant_id)
    db.session.refresh(connection)
    if connection.inventory_revision != revision or connection.inventory_reconciled_at is not None:
        raise ApiError(
            409,
            "channel_onboarding_changed",
            "Trạng thái đối chiếu vừa thay đổi. Tải lại trước khi tiếp tục.",
        )


def load_target(entity):
    attrs = entity["attributes"]
    values = {
        "id": entity["id"],
        "properties": sorted(attrs["properties"]),
        "mappings": sorted((row["id"], row["rate_plan_id"]) for row in attrs["rate_plans"]),
        "active": attrs["is_active"],
        "updatedAt": attrs.get("updated_at"),
    }
    return hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest()


def validate_load(client, connection, channel_id, target=None):
    from ..admin.channex_channels import verify_channel

    entity = verify_channel(client, channel_id, connection.property_id, mutable=True)
    attrs = entity["attributes"]
    if "load_future_reservations" not in attrs.get("actions", []):
        raise ApiError(
            409,
            "channel_load_unsupported",
            "Kênh này không hỗ trợ yêu cầu tải booking cũ; cần nhập và đối chiếu thủ công.",
        )
    if not attrs["is_active"] or not attrs["rate_plans"]:
        raise ApiError(
            409,
            "channel_load_unavailable",
            "Bật và ghép nối kênh trước khi yêu cầu tải booking cũ.",
        )
    if target is not None and load_target(entity) != target:
        raise ApiError(
            409,
            "channel_onboarding_changed",
            "Ghép nối kênh đã thay đổi. Tải lại và yêu cầu nhập booking cũ.",
        )
    return entity


def onboarding_json(connection):
    from .routes import job_json

    if connection is None:
        return None
    tenant_id = connection.tenant_id
    channel_id = ChannelJob.payload["channelId"].astext
    loads = db.session.scalars(
        select(ChannelJob)
        .where(
            ChannelJob.tenant_id == tenant_id,
            ChannelJob.kind == "load_bookings",
        )
        .distinct(channel_id)
        .order_by(channel_id, ChannelJob.created_at.desc())
    )
    pending = db.session.scalar(
        select(func.count())
        .select_from(ChannelJob)
        .where(
            ChannelJob.tenant_id == tenant_id,
            or_(
                ChannelJob.kind.in_(["load_bookings", "ack_revision"]),
                (ChannelJob.kind == "pull_bookings")
                & ChannelJob.payload["revisionId"].astext.is_not(None),
            ),
            ChannelJob.status.in_(["queued", "processing"]),
        )
    )
    reviews = db.session.scalar(
        select(func.count())
        .select_from(ChannelBookingReview)
        .where(
            ChannelBookingReview.tenant_id == tenant_id,
            ChannelBookingReview.resolved_at.is_(None),
        )
    )
    return {
        "revision": connection.inventory_revision,
        "reconciledAt": connection.inventory_reconciled_at.isoformat()
        if connection.inventory_reconciled_at
        else None,
        "pendingBookings": pending,
        "reviewCount": reviews,
        "loads": [job_json(row) for row in loads],
    }


def request_existing_bookings(environment, client, prop, entity):
    from .routes import job_json
    from .service import queue_job

    connection = db.session.scalar(
        select(ChannelConnection).where(
            ChannelConnection.environment == environment,
            ChannelConnection.property_id == prop["id"],
        )
    )
    if connection is None or not connection.active:
        raise ApiError(
            409, "channel_inactive", "Cấu hình và bật kết nối PMS của khách sạn để nhận booking cũ."
        )
    entity = validate_load(client, connection, entity["id"], load_target(entity))
    target = load_target(entity)
    dedupe = "load:" + hashlib.sha256((entity["id"] + target).encode()).hexdigest()
    existing = db.session.scalar(
        select(ChannelJob).where(
            ChannelJob.tenant_id == connection.tenant_id,
            ChannelJob.dedupe_key == dedupe,
        )
    )
    if existing is not None and existing.status != "failed":
        return {"job": job_json(existing)}, 202
    invalidate_inventory(connection)
    row = queue_job(
        connection.tenant_id,
        g.user.id,
        "load_bookings",
        {"channelId": entity["id"], "target": target},
        dedupe,
        retry_failed=True,
    )
    audit(
        "channel.booking_load_requested",
        "channel_job",
        row.id,
        {"channelId": entity["id"], "propertyId": prop["id"]},
    )
    return {"job": job_json(row)}, 202
