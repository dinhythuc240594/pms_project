import re
import secrets
from datetime import timedelta

from sqlalchemy import case, select
from sqlalchemy.dialects.postgresql import insert
from werkzeug.security import check_password_hash, generate_password_hash

from pms_api.ports import runtime

from ..core_models import AuthSession, LoginAttempt, Tenant, TenantUser, User, utcnow
from ..extensions import db
from ..security import (
    COOKIE,
    ApiError,
    audit,
    authenticate,
    check_origin,
    digest,
    set_context,
)

DUMMY_HASH = generate_password_hash("invalid-account-placeholder")


def validate_password(password):
    if not isinstance(password, str) or not 12 <= len(password) <= 128:
        raise ApiError(422, "invalid_password", "Mật khẩu cần từ 12 đến 128 ký tự.")
    return password


def validate_email(email):
    if not isinstance(email, str):
        raise ApiError(422, "invalid_email", "Email không hợp lệ.")
    email = email.strip().lower()
    local, separator, domain = email.partition("@")
    if (
        len(email) > 254
        or not separator
        or not local
        or len(local) > 64
        or local.startswith(".")
        or local.endswith(".")
        or ".." in local
        or not re.fullmatch(r"[a-z0-9!#$%&'*+/=?^_`{|}~.-]+", local)
        or any(
            not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
            for label in domain.split(".")
        )
    ):
        raise ApiError(422, "invalid_email", "Email không hợp lệ.")
    return email


def user_json(user):
    memberships = db.session.scalars(select(TenantUser).where(TenantUser.user_id == user.id)).all()
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "globalRole": user.global_role,
        "active": user.active,
        "memberships": [
            {"tenantId": m.tenant_id, "role": m.role, "active": m.active} for m in memberships
        ],
    }


def tenant_json(tenant):
    return {**tenant.settings, "id": tenant.id, "name": tenant.name, "status": tenant.status}


def session_json(user, session):
    tenants = db.session.scalars(
        select(Tenant)
        .join(TenantUser, TenantUser.tenant_id == Tenant.id)
        .where(TenantUser.user_id == user.id, TenantUser.active.is_(True))
        .order_by(Tenant.name)
    ).all()
    return {
        "user": user_json(user),
        "tenants": [tenant_json(t) for t in tenants],
        "csrfToken": session.csrf_token,
        "expiresAt": session.expires_at.isoformat(),
    }


def count_attempt(key):
    now = utcnow()
    cutoff = now - timedelta(minutes=15)
    stmt = insert(LoginAttempt).values(key=digest(key), started_at=now, attempts=1)
    stmt = stmt.on_conflict_do_update(
        index_elements=[LoginAttempt.key],
        set_={
            "started_at": case(
                (LoginAttempt.started_at < cutoff, now), else_=LoginAttempt.started_at
            ),
            "attempts": case(
                (LoginAttempt.started_at < cutoff, 1), else_=LoginAttempt.attempts + 1
            ),
        },
    ).returning(LoginAttempt.attempts)
    return db.session.execute(stmt).scalar_one()


def handle_login():
    check_origin()
    data = runtime().payload()
    email = validate_email(data.get("email"))
    password = data.get("password", "")
    if not isinstance(password, str) or len(password) > 128:
        raise ApiError(401, "invalid_credentials", "Email hoặc mật khẩu không đúng.")
    runtime().state.commit_on_error = True  # Failed attempts persist across workers/restarts.
    limited = count_attempt("ip:" + (runtime().request.remote_addr or "unknown")) > 60
    if not limited:
        limited = count_attempt("email:" + email) > 10
    if limited:
        raise ApiError(429, "rate_limited", "Bạn đã thử đăng nhập nhiều lần. Vui lòng chờ 15 phút.")
    # Session creation must finish before account changes revoke its sessions.
    user = db.session.scalar(select(User).where(User.email == email).with_for_update(read=True))
    valid = check_password_hash(user.password_hash if user else DUMMY_HASH, password)
    if not user or not user.active or not valid:
        raise ApiError(401, "invalid_credentials", "Email hoặc mật khẩu không đúng.")
    runtime().state.commit_on_error = False
    previous = runtime().request.cookies.get(COOKIE)
    if previous:
        old = db.session.get(AuthSession, digest(previous))
        if old:
            db.session.delete(old)
    token = secrets.token_urlsafe(48)
    lifetime = timedelta(days=7) if data.get("remember") is True else timedelta(hours=8)
    session = AuthSession(
        token_hash=digest(token),
        user_id=user.id,
        csrf_token=secrets.token_urlsafe(32),
        expires_at=utcnow() + lifetime,
    )
    db.session.add(session)
    set_context(user.id)
    response = runtime().json_response(session_json(user, session))
    response.set_cookie(
        COOKIE,
        token,
        max_age=int(lifetime.total_seconds()) if data.get("remember") is True else None,
        httponly=True,
        secure=runtime().config["APP_ENV"] == "production",
        samesite="Lax",
        path="/api",
    )
    return response


def handle_current_session():
    user = authenticate()
    return runtime().json_response(session_json(user, runtime().state.auth_session))


def handle_logout():
    authenticate()
    db.session.delete(runtime().state.auth_session)
    response = runtime().json_response(ok=True)
    response.delete_cookie(
        COOKIE,
        path="/api",
        httponly=True,
        secure=runtime().config["APP_ENV"] == "production",
        samesite="Lax",
    )
    return response


def handle_change_password():
    user = lock_current_user()
    data = runtime().payload()
    previous = data.get("currentPassword", "")
    if not isinstance(previous, str) or not check_password_hash(user.password_hash, previous):
        raise ApiError(403, "invalid_password", "Mật khẩu hiện tại không đúng.")
    user.password_hash = generate_password_hash(validate_password(data.get("newPassword")))
    db.session.query(AuthSession).filter(
        AuthSession.user_id == user.id,
        AuthSession.token_hash != runtime().state.auth_session.token_hash,
    ).delete(synchronize_session=False)
    return runtime().json_response(ok=True)


def lock_current_user():
    actor = authenticate()
    user = db.session.scalar(
        select(User)
        .where(User.id == actor.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if not user or not user.active:
        raise ApiError(401, "unauthenticated", "Vui lòng đăng nhập lại.")
    session = db.session.scalar(
        select(AuthSession)
        .where(
            AuthSession.token_hash == runtime().state.auth_session.token_hash,
            AuthSession.user_id == user.id,
            AuthSession.expires_at > utcnow(),
        )
        .execution_options(populate_existing=True)
    )
    if session is None:
        raise ApiError(401, "unauthenticated", "Vui lòng đăng nhập lại.")
    runtime().state.auth_session = session
    return user


def handle_update_profile():
    user = lock_current_user()
    data = runtime().payload()
    name = data.get("name")
    if set(data) != {"name"} or not isinstance(name, str) or not 1 <= len(name.strip()) <= 160:
        raise ApiError(422, "invalid_profile", "Chỉ sửa họ tên, từ 1 đến 160 ký tự.")
    user.name = name.strip()
    audit("profile.updated", "user", user.id)
    return runtime().json_response(user=user_json(user))


def handle_own_sessions():
    user = authenticate()
    rows = db.session.scalars(
        select(AuthSession)
        .where(AuthSession.user_id == user.id, AuthSession.expires_at > utcnow())
        .order_by(AuthSession.created_at.desc())
    ).all()
    return runtime().json_response(
        sessions=[
            {
                "current": row.token_hash == runtime().state.auth_session.token_hash,
                "createdAt": row.created_at.isoformat(),
                "expiresAt": row.expires_at.isoformat(),
            }
            for row in rows
        ]
    )


def handle_revoke_other_sessions():
    user = lock_current_user()
    if runtime().payload():
        raise ApiError(422, "unsupported_field", "Thao tác này chỉ thu hồi các phiên khác của bạn.")
    count = (
        db.session.query(AuthSession)
        .filter(
            AuthSession.user_id == user.id,
            AuthSession.token_hash != runtime().state.auth_session.token_hash,
        )
        .delete(synchronize_session=False)
    )
    audit("sessions.revoked", "user", user.id, {"count": count})
    return runtime().json_response(ok=True, revoked=count)
