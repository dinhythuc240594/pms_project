"""Manager OTA support summaries and minimal hotel configuration context."""

from flask import g
from sqlalchemy import and_, func, select

from common import CommonMethodView

from ..catalog.models import PhysicalRoom, RoomType
from ..channels.access import require_channel_access
from ..channels.models import ChannelConnection, ChannelJob, ChannelMapping
from ..channels.routes import connection_json
from ..core_models import Tenant
from ..extensions import db
from ..security import ApiError, require_system, set_context
from ..subscriptions import workspace_entitlements
from .channex_remote import hotel_access, support_hotels
from .client_models import TenantClientProfile


def hotel_summary(tenant_id):
    try:
        hotel_access(tenant_id, "channels.view")
    except ApiError as error:
        if error.status != 403:
            raise
        return None
    tenant = db.session.get(Tenant, tenant_id)
    if tenant is None:
        return None
    set_context(g.user.id, tenant_id, is_system=True, channel_support=True)
    profile = db.session.get(TenantClientProfile, tenant_id)
    connection = db.session.scalar(
        select(ChannelConnection).where(ChannelConnection.tenant_id == tenant_id)
    )
    summary = connection_json(connection) if connection else None
    counts = {}
    for key, model in (("roomCount", PhysicalRoom), ("roomTypeCount", RoomType)):
        counts[key] = db.session.scalar(
            select(func.count())
            .select_from(model)
            .where(model.tenant_id == tenant_id, model.active.is_(True))
        )
    active, closing = db.session.execute(
        select(
            func.count().filter(
                ChannelMapping.active.is_(True),
                ChannelMapping.pause_requested.is_(False),
                RoomType.active.is_(True),
            ),
            func.count().filter(ChannelMapping.pause_requested.is_(True)),
        )
        .join(
            RoomType,
            and_(
                RoomType.tenant_id == ChannelMapping.tenant_id,
                RoomType.id == ChannelMapping.room_type_id,
            ),
        )
        .where(ChannelMapping.tenant_id == tenant_id)
    ).one()
    latest = db.session.scalar(
        select(ChannelJob)
        .where(ChannelJob.tenant_id == tenant_id)
        .order_by(ChannelJob.created_at.desc(), ChannelJob.id.desc())
        .limit(1)
    )
    return {
        "tenantId": tenant.id,
        "name": tenant.name,
        "city": profile.city if profile else "",
        "status": tenant.status,
        **counts,
        "mappingCount": active,
        "closingCount": closing,
        "connection": {
            key: summary[key]
            for key in (
                "environment",
                "propertyId",
                "active",
                "credentialsConfigured",
                "credentialError",
                "credentialSource",
                "verifiedAt",
                "webhookRegistered",
            )
        }
        if summary
        else None,
        "latestJob": {
            "kind": latest.kind,
            "status": latest.status,
            "errorCode": latest.error_code,
            "createdAt": latest.created_at.isoformat(),
        }
        if latest
        else None,
    }


class ChannexView(CommonMethodView):
    @staticmethod
    @require_system()
    def dispatch_request():
        return {
            "hotels": [
                summary
                for row in support_hotels()
                if (summary := hotel_summary(row.tenant_id)) is not None
            ]
        }


class ChannelSupportWorkspaceView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.view")
    def dispatch_request(tenant_id):
        settings = g.tenant.settings or {}
        entitlements = workspace_entitlements(tenant_id)
        return {
            "tenant": {"id": g.tenant.id, "name": g.tenant.name, "status": g.tenant.status},
            "settings": {
                "timezone": settings.get("timezone", "Asia/Ho_Chi_Minh"),
                "currency": settings.get("currency", "VND"),
            },
            "subscription": entitlements["subscription"],
            "features": entitlements["features"],
        }
