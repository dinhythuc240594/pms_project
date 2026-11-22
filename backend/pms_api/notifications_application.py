"""Transactional in-app notifications; configuration selects recipient hotel roles."""

from datetime import UTC, datetime

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError

from pms_api.ports import runtime

from .core_models import TenantUser, User, uid, utcnow
from .extensions import db
from .notification_models import Notification, NotificationSetting
from .security import ROLES, ApiError, audit

PREFIX = "/api/tenants/<tenant_id>/notifications"
EVENTS = {
    "NEW_BOOKING": ("HIGH", ["HOTEL_OWNER", "FRONT_DESK"]),
    "BOOKING_MODIFIED": ("MEDIUM", ["HOTEL_OWNER", "FRONT_DESK"]),
    "BOOKING_CANCELLED": ("HIGH", ["HOTEL_OWNER", "FRONT_DESK"]),
    "CHECKIN_DONE": ("LOW", ["HOTEL_OWNER", "FRONT_DESK"]),
    "CHECKOUT_DONE": ("LOW", ["HOTEL_OWNER", "FRONT_DESK"]),
    "ROOM_CLEANED": ("MEDIUM", ["FRONT_DESK", "HOUSEKEEPING"]),
    "ROOM_MAINTENANCE": ("HIGH", ["HOTEL_OWNER", "FRONT_DESK", "HOUSEKEEPING"]),
    "PAYMENT_RECEIVED": ("MEDIUM", ["HOTEL_OWNER", "FRONT_DESK", "ACCOUNTANT"]),
    "OTA_SYNC_ERROR": ("HIGH", ["HOTEL_OWNER", "FRONT_DESK"]),
}
AUDIT_EVENTS = {
    "reservation.created": "NEW_BOOKING",
    "reservation.updated": "BOOKING_MODIFIED",
    "reservation.payment": "PAYMENT_RECEIVED",
    "pos.payment": "PAYMENT_RECEIVED",
    "room.clean": "ROOM_CLEANED",
    "room.maintenance": "ROOM_MAINTENANCE",
    "channel.sync_error": "OTA_SYNC_ERROR",
}


def event_code(entry):
    if entry.event == "channel.sync_error" and entry.details.get("status") == "queued":
        return None
    if entry.event.startswith("room.") and entry.details.get("from") == entry.details.get(
        "condition"
    ):
        return None
    if entry.event == "reservation.status":
        return {
            "CANCELLED": "BOOKING_CANCELLED",
            "IN_HOUSE": "CHECKIN_DONE",
            "CHECKED_OUT": "CHECKOUT_DONE",
        }.get(entry.details.get("to"))
    return AUDIT_EVENTS.get(entry.event)


def emit_audit(entry):
    code = event_code(entry)
    if not code or not entry.tenant_id:
        return
    _, defaults = EVENTS[code]
    title_key = f"i18n:notifications.events.{code}"
    setting = db.session.scalar(
        select(NotificationSetting).where(
            NotificationSetting.tenant_id == entry.tenant_id,
            NotificationSetting.event_code == code,
        )
    )
    roles = setting.roles if setting else defaults
    # Recipient SELECT policies also apply to ON CONFLICT: plain INSERT keeps inboxes private.
    recipients = db.session.scalars(
        select(TenantUser.user_id)
        .join(User, User.id == TenantUser.user_id)
        .where(
            TenantUser.tenant_id == entry.tenant_id,
            TenantUser.active.is_(True),
            TenantUser.role.in_(roles),
            User.active.is_(True),
        )
    ).all()
    for user_id in recipients:
        try:
            with db.session.begin_nested():
                db.session.execute(
                    insert(Notification).values(
                        {
                            "id": uid(),
                            "tenant_id": entry.tenant_id,
                            "source_id": entry.id,
                            "recipient_user_id": user_id,
                            "event_code": code,
                            "title": title_key,
                            "body": f"i18n:notifications.eventBodies.{code}",
                            "entity_type": entry.entity_type,
                            "entity_id": entry.entity_id,
                            "created_at": utcnow(),
                        }
                    )
                )
        except IntegrityError as error:
            if (
                error.orig.sqlstate != "23505"
                or error.orig.diag.constraint_name
                != "uq_notifications_tenant_id_source_id_recipient_user_id"
            ):
                raise


def notification_json(row):
    title_key = f"i18n:notifications.events.{row.event_code}"
    return {
        "id": row.id,
        "eventCode": row.event_code,
        "title": title_key,
        "body": {
            "$i18n": f"notifications.eventBodies.{row.event_code}",
            "values": {"entityId": row.entity_id},
        },
        "entityType": row.entity_type,
        "entityId": row.entity_id,
        "createdAt": row.created_at.astimezone(UTC).isoformat(),
        "readAt": row.read_at.astimezone(UTC).isoformat() if row.read_at else None,
    }


def own_inbox(tenant_id):
    return (
        Notification.tenant_id == tenant_id,
        Notification.recipient_user_id == runtime().state.user.id,
    )


def handle_inbox(tenant_id):
    limit = runtime().request.args.get("limit", "50")
    unread = runtime().request.args.get("unread", "false")
    if (
        len(limit) > 3
        or not limit.isascii()
        or not limit.isdigit()
        or not 1 <= int(limit) <= 100
        or unread not in {"true", "false"}
    ):
        raise ApiError(422, "invalid_query", "Bộ lọc thông báo không hợp lệ.")
    statement = select(Notification).where(*own_inbox(tenant_id))
    if unread == "true":
        statement = statement.where(Notification.read_at.is_(None))
    before = runtime().request.args.get("before")
    if before:
        try:
            if len(before) > 100:
                raise ValueError
            stamp, row_id = before.rsplit("~", 1)
            stamp = datetime.fromisoformat(stamp)
            if stamp.tzinfo is None or not row_id or len(row_id) > 40:
                raise ValueError
        except ValueError, TypeError:
            raise ApiError(422, "invalid_query", "Mốc trang thông báo không hợp lệ.") from None
        statement = statement.where(
            or_(
                Notification.created_at < stamp,
                and_(Notification.created_at == stamp, Notification.id < row_id),
            )
        )
    rows = db.session.scalars(
        statement.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(
            int(limit) + 1
        )
    ).all()
    more = len(rows) > int(limit)
    rows = rows[: int(limit)]
    unread_count = db.session.scalar(
        select(func.count())
        .select_from(Notification)
        .where(*own_inbox(tenant_id), Notification.read_at.is_(None))
    )
    return {
        "items": [notification_json(row) for row in rows],
        "unreadCount": unread_count,
        "nextBefore": f"{rows[-1].created_at.isoformat()}~{rows[-1].id}" if more else None,
    }


def handle_read_notification(tenant_id, notification_id):
    row = db.session.scalar(
        select(Notification)
        .where(*own_inbox(tenant_id), Notification.id == notification_id)
        .with_for_update()
    )
    if row is None:
        raise ApiError(404, "not_found", "Không tìm thấy thông báo.")
    row.read_at = row.read_at or utcnow()
    return notification_json(row)


def handle_read_all(tenant_id):
    result = db.session.execute(
        update(Notification)
        .where(*own_inbox(tenant_id), Notification.read_at.is_(None))
        .values(read_at=utcnow())
    )
    return {"updated": result.rowcount}


def preferences_json(tenant_id):
    configured = {
        row.event_code: row.roles
        for row in db.session.scalars(
            select(NotificationSetting).where(NotificationSetting.tenant_id == tenant_id)
        )
    }
    return {
        "availableRoles": sorted(ROLES),
        "events": [
            {
                "code": code,
                "name": f"i18n:notifications.events.{code}",
                "priority": priority,
                "roles": configured.get(code, roles),
                "inApp": True,
                "channels": ["in_app"],
            }
            for code, (priority, roles) in EVENTS.items()
        ],
    }


def handle_get_preferences(tenant_id):
    return preferences_json(tenant_id)


def handle_set_preferences(tenant_id):
    data = runtime().payload()
    events = data.get("events")
    if (
        set(data) != {"events"}
        or not isinstance(events, list)
        or not 1 <= len(events) <= len(EVENTS)
    ):
        raise ApiError(422, "invalid_preferences", "Cấu hình cần danh sách sự kiện thông báo.")
    seen = set()
    for event in events:
        if not isinstance(event, dict) or set(event) != {"code", "roles"}:
            raise ApiError(422, "invalid_preferences", "Cấu hình sự kiện không hợp lệ.")
        code, roles = event["code"], event["roles"]
        if (
            not isinstance(code, str)
            or code not in EVENTS
            or code in seen
            or not isinstance(roles, list)
            or len(roles) > len(ROLES)
            or any(not isinstance(role, str) or role not in ROLES for role in roles)
            or len(set(roles)) != len(roles)
        ):
            raise ApiError(
                422, "invalid_preferences", "Sự kiện hoặc vai trò nhận thông báo không hợp lệ."
            )
        seen.add(code)
        statement = insert(NotificationSetting).values(
            id=uid(), tenant_id=tenant_id, event_code=code, roles=roles
        )
        db.session.execute(
            statement.on_conflict_do_update(
                index_elements=["tenant_id", "event_code"], set_={"roles": roles}
            )
        )
    audit("notifications.preferences", "tenant", tenant_id, {"events": sorted(seen)})
    return preferences_json(tenant_id)
