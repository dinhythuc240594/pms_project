"""HTTP entry points; business behavior is implemented in the application layer."""

from common import CommonMethodView

from ..security import require_system
from . import channex_insights_application as application


class RemoteChannelsView(CommonMethodView):
    @staticmethod
    @require_system()
    def dispatch_request(property_id):
        return application.handle_remote_channels(property_id)


class RemoteBookingsView(CommonMethodView):
    @staticmethod
    @require_system()
    def dispatch_request(property_id):
        return application.handle_remote_bookings(property_id)


class RemoteInventoryView(CommonMethodView):
    @staticmethod
    @require_system()
    def dispatch_request(property_id):
        return application.handle_remote_inventory(property_id)


def __getattr__(name):
    return getattr(application, name)
