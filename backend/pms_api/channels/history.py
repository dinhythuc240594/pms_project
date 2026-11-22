"""HTTP entry points; business behavior is implemented in the application layer."""

from common import CommonMethodView

from . import history_application as application
from .access import require_channel_access


class JobsView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.view")
    def dispatch_request(tenant_id):
        return application.handle_jobs(tenant_id)


class JobDetailView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.view")
    def dispatch_request(tenant_id, job_id):
        return application.handle_job_detail(tenant_id, job_id)


def __getattr__(name):
    return getattr(application, name)
