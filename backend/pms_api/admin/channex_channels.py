"""HTTP entry points; business behavior is implemented in the application layer."""

from common import CommonMethodView

from ..security import require_system
from . import channex_channels_application as application


class ChannelAdaptersView(CommonMethodView):
    @staticmethod
    @require_system()
    def dispatch_request(property_id, code=None):
        return application.handle_channel_adapters(property_id, code)


class ChannelDetailView(CommonMethodView):
    @staticmethod
    @require_system()
    def dispatch_request(property_id, channel_id):
        return application.handle_channel_detail(property_id, channel_id)


class ChannelProbeView(CommonMethodView):
    @staticmethod
    @require_system()
    def dispatch_request(property_id, action):
        return application.handle_channel_probe(property_id, action)


class SaveChannelView(CommonMethodView):
    @staticmethod
    @require_system()
    def dispatch_request(property_id, channel_id=None):
        return application.handle_save_channel(property_id, channel_id)


class ChannelActionView(CommonMethodView):
    @staticmethod
    @require_system()
    def dispatch_request(property_id, channel_id, action=None):
        return application.handle_channel_action(property_id, channel_id, action)


def __getattr__(name):
    return getattr(application, name)
