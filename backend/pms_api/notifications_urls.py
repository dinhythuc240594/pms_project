"""Routing metadata; handlers load only when their route is dispatched."""

from flask import Blueprint

from common import CommonURL


class URL(CommonURL):
    INBOX = "/api/tenants/<tenant_id>/notifications"
    READ_NOTIFICATION = "/api/tenants/<tenant_id>/notifications/<notification_id>/read"
    READ_ALL = "/api/tenants/<tenant_id>/notifications/read-all"
    GET_PREFERENCES = "/api/tenants/<tenant_id>/notifications/preferences"
    SET_PREFERENCES = "/api/tenants/<tenant_id>/notifications/preferences"


notifications = Blueprint("notifications", __name__)

URL.register(
    notifications, URL.INBOX, "pms_api.notifications:InboxView", endpoint="inbox", methods=["GET"]
)

URL.register(
    notifications,
    URL.READ_NOTIFICATION,
    "pms_api.notifications:ReadNotificationView",
    endpoint="read_notification",
    methods=["POST"],
)

URL.register(
    notifications,
    URL.READ_ALL,
    "pms_api.notifications:ReadAllView",
    endpoint="read_all",
    methods=["POST"],
)

URL.register(
    notifications,
    URL.GET_PREFERENCES,
    "pms_api.notifications:GetPreferencesView",
    endpoint="get_preferences",
    methods=["GET"],
)

URL.register(
    notifications,
    URL.SET_PREFERENCES,
    "pms_api.notifications:SetPreferencesView",
    endpoint="set_preferences",
    methods=["PATCH"],
)
