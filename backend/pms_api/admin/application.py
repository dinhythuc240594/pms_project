import re
from decimal import Decimal

from sqlalchemy import func, select, text
from werkzeug.security import generate_password_hash

from pms_api.auth.application import user_json, validate_email, validate_password
from pms_api.bookings.application import money_value
from pms_api.ports import runtime

from ..core_models import (
    AuditLog,
    AuthSession,
    Plan,
    Subscription,
    SubscriptionHistory,
    Tenant,
    TenantUser,
    User,
    utcnow,
)
from ..extensions import db
from ..plan_pricing import calculate_plan_amount, default_pricing_rules, pricing_rules_value
from ..security import GLOBAL_ROLES, ROLES, ApiError, audit
from ..subscriptions import (
    default_features,
    ensure_quota,
    feature_values,
    integer_limit,
    lock_tenant,
    plan_code,
    plan_json,
    subscription_history_json,
    subscription_json,
    timestamp,
)
from .client_models import TenantClientProfile
from .customers import (
    CLIENT_FIELDS,
    client_values,
    customer_accounts,
    customer_tenants,
    hotel_currency,
)
from .feature_models import FEATURE_CATALOG


def name_value(value):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 160:
        raise ApiError(422, "invalid_name", "Tên cần từ 1 đến 160 ký tự.")
    return value.strip()


def new_user(data, *, prefix=""):
    email = validate_email(data.get(f"{prefix}Email" if prefix else "email"))
    if db.session.scalar(select(User).where(User.email == email)):
        raise ApiError(
            409, "email_exists", "Email đã được sử dụng. Dùng tài khoản đã có hoặc email khác."
        )
    user = User(
        name=name_value(data.get(f"{prefix}Name" if prefix else "name")),
        email=email,
        password_hash=generate_password_hash(
            validate_password(data.get(f"{prefix}Password" if prefix else "password"))
        ),
    )
    db.session.add(user)
    db.session.flush()
    return user


def system_user_json(user):
    return {**user_json(user), "createdAt": user.created_at.isoformat()}


def lock_system_users():
    # Serialize role changes and recheck an actor who may have lost access while waiting.
    db.session.execute(text("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE"))
    actor = db.session.scalar(
        select(User)
        .where(User.id == runtime().state.user.id)
        .execution_options(populate_existing=True)
    )
    if not actor.active or actor.global_role != "SUPER_ADMIN":
        raise ApiError(403, "forbidden", "Quyền quản trị của bạn đã thay đổi.")


def handle_system_users():
    return runtime().json_response(
        users=[
            system_user_json(user)
            for user in db.session.scalars(
                select(User).where(User.global_role.in_(GLOBAL_ROLES)).order_by(User.name, User.id)
            )
        ]
    )


def handle_create_system_user():
    data = runtime().payload()
    if set(data) - {"name", "email", "password", "globalRole", "active"}:
        raise ApiError(422, "unsupported_field", "Tài khoản chứa trường không được hỗ trợ.")
    role, active = data.get("globalRole", "SYSTEM_MANAGER"), data.get("active", True)
    if not isinstance(role, str) or role not in GLOBAL_ROLES or not isinstance(active, bool):
        raise ApiError(422, "invalid_user", "Vai trò hoặc trạng thái hệ thống không hợp lệ.")
    lock_system_users()
    user = new_user(data)
    user.global_role, user.active = role, active
    audit("system_user.created", "user", user.id, {"globalRole": role, "active": active})
    db.session.flush()
    return runtime().json_response(system_user_json(user)), 201


def handle_update_system_user(user_id):
    data = runtime().payload()
    if not data or set(data) - {"name", "globalRole", "active"}:
        raise ApiError(422, "unsupported_field", "Chỉ sửa tên, vai trò và trạng thái tài khoản.")
    lock_system_users()
    user = db.session.scalar(
        select(User).where(User.id == user_id, User.global_role.in_(GLOBAL_ROLES)).with_for_update()
    )
    if not user:
        raise ApiError(404, "not_found", "Không tìm thấy tài khoản hệ thống.")
    role, active = data.get("globalRole", user.global_role), data.get("active", user.active)
    if not isinstance(role, str) or role not in GLOBAL_ROLES or not isinstance(active, bool):
        raise ApiError(422, "invalid_user", "Vai trò hoặc trạng thái hệ thống không hợp lệ.")
    if user.id == runtime().state.user.id and (not active or role != "SUPER_ADMIN"):
        raise ApiError(
            409, "self_lockout", "Không thể tự khóa hoặc hạ quyền tài khoản đang đăng nhập."
        )
    if user.active and user.global_role == "SUPER_ADMIN" and (not active or role != "SUPER_ADMIN"):
        owners = db.session.scalar(
            select(func.count())
            .select_from(User)
            .where(User.active.is_(True), User.global_role == "SUPER_ADMIN")
        )
        if owners <= 1:
            raise ApiError(409, "last_super_admin", "Hệ thống cần một Super Admin đang hoạt động.")
    if "name" in data:
        user.name = name_value(data["name"])
    if not active or role != user.global_role:
        db.session.query(AuthSession).filter(AuthSession.user_id == user.id).delete(
            synchronize_session=False
        )
    user.global_role, user.active = role, active
    audit("system_user.updated", "user", user.id, {"globalRole": role, "active": active})
    db.session.flush()
    return runtime().json_response(system_user_json(user))


def handle_tenants():
    return runtime().json_response(tenants=customer_tenants())


def handle_customer_accounts():
    if (
        set(runtime().request.args) - {"search"}
        or len(runtime().request.args.getlist("search")) != 1
    ):
        raise ApiError(422, "invalid_search", "Chỉ tìm tài khoản theo tên hoặc email.")
    search = runtime().request.args["search"].strip()
    if not 2 <= len(search) <= 254 or any(ord(char) < 32 or ord(char) == 127 for char in search):
        raise ApiError(422, "invalid_search", "Từ khóa tìm kiếm cần từ 2 đến 254 ký tự.")
    return runtime().json_response(users=customer_accounts(search))


def handle_create_tenant():
    data = runtime().payload()
    if set(data) - {
        "name",
        "status",
        "ownerName",
        "ownerEmail",
        "ownerPassword",
        "ownerUserId",
        "currency",
        *CLIENT_FIELDS,
    }:
        raise ApiError(422, "unsupported_field", "Thông tin khách sạn chứa trường không hỗ trợ.")
    values = client_values(data)
    currency = hotel_currency(data.get("currency", "VND"))
    status = data.get("status", "active")
    if status not in ("active", "suspended"):
        raise ApiError(422, "invalid_status", "Trạng thái không hợp lệ.")
    if "ownerUserId" in data:
        owner_id = data["ownerUserId"]
        if (
            not isinstance(owner_id, str)
            or not owner_id.strip()
            or owner_id != owner_id.strip()
            or len(owner_id) > 40
            or {"ownerName", "ownerEmail", "ownerPassword"}.intersection(data)
        ):
            raise ApiError(
                422, "invalid_owner", "Chọn tài khoản đã có hoặc nhập thông tin tài khoản mới."
            )
        owner = db.session.scalar(select(User).where(User.id == owner_id).with_for_update())
        if owner is None:
            raise ApiError(404, "not_found", "Không tìm thấy tài khoản quản lý khách sạn.")
        if not owner.active or owner.global_role != "USER":
            raise ApiError(422, "invalid_owner", "Chọn tài khoản khách hàng đang hoạt động.")
    else:
        owner = new_user(data, prefix="owner")
    tenant = Tenant(name=name_value(data.get("name")), status=status)
    db.session.add(tenant)
    db.session.flush()
    tenant.settings = {**tenant.settings, "currency": currency}
    db.session.execute(text("SELECT pms_provision_units(:tenant)"), {"tenant": tenant.id})
    db.session.add(TenantUser(tenant_id=tenant.id, user_id=owner.id, role="HOTEL_OWNER"))
    db.session.add(
        TenantClientProfile(
            tenant_id=tenant.id,
            **{"contact_name": owner.name, "contact_email": owner.email, **values},
        )
    )
    db.session.flush()
    runtime().state.tenant = tenant
    audit("tenant.created", "tenant", tenant.id)
    return runtime().json_response(customer_tenants(tenant.id)[0]), 201


def handle_update_tenant(tenant_id):
    tenant = db.session.scalar(select(Tenant).where(Tenant.id == tenant_id).with_for_update())
    if not tenant:
        raise ApiError(404, "not_found", "Không tìm thấy khách sạn.")
    data = runtime().payload()
    if not data or set(data) - {"name", "status", *CLIENT_FIELDS}:
        raise ApiError(422, "unsupported_field", "Chỉ sửa tên, trạng thái hoặc hồ sơ khách hàng.")
    values = client_values(data)
    if "name" in data:
        tenant.name = name_value(data["name"])
    if "status" in data:
        if data["status"] not in ("active", "suspended"):
            raise ApiError(422, "invalid_status", "Trạng thái không hợp lệ.")
        tenant.status = data["status"]
    if values:
        profile = db.session.get(TenantClientProfile, tenant.id)
        if profile is None:
            profile = TenantClientProfile(tenant_id=tenant.id)
            db.session.add(profile)
        for key, value in values.items():
            setattr(profile, key, value)
    runtime().state.tenant = tenant
    audit("tenant.updated", "tenant", tenant.id, {"status": tenant.status, "fields": sorted(data)})
    db.session.flush()
    return runtime().json_response(customer_tenants(tenant.id)[0])


def handle_customer_history(tenant_id):
    if not db.session.get(Tenant, tenant_id):
        raise ApiError(404, "not_found", "Không tìm thấy khách sạn.")
    return audit_response(tenant_id, system_only=True)


# SaaS support history contains commercial/account changes, never hotel activity.
SAAS_AUDIT_EVENTS = {
    "tenant.created",
    "tenant.updated",
    "subscription.updated",
    "system_user.created",
    "system_user.updated",
    "plan.created",
    "plan.updated",
    "plan.deleted",
    "feature.updated",
    "feature_override.upserted",
    "feature_override.deleted",
    "channex.property.created",
}


def require_owner_grantor():
    # System privileges must never be used to manufacture or restore PMS access,
    # even when the actor also received an owner membership.
    if runtime().state.user.global_role in GLOBAL_ROLES or runtime().state.role != "HOTEL_OWNER":
        raise ApiError(
            403, "owner_grant_required", "Chỉ chủ khách sạn được cấp hoặc thu hồi quyền PMS."
        )


def tenant_users_json(tenant_id):
    rows = db.session.execute(
        select(User, TenantUser)
        .join(TenantUser, TenantUser.user_id == User.id)
        .where(TenantUser.tenant_id == tenant_id)
        .order_by(User.name)
    ).all()
    return [
        {
            "id": u.id,
            "name": u.name,
            "email": u.email,
            "globalRole": u.global_role,
            "active": m.active,
            "role": m.role,
            "memberships": [{"tenantId": m.tenant_id, "role": m.role, "active": m.active}],
        }
        for u, m in rows
    ]


def handle_tenant_users(tenant_id):
    return runtime().json_response(users=tenant_users_json(tenant_id))


def handle_create_tenant_user(tenant_id):
    require_owner_grantor()
    data = runtime().payload()
    if set(data) - {"name", "email", "password", "role", "active", "userId"}:
        raise ApiError(403, "forbidden", "Thông tin cấp quyền khách sạn không hợp lệ.")
    role = data.get("role", "FRONT_DESK")
    if role not in ROLES:
        raise ApiError(422, "invalid_role", "Vai trò khách sạn không hợp lệ.")
    if "globalRole" in data:
        raise ApiError(403, "forbidden", "Không thể cấp quyền hệ thống tại khách sạn.")
    active = data.get("active", True)
    if not isinstance(active, bool):
        raise ApiError(422, "invalid_membership", "Trạng thái không hợp lệ.")
    if "userId" in data:
        if not isinstance(data["userId"], str) or set(data) - {"userId", "role", "active"}:
            raise ApiError(422, "invalid_membership", "Chỉ chọn tài khoản, vai trò và trạng thái.")
        user = db.session.get(User, data["userId"])
        if user is None:
            raise ApiError(404, "not_found", "Không tìm thấy tài khoản.")
    else:
        email = validate_email(data.get("email"))
        user = db.session.scalar(select(User).where(User.email == email))
    if user is not None:
        if "password" in data or "name" in data:
            raise ApiError(
                403,
                "profile_restricted",
                "Cấp quyền tài khoản đã có không được đổi hồ sơ hoặc mật khẩu.",
            )
        if "role" not in data:
            raise ApiError(422, "invalid_role", "Chọn rõ vai trò được cấp tại khách sạn.")
        if db.session.scalar(
            select(TenantUser).where(
                TenantUser.tenant_id == tenant_id, TenantUser.user_id == user.id
            )
        ):
            raise ApiError(
                409,
                "membership_exists",
                "Tài khoản đã có quyền; cập nhật hoặc thu hồi quyền hiện tại.",
            )
    else:
        user = new_user(data)
    ensure_quota(tenant_id, "users", 1 if active else 0)
    db.session.add(TenantUser(tenant_id=tenant_id, user_id=user.id, role=role, active=active))
    audit("membership.created", "user", user.id, {"role": role})
    db.session.flush()
    return runtime().json_response(
        next(row for row in tenant_users_json(tenant_id) if row["id"] == user.id)
    ), 201


def handle_update_tenant_user(tenant_id, user_id):
    require_owner_grantor()
    # Serialize owner changes to ensure a hotel always has an active owner.
    db.session.execute(select(Tenant).where(Tenant.id == tenant_id).with_for_update()).scalar_one()
    membership = db.session.scalar(
        select(TenantUser).where(TenantUser.tenant_id == tenant_id, TenantUser.user_id == user_id)
    )
    if not membership:
        raise ApiError(404, "not_found", "Không tìm thấy nhân viên.")
    data = runtime().payload()
    if not data or set(data) - {"role", "active", "name", "email", "password", "globalRole"}:
        raise ApiError(422, "unsupported_field", "Thông tin cập nhật quyền khách sạn không hợp lệ.")
    role, active = data.get("role", membership.role), data.get("active", membership.active)
    if role not in ROLES or not isinstance(active, bool):
        raise ApiError(422, "invalid_membership", "Vai trò hoặc trạng thái không hợp lệ.")
    if (
        membership.role == "HOTEL_OWNER"
        and membership.active
        and (role != "HOTEL_OWNER" or not active)
    ):
        owners = db.session.scalar(
            select(func.count())
            .select_from(TenantUser)
            .where(
                TenantUser.tenant_id == tenant_id,
                TenantUser.role == "HOTEL_OWNER",
                TenantUser.active.is_(True),
            )
        )
        if owners <= 1:
            raise ApiError(409, "last_owner", "Khách sạn cần ít nhất một Owner đang hoạt động.")
    if "password" in data or "globalRole" in data:
        raise ApiError(
            403,
            "forbidden",
            "Dùng luồng đổi mật khẩu cá nhân; không thể cấp quyền hệ thống ở đây.",
        )
    user = db.session.get(User, user_id)
    if "email" in data and validate_email(data["email"]) != user.email:
        raise ApiError(
            422, "email_immutable", "Email đăng nhập không được đổi trong quản lý nhân viên."
        )
    if "name" in data and data["name"] != user.name:
        # A global user profile can belong to multiple hotels.
        if user.id != runtime().state.user.id:
            raise ApiError(
                403, "profile_restricted", "Chỉ người dùng hoặc Admin được đổi hồ sơ cá nhân."
            )
        user.name = name_value(data["name"])
    if active and not membership.active:
        ensure_quota(tenant_id, "users")
    membership.role, membership.active = role, active
    audit("membership.updated", "user", user_id, {"role": role, "active": active})
    db.session.flush()
    return runtime().json_response(
        next(row for row in tenant_users_json(tenant_id) if row["id"] == user.id)
    )


def handle_system_audit():
    return audit_response(system_only=True)


def handle_tenant_audit(tenant_id):
    return audit_response(tenant_id)


def audit_response(tenant_id=None, *, system_only=False):
    allowed = {"userId", "start", "end", "start_date", "end_date", "event", "page", "pageSize"}
    if tenant_id is None:
        allowed.add("tenantId")
    if set(runtime().request.args) - allowed:
        raise ApiError(422, "invalid_filter", "Bộ lọc nhật ký không được hỗ trợ.")
    conditions = []
    if system_only:
        conditions.append(AuditLog.event.in_(SAAS_AUDIT_EVENTS))
    if tenant_id is not None:
        conditions.append(AuditLog.tenant_id == tenant_id)
    for name, column in (
        ("tenantId", AuditLog.tenant_id),
        ("userId", AuditLog.user_id),
        ("event", AuditLog.event),
    ):
        if name in runtime().request.args:
            value = runtime().request.args[name]
            limit = 80 if name == "event" else 40
            if not value.strip() or len(value) > limit:
                raise ApiError(422, "invalid_filter", f"{name} phải từ 1 đến {limit} ký tự.")
            conditions.append(column == value)
    start_value, end_value = runtime().date_range()
    start = timestamp(start_value, "start") if start_value is not None else None
    end = timestamp(end_value, "end") if end_value is not None else None
    if start is not None and end is not None and start >= end:
        raise ApiError(422, "invalid_dates", "end phải sau start.")
    if start is not None:
        conditions.append(AuditLog.created_at >= start)
    if end is not None:
        conditions.append(AuditLog.created_at < end)
    try:
        page = int(runtime().request.args.get("page", "1"))
        size = int(runtime().request.args.get("pageSize", "200"))
    except ValueError:
        raise ApiError(422, "invalid_pagination", "Phân trang không hợp lệ.") from None
    if not 1 <= page <= 100000 or not 1 <= size <= 200:
        raise ApiError(422, "invalid_pagination", "page từ 1 đến 100000; pageSize từ 1 đến 200.")
    total = db.session.scalar(select(func.count()).select_from(AuditLog).where(*conditions))
    rows = db.session.scalars(
        select(AuditLog)
        .where(*conditions)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .offset((page - 1) * size)
        .limit(size)
    ).all()
    actor_names = dict(
        db.session.execute(
            select(User.id, User.name).where(
                User.id.in_({row.user_id for row in rows if row.user_id})
            )
        ).all()
    )
    return runtime().json_response(
        auditLogs=[
            {
                "id": row.id,
                "tenantId": row.tenant_id,
                "userId": row.user_id,
                "userName": actor_names.get(row.user_id, ""),
                "event": row.event,
                "entityType": row.entity_type,
                "entityId": row.entity_id,
                "details": row.details,
                "createdAt": row.created_at.isoformat(),
            }
            for row in rows
        ],
        pagination={"page": page, "pageSize": size, "totalItems": total},
    )


def handle_list_plans():
    return runtime().json_response(
        plans=[
            plan_json(plan)
            for plan in db.session.scalars(select(Plan).order_by(Plan.price, Plan.id))
        ],
        featureLabels=FEATURE_CATALOG,
    )


def handle_public_plans():
    response = runtime().json_response(
        plans=[
            plan_json(plan)
            for plan in db.session.scalars(
                select(Plan)
                .where(Plan.active.is_(True), Plan.deleted.is_(False))
                .order_by(Plan.price, Plan.id)
            )
        ],
        featureLabels=FEATURE_CATALOG,
    )
    response.headers["Cache-Control"] = "no-store"
    return response


def plan_values(data, plan=None):
    if set(data) - {
        "id",
        "code",
        "name",
        "price",
        "priceYear",
        "pricingRules",
        "currency",
        "maxRooms",
        "maxUsers",
        "features",
        "active",
        "deleted",
    }:
        raise ApiError(422, "invalid_plan", "Gói chứa trường không được hỗ trợ.")
    name = name_value(data.get("name", plan.name if plan else None))
    if len(name) > 100:
        raise ApiError(422, "invalid_name", "Tên gói tối đa 100 ký tự.")
    code = data.get("code", plan_code(plan) if plan else plan_code(Plan(name=name)))
    if not isinstance(code, str) or not re.fullmatch(r"[A-Z][A-Z0-9_]{0,11}", code):
        raise ApiError(422, "invalid_plan", "Mã gói cần 1–12 ký tự in hoa, số hoặc dấu gạch dưới.")
    if plan and plan_code(plan) is not None and code != plan_code(plan):
        raise ApiError(422, "immutable_plan_code", "Không đổi định danh gói đã có.")
    price = money_value(
        data.get("price", plan.price if plan else "2500000" if code == "PRO" else "0"),
        allow_zero=True,
    )
    annual = money_value(
        data.get(
            "priceYear",
            plan_json(plan)["priceYear"] if plan else "25000000" if code == "PRO" else price * 12,
        ),
        allow_zero=True,
    )
    if code == "FREE" and (price != 0 or annual != 0):
        raise ApiError(422, "invalid_price", "Gói Miễn Phí phải có giá bằng 0.")
    pricing_rules = pricing_rules_value(
        data.get(
            "pricingRules", plan_json(plan)["pricingRules"] if plan else default_pricing_rules()
        )
    )
    if code == "FREE" and any(
        Decimal(pricing_rules[field]) != 0 for field in ("extraRoomPrice", "extraRoomPriceYear")
    ):
        raise ApiError(422, "invalid_price", "Gói Miễn Phí không có phụ thu phòng.")
    currency = data.get("currency", plan.currency if plan else "VND")
    if not isinstance(currency, str) or currency not in {"VND", "USD"}:
        raise ApiError(422, "invalid_currency", "Tiền tệ phải là VND hoặc USD.")
    rooms = integer_limit(
        data.get(
            "maxRooms", plan_json(plan)["maxRooms"] if plan else 30 if code == "FREE" else None
        ),
        "Giới hạn phòng",
    )
    users = integer_limit(
        data.get(
            "maxUsers", plan_json(plan)["maxUsers"] if plan else 5 if code == "FREE" else None
        ),
        "Giới hạn tài khoản",
    )
    if code == "FREE" and (rooms is None or rooms > 30 or users is None or users > 5):
        raise ApiError(422, "invalid_quota", "Gói Miễn Phí có tối đa 30 phòng và 5 tài khoản.")
    features = {
        **(plan_json(plan)["features"] if plan else default_features(code)),
        **feature_values(data.get("features", {})),
    }
    active = data.get("active", plan.active if plan else True)
    deleted = data.get("deleted", bool(plan.deleted) if plan else False)
    if not isinstance(active, bool) or not isinstance(deleted, bool):
        raise ApiError(422, "invalid_plan", "Trạng thái gói phải là boolean.")
    db.session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended('pms:commercial-plans',0))")
    )
    if any(
        other.id != (plan.id if plan else None) and plan_code(other) == code
        for other in db.session.scalars(select(Plan))
    ):
        raise ApiError(409, "plan_exists", "Mã gói đã tồn tại; hãy sửa hoặc khôi phục gói đó.")
    if (
        plan
        and rooms is not None
        and rooms != plan_json(plan)["maxRooms"]
        and db.session.scalar(
            select(Subscription.id)
            .where(Subscription.plan_id == plan.id, Subscription.room_count > rooms)
            .limit(1)
        )
    ):
        raise ApiError(
            409, "quota_below_subscription", "Giới hạn thấp hơn số phòng đã đăng ký của khách sạn."
        )
    plan = plan or Plan()
    plan.pricing_rules = pricing_rules
    plan.name, plan.code, plan.price, plan.price_year, plan.currency = (
        name,
        code,
        price,
        annual,
        currency,
    )
    plan.max_rooms, plan.max_users, plan.features, plan.active, plan.deleted = (
        rooms,
        users,
        features,
        active,
        deleted,
    )
    db.session.add(plan)
    db.session.flush()
    return plan


def handle_create_plan():
    plan = plan_values(runtime().payload())
    audit("plan.created", "plan", plan.id, {"name": plan.name})
    return runtime().json_response(plan_json(plan)), 201


def handle_update_plan(plan_id):
    db.session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended('pms:commercial-plans',0))")
    )
    plan = db.session.scalar(select(Plan).where(Plan.id == plan_id).with_for_update())
    if plan is None:
        raise ApiError(404, "not_found", "Không tìm thấy gói.")
    data = runtime().payload()
    if "id" in data and data["id"] != plan.id:
        raise ApiError(422, "invalid_plan", "Mã gói không khớp URL.")
    plan = plan_values(data, plan)
    audit("plan.updated", "plan", plan.id, {"code": plan.code, "active": plan.active})
    return runtime().json_response(plan_json(plan))


def handle_delete_plan(plan_id):
    db.session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended('pms:commercial-plans',0))")
    )
    plan = db.session.scalar(select(Plan).where(Plan.id == plan_id).with_for_update())
    if plan is None:
        raise ApiError(404, "not_found", "Không tìm thấy gói.")
    # Keep subscribed hotels and immutable history working after stopping sales.
    plan.deleted = True
    audit("plan.deleted", "plan", plan.id, {"code": plan_code(plan)})
    db.session.flush()
    return runtime().json_response(plan_json(plan))


def history_json(tenant_id):
    rows = db.session.execute(
        select(SubscriptionHistory, Plan, User.name)
        .join(Plan, Plan.id == SubscriptionHistory.plan_id)
        .outerjoin(User, User.id == SubscriptionHistory.user_id)
        .where(SubscriptionHistory.tenant_id == tenant_id)
        .order_by(SubscriptionHistory.created_at.desc(), SubscriptionHistory.id)
        .limit(200)
    ).all()
    return [
        subscription_history_json(row, plan, actor_name=actor, include_actor=True)
        for row, plan, actor in rows
    ]


def subscription_response(tenant_id):
    row = db.session.execute(
        select(Subscription, Plan)
        .join(Plan, Plan.id == Subscription.plan_id)
        .where(Subscription.tenant_id == tenant_id)
    ).one_or_none()
    return {
        "subscription": subscription_json(*row) if row else None,
        "history": history_json(tenant_id),
    }


def handle_tenant_subscription(tenant_id):
    if db.session.get(Tenant, tenant_id) is None:
        raise ApiError(404, "not_found", "Không tìm thấy khách sạn.")
    return runtime().json_response(subscription_response(tenant_id))


def handle_subscription_history(tenant_id):
    if db.session.get(Tenant, tenant_id) is None:
        raise ApiError(404, "not_found", "Không tìm thấy khách sạn.")
    return runtime().json_response(history=history_json(tenant_id))


def handle_update_subscription(tenant_id):
    data = runtime().payload()
    if set(data) - {
        "planId",
        "status",
        "startDate",
        "endDate",
        "amount",
        "currency",
        "cycle",
        "roomCount",
    }:
        raise ApiError(422, "invalid_subscription", "Yêu cầu chứa trường không được hỗ trợ.")
    runtime().state.tenant = lock_tenant(tenant_id)
    plan_id = data.get("planId")
    status = data.get("status", "active")
    if (
        not isinstance(plan_id, str)
        or not isinstance(status, str)
        or status not in {"active", "expired", "cancelled"}
    ):
        raise ApiError(
            422, "invalid_subscription", "Gói hoặc trạng thái subscription không hợp lệ."
        )
    plan = db.session.scalar(select(Plan).where(Plan.id == plan_id).with_for_update(read=True))
    if plan is None:
        raise ApiError(404, "not_found", "Không tìm thấy gói.")
    if status == "active" and not plan.active:
        raise ApiError(409, "inactive_plan", "Gói đã ngừng hoạt động.")
    sub = db.session.scalar(
        select(Subscription).where(Subscription.tenant_id == tenant_id).with_for_update()
    )
    previous = sub.plan_id if sub else None
    if plan.deleted and previous != plan.id:
        raise ApiError(
            409, "deleted_plan", "Gói đã ngừng bán; chỉ có thể gia hạn khách sạn đang sử dụng."
        )
    plan_data = plan_json(plan)
    room_cap = plan_data["maxRooms"]
    default_rooms = min(plan_data["pricingRules"]["baseRooms"], room_cap or 1000000)
    room_count = integer_limit(
        data.get("roomCount", sub.room_count if sub else default_rooms), "Số phòng đăng ký"
    )
    if room_count is None:
        raise ApiError(422, "invalid_quota", "Cần nhập số phòng đăng ký.")
    if room_cap is not None and room_count > room_cap:
        raise ApiError(
            409, "quota_exceeded", "Số phòng đăng ký vượt giới hạn gói.", {"limit": room_cap}
        )
    used = db.session.scalar(text("SELECT pms_room_quota_used(:tenant)"), {"tenant": tenant_id})
    if room_count < used:
        raise ApiError(
            409,
            "quota_below_usage",
            "Số phòng đăng ký thấp hơn số phòng đang hoạt động.",
            {"used": used},
        )
    previous_end, previous_status = (sub.end_date, sub.status) if sub else (None, None)
    start = (
        timestamp(data["startDate"], "Ngày bắt đầu")
        if "startDate" in data
        else sub.start_date
        if sub
        else utcnow()
    )
    if "endDate" in data:
        end = timestamp(data["endDate"], "Ngày kết thúc") if data["endDate"] is not None else None
    elif plan_code(plan) == "FREE" and previous != plan_id:
        end = None
    else:
        end = previous_end
    if end is not None and end <= start:
        raise ApiError(422, "invalid_dates", "Hạn gói phải sau ngày bắt đầu.")
    if status == "active" and plan_code(plan) != "FREE" and (end is None or end <= utcnow()):
        raise ApiError(422, "invalid_dates", "Gói đang hoạt động cần hạn trong tương lai.")
    currency = data.get("currency", plan.currency)
    if currency != plan.currency:
        raise ApiError(422, "currency_mismatch", "Tiền tệ thanh toán phải cùng loại với gói.")
    if "amount" in data:
        money_value(data["amount"], allow_zero=True)
    cycle = data.get("cycle", "monthly")
    if not isinstance(cycle, str) or cycle not in {"monthly", "yearly"}:
        raise ApiError(422, "invalid_cycle", "Chu kỳ phải là monthly hoặc yearly.")
    amount = calculate_plan_amount(plan_data, room_count, cycle)
    if previous is None:
        action = "created"
    elif previous != plan_id:
        action = "changed_plan"
    elif end is not None and (previous_end is None or end > previous_end):
        action = "renewed"
    elif previous_status != status:
        action = "changed_status"
    else:
        action = "updated"
    sub = sub or Subscription(tenant_id=tenant_id)
    sub.plan_id, sub.status, sub.start_date, sub.end_date = plan_id, status, start, end
    sub.room_count = room_count
    db.session.add(sub)
    db.session.add(
        SubscriptionHistory(
            tenant_id=tenant_id,
            plan_id=plan_id,
            action=action,
            user_id=runtime().state.user.id,
            plan_name=plan.name,
            plan_code=plan_code(plan),
            previous_plan_id=previous,
            amount=amount,
            currency=currency,
            effective_date=timestamp(data["startDate"], "Ngày hiệu lực")
            if "startDate" in data
            else utcnow(),
            end_date=end,
            cycle=cycle,
            status=status,
            room_count=room_count,
        )
    )
    db.session.flush()
    audit(
        "subscription.updated",
        "tenant",
        tenant_id,
        {"planId": plan_id, "status": status, "roomCount": room_count},
    )
    return runtime().json_response(id=sub.id, **subscription_response(tenant_id))
