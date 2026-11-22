"""HTTP entry points; business behavior is implemented in the application layer."""

from common import CommonMethodView

from ..security import require_tenant
from . import application as application


class PreviewView(CommonMethodView):
    @staticmethod
    @require_tenant("reconciliation.view")
    def dispatch_request(tenant_id):
        return application.handle_preview(tenant_id)


class ConfirmView(CommonMethodView):
    @staticmethod
    @require_tenant("reconciliation.confirm")
    def dispatch_request(tenant_id):
        return application.handle_confirm(tenant_id)


class HistoryView(CommonMethodView):
    @staticmethod
    @require_tenant("reconciliation.view")
    def dispatch_request(tenant_id):
        return application.handle_history(tenant_id)


def __getattr__(name):
    return getattr(application, name)
