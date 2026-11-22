"""Explicit server-side sources and allowlisted remote Channex manager views."""

import re
from types import SimpleNamespace
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select

from pms_api.auth.application import validate_email
from pms_api.catalog.application import money_value
from pms_api.composition import channel_adapter
from pms_api.ports import runtime

from ..channels.access import authorize_channel_support
from ..channels.client import ProviderError, remote_id
from ..channels.credentials import load_credentials, valid_secret
from ..channels.models import ChannelConnection, ChannelMapping
from ..channels.service import (
    _catalog_index,
    _relationship,
    catalog_options,
    catalog_values,
    supported_rate_plan,
)
from ..core_models import Tenant
from ..currencies import is_hotel_currency
from ..extensions import db
from ..security import (
    ApiError,
    audit,
    set_context,
)
from ..subscriptions import lock_tenant
from ..validation import phone_value

PAGE_SIZE = 25
MANAGER_KEYS = {
    "system:staging": ("staging", "CHANNEX_MANAGER_API_KEY_STAGING", "Channex Staging"),
    "system:production": ("production", "CHANNEX_MANAGER_API_KEY_PRODUCTION", "Channex Production"),
}


def provider_error(error, *, mutation=False):
    """Translate only known provider codes; provider bodies and unknown text stay private."""
    if error.code in {"credentials_unavailable", "credential_storage_unavailable"}:
        raise ApiError(
            503, error.code, "Chưa đọc được khóa Channex của nguồn này. Vui lòng kiểm tra cấu hình."
        ) from None
    if error.code == "channel_catalog_too_large":
        raise ApiError(
            422, error.code, "Danh mục Channex vượt giới hạn 100 loại phòng hoặc gói giá."
        ) from None
    code = (
        error.code
        if error.code
        in {
            "provider_unavailable",
            "provider_rate_limited",
            "provider_rejected",
            "provider_invalid_response",
            "provider_response_too_large",
        }
        else "provider_invalid_response"
    )
    raise ApiError(
        503 if error.retryable else 502,
        code,
        "Chưa xác nhận được thay đổi trên Channex. Tải lại danh mục trước khi gửi lại để tránh tạo trùng."
        if mutation
        else "Chưa tải được dữ liệu Channex hợp lệ. Vui lòng thử lại hoặc kiểm tra quyền của khóa API.",
    ) from None


def support_hotels():
    return [
        SimpleNamespace(tenant_id=tenant_id)
        for tenant_id in db.session.scalars(select(Tenant.id).order_by(Tenant.id))
    ]


def hotel_access(tenant_id, action):
    authorize_channel_support(tenant_id, action)


def authorize_remote_property(client, property_id):
    environment = getattr(client, "_pms_environment", None)
    if not isinstance(environment, str):
        # Channel routes construct their client after tenant or support authorization.
        return
    action = client._pms_action
    account_tenant = client._pms_tenant_id
    candidates = [account_tenant] if account_tenant else [row.tenant_id for row in support_hotels()]
    for tenant_id in candidates:
        set_context(runtime().state.user.id, tenant_id, is_system=True, channel_support=True)
        linked = db.session.scalar(
            select(ChannelConnection.id).where(
                ChannelConnection.tenant_id == tenant_id,
                ChannelConnection.environment == environment,
                ChannelConnection.property_id == property_id,
            )
        )
        if linked:
            hotel_access(tenant_id, action)
            return
    raise ApiError(403, "tenant_denied", "Bạn không có quyền thực hiện thao tác này.")


def account_client(account_id, *, action=None):
    if not isinstance(account_id, str) or not account_id:
        raise ApiError(422, "channex_account_required", "Vui lòng chọn nguồn Channex.")
    action = action or (
        "channels.view" if runtime().request.method in {"GET", "HEAD"} else "channels.write"
    )
    account_tenant = None
    try:
        if account_id in MANAGER_KEYS:
            environment, key_name, _ = MANAGER_KEYS[account_id]
            key = runtime().config.get(key_name)
        elif account_id.startswith("hotel:"):
            account_tenant = account_id[6:]
            hotel_access(account_tenant, action)
            connection = db.session.scalar(
                select(ChannelConnection).where(ChannelConnection.tenant_id == account_tenant)
            )
            if connection is None:
                raise ApiError(
                    404, "channex_account_not_found", "Không tìm thấy nguồn Channex này."
                )
            environment = connection.environment
            key = load_credentials(connection).get("apiKey")
        else:
            raise ApiError(404, "channex_account_not_found", "Không tìm thấy nguồn Channex này.")
        if not valid_secret(key):
            raise ProviderError("credentials_unavailable")
        client = channel_adapter(environment, key)
        client._pms_environment = environment
        client._pms_action = action
        client._pms_tenant_id = account_tenant
        return environment, client
    except ProviderError as error:
        provider_error(error)


def read_page(result, page, limit=PAGE_SIZE):
    if not isinstance(result, dict):
        raise ProviderError("provider_invalid_response")
    rows, meta = result.get("data"), result.get("meta")
    if not isinstance(meta, dict) or not isinstance(rows, list):
        raise ProviderError("provider_invalid_response")
    total, actual_page, actual_limit = meta.get("total"), meta.get("page"), meta.get("limit")
    if (
        type(total) is not int
        or not 0 <= total <= 2**31 - 1
        or type(actual_page) is not int
        or actual_page != page
        or type(actual_limit) is not int
        or actual_limit != limit
        or len(rows) != min(limit, max(0, total - (page - 1) * limit))
    ):
        raise ProviderError("provider_invalid_response")
    _catalog_index(rows)
    return rows, {
        "page": page,
        "pageSize": limit,
        "totalItems": total,
        "totalPages": (total + limit - 1) // limit,
    }


def property_values(entity):
    if (
        not isinstance(entity, dict)
        or entity.get("type") not in ("property", "properties")
        or not isinstance(entity.get("attributes"), dict)
    ):
        raise ProviderError("provider_invalid_response")
    identifier, attributes = remote_id(entity.get("id")), entity["attributes"]
    title, currency = attributes.get("title"), attributes.get("currency")
    if (
        not isinstance(title, str)
        or not title.strip()
        or len(title) > 500
        or not isinstance(currency, str)
        or len(currency) != 3
        or not currency.isascii()
        or not currency.isalpha()
        or not currency.isupper()
    ):
        raise ProviderError("provider_invalid_response")
    values = {"id": identifier, "name": title, "currency": currency}
    for field, maximum in (("timezone", 100), ("city", 500), ("country", 2)):
        value = attributes.get(field)
        if value is not None and (
            not isinstance(value, str)
            or len(value) > maximum
            or (
                field == "country"
                and value
                and (
                    len(value) != 2
                    or not value.isascii()
                    or not value.isalpha()
                    or not value.isupper()
                )
            )
        ):
            raise ProviderError("provider_invalid_response")
        values[field] = value
    if values["timezone"]:
        try:
            ZoneInfo(values["timezone"])
        except ZoneInfoNotFoundError, ValueError:
            raise ProviderError("provider_invalid_response") from None
    return values


def verify_property(client, property_id):
    try:
        identifier = remote_id(property_id)
    except ProviderError:
        raise ApiError(422, "invalid_property_id", "Property ID Channex không hợp lệ.") from None
    authorize_remote_property(client, identifier)
    entity = client.property(identifier)
    if property_values(entity)["id"] != identifier:
        raise ProviderError("provider_invalid_response")
    return entity


def property_json(entity, environment):
    values = property_values(entity)
    hotel = None
    for membership in support_hotels():
        set_context(
            runtime().state.user.id, membership.tenant_id, is_system=True, channel_support=True
        )
        hotel = db.session.execute(
            select(Tenant.id, Tenant.name)
            .join(ChannelConnection, ChannelConnection.tenant_id == Tenant.id)
            .where(
                Tenant.id == membership.tenant_id,
                ChannelConnection.environment == environment,
                ChannelConnection.property_id == values["id"],
            )
        ).first()
        if hotel is not None:
            break
    values["linkedHotel"] = {"tenantId": hotel.id, "name": hotel.name} if hotel else None
    return values


def query_values(allowed):
    if set(runtime().request.args) - allowed or any(
        len(runtime().request.args.getlist(key)) != 1 for key in runtime().request.args
    ):
        raise ApiError(422, "invalid_query", "Tham số yêu cầu không hợp lệ.")
    return runtime().request.args


def page_number(value):
    if not isinstance(value, str) or not value.isascii() or not value.isdigit() or len(value) > 10:
        raise ApiError(422, "invalid_page", "Số trang Channex không hợp lệ.")
    page = int(value)
    if not 1 <= page <= 2**31 - 1:
        raise ApiError(422, "invalid_page", "Số trang Channex không hợp lệ.")
    return page


def handle_remote_accounts():
    query_values(set())
    accounts = []
    for identifier, (environment, key_name, label) in MANAGER_KEYS.items():
        configured = valid_secret(runtime().config.get(key_name))
        accounts.append(
            {
                "id": identifier,
                "label": label,
                "environment": environment,
                "configured": configured,
                "errorCode": None if configured else "credentials_unavailable",
            }
        )
    for membership in support_hotels():
        try:
            hotel_access(membership.tenant_id, "channels.view")
        except ApiError as error:
            if error.status != 403:
                raise
            continue
        row = db.session.execute(
            select(ChannelConnection, Tenant.name)
            .join(Tenant, Tenant.id == ChannelConnection.tenant_id)
            .where(Tenant.id == membership.tenant_id)
        ).first()
        if row is None:
            continue
        connection, name = row
        try:
            configured = valid_secret(load_credentials(connection).get("apiKey"))
            error_code = None if configured else "credentials_unavailable"
        except ProviderError as error:
            configured, error_code = False, error.code
        accounts.append(
            {
                "id": "hotel:" + connection.tenant_id,
                "label": name,
                "environment": connection.environment,
                "configured": configured,
                "errorCode": error_code,
            }
        )
    return {"accounts": accounts}


def handle_remote_properties():
    args = query_values({"accountId", "page"})
    page = page_number(args.get("page", "1"))
    environment, client = account_client(args.get("accountId"))
    try:
        if client._pms_tenant_id:
            connection = db.session.scalar(
                select(ChannelConnection).where(
                    ChannelConnection.tenant_id == client._pms_tenant_id
                )
            )
            rows = [verify_property(client, connection.property_id)] if page == 1 else []
            return {
                "environment": environment,
                "properties": [property_json(row, environment) for row in rows],
                "pagination": {
                    "page": page,
                    "pageSize": PAGE_SIZE,
                    "totalItems": 1,
                    "totalPages": 1,
                },
            }
        rows, pagination = read_page(client.properties(page), page)
        return {
            "environment": environment,
            "properties": [property_json(row, environment) for row in rows],
            "pagination": pagination,
        }
    except ProviderError as error:
        provider_error(error)


def property_input():
    query_values(set())
    data = runtime().payload()
    required = {"accountId", "name", "currency", "timezone"}
    optional = {"country", "city", "address", "email", "phone"}
    if required - data.keys() or data.keys() - required - optional:
        raise ApiError(
            422, "invalid_channex_payload", "Các trường tạo khách sạn Channex không hợp lệ."
        )
    account = data["accountId"]
    if not isinstance(account, str) or account not in MANAGER_KEYS:
        raise ApiError(
            422,
            "channex_system_account_required",
            "Chọn tài khoản Channex hệ thống có quyền tạo khách sạn.",
        )
    values = {"property_type": "hotel"}
    fields = (
        ("name", "title", 255),
        ("currency", "currency", 3),
        ("timezone", "timezone", 100),
        ("country", "country", 2),
        ("city", "city", 255),
        ("address", "address", 255),
        ("email", "email", 254),
        ("phone", "phone", 32),
    )
    for source, target, maximum in fields:
        if source not in data:
            continue
        value = data[source]
        if (
            not isinstance(value, str)
            or len(value.strip()) > maximum
            or any(ord(c) < 32 or 127 <= ord(c) <= 159 for c in value)
        ):
            raise ApiError(
                422, "invalid_channex_property", "Thông tin khách sạn Channex không hợp lệ."
            )
        value = value.strip()
        if not value:
            if source in required:
                raise ApiError(
                    422, "invalid_channex_property", "Nhập tên, tiền tệ và múi giờ khách sạn."
                )
            continue
        if source == "currency" and not is_hotel_currency(value):
            raise ApiError(422, "invalid_channex_currency", "Tiền tệ không được hỗ trợ.")
        if source == "country" and (
            len(value) != 2 or not value.isascii() or not value.isalpha() or not value.isupper()
        ):
            raise ApiError(422, "invalid_channex_country", "Mã quốc gia cần 2 chữ cái viết hoa.")
        if source == "timezone":
            try:
                ZoneInfo(value)
            except ZoneInfoNotFoundError, ValueError:
                raise ApiError(422, "invalid_channex_timezone", "Múi giờ không hợp lệ.") from None
        if source == "phone":
            value = phone_value(value)
        values[target] = validate_email(value) if source == "email" else value
    return account, values


def handle_save_remote_property():
    account, values = property_input()
    environment, client = account_client(account)
    try:
        # shortcut: Channex property creation has no idempotency key; reload before retrying an uncertain write.
        value = property_values(client.create_property(values))
        if any(
            value[field] != values[source]
            for field, source in (
                ("name", "title"),
                ("currency", "currency"),
                ("timezone", "timezone"),
            )
        ):
            raise ProviderError("provider_invalid_response")
        value["linkedHotel"] = None
        audit(
            "channex.property.created",
            "channex_property",
            value["id"],
            {"environment": environment},
        )
        return {"environment": environment, "property": value}, 201
    except ProviderError as error:
        provider_error(error, mutation=True)


def handle_remote_catalog(property_id):
    args = query_values({"accountId"})
    environment, client = account_client(args.get("accountId"))
    try:
        entity = verify_property(client, property_id)
        value = property_json(entity, environment)
        catalog = catalog_options(
            SimpleNamespace(property_id=value["id"]),
            client,
            value["currency"],
            remote_view=True,
        )
        mapped = {row.remote_room_type_id for row in property_mappings(environment, value["id"])}
        for room in catalog["roomTypes"]:
            room["mapped"] = room["id"] in mapped
        return {"environment": environment, "property": value, **catalog}
    except ProviderError as error:
        provider_error(error)


def property_mappings(environment, property_id):
    return list(
        db.session.scalars(
            select(ChannelMapping)
            .join(ChannelConnection, ChannelConnection.tenant_id == ChannelMapping.tenant_id)
            .where(
                ChannelConnection.environment == environment,
                ChannelConnection.property_id == property_id,
            )
        )
    )


def lock_linked_property(environment, property_id):
    tenant_id = db.session.scalar(
        select(ChannelConnection.tenant_id).where(
            ChannelConnection.environment == environment,
            ChannelConnection.property_id == property_id,
        )
    )
    if tenant_id:
        lock_tenant(tenant_id)


def mutation_input(fields):
    query_values(set())
    data = runtime().payload()
    if set(data) != {"accountId", "name", *fields}:
        raise ApiError(422, "invalid_channex_payload", "Các trường chỉnh sửa Channex không hợp lệ.")
    name = data["name"]
    if (
        not isinstance(name, str)
        or not name.strip()
        or len(name.strip()) > 255
        or any(ord(c) < 32 for c in name)
    ):
        raise ApiError(422, "invalid_channex_name", "Tên phải có 1–255 ký tự.")
    data["name"] = name.strip()
    return data


def input_id(value):
    try:
        return remote_id(value)
    except ProviderError:
        raise ApiError(422, "invalid_channex_id", "Mã Channex phải là UUID hợp lệ.") from None


def room_json(entity, property_id, currency):
    return catalog_values([entity], [], property_id, currency, remote_view=True)["roomTypes"][0]


def rate_json(entity, room, property_id, currency):
    return catalog_values([room], [entity], property_id, currency, remote_view=True)["ratePlans"][0]


def handle_save_remote_room_type(property_id, room_type_id=None):
    data = mutation_input({"countOfRooms", "adults", "children", "infants"})
    fields = (
        ("countOfRooms", "count_of_rooms", 1, 10000),
        ("adults", "occ_adults", 1, 50),
        ("children", "occ_children", 0, 50),
        ("infants", "occ_infants", 0, 50),
    )
    values = {"title": data["name"]}
    for source, target, minimum, maximum in fields:
        if type(data[source]) is not int or not minimum <= data[source] <= maximum:
            raise ApiError(422, "invalid_channex_occupancy", "Số phòng hoặc sức chứa không hợp lệ.")
        values[target] = data[source]
    identifier = input_id(room_type_id) if room_type_id is not None else None
    environment, client = account_client(data["accountId"])
    try:
        prop = property_values(verify_property(client, property_id))
        lock_linked_property(environment, prop["id"])
        mapped = False
        if identifier:
            old = client.catalog_entity("room_types", identifier)
            old_value = room_json(old, prop["id"], prop["currency"])
            if old_value["id"] != identifier:
                raise ProviderError("provider_invalid_response")
            mapped = any(
                row.remote_room_type_id == identifier
                for row in property_mappings(environment, prop["id"])
            )
            if mapped and any(old_value[source] != data[source] for source, _, _, _ in fields):
                raise ApiError(
                    409,
                    "channex_mapping_protected",
                    "Phòng đã ghép LOHA; chỉ được đổi tên, không đổi số phòng hoặc sức chứa.",
                )
            default = old["attributes"].get("default_occupancy")
            if default is not None:
                if type(default) is not int or not 1 <= default <= 50:
                    raise ProviderError("provider_invalid_response")
                values["default_occupancy"] = min(default, data["adults"])
        else:
            values.update(
                property_id=prop["id"], default_occupancy=data["adults"], room_kind="room"
            )
        # shortcut: provider writes have no idempotency key; reload after an uncertain result before retrying.
        saved = (
            client.write_catalog("room_types", values, identifier)
            if identifier
            else client.write_catalog("room_types", values)
        )
        value = room_json(saved, prop["id"], prop["currency"])
        if (
            (identifier and value["id"] != identifier)
            or value["name"] != data["name"]
            or any(value[source] != data[source] for source, _, _, _ in fields)
        ):
            raise ProviderError("provider_invalid_response")
        value["mapped"] = mapped
        audit(
            "channex.room_type.updated" if identifier else "channex.room_type.created",
            "channex_room_type",
            value["id"],
            {"propertyId": prop["id"], "environment": environment},
        )
        return {"roomType": value}, 200 if identifier else 201
    except ProviderError as error:
        provider_error(error, mutation=True)


def handle_save_remote_rate_plan(property_id, rate_plan_id=None):
    identifier = input_id(rate_plan_id) if rate_plan_id is not None else None
    data = mutation_input({"rate"} if identifier else {"roomTypeId", "currency", "rate"})
    if not isinstance(data["rate"], str) or not re.fullmatch(
        r"[0-9]{1,15}(?:\.[0-9]{1,4})?", data["rate"]
    ):
        raise ApiError(
            422,
            "invalid_channex_rate",
            "Giá phải là chuỗi số không âm, tối đa 15 số nguyên và 4 số lẻ.",
        )
    amount = format(money_value(data["rate"]), ".4f")
    if not identifier:
        room_id = input_id(data["roomTypeId"])
        currency = data["currency"]
        if (
            not isinstance(currency, str)
            or len(currency) != 3
            or not currency.isascii()
            or not currency.isalpha()
            or not currency.isupper()
        ):
            raise ApiError(422, "invalid_channex_currency", "Tiền tệ phải có 3 ký tự viết hoa.")
    environment, client = account_client(data["accountId"])
    try:
        prop = property_values(verify_property(client, property_id))
        lock_linked_property(environment, prop["id"])
        if identifier:
            old = client.catalog_entity("rate_plans", identifier)
            room_id = remote_id(_relationship(old, "room_type"))
            room = client.catalog_entity("room_types", room_id)
            value = rate_json(old, room, prop["id"], prop["currency"])
            if value["id"] != identifier:
                raise ProviderError("provider_invalid_response")
            # shortcut: complex occupancy/derived plans are read-only until a complete options editor exists.
            if not value["editable"]:
                raise ApiError(
                    409,
                    "channex_rate_read_only",
                    "Chỉ sửa giá của gói manual/per-room với một mức sức chứa chính.",
                )
            for mapping in property_mappings(environment, prop["id"]):
                if mapping.remote_rate_plan_id != identifier:
                    continue
                tenant = db.session.get(Tenant, mapping.tenant_id)
                if mapping.pause_requested:
                    raise ApiError(
                        409,
                        "channel_mapping_pause_pending",
                        "Gói giá đang đóng bán; chờ tác vụ hoàn tất trước khi sửa.",
                    )
                if mapping.remote_room_type_id != room_id or not supported_rate_plan(
                    old["attributes"], (tenant.settings or {}).get("currency", "VND")
                ):
                    raise ApiError(
                        409,
                        "channex_mapping_protected",
                        "Gói đã ghép LOHA có mã phòng hoặc tiền tệ không khớp; cần kiểm tra ghép nối.",
                    )
            currency = value["currency"]
            occupancy = old["attributes"]["options"][0]["occupancy"]
            values = {"title": data["name"]}
        else:
            room = client.catalog_entity("room_types", room_id)
            room_value = room_json(room, prop["id"], prop["currency"])
            if room_value["id"] != room_id:
                raise ProviderError("provider_invalid_response")
            occupancy = room_value["adults"]
            if type(occupancy) is not int or not 1 <= occupancy <= 50:
                raise ApiError(
                    409,
                    "channex_room_occupancy_required",
                    "Loại phòng cần có sức chứa người lớn hợp lệ trước khi tạo gói giá.",
                )
            values = {
                "title": data["name"],
                "property_id": prop["id"],
                "room_type_id": room_id,
                "currency": currency,
                "sell_mode": "per_room",
                "rate_mode": "manual",
                "inherit_rate": False,
            }
        values["options"] = [{"occupancy": occupancy, "is_primary": True, "rate": amount}]
        saved = (
            client.write_catalog("rate_plans", values, identifier)
            if identifier
            else client.write_catalog("rate_plans", values)
        )
        value = rate_json(saved, room, prop["id"], prop["currency"])
        if (
            (identifier and value["id"] != identifier)
            or value["name"] != data["name"]
            or value["roomTypeId"] != room_id
            or value["currency"] != currency
            or value["rate"] != amount
            or not value["editable"]
        ):
            raise ProviderError("provider_invalid_response")
        audit(
            "channex.rate_plan.updated" if identifier else "channex.rate_plan.created",
            "channex_rate_plan",
            value["id"],
            {"propertyId": prop["id"], "environment": environment},
        )
        return {"ratePlan": value}, 200 if identifier else 201
    except ProviderError as error:
        provider_error(error, mutation=True)
