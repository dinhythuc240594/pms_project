"""Commercial plans, tenant entitlements and transaction-scoped quota checks."""

from datetime import datetime
from decimal import Decimal

from flask import g, request
from sqlalchemy import func, select

from .admin.feature_models import FEATURE_CATALOG, FeatureControl, TenantFeatureOverride
from .catalog.models import PhysicalRoom
from .core_models import Plan, Subscription, Tenant, TenantUser, utcnow
from .extensions import db
from .plan_pricing import default_pricing_rules
from .security import ApiError

ACTION_FEATURES = {
    "channels.view": "OTA_SYNC",
    "channels.write": "OTA_SYNC",
    "dashboard.view": "DASHBOARD",
    "reservations.view": "RESERVATION_VIEW",
    "reservations.write": "RESERVATION_CREATE",
    "rooms.view": "ROOM_DIAGRAM",
    "housekeeping.view": "HOUSEKEEPING",
    "housekeeping.write": "HOUSEKEEPING",
    "housekeeping.manage": "HOUSEKEEPING",
    "cashbook.view": "CASHBOOK",
    "cashbook.write": "CASHBOOK",
    "cashbook.reverse": "CASHBOOK",
    "payments.write": "CASHBOOK",
    "finance.adjust": "CASHBOOK",
    "rates.view": "ARI_MANAGEMENT",
    "rates.write": "ARI_MANAGEMENT",
    "inventory.view": "INVENTORY_WAREHOUSE",
    "inventory.write": "INVENTORY_WAREHOUSE",
    "reports.view": "REPORTS_BASIC",
    "reconciliation.view": "REPORTS_BASIC",
    "reconciliation.confirm": "REPORTS_BASIC",
    "reports.advanced.view": "REPORTS_ADVANCED",
}
CORE_FEATURES = {
    "DASHBOARD",
    "ROOM_DIAGRAM",
    "RESERVATION_VIEW",
    "RESERVATION_CREATE",
    "TAPE_CHART",
    "ARI_MANAGEMENT",
    "HOUSEKEEPING",
    "POS_SALES",
    "CASHBOOK",
    "REPORTS_BASIC",
}
ADVANCED_FEATURES = {
    "OTA_SYNC",
    "REPORTS_ADVANCED",
    "INVENTORY_WAREHOUSE",
    "MULTI_CURRENCY",
    "VOUCHER_PROMO",
    "API_EXTERNAL",
}


def plan_code(plan):
    if plan.code:
        return plan.code
    name = plan.name.casefold()
    if "free" in name or "miễn phí" in name or "mien phi" in name:
        return "FREE"
    if "pro" in name or "chuyên nghiệp" in name or "chuyen nghiep" in name:
        return "PRO"
    return None


def timestamp(value, label):
    try:
        parsed = datetime.fromisoformat(value) if isinstance(value, str) else None
        if parsed is None or parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ValueError
        return parsed
    except ValueError, TypeError:
        raise ApiError(422, "invalid_dates", f"{label} phải là thời điểm ISO có múi giờ.") from None


def integer_limit(value, label):
    if value is not None and (
        isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 1000000
    ):
        raise ApiError(422, "invalid_quota", f"{label} phải là số nguyên dương hoặc null.")
    return value


def feature_values(value):
    if not isinstance(value, dict) or any(
        key not in FEATURE_CATALOG or not isinstance(enabled, bool)
        for key, enabled in value.items()
    ):
        raise ApiError(422, "invalid_features", "Tính năng phải là object mã tính năng và boolean.")
    return value


def default_features(code):
    return {**dict.fromkeys(CORE_FEATURES, True), **dict.fromkeys(ADVANCED_FEATURES, code == "PRO")}


def plan_json(plan):
    code = plan_code(plan)
    return {
        "id": plan.id,
        "code": code,
        "name": plan.name,
        "price": format(plan.price, ".4f"),
        "priceYear": format(
            plan.price_year
            if plan.price_year is not None
            else Decimal("25000000")
            if code == "PRO" and plan.price == Decimal("2500000")
            else plan.price * 12,
            ".4f",
        ),
        "currency": plan.currency,
        "pricingRules": getattr(plan, "pricing_rules", None) or default_pricing_rules(),
        "maxRooms": plan.max_rooms
        if plan.max_rooms is not None
        else 30
        if code == "FREE"
        else None,
        "maxUsers": plan.max_users if plan.max_users is not None else 5 if code == "FREE" else None,
        "features": {key: (plan.features or {}).get(key, True) for key in FEATURE_CATALOG},
        "active": plan.active,
        "deleted": bool(plan.deleted),
    }


def lock_tenant(tenant_id):
    tenant = db.session.scalar(
        select(Tenant)
        .where(Tenant.id == tenant_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if tenant is None:
        raise ApiError(404, "not_found", "Không tìm thấy khách sạn.")
    return tenant


def entitlement(tenant_id=None):
    tenant_id = tenant_id or g.tenant.id
    cached = getattr(g, "subscription_entitlement", None)
    if (
        cached is not None
        and cached[0] == tenant_id
        and cached[2] is db.session().get_transaction()
    ):
        return cached[1]
    statement = (
        select(Subscription, Plan)
        .join(Plan, Plan.id == Subscription.plan_id)
        .where(Subscription.tenant_id == tenant_id)
    )
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        statement = statement.with_for_update(read=True, of=(Subscription, Plan))
    row = db.session.execute(statement).one_or_none()
    reason = None
    if row:
        sub, plan = row
        if not plan.active:
            reason = "inactive"
        elif sub.status != "active":
            reason = sub.status
        elif sub.start_date > utcnow():
            reason = "future"
        elif sub.end_date is not None and sub.end_date <= utcnow():
            reason = "expired"
        value = {"subscription": sub, "plan": plan, "blockedReason": reason}
    else:
        value = {"subscription": None, "plan": None, "blockedReason": None}
    g.subscription_entitlement = (tenant_id, value, db.session().get_transaction())
    return value


def effective_features(tenant_id=None, *, for_write=False):
    """Blocked tenants retain plan reads; grants cannot revive their feature access."""
    tenant_id = tenant_id or g.tenant.id
    cached = getattr(g, "effective_feature_entitlement", None)
    if cached is None or cached[0] != tenant_id or cached[3] is not db.session().get_transaction():
        value = entitlement(tenant_id)
        plan = value["plan"]
        tenant = (
            g.tenant
            if getattr(g, "tenant", None) and g.tenant.id == tenant_id
            else db.session.get(Tenant, tenant_id)
        )
        blocked = value["blockedReason"] or (tenant and tenant.status != "active")
        resolved = {
            code: (plan.features or {}).get(code, True) is not False if plan else True
            for code in FEATURE_CATALOG
        }
        if not blocked or blocked == "expired" and operational_access(tenant_id):
            now = utcnow()
            for row in db.session.scalars(
                select(TenantFeatureOverride).where(TenantFeatureOverride.tenant_id == tenant_id)
            ):
                if row.expires_at is None or row.expires_at > now:
                    resolved[row.code] = row.enabled
        for row in db.session.scalars(select(FeatureControl)):
            if not row.enabled_global:
                resolved[row.code] = False
        cached = (tenant_id, resolved, blocked, db.session().get_transaction())
        g.effective_feature_entitlement = cached
    return dict.fromkeys(cached[1], False) if for_write and cached[2] else dict(cached[1])


def feature_enabled(code, *, for_write=False):
    return effective_features(for_write=for_write).get(code, True)


def operational_access(tenant_id, *, include_inactive=False):
    """Latest explicit decision; expiry recovery never revives a suspended hotel or plan."""
    from .saas_billing.models import SaaSOperationalAccess

    row = db.session.execute(
        select(SaaSOperationalAccess, Subscription, Plan, Tenant)
        .join(
            Subscription,
            (Subscription.id == SaaSOperationalAccess.subscription_id)
            & (Subscription.tenant_id == SaaSOperationalAccess.tenant_id),
        )
        .join(Plan, Plan.id == Subscription.plan_id)
        .join(Tenant, Tenant.id == SaaSOperationalAccess.tenant_id)
        .where(SaaSOperationalAccess.tenant_id == tenant_id)
        .order_by(SaaSOperationalAccess.created_at.desc(), SaaSOperationalAccess.id.desc())
        .limit(1)
    ).one_or_none()
    if row is None:
        return None
    access, sub, plan, tenant = row
    now = utcnow()
    active = bool(
        access.until
        and access.until > now
        and tenant.status == "active"
        and plan.active
        and sub.status == "active"
        and sub.start_date <= now
        and sub.end_date
        and sub.end_date <= now
        and sub.end_date == access.subscription_end
        and sub.plan_id == access.plan_id
    )
    if not include_inactive and not active:
        return None
    return {
        "id": access.id,
        "until": access.until.isoformat() if access.until else None,
        "reason": access.reason,
        "createdAt": access.created_at.isoformat(),
        "active": active,
    }


def completion_allowed(action, access, *, operation=None):
    if not access:
        return False
    endpoint = request.endpoint
    if action == "channels.write":
        return endpoint in {
            "channels.webhook",
            "channels.resolve_booking_review",
            "channels.incident_action",
            "channels.support_incident_action",
        } or operation in {"pull_bookings", "ack_revision"}
    if endpoint == "housekeeping.change_task_status":
        return True
    if endpoint not in {
        "booking.add_charge",
        "booking.add_payment",
        "booking.refund_payment",
        "booking.adjust_closed_stay",
        "booking.change_status",
    }:
        return False
    from .bookings.models import Reservation

    booking = db.session.scalar(
        select(Reservation).where(
            Reservation.tenant_id == g.tenant.id,
            Reservation.id == (request.view_args or {}).get("reservation_id"),
        )
    )
    if booking is None or booking.created_at > datetime.fromisoformat(access["createdAt"]):
        return False
    if endpoint == "booking.change_status":
        data = request.get_json(silent=True)
        return (
            booking.status == "IN_HOUSE"
            and isinstance(data, dict)
            and data.get("status") == "CHECKED_OUT"
        )
    return booking.status == "IN_HOUSE" or (
        endpoint in {"booking.refund_payment", "booking.adjust_closed_stay"}
        and booking.status in {"CHECKED_OUT", "CANCELLED", "NO_SHOW"}
    )


def enforce_entitlements(action, *, operation=None):
    value = entitlement()
    feature = (
        "POS_SALES"
        if request.blueprint == "finance" and "/pos/" in request.path
        else ACTION_FEATURES.get(action)
    )
    if feature and not feature_enabled(feature):
        raise ApiError(
            403,
            "feature_disabled",
            "Tính năng đã bị tắt trong gói của khách sạn.",
            {"feature": feature},
        )
    if (
        request.method not in {"GET", "HEAD", "OPTIONS"}
        and value["blockedReason"]
        and not (
            value["blockedReason"] == "expired"
            and completion_allowed(action, operational_access(g.tenant.id), operation=operation)
        )
    ):
        raise ApiError(
            403,
            "subscription_inactive",
            "Gói hiện không cho phép ghi dữ liệu; vui lòng gia hạn.",
            {"reason": value["blockedReason"]},
        )


def quota_limit(value, resource):
    plan = value["plan"]
    if plan is None:
        return None
    cap = plan_json(plan)["maxRooms" if resource == "rooms" else "maxUsers"]
    if resource == "rooms":
        registered = value["subscription"].room_count
        return min(registered, cap) if cap is not None else registered
    return cap


def quota_used(tenant_id, resource):
    model = PhysicalRoom if resource == "rooms" else TenantUser
    return db.session.scalar(
        select(func.count())
        .select_from(model)
        .where(model.tenant_id == tenant_id, model.active.is_(True))
    )


def ensure_quota(tenant_id, resource, delta=1, *, require_registration=False):
    if delta <= 0 and not require_registration:
        return
    lock_tenant(tenant_id)
    value = entitlement(tenant_id)
    if resource == "rooms" and value["subscription"] is None:
        raise ApiError(
            409, "subscription_required", "Cần đăng ký gói và số phòng trước khi thêm phòng."
        )
    if delta <= 0:
        return
    limit = quota_limit(value, resource)
    used = quota_used(tenant_id, resource)
    if limit is not None and used + delta > limit:
        raise ApiError(
            409,
            "quota_exceeded",
            "Đã đạt giới hạn của gói khách sạn.",
            {"resource": resource, "used": used, "limit": limit},
        )


def subscription_json(sub, plan):
    if sub is None:
        return None
    now = utcnow()
    reason = (
        "inactive"
        if not plan.active
        else sub.status
        if sub.status != "active"
        else "future"
        if sub.start_date > now
        else "expired"
        if sub.end_date and sub.end_date <= now
        else None
    )
    return {
        "id": sub.id,
        "planId": sub.plan_id,
        "planName": plan.name,
        "planCode": plan_code(plan),
        "roomCount": sub.room_count,
        "status": sub.status,
        "startDate": sub.start_date.isoformat(),
        "endDate": sub.end_date.isoformat() if sub.end_date else None,
        "effectiveActive": reason is None,
        "blockedReason": reason,
        "planFeatures": dict(plan.features or {}),
        "operationalAccess": operational_access(sub.tenant_id, include_inactive=True),
    }


def subscription_history_json(row, plan, *, actor_name=None, include_actor=False):
    """Keep operator and owner history on the same immutable plan snapshots."""
    value = {
        "id": row.id,
        "planId": row.plan_id,
        "planName": row.plan_name or plan.name,
        "planCode": row.plan_code or plan_code(plan),
        "previousPlanId": row.previous_plan_id,
        "action": row.action,
        "amount": format(row.amount, ".4f") if row.amount is not None else None,
        "currency": row.currency,
        "cycle": row.cycle,
        "status": row.status,
        "roomCount": row.room_count,
        "effectiveDate": row.effective_date.isoformat(),
        "endDate": row.end_date.isoformat() if row.end_date else None,
        "createdAt": row.created_at.isoformat(),
    }
    if include_actor:
        value.update(actorId=row.user_id, actorName=actor_name)
    return value


def workspace_entitlements(tenant_id):
    value = entitlement(tenant_id)
    sub, plan = value["subscription"], value["plan"]
    subscription = subscription_json(sub, plan)
    if subscription:
        subscription["effectiveFeatures"] = effective_features(tenant_id)
    return {
        "features": effective_features(tenant_id, for_write=True),
        "subscription": subscription,
        "quota": {
            resource: {
                "used": quota_used(tenant_id, resource),
                "limit": quota_limit(value, resource),
            }
            for resource in ("rooms", "users")
        },
    }
