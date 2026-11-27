"""Hotel-owned OTA channels use the hotel's stored Channex connection only."""

from flask import request

from common import CommonMethodView

from ..admin.channex_airbnb import (
    airbnb_connection_link,
    airbnb_listings,
    airbnb_mapping,
    confirm_airbnb,
    input_fields,
)
from ..admin.channex_channels import (
    channel_action,
    channel_adapters,
    channel_detail_response,
    invalid,
    mutation_data,
    probe_channel,
    save_channel,
)
from ..admin.channex_insights import remote_channels
from ..admin.channex_remote import page_number, provider_error, query_values, verify_property
from ..security import ApiError
from .access import require_channel_access
from .client import ChannexClient, ProviderError
from .credentials import load_credentials, valid_secret
from .routes import connection


def hotel_context(tenant_id):
    row = connection(tenant_id)
    if row is None:
        raise ApiError(409, "channel_unconfigured", "Khách sạn chưa cấu hình Channex.")
    try:
        key = load_credentials(row).get("apiKey")
        if not valid_secret(key):
            raise ProviderError("credentials_unavailable")
        client = ChannexClient(row.environment, key)
        return row.environment, client, verify_property(client, row.property_id)
    except ProviderError as error:
        provider_error(error)


class RemoteChannelsView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.view")
    def dispatch_request(tenant_id):
        args = query_values({"page"})
        page = page_number(args.get("page", "1"))
        _, client, prop = hotel_context(tenant_id)
        try:
            return remote_channels(client, prop["id"], page, single_property=True)
        except ProviderError as error:
            provider_error(error)


class RemoteAdaptersView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.view")
    def dispatch_request(tenant_id, code=None):
        query_values(set())
        _, client, prop = hotel_context(tenant_id)
        return channel_adapters(client, prop, code)


class RemoteChannelDetailView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.view")
    def dispatch_request(tenant_id, channel_id):
        query_values(set())
        _, client, prop = hotel_context(tenant_id)
        return channel_detail_response(client, prop, channel_id, single_property=True)


class RemoteProbeView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.write")
    def dispatch_request(tenant_id, action):
        if action not in {"test_connection", "mapping_details", "connection_details"}:
            invalid()
        data = mutation_data({"code", "settings", "channelId", "revision"}, {"code", "settings"})
        _, client, prop = hotel_context(tenant_id)
        return probe_channel(client, prop, data, action)


class SaveRemoteChannelView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.write")
    def dispatch_request(tenant_id, channel_id=None):
        required = (
            {"revision"} if channel_id else {"code", "name", "groupId", "settings", "mappings"}
        )
        allowed = {"revision", "name", "settings", "mappings"} if channel_id else required
        data = mutation_data(allowed, required)
        environment, client, prop = hotel_context(tenant_id)
        return save_channel(environment, client, prop, data, channel_id)


class RemoteChannelActionView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.write")
    def dispatch_request(tenant_id, channel_id, action=None):
        deleting = request.method == "DELETE"
        if not deleting and action not in {"readiness", "activate", "deactivate", "load_bookings"}:
            invalid()
        data = mutation_data({"revision", "confirm"}, {"revision"})
        if (deleting or action != "readiness") and data.get("confirm") is not True:
            raise ApiError(
                422,
                "channel_confirmation_required",
                "Xác nhận tác động trước khi thay đổi kết nối OTA.",
            )
        environment, client, prop = hotel_context(tenant_id)
        return channel_action(environment, client, prop, data, channel_id, action)


class RemoteAirbnbLinkView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.write")
    def dispatch_request(tenant_id):
        data = input_fields({"name", "returnOrigin"}, {"groupId", "channelId"})
        environment, client, prop = hotel_context(tenant_id)
        return airbnb_connection_link(
            environment,
            client,
            prop,
            {**data, "accountId": "hotel:" + tenant_id},
            tenant_id=tenant_id,
        )


class RemoteAirbnbConfirmView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.write")
    def dispatch_request(tenant_id):
        data = input_fields({"channelId", "token"})
        result = confirm_airbnb(data, tenant_id=tenant_id, context=hotel_context(tenant_id))
        return {"channel": result["channel"]}


class RemoteAirbnbListingsView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.view")
    def dispatch_request(tenant_id, channel_id):
        query_values(set())
        _, client, prop = hotel_context(tenant_id)
        return airbnb_listings(client, prop, channel_id, single_property=True)


class RemoteAirbnbMappingView(CommonMethodView):
    @staticmethod
    @require_channel_access("channels.write")
    def dispatch_request(tenant_id, channel_id, mapping_id=None):
        data = input_fields(
            {"revision", "confirm"}
            if request.method == "DELETE"
            else {"revision", "listingId", "ratePlanId"}
        )
        environment, client, prop = hotel_context(tenant_id)
        return airbnb_mapping(environment, client, prop, data, channel_id, mapping_id)
