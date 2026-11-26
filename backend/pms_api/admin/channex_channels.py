"""Native OTA setup; adapter fields are allowlisted and provider secrets stay private.

Contract: https://docs.channex.io/api-v.1-documentation/channel-api
"""

import hashlib
import hmac
import json
import math
import re
from copy import deepcopy

from flask import current_app, request
from sqlalchemy import text

from common import CommonMethodView

from ..channels.client import BASES, ProviderError, remote_id
from ..channels.onboarding import invalidate_linked_inventory
from ..channels.service import catalog_values
from ..extensions import db
from ..security import ApiError, audit, payload, require_system
from .channex_insights import channel_json, provider_text
from .channex_remote import (
    account_client,
    input_id,
    lock_linked_property,
    provider_error,
    query_values,
    verify_property,
)

FIELD_TYPES = {
    "string",
    "slug",
    "password",
    "boolean",
    "integer",
    "number",
    "select",
    "switch",
    "hidden",
}
NAME = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}\Z")
SECRET = re.compile(r"password|token|secret|credential|api.?key|machine_account", re.I)


def invalid():
    raise ApiError(422, "invalid_channel_input", "Thông tin kênh OTA không hợp lệ.")


def adapter_code(value, *, provider=False):
    if not isinstance(value, str) or not NAME.fullmatch(value):
        if provider:
            raise ProviderError("provider_invalid_response")
        invalid()
    return value


def fields_json(raw):
    if raw is None:
        return []
    if not isinstance(raw, dict) or len(raw) > 60:
        raise ProviderError("provider_invalid_response")
    fields = []
    for key, field in raw.items():
        adapter_code(key, provider=True)
        if (
            not isinstance(field, dict)
            or not isinstance(field.get("type"), str)
            or field.get("type") not in FIELD_TYPES
            or type(field.get("position")) is not int
            or not 0 <= field["position"] <= 1000
        ):
            raise ProviderError("provider_invalid_response")
        if field["type"] == "hidden":
            continue
        secret = field["type"] == "password" or bool(SECRET.search(key))
        value = {
            "key": key,
            "label": provider_text(field.get("title", key), 160, required=True),
            "type": "password" if secret else field["type"],
            "position": field["position"],
            "secret": secret,
            "options": [],
            "rules": [],
        }
        options = field.get("options", [])
        rules = field.get("rules", [])
        if (
            not isinstance(options, list)
            or len(options) > 100
            or not isinstance(rules, list)
            or len(rules) > 20
        ):
            raise ProviderError("provider_invalid_response")
        value["options"] = [provider_text(option, 200, required=True) for option in options]
        for rule in rules:
            if (
                not isinstance(rule, dict)
                or rule.get("apply") != "hidden"
                or not isinstance(rule.get("when"), (str, bool))
                or not isinstance(rule.get("with_value"), str)
                or len(rule["with_value"]) > 2000
                or not isinstance(rule.get("influence_field"), str)
                or rule.get("influence_field") not in raw
            ):
                raise ProviderError("provider_invalid_response")
            value["rules"].append(
                {
                    "apply": "hidden",
                    "when": rule["when"],
                    "influenceField": rule["influence_field"],
                    "withValue": "" if secret else rule["with_value"],
                }
            )
        if not secret and "default" in field:
            default = field["default"]
            if not isinstance(default, (str, bool, int)) or (
                isinstance(default, str) and len(default) > 2000
            ):
                raise ProviderError("provider_invalid_response")
            value["default"] = default
        fields.append(value)
    return sorted(fields, key=lambda value: (value["position"], value["key"]))


def adapter_json(raw):
    if (
        not isinstance(raw, dict)
        or raw.get("kind") not in ("ota", "meta", "cm")
        or raw.get("property_mapping") not in (None, "single", "multiple")
        or raw.get("mapping_mode")
        not in (None, "direct", "listing", "tree", "room_rate_multioccupancy")
    ):
        raise ProviderError("provider_invalid_response")
    code = adapter_code(raw.get("code"), provider=True)
    return {
        "code": code,
        "name": provider_text(raw.get("title"), 160, required=True),
        "kind": raw["kind"],
        "propertyMapping": raw.get("property_mapping"),
        "mappingMode": raw.get("mapping_mode"),
        "oauth": code.lower() == "airbnb",
        "fields": fields_json(raw.get("params")),
        "mappingFields": fields_json(raw.get("rate_params")),
    }


def get_adapter(client, code):
    code = adapter_code(code)
    result = client._request("GET", "/channels/adapter", query={"code": code})
    adapter = adapter_json(result.get("data"))
    if adapter["code"] != code:
        raise ProviderError("provider_invalid_response")
    return adapter


def groups_json(property_entity):
    try:
        groups = property_entity["relationships"]["groups"]["data"]
    except (KeyError, TypeError):
        return []
    if not isinstance(groups, list) or len(groups) > 100:
        raise ProviderError("provider_invalid_response")
    result, seen = [], set()
    for group in groups:
        if not isinstance(group, dict):
            raise ProviderError("provider_invalid_response")
        identifier = remote_id(group.get("id"))
        if identifier in seen:
            raise ProviderError("provider_invalid_response")
        seen.add(identifier)
        attrs = group.get("attributes", {})
        if not isinstance(attrs, dict):
            raise ProviderError("provider_invalid_response")
        result.append(
            {
                "id": identifier,
                "name": provider_text(attrs.get("title", identifier), 255, required=True),
            }
        )
    return result


def rate_options(client, prop):
    rooms = client.catalog("room_types", prop["id"])
    rates = client.catalog("rate_plans", prop["id"])
    catalog = catalog_values(rooms, rates, prop["id"], prop["attributes"]["currency"])
    index = {remote_id(entity["id"]): entity for entity in rates}
    result = []
    for rate in catalog["ratePlans"]:
        entity = index[rate["id"]]
        options = entity["attributes"].get("options", [])
        if not isinstance(options, list) or len(options) > 50:
            raise ProviderError("provider_invalid_response")
        occupancies = []
        for option in options:
            if (
                not isinstance(option, dict)
                or type(option.get("occupancy")) is not int
                or not 1 <= option["occupancy"] <= 50
            ):
                raise ProviderError("provider_invalid_response")
            occupancies.append(option["occupancy"])
        result.append(
            {
                "id": rate["id"],
                "name": rate["name"],
                "roomTypeId": rate["roomTypeId"],
                "occupancy": occupancies[0] if len(occupancies) == 1 else None,
            }
        )
    return result


def verify_channel(client, channel_id, property_id, *, mutable=False, single_property=False):
    identifier = input_id(channel_id)
    if mutable:
        if not isinstance(client.base, str) or client.base not in BASES.values():
            raise ProviderError("provider_invalid_response")
        # Serialize LOHA writers even when the remote property has no local tenant yet.
        db.session.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:channel_key, 0))"),
            {"channel_key": "channex:" + client.base + ":" + identifier},
        )
    entity = client._request("GET", f"/channels/{identifier}").get("data")
    value = channel_json(entity, property_id)
    if value["id"] != identifier:
        raise ProviderError("provider_invalid_response")
    attrs = entity["attributes"]
    if not isinstance(attrs.get("settings"), dict) or len(attrs["rate_plans"]) > 500:
        raise ProviderError("provider_invalid_response")
    mapping_ids = set()
    for mapping in attrs["rate_plans"]:
        mapping_id = remote_id(mapping.get("id"))
        if mapping_id in mapping_ids or not isinstance(mapping.get("settings"), dict):
            raise ProviderError("provider_invalid_response")
        mapping_ids.add(mapping_id)
    if (mutable or single_property) and value["propertyCount"] != 1:
        raise ApiError(
            409,
            "channel_multiple_properties",
            "Kênh dùng chung nhiều khách sạn chỉ được xem tại đây.",
        )
    return entity


def revision(client, entity):
    # Use the account key so a digest of low-entropy private settings cannot be guessed offline.
    attrs = entity["attributes"]
    values = {
        key: attrs.get(key)
        for key in ("title", "settings", "rate_plans", "properties", "is_active", "updated_at")
    }
    values["id"] = entity["id"]
    try:
        raw = json.dumps(values, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    except (ValueError, TypeError):
        raise ProviderError("provider_invalid_response") from None
    return hmac.new(client.api_key.encode(), raw, hashlib.sha256).hexdigest()


def check_revision(client, entity, value):
    if (
        not isinstance(value, str)
        or not re.fullmatch(r"[0-9a-f]{64}", value)
        or not hmac.compare_digest(value, revision(client, entity))
    ):
        raise ApiError(409, "channel_changed", "Kênh đã thay đổi. Tải lại trước khi tiếp tục.")


def public_settings(raw, fields):
    if not isinstance(raw, dict):
        raise ProviderError("provider_invalid_response")
    values, secrets = {}, []
    for field in fields:
        key = field["key"]
        if key not in raw:
            continue
        if field["secret"]:
            if raw[key] not in (None, ""):
                secrets.append(key)
            continue
        value = raw[key]
        # Provider room/rate codes may be numbers even when their descriptor uses string controls.
        if (
            not isinstance(value, (str, bool, int, float))
            or (isinstance(value, float) and not math.isfinite(value))
            or (isinstance(value, str) and len(value) > 2000)
        ):
            raise ProviderError("provider_invalid_response")
        values[key] = value
    return values, secrets


def channel_detail(client, entity, property_id, adapter=None):
    value = channel_json(entity, property_id)
    adapter = adapter or get_adapter(client, value["code"])
    attrs = entity["attributes"]
    if not isinstance(attrs.get("settings"), dict) or len(attrs["rate_plans"]) > 500:
        raise ProviderError("provider_invalid_response")
    value.update(revision=revision(client, entity), editable=value["propertyCount"] == 1)
    value["settings"], value["secrets"] = public_settings(attrs["settings"], adapter["fields"])
    value["mappings"] = []
    mapping_fields = adapter["mappingFields"]
    if adapter["oauth"] and not any(field["key"] == "listing_id" for field in mapping_fields):
        mapping_fields = [*mapping_fields, {"key": "listing_id", "secret": False}]
    for mapping in attrs["rate_plans"]:
        settings, secrets = public_settings(mapping["settings"], mapping_fields)
        value["mappings"].append(
            {
                "id": remote_id(mapping.get("id")),
                "ratePlanId": remote_id(mapping.get("rate_plan_id")),
                "settings": settings,
                "secrets": secrets,
            }
        )
    return value


def settings_input(changes, fields, stored=None):
    if not isinstance(changes, dict) or set(changes) - {field["key"] for field in fields}:
        invalid()
    values = deepcopy(stored or {})
    for field in fields:
        key, kind = field["key"], field["type"]
        if key not in changes:
            if stored is None and "default" in field:
                values[key] = field["default"]
            continue
        value = changes[key]
        if kind == "boolean":
            valid = type(value) is bool
        elif kind == "integer":
            valid = type(value) is int and 0 <= value <= 2**31 - 1
        elif kind == "number":
            valid = type(value) in (int, float) and abs(value) <= 10**12 and math.isfinite(value)
        elif kind in {"select", "switch"}:
            valid = isinstance(value, str) and value in field["options"]
        else:
            valid = (
                isinstance(value, str)
                and len(value) <= 2000
                and not any(ord(c) < 32 for c in value)
            )
        if not valid:
            invalid()
        if field["secret"] and value == "" and stored is not None:
            continue
        values[key] = value
    for field in fields:
        for rule in field["rules"]:
            current = values.get(rule["influenceField"])
            if type(current) is type(rule["when"]) and current == rule["when"]:
                values[field["key"]] = rule["withValue"]
    return values


def mappings_input(changes, fields, options, stored=None):
    if not isinstance(changes, list) or len(changes) > 250:
        invalid()
    result = deepcopy(stored or [])
    existing = {row["id"]: row for row in result}
    allowed = {row["id"] for row in options}
    seen = set()
    for change in changes:
        if (
            not isinstance(change, dict)
            or set(change) - {"id", "ratePlanId", "settings"}
            or not {"ratePlanId", "settings"} <= set(change)
        ):
            invalid()
        rate_id = input_id(change["ratePlanId"])
        if rate_id not in allowed:
            raise ApiError(
                422, "channel_rate_wrong_property", "Gói giá phải thuộc khách sạn đang chọn."
            )
        identifier = input_id(change["id"]) if change.get("id") is not None else None
        old = existing.get(identifier) if identifier else None
        if identifier and (not old or identifier in seen or old["rate_plan_id"] != rate_id):
            invalid()
        if identifier:
            seen.add(identifier)
        if change["settings"] is None:
            if old is None:
                invalid()
            result.remove(old)
        else:
            values = settings_input(change["settings"], fields, old["settings"] if old else None)
            if old:
                old["settings"] = values
            else:
                result.append({"rate_plan_id": rate_id, "settings": values})
    if len(result) > 500:
        invalid()
    signatures = {
        (row["rate_plan_id"], json.dumps(row["settings"], sort_keys=True, allow_nan=False))
        for row in result
    }
    if len(signatures) != len(result):
        raise ApiError(422, "channel_duplicate_mapping", "Ghép nối phòng/gói giá đang bị trùng.")
    return [{"rate_plan_id": row["rate_plan_id"], "settings": row["settings"]} for row in result]


def mutation_data(allowed, required):
    query_values(set())
    data = payload()
    if set(data) - allowed or not required <= set(data):
        invalid()
    return data


def channel_name(value):
    if (
        not isinstance(value, str)
        or not 1 <= len(value.strip()) <= 255
        or any(ord(c) < 32 for c in value)
    ):
        invalid()
    return value.strip()


def probe_json(action, result):
    data = result.get("data")
    if not isinstance(data, dict):
        raise ProviderError("provider_invalid_response")
    if action == "test_connection":
        if type(data.get("success")) is not bool:
            raise ProviderError("provider_invalid_response")
        return {
            "success": data["success"],
            "message": "Kết nối hợp lệ."
            if data["success"]
            else "OTA chưa chấp nhận thông tin kết nối. Kiểm tra mã khách sạn và quyền kết nối Channex tại OTA.",
        }
    if action == "connection_details":
        attrs = data.get("attributes")
        if data.get("type") != "connection_details" or (
            attrs is not None and not isinstance(attrs, dict)
        ):
            raise ProviderError("provider_invalid_response")
        currency = (attrs or {}).get("currency")
        if currency is not None and (
            not isinstance(currency, str) or not re.fullmatch(r"[A-Z]{3}", currency)
        ):
            raise ProviderError("provider_invalid_response")
        return {"currency": currency, "available": attrs is not None}
    rooms = data.get("rooms", [])
    if not isinstance(rooms, list) or len(rooms) > 500:
        raise ProviderError("provider_invalid_response")
    output = []
    for room in rooms:
        if (
            not isinstance(room, dict)
            or not isinstance(room.get("rates", []), list)
            or len(room.get("rates", [])) > 500
        ):
            raise ProviderError("provider_invalid_response")
        rates = []
        for rate in room.get("rates", []):
            if not isinstance(rate, dict):
                raise ProviderError("provider_invalid_response")
            occupancies = rate.get("occupancies", [])
            if (
                not isinstance(occupancies, list)
                or len(occupancies) > 50
                or any(type(v) is not int or not 1 <= v <= 50 for v in occupancies)
            ):
                raise ProviderError("provider_invalid_response")
            readonly = rate.get("readonly", False)
            if type(readonly) is not bool:
                raise ProviderError("provider_invalid_response")
            rates.append(
                {
                    "id": probe_identifier(rate.get("id")),
                    "name": provider_text(rate.get("title", rate.get("name")), 500, required=True),
                    "occupancies": occupancies,
                    "readonly": readonly,
                    "pricingType": provider_text(rate.get("pricing"), 80),
                }
            )
        output.append(
            {
                "id": probe_identifier(room.get("id")),
                "name": provider_text(room.get("title", room.get("name")), 500, required=True),
                "rates": rates,
            }
        )
    return {
        "rooms": output,
        "pricingType": provider_text(data.get("pricing_type"), 80),
        "listings": [],
    }


def probe_identifier(value):
    if type(value) is int and 0 <= value <= 2**63 - 1:
        return str(value)
    if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_.:-]{1,160}", value):
        return value
    raise ProviderError("provider_invalid_response")


def readiness(client, identifier):
    result = client._request("POST", f"/channels/{identifier}/check_readiness")
    issues = result.get("data")
    if (
        not isinstance(issues, list)
        or len(issues) > 500
        or any(not isinstance(issue, dict) for issue in issues)
    ):
        raise ProviderError("provider_invalid_response")
    # Provider issue descriptions may echo credentials. Only known machine codes cross the boundary.
    messages = []
    for issue in issues:
        code = issue.get("error_code")
        if not isinstance(code, str):
            raise ProviderError("provider_invalid_response")
        messages.append(
            {
                "missing_mapping": "Chưa ghép phòng/gói giá.",
                "no_mapping": "Chưa ghép phòng/gói giá.",
                "missing_settings": "Thông tin kết nối chưa đầy đủ.",
            }.get(
                code,
                "Channex báo cấu hình chưa sẵn sàng; kiểm tra thông tin kết nối và ghép phòng/gói giá.",
            )
        )
    return {"ready": not issues, "issues": list(dict.fromkeys(messages))}


def pending_result(result):
    return result.get("_http_status") == 202 or "async_meta" in result


def pending_response():
    return {
        "pending": True,
        "message": "Channex đang xử lý yêu cầu. Tải lại danh sách trước khi gửi thêm thay đổi.",
    }, 202


class ChannelAdaptersView(CommonMethodView):
    @staticmethod
    @require_system()
    def dispatch_request(property_id, code=None):
        args = query_values({"accountId"})
        try:
            _, client = account_client(args.get("accountId"))
            prop = verify_property(client, property_id)
            return channel_adapters(client, prop, code)
        except ProviderError as error:
            provider_error(error)


class ChannelDetailView(CommonMethodView):
    @staticmethod
    @require_system()
    def dispatch_request(property_id, channel_id):
        args = query_values({"accountId"})
        try:
            _, client = account_client(args.get("accountId"))
            prop = verify_property(client, property_id)
            return channel_detail_response(client, prop, channel_id, single_property=True)
        except ProviderError as error:
            provider_error(error)


class ChannelProbeView(CommonMethodView):
    @staticmethod
    @require_system()
    def dispatch_request(property_id, action):
        if action not in {"test_connection", "mapping_details", "connection_details"}:
            invalid()
        data = mutation_data(
            {"accountId", "code", "settings", "channelId", "revision"},
            {"accountId", "code", "settings"},
        )
        try:
            _, client = account_client(data["accountId"])
            prop = verify_property(client, property_id)
            return probe_channel(client, prop, data, action)
        except ProviderError as error:
            provider_error(error)


class SaveChannelView(CommonMethodView):
    @staticmethod
    @require_system()
    def dispatch_request(property_id, channel_id=None):
        required = (
            {"accountId", "revision"}
            if channel_id
            else {"accountId", "code", "name", "groupId", "settings", "mappings"}
        )
        allowed = (
            {"accountId", "revision", "name", "settings", "mappings"} if channel_id else required
        )
        data = mutation_data(allowed, required)
        try:
            environment, client = account_client(data["accountId"])
            prop = verify_property(client, property_id)
            return save_channel(environment, client, prop, data, channel_id)
        except ProviderError as error:
            provider_error(error, mutation=True)


class ChannelActionView(CommonMethodView):
    @staticmethod
    @require_system()
    def dispatch_request(property_id, channel_id, action=None):
        deleting = request.method == "DELETE"
        if not deleting and action not in {"readiness", "activate", "deactivate", "load_bookings"}:
            invalid()
        data = mutation_data({"accountId", "revision", "confirm"}, {"accountId", "revision"})
        if (deleting or action != "readiness") and data.get("confirm") is not True:
            raise ApiError(
                422,
                "channel_confirmation_required",
                "Xác nhận tác động trước khi thay đổi kết nối OTA.",
            )
        try:
            environment, client = account_client(data["accountId"])
            prop = verify_property(client, property_id)
            return channel_action(environment, client, prop, data, channel_id, action)
        except ProviderError as error:
            provider_error(error, mutation=True)


def channel_adapters(client, prop, code=None):
    try:
        if code is not None:
            return {"adapter": get_adapter(client, code)}
        raw = client._request("GET", "/channels/list").get("data")
        if not isinstance(raw, list) or len(raw) > 500:
            raise ProviderError("provider_invalid_response")
        adapters, unavailable, seen = [], [], set()
        for row in raw:
            if not isinstance(row, dict) or row.get("kind") not in ("ota", "meta", "cm"):
                raise ProviderError("provider_invalid_response")
            identifier = adapter_code(row.get("code"), provider=True)
            name = provider_text(row.get("title"), 160, required=True)
            if identifier in seen:
                raise ProviderError("provider_invalid_response")
            seen.add(identifier)
            # Channex also classifies Booking.com, Agoda and Expedia as meta.
            if row["kind"] == "cm":
                continue
            try:
                adapters.append(adapter_json(row))
            except ProviderError as error:
                if error.code != "provider_invalid_response":
                    raise
                unavailable.append({"code": identifier, "name": name})
                current_app.logger.warning("Unsupported Channex OTA descriptor: %s", identifier)
        return {
            "adapters": adapters,
            "unavailableAdapters": unavailable,
            "groups": groups_json(prop),
            "rateOptions": rate_options(client, prop),
        }
    except ProviderError as error:
        provider_error(error)


def channel_detail_response(client, prop, channel_id, *, single_property=False):
    try:
        entity = verify_channel(client, channel_id, prop["id"], single_property=single_property)
        adapter = get_adapter(client, entity["attributes"]["channel"])
        return {
            "channel": channel_detail(client, entity, prop["id"], adapter),
            "adapter": adapter,
            "rateOptions": rate_options(client, prop),
        }
    except ProviderError as error:
        provider_error(error)


def probe_channel(client, prop, data, action):
    try:
        adapter = get_adapter(client, data["code"])
        if adapter["oauth"]:
            raise ApiError(
                409, "channel_oauth_required", "Airbnb cần liên kết tài khoản bằng OAuth."
            )
        stored = None
        if data.get("channelId") is not None:
            entity = verify_channel(client, data["channelId"], prop["id"], mutable=True)
            check_revision(client, entity, data.get("revision"))
            if entity["attributes"]["channel"] != adapter["code"]:
                invalid()
            stored = entity["attributes"]["settings"]
        settings = settings_input(data["settings"], adapter["fields"], stored)
        return probe_json(
            action,
            client._request(
                "POST",
                "/channels/" + action,
                {"channel": adapter["code"], "settings": settings},
            ),
        )
    except ProviderError as error:
        provider_error(error)


def save_channel(environment, client, prop, data, channel_id=None):
    try:
        lock_linked_property(environment, prop["id"])
        if channel_id:
            entity = verify_channel(client, channel_id, prop["id"], mutable=True)
            check_revision(client, entity, data["revision"])
            attrs = entity["attributes"]
            adapter = get_adapter(client, attrs["channel"])
            if attrs["is_active"] and {"settings", "mappings"} & set(data):
                raise ApiError(
                    409,
                    "channel_active_edit",
                    "Dừng đồng bộ kênh trước khi đổi thông tin hoặc ghép nối.",
                )
            if adapter["oauth"] and {"settings", "mappings"} & set(data):
                raise ApiError(
                    409,
                    "channel_airbnb_mapping",
                    "Dùng luồng liên kết và ghép listing riêng của Airbnb.",
                )
            values = {"channel": attrs["channel"]}
            if "name" in data:
                values["title"] = channel_name(data["name"])
            if "settings" in data:
                values["settings"] = settings_input(
                    data["settings"], adapter["fields"], attrs["settings"]
                )
            if "mappings" in data:
                options = rate_options(client, prop)
                values["rate_plans"] = mappings_input(
                    data["mappings"], adapter["mappingFields"], options, attrs["rate_plans"]
                )
            if "settings" in values and values.get("rate_plans", attrs["rate_plans"]):
                for field in adapter["fields"]:
                    if field["secret"]:
                        continue
                    old = attrs["settings"].get(field["key"])
                    new = values["settings"].get(field["key"])
                    if field["type"] in {"string", "slug", "select", "switch"}:
                        old, new = str(old), str(new)
                    if old != new:
                        raise ApiError(
                            409,
                            "channel_settings_mapped",
                            "Gỡ các ghép nối trước khi đổi thông tin tài khoản hoặc mã khách sạn OTA.",
                        )
            identifier = input_id(channel_id)
            if {"settings", "mappings"} & set(data):
                invalidate_linked_inventory(environment, prop["id"])
            # Reject external edits made while the adapter and rate catalogs were loading.
            current = verify_channel(client, identifier, prop["id"], mutable=True)
            check_revision(client, current, data["revision"])
            result = client._request(
                "PUT", f"/channels/{identifier}", {"channel": values}, allow_async=True
            )
        else:
            adapter = get_adapter(client, data["code"])
            if adapter["oauth"]:
                raise ApiError(
                    409, "channel_oauth_required", "Airbnb cần liên kết tài khoản bằng OAuth."
                )
            group_id = input_id(data["groupId"])
            if group_id not in {group["id"] for group in groups_json(prop)}:
                raise ApiError(
                    422,
                    "channel_group_wrong_property",
                    "Nhóm Channex phải chứa khách sạn đang chọn.",
                )
            options = rate_options(client, prop)
            values = {
                "channel": adapter["code"],
                "title": channel_name(data["name"]),
                "group_id": group_id,
                "properties": [prop["id"]],
                "settings": settings_input(data["settings"], adapter["fields"]),
                "rate_plans": mappings_input(data["mappings"], adapter["mappingFields"], options),
            }
            invalidate_linked_inventory(environment, prop["id"])
            result = client._request("POST", "/channels", {"channel": values}, allow_async=True)
            identifier = None
        if pending_result(result):
            audit(
                "channex.channel.requested",
                "channex_channel",
                identifier or prop["id"],
                {"propertyId": prop["id"], "environment": environment},
            )
            return pending_response()
        saved = result.get("data")
        value = channel_detail(client, saved, prop["id"], adapter)
        if (
            (identifier and value["id"] != identifier)
            or value["code"] != adapter["code"]
            or not value["editable"]
            or (not identifier and value["active"])
        ):
            raise ProviderError("provider_invalid_response")
        audit(
            "channex.channel.updated" if identifier else "channex.channel.created",
            "channex_channel",
            value["id"],
            {"propertyId": prop["id"], "environment": environment},
        )
        return {"channel": value}, 200 if identifier else 201
    except ProviderError as error:
        provider_error(error, mutation=True)


def channel_action(environment, client, prop, data, channel_id, action=None):
    deleting = request.method == "DELETE"
    try:
        lock_linked_property(environment, prop["id"])
        entity = verify_channel(client, channel_id, prop["id"], mutable=True)
        check_revision(client, entity, data["revision"])
        identifier, attrs = entity["id"], entity["attributes"]
        if action == "readiness":
            return readiness(client, identifier)
        if action == "load_bookings":
            from ..channels.onboarding import request_existing_bookings

            return request_existing_bookings(environment, client, prop, entity)
        if deleting:
            if attrs["is_active"]:
                raise ApiError(
                    409, "channel_active_delete", "Dừng đồng bộ kênh trước khi xóa kết nối."
                )
            result = client._request(
                "DELETE", f"/channels/{identifier}", allow_async=True, allow_empty=True
            )
            if pending_result(result):
                return pending_response()
            audit(
                "channex.channel.deleted",
                "channex_channel",
                identifier,
                {"propertyId": prop["id"], "environment": environment},
            )
            return {"deleted": True}
        if action == "activate":
            if not readiness(client, identifier)["ready"]:
                raise ApiError(
                    409,
                    "channel_not_ready",
                    "Kênh chưa sẵn sàng; kiểm tra thông tin và ghép phòng/gói giá.",
                )
            invalidate_linked_inventory(environment, prop["id"])
            current = verify_channel(client, identifier, prop["id"], mutable=True)
            check_revision(client, current, data["revision"])
        elif attrs["channel"].lower() == "airbnb" and attrs["rate_plans"]:
            raise ApiError(
                409,
                "airbnb_unmap_first",
                "Airbnb yêu cầu gỡ ghép các listing trước khi dừng đồng bộ.",
            )
        result = client._request("POST", f"/channels/{identifier}/{action}", allow_async=True)
        if pending_result(result):
            return pending_response()
        saved = verify_channel(client, identifier, prop["id"], mutable=True)
        if saved["attributes"]["is_active"] is not (action == "activate"):
            raise ProviderError("provider_invalid_response")
        audit(
            "channex.channel." + action,
            "channex_channel",
            identifier,
            {"propertyId": prop["id"], "environment": environment},
        )
        return {"channel": channel_detail(client, saved, prop["id"])}
    except ProviderError as error:
        provider_error(error, mutation=True)
