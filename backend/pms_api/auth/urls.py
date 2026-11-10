"""Routing metadata; handlers load only when their route is dispatched."""

from flask import Blueprint

from common import CommonURL


class URL(CommonURL):
    LOGIN = "/login"
    CURRENT_SESSION = "/session"
    LOGOUT = "/logout"
    CHANGE_PASSWORD = "/change-password"
    UPDATE_PROFILE = "/profile"
    OWN_SESSIONS = "/sessions"
    REVOKE_OTHER_SESSIONS = "/sessions/revoke-others"


auth = Blueprint("auth", __name__, url_prefix="/api/auth")

URL.register(auth, URL.LOGIN, "pms_api.auth.routes:LoginView", endpoint="login", methods=["POST"])

URL.register(
    auth,
    URL.CURRENT_SESSION,
    "pms_api.auth.routes:CurrentSessionView",
    endpoint="current_session",
    methods=["GET"],
)

URL.register(
    auth, URL.LOGOUT, "pms_api.auth.routes:LogoutView", endpoint="logout", methods=["POST"]
)

URL.register(
    auth,
    URL.CHANGE_PASSWORD,
    "pms_api.auth.routes:ChangePasswordView",
    endpoint="change_password",
    methods=["POST"],
)

URL.register(
    auth,
    URL.UPDATE_PROFILE,
    "pms_api.auth.routes:UpdateProfileView",
    endpoint="update_profile",
    methods=["PATCH"],
)

URL.register(
    auth,
    URL.OWN_SESSIONS,
    "pms_api.auth.routes:OwnSessionsView",
    endpoint="own_sessions",
    methods=["GET"],
)

URL.register(
    auth,
    URL.REVOKE_OTHER_SESSIONS,
    "pms_api.auth.routes:RevokeOtherSessionsView",
    endpoint="revoke_other_sessions",
    methods=["POST"],
)
