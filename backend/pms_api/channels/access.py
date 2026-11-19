"""Separate Manager OTA support from membership-based PMS access."""

from functools import wraps

from flask import g, request

from ..core_models import Tenant
from ..extensions import db
from ..security import ApiError, require_system, require_tenant, set_context
from ..subscriptions import enforce_entitlements, lock_tenant


@require_system()
def authorize_channel_support(tenant_id, action):
    if action not in {"channels.view", "channels.write"}:
        raise ApiError(403, "forbidden", "Bạn không có quyền thực hiện thao tác này.")
    set_context(g.user.id, tenant_id, is_system=True, channel_support=True)
    tenant = db.session.get(Tenant, tenant_id)
    if tenant is None:
        raise ApiError(404, "not_found", "Không tìm thấy khách sạn.")
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        tenant = lock_tenant(tenant_id)
        if tenant.status != "active":
            raise ApiError(403, "tenant_suspended", "Khách sạn đang bị tạm ngưng.")
    g.tenant = tenant
    enforce_entitlements(action)


def require_channel_access(action):
    def decorator(view):
        tenant_view = require_tenant(action)(view)

        @wraps(view)
        def wrapped(tenant_id, *args, **kwargs):
            if (request.endpoint or "").startswith("channels.support_"):
                authorize_channel_support(tenant_id, action)
                return view(tenant_id, *args, **kwargs)
            return tenant_view(tenant_id, *args, **kwargs)

        return wrapped

    return decorator
