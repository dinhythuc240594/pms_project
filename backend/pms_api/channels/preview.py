"""HTTP entry points; business behavior is implemented in the application layer."""

from common import CommonMethodView

from . import preview_application as application
from .access import require_channel_access


class AriPreviewView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.view")
    def dispatch_request(tenant_id):
        return application.handle_ari_preview(tenant_id)


def __getattr__(name):
    return getattr(application, name)
