"""HTTP entry points; business behavior is implemented in the application layer."""

from common import CommonMethodView

from ..security import require_tenant
from . import exceptions_application as application
from .access import require_channel_access


class IncidentsView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.view")
    def dispatch_request(tenant_id):
        return application.handle_incidents(tenant_id)


class IncidentActionView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.write")
    def dispatch_request(tenant_id, incident_id):
        return application.handle_incident_action(tenant_id, incident_id)


class ResolveBookingReviewView(CommonMethodView):
    @staticmethod
    @require_tenant("channels.write")
    def dispatch_request(tenant_id, review_id):
        return application.handle_resolve_booking_review(tenant_id, review_id)


def __getattr__(name):
    return getattr(application, name)
