"""Owner-authorized Airbnb connection and listing mappings, with no OAuth secrets exposed.

Provider contract: https://docs.channex.io/channel-api-examples/airbnb
"""

import re
from urllib.parse import quote, urlsplit

from itsdangerous import BadSignature, URLSafeTimedSerializer

from pms_api.admin.channex_channels_application import (
    channel_detail,
    channel_name,
    check_revision,
    groups_json,
    pending_result,
    verify_channel,
)
from pms_api.admin.channex_insights_application import provider_text
from pms_api.admin.channex_remote_application import (
    account_client,
    input_id,
    lock_linked_property,
    property_json,
    property_values,
    provider_error,
    query_values,
    rate_json,
    verify_property,
)
from pms_api.ports import runtime

from ..channels.client import ProviderError, remote_id
from ..channels.service import _relationship
from ..security import GLOBAL_ROLES, ApiError, audit

STATE_LIFETIME = 7200


def input_fields(required, optional=()):
    query_values(set())
    data = runtime().payload()
    if not set(required) <= data.keys() or data.keys() - {*required, *optional}:
        raise ApiError(422, "invalid_airbnb_payload", "Các trường kết nối Airbnb không hợp lệ.")
    return data


def state_signer():
    # The session hash stays server-side; the browser-readable CSRF token cannot sign OAuth state.
    return URLSafeTimedSerializer(
        runtime().state.auth_session.token_hash, salt="channex-airbnb-owner-v1"
    )


def return_origin(value):
    if (
        not isinstance(value, str)
        or value not in runtime().config["CORS_ORIGINS"]
        or value != runtime().request.headers.get("Origin")
        or (runtime().config["APP_ENV"] == "production" and not value.startswith("https://"))
    ):
        raise ApiError(
            422, "invalid_airbnb_origin", "Địa chỉ trở về phải là trang LOHA được cấp phép."
        )
    return value


def owner_url(value):
    if (
        not isinstance(value, str)
        or not 1 <= len(value) <= 8192
        or any(ord(char) <= 32 or ord(char) > 126 for char in value)
    ):
        raise ProviderError("provider_invalid_response")
    try:
        parsed = urlsplit(value)
        if (
            parsed.scheme != "https"
            or parsed.hostname
            not in {"www.airbnb.com", "airbnb.com", "app.channex.io", "staging.channex.io"}
            or parsed.username is not None
            or parsed.password is not None
            or parsed.port not in (None, 443)
            or parsed.fragment
        ):
            raise ValueError
    except ValueError:
        raise ProviderError("provider_invalid_response") from None
    return value


def airbnb_channel(client, channel_id, property_id, *, mutable=False, single_property=False):
    entity = verify_channel(
        client, channel_id, property_id, mutable=mutable, single_property=single_property
    )
    if entity["attributes"].get("channel") != "AirBNB":
        raise ApiError(422, "invalid_airbnb_channel", "Kết nối này không phải Airbnb.")
    return entity


def listing_id(value, *, provider=False):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value):
        if provider:
            raise ProviderError("provider_invalid_response")
        raise ApiError(422, "invalid_airbnb_listing", "Mã chỗ ở Airbnb không hợp lệ.")
    return value


def listings(client, channel_id):
    result = client._request("GET", f"/channels/{channel_id}/action/listings", timeout=45)
    try:
        rows = result["data"]["listing_id_dictionary"]["values"]
        if not isinstance(rows, list) or len(rows) > 1000:
            raise ValueError
        values = []
        for row in rows:
            occupancies = row["occupancies"]
            if (
                not isinstance(occupancies, list)
                or len(occupancies) > 100
                or any(type(value) is not int or not 1 <= value <= 100 for value in occupancies)
            ):
                raise ValueError
            values.append(
                {
                    "id": listing_id(row["id"], provider=True),
                    "name": provider_text(row["title"], 500, required=True),
                    "capacity": max(occupancies) if occupancies else None,
                }
            )
        if len({value["id"] for value in values}) != len(values):
            raise ValueError
        return values
    except KeyError, TypeError, ValueError:
        raise ProviderError("provider_invalid_response") from None


def handle_airbnb_connection_link(property_id):
    data = input_fields({"accountId", "name", "returnOrigin"}, {"groupId", "channelId"})
    try:
        environment, client = account_client(data["accountId"])
        prop = verify_property(client, property_id)
        return airbnb_connection_link(environment, client, prop, data)
    except ProviderError as error:
        provider_error(error)


def handle_airbnb_confirm():
    data = input_fields({"channelId", "token"})
    return confirm_airbnb(payload_data=data)


def handle_airbnb_listings(property_id, channel_id):
    args = query_values({"accountId"})
    try:
        _, client = account_client(args.get("accountId"))
        prop = verify_property(client, property_id)
        return airbnb_listings(client, prop, channel_id, single_property=True)
    except ProviderError as error:
        provider_error(error)


def handle_airbnb_mapping(property_id, channel_id, mapping_id=None):
    removing = runtime().request.method == "DELETE"
    data = input_fields(
        {"accountId", "revision", "confirm"}
        if removing
        else {"accountId", "revision", "listingId", "ratePlanId"}
    )
    try:
        environment, client = account_client(data["accountId"])
        prop = verify_property(client, property_id)
        return airbnb_mapping(environment, client, prop, data, channel_id, mapping_id)
    except ProviderError as error:
        provider_error(error, mutation=True)


def airbnb_connection_link(environment, client, prop, data, *, tenant_id=None):
    origin = return_origin(data["returnOrigin"])
    name = channel_name(data["name"])
    channel_id = input_id(data["channelId"]) if "channelId" in data else None
    try:
        property_id = remote_id(prop["id"])
        groups = {group["id"] for group in groups_json(prop)}
        if channel_id:
            channel = airbnb_channel(client, channel_id, property_id, mutable=True)
            group_id = remote_id(_relationship(channel, "group"))
            if "groupId" in data and input_id(data["groupId"]) != group_id:
                raise ApiError(422, "invalid_channex_group", "Nhóm không khớp kết nối Airbnb.")
        else:
            group_id = input_id(data.get("groupId"))
        if group_id not in groups:
            raise ApiError(422, "invalid_channex_group", "Nhóm không thuộc khách sạn đã chọn.")
        state = {
            "actor": runtime().state.user.id,
            "accountId": data["accountId"],
            "propertyId": property_id,
            "environment": environment,
            "groupId": group_id,
            "channelId": channel_id,
        }
        if tenant_id is not None:
            state["tenantId"] = tenant_id
        return_path = "/id/ota" if tenant_id else "/manager/channex"
        if tenant_id and runtime().state.user.global_role in GLOBAL_ROLES:
            return_path = f"/manager/tenants/{quote(tenant_id, safe='')}/ota"
        values = {
            "group_id": group_id,
            "properties": [property_id],
            "title": name,
            "redirect_uri": origin + return_path,
            "failure_redirect_uri": origin + return_path,
            "token": state_signer().dumps(state),
        }
        if channel_id:
            values["channel_id"] = channel_id
        from ..channels.onboarding import invalidate_linked_inventory

        invalidate_linked_inventory(environment, prop["id"])
        result = client._request(
            "POST", "/meta/airbnb/connection_link", body={"connection_link": values}
        )
        entity = result.get("data")
        if (
            not isinstance(entity, dict)
            or entity.get("type") != "connection_link"
            or not isinstance(entity.get("attributes"), dict)
        ):
            raise ProviderError("provider_invalid_response")
        return {"url": owner_url(entity["attributes"].get("url")), "expiresIn": STATE_LIFETIME}
    except ProviderError as error:
        provider_error(error)


def confirm_airbnb(payload_data, *, tenant_id=None, context=None):
    data = payload_data
    channel_id = input_id(data["channelId"])
    token = data["token"]
    if not isinstance(token, str) or not 1 <= len(token) <= 4096:
        raise ApiError(422, "invalid_airbnb_state", "Phiên liên kết Airbnb không hợp lệ.")
    try:
        state = state_signer().loads(token, max_age=STATE_LIFETIME)
        if (
            not isinstance(state, dict)
            or set(state)
            != (
                {"actor", "accountId", "propertyId", "environment", "groupId", "channelId"}
                | ({"tenantId"} if tenant_id is not None else set())
            )
            or state["actor"] != runtime().state.user.id
            or (tenant_id is not None and state.get("tenantId") != tenant_id)
            or (state["channelId"] is not None and state["channelId"] != channel_id)
        ):
            raise BadSignature("Invalid context")
    except BadSignature:
        raise ApiError(
            422,
            "invalid_airbnb_state",
            "Phiên liên kết Airbnb đã hết hạn hoặc không khớp phiên đăng nhập. Tạo liên kết mới.",
        ) from None
    if context is None:
        environment, client = account_client(state["accountId"])
        prop = None
    else:
        environment, client, prop = context
        if state["accountId"] != "hotel:" + tenant_id or state["propertyId"] != prop["id"]:
            raise ApiError(422, "invalid_airbnb_state", "Phiên liên kết không thuộc khách sạn này.")
    if environment != state["environment"]:
        raise ApiError(
            409,
            "airbnb_account_changed",
            "Nguồn Channex đã đổi môi trường. Tạo liên kết Airbnb mới.",
        )
    try:
        prop = prop or verify_property(client, state["propertyId"])
        channel = airbnb_channel(client, channel_id, state["propertyId"], mutable=True)
        if remote_id(_relationship(channel, "group")) != state["groupId"] or state[
            "groupId"
        ] not in {group["id"] for group in groups_json(prop)}:
            raise ProviderError("provider_invalid_response")
        return {
            "accountId": state["accountId"],
            "propertyId": state["propertyId"],
            "property": property_json(prop, environment),
            "channel": channel_detail(client, channel, state["propertyId"]),
        }
    except ProviderError as error:
        provider_error(error)


def airbnb_listings(client, prop, channel_id, *, single_property=False):
    property_id = remote_id(prop["id"])
    try:
        channel = airbnb_channel(client, channel_id, property_id, single_property=single_property)
        return {"listings": listings(client, remote_id(channel["id"]))}
    except ProviderError as error:
        provider_error(error)


def airbnb_mapping(environment, client, prop, data, channel_id, mapping_id=None):
    removing = runtime().request.method == "DELETE"
    if removing and data["confirm"] is not True:
        raise ApiError(
            422,
            "airbnb_confirmation_required",
            "Xác nhận gỡ liên kết chỗ ở Airbnb trước khi tiếp tục.",
        )
    mapping_id = input_id(mapping_id) if removing else None
    selected_listing = None if removing else listing_id(data["listingId"])
    rate_id = None if removing else input_id(data["ratePlanId"])
    try:
        prop = property_values(prop)
        property_id = prop["id"]
        lock_linked_property(environment, property_id)
        channel = airbnb_channel(client, channel_id, property_id, mutable=True)
        channel_id = remote_id(channel["id"])
        check_revision(client, channel, data["revision"])
        existing = channel["attributes"]["rate_plans"]
        if removing:
            if mapping_id not in {remote_id(row.get("id")) for row in existing}:
                raise ApiError(
                    404,
                    "airbnb_mapping_not_found",
                    "Không tìm thấy ghép nối Airbnb trong kết nối này.",
                )
        else:
            if channel["attributes"]["is_active"]:
                raise ApiError(
                    409,
                    "airbnb_mapping_active",
                    "Chỉ thêm ghép nối khi kết nối Airbnb đang tắt đồng bộ.",
                )
            if selected_listing not in {row["id"] for row in listings(client, channel_id)}:
                raise ApiError(
                    422,
                    "airbnb_listing_not_found",
                    "Chỗ ở không thuộc tài khoản Airbnb đã liên kết.",
                )
            if any(
                row.get("settings", {}).get("listing_id") == selected_listing
                or remote_id(row.get("rate_plan_id")) == rate_id
                for row in existing
            ):
                raise ApiError(
                    409,
                    "airbnb_mapping_exists",
                    "Chỗ ở hoặc gói giá này đã được ghép nối. Tải lại kết nối để kiểm tra.",
                )
            rate = client.catalog_entity("rate_plans", rate_id)
            room = client.catalog_entity("room_types", remote_id(_relationship(rate, "room_type")))
            if rate_json(rate, room, property_id, prop["currency"])["id"] != rate_id:
                raise ProviderError("provider_invalid_response")
        # External edits can happen while Airbnb listings load; reject a changed connection before writing.
        from ..channels.onboarding import invalidate_linked_inventory

        invalidate_linked_inventory(environment, property_id)
        channel = airbnb_channel(client, channel_id, property_id, mutable=True)
        check_revision(client, channel, data["revision"])
        # shortcut: provider mappings have no idempotency key; reload after uncertain results before retrying.
        result = client._request(
            "DELETE" if removing else "POST",
            f"/channels/{channel_id}/mappings" + (f"/{mapping_id}" if removing else ""),
            body=None
            if removing
            else {
                "mapping": {
                    "rate_plan_id": rate_id,
                    "settings": {"listing_id": selected_listing},
                }
            },
            allow_async=True,
            allow_empty=removing,
            timeout=45,
        )
        pending = pending_result(result)
        if not pending and not removing:
            entity = result.get("data")
            if (
                not isinstance(entity, dict)
                or entity.get("type") != "channel_rate_plan"
                or not isinstance(entity.get("attributes"), dict)
                or not isinstance(entity["attributes"].get("settings"), dict)
                or remote_id(_relationship(entity, "channel")) != channel_id
                or entity["attributes"].get("settings", {}).get("listing_id") != selected_listing
            ):
                raise ProviderError("provider_invalid_response")
            mapping_id = remote_id(entity.get("id"))
        elif (
            not pending and removing and not isinstance(result.get("meta", {}).get("message"), str)
        ):
            raise ProviderError("provider_invalid_response")
        audit(
            "channex.airbnb.mapping.removed" if removing else "channex.airbnb.mapping.created",
            "channex_channel",
            channel_id,
            {
                "propertyId": property_id,
                "environment": environment,
                "mappingId": mapping_id,
                "status": "pending" if pending else "completed",
            },
        )
        channel = airbnb_channel(client, channel_id, property_id, mutable=True)
        return {
            "channel": channel_detail(client, channel, property_id),
            "status": "pending" if pending else "completed",
        }
    except ProviderError as error:
        provider_error(error, mutation=True)
