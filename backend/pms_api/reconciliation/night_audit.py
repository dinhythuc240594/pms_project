"""HTTP entry points; business behavior is implemented in the application layer."""

from common import CommonMethodView

from ..security import require_tenant
from . import night_audit_application as application


class NightAuditPreviewView(CommonMethodView):
    @staticmethod
    @require_tenant("reconciliation.view")
    def dispatch_request(tenant_id):
        return application.handle_night_audit_preview(tenant_id)


class CloseNightAuditView(CommonMethodView):
    @staticmethod
    @require_tenant("reconciliation.confirm")
    def dispatch_request(tenant_id):
        return application.handle_close_night_audit(tenant_id)


def __getattr__(name):
    return getattr(application, name)
