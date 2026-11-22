"""Hotel-owned OTA channels use the hotel's stored Channex connection only."""

from pms_api.admin.channex_airbnb_application import (
    airbnb_connection_link,
    airbnb_listings,
    airbnb_mapping,
    confirm_airbnb,
    input_fields,
)
from pms_api.admin.channex_channels_application import (
    channel_action,
    channel_adapters,
    channel_detail_response,
    invalid,
    mutation_data,
    probe_channel,
    save_channel,
)
from pms_api.admin.channex_insights_application import remote_channels
from pms_api.admin.channex_remote_application import (
    page_number,
    provider_error,
    query_values,
    verify_property,
)
from pms_api.channels.application import connection
from pms_api.composition import channel_adapter
from pms_api.ports import runtime

from ..security import ApiError
from .client import ProviderError
from .credentials import load_credentials, valid_secret


def hotel_context(tenant_id):
    row = connection(tenant_id)
    if row is None:
        raise ApiError(409, "channel_unconfigured", "Khách sạn chưa cấu hình Channex.")
    try:
        key = load_credentials(row).get("apiKey")
        if not valid_secret(key):
            raise ProviderError("credentials_unavailable")
        client = channel_adapter(row.environment, key)
        return row.environment, client, verify_property(client, row.property_id)
    except ProviderError as error:
        provider_error(error)


def handle_remote_channels(tenant_id):
    args = query_values({"page"})
    page = page_number(args.get("page", "1"))
    _, client, prop = hotel_context(tenant_id)
    try:
        return remote_channels(client, prop["id"], page, single_property=True)
    except ProviderError as error:
        provider_error(error)


def handle_remote_adapters(tenant_id, code=None):
    query_values(set())
    _, client, prop = hotel_context(tenant_id)
    return channel_adapters(client, prop, code)


def handle_remote_channel_detail(tenant_id, channel_id):
    query_values(set())
    _, client, prop = hotel_context(tenant_id)
    return channel_detail_response(client, prop, channel_id, single_property=True)


def handle_remote_probe(tenant_id, action):
    if action not in {"test_connection", "mapping_details", "connection_details"}:
        invalid()
    data = mutation_data({"code", "settings", "channelId", "revision"}, {"code", "settings"})
    _, client, prop = hotel_context(tenant_id)
    return probe_channel(client, prop, data, action)


def handle_save_remote_channel(tenant_id, channel_id=None):
    required = {"revision"} if channel_id else {"code", "name", "groupId", "settings", "mappings"}
    allowed = {"revision", "name", "settings", "mappings"} if channel_id else required
    data = mutation_data(allowed, required)
    environment, client, prop = hotel_context(tenant_id)
    return save_channel(environment, client, prop, data, channel_id)


def handle_remote_channel_action(tenant_id, channel_id, action=None):
    deleting = runtime().request.method == "DELETE"
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


def handle_remote_airbnb_link(tenant_id):
    data = input_fields({"name", "returnOrigin"}, {"groupId", "channelId"})
    environment, client, prop = hotel_context(tenant_id)
    return airbnb_connection_link(
        environment,
        client,
        prop,
        {**data, "accountId": "hotel:" + tenant_id},
        tenant_id=tenant_id,
    )


def handle_remote_airbnb_confirm(tenant_id):
    data = input_fields({"channelId", "token"})
    result = confirm_airbnb(data, tenant_id=tenant_id, context=hotel_context(tenant_id))
    return {"channel": result["channel"]}


def handle_remote_airbnb_listings(tenant_id, channel_id):
    query_values(set())
    _, client, prop = hotel_context(tenant_id)
    return airbnb_listings(client, prop, channel_id, single_property=True)


def handle_remote_airbnb_mapping(tenant_id, channel_id, mapping_id=None):
    data = input_fields(
        {"revision", "confirm"}
        if runtime().request.method == "DELETE"
        else {"revision", "listingId", "ratePlanId"}
    )
    environment, client, prop = hotel_context(tenant_id)
    return airbnb_mapping(environment, client, prop, data, channel_id, mapping_id)
