"""HTTP entry points; business behavior is implemented in the application layer."""

from common import CommonMethodView

from . import application as application


class LoginView(CommonMethodView):
    @staticmethod
    def dispatch_request():
        return application.handle_login()


class CurrentSessionView(CommonMethodView):
    @staticmethod
    def dispatch_request():
        return application.handle_current_session()


class LogoutView(CommonMethodView):
    @staticmethod
    def dispatch_request():
        return application.handle_logout()


class ChangePasswordView(CommonMethodView):
    @staticmethod
    def dispatch_request():
        return application.handle_change_password()


class UpdateProfileView(CommonMethodView):
    @staticmethod
    def dispatch_request():
        return application.handle_update_profile()


class OwnSessionsView(CommonMethodView):
    @staticmethod
    def dispatch_request():
        return application.handle_own_sessions()


class RevokeOtherSessionsView(CommonMethodView):
    @staticmethod
    def dispatch_request():
        return application.handle_revoke_other_sessions()


def __getattr__(name):
    if name in {"URL", "auth"}:
        from importlib import import_module

        return getattr(import_module(".urls", __package__), name)
    return getattr(application, name)
