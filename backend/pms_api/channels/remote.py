"""HTTP entry points; business behavior is implemented in the application layer."""

from common import CommonMethodView

from . import remote_application as application
from .access import require_channel_access


class RemoteChannelsView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.view")
    def dispatch_request(tenant_id):
        return application.handle_remote_channels(tenant_id)


class RemoteAdaptersView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.view")
    def dispatch_request(tenant_id, code=None):
        return application.handle_remote_adapters(tenant_id, code)


class RemoteChannelDetailView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.view")
    def dispatch_request(tenant_id, channel_id):
        return application.handle_remote_channel_detail(tenant_id, channel_id)


class RemoteProbeView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.write")
    def dispatch_request(tenant_id, action):
        return application.handle_remote_probe(tenant_id, action)


class SaveRemoteChannelView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.write")
    def dispatch_request(tenant_id, channel_id=None):
        return application.handle_save_remote_channel(tenant_id, channel_id)


class RemoteChannelActionView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.write")
    def dispatch_request(tenant_id, channel_id, action=None):
        return application.handle_remote_channel_action(tenant_id, channel_id, action)


class RemoteAirbnbLinkView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.write")
    def dispatch_request(tenant_id):
        return application.handle_remote_airbnb_link(tenant_id)


class RemoteAirbnbConfirmView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.write")
    def dispatch_request(tenant_id):
        return application.handle_remote_airbnb_confirm(tenant_id)


class RemoteAirbnbListingsView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.view")
    def dispatch_request(tenant_id, channel_id):
        return application.handle_remote_airbnb_listings(tenant_id, channel_id)


class RemoteAirbnbMappingView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.write")
    def dispatch_request(tenant_id, channel_id, mapping_id=None):
        return application.handle_remote_airbnb_mapping(tenant_id, channel_id, mapping_id)


def __getattr__(name):
    return getattr(application, name)
