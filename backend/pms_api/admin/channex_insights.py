"""Read remote bookings, channels and ARI without importing or acknowledging them."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from types import SimpleNamespace

from flask import request

from common import CommonMethodView, RequestData

from ..channels.client import ProviderError, remote_id
from ..channels.service import catalog_options
from ..security import ApiError, require_system
from .channex_remote import (
    account_client,
    page_number,
    provider_error,
    query_values,
    read_page,
    verify_property,
)


def iso_date(value):
    if not isinstance(value, str) or len(value) != 10:
        raise ValueError
    result = date.fromisoformat(value)
    if result.isoformat() != value:
        raise ValueError
    return result


def provider_text(value, limit, *, required=False):
    if value is None and not required:
        return None
    if (
        not isinstance(value, str)
        or len(value) > limit
        or any(ord(c) < 32 for c in value)
        or (required and not value.strip())
    ):
        raise ProviderError("provider_invalid_response")
    return value.strip()


def provider_money(value):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (str, int, float)) or len(str(value)) > 50:
        raise ProviderError("provider_invalid_response")
    try:
        amount = Decimal(str(value))
        if (
            not amount.is_finite()
            or amount < 0
            or amount > Decimal("999999999999999.9999")
            or amount.as_tuple().exponent < -8
        ):
            raise ValueError
        return format(amount, "f")
    except (InvalidOperation, ValueError):
        raise ProviderError("provider_invalid_response") from None


def booking_json(entity, property_id):
    if not isinstance(entity, dict) or not isinstance(entity.get("attributes"), dict):
        raise ProviderError("provider_invalid_response")
    attrs = entity["attributes"]
    if remote_id(attrs.get("property_id")) != property_id:
        raise ProviderError("provider_invalid_response")
    currency = provider_text(attrs.get("currency"), 3, required=True)
    customer = attrs.get("customer")
    customer = {} if customer is None else customer
    rooms = attrs.get("rooms", [])
    if (
        not isinstance(customer, dict)
        or not isinstance(rooms, list)
        or len(rooms) > 100
        or any(not isinstance(r, dict) for r in rooms)
        or not currency.isascii()
        or not currency.isalpha()
        or not currency.isupper()
        or len(currency) != 3
    ):
        raise ProviderError("provider_invalid_response")
    try:
        arrival = iso_date(attrs["arrival_date"]) if attrs.get("arrival_date") is not None else None
        departure = (
            iso_date(attrs["departure_date"]) if attrs.get("departure_date") is not None else None
        )
        if arrival and departure and departure <= arrival:
            raise ValueError
        created = provider_text(attrs.get("inserted_at"), 80, required=True)
        inserted = datetime.fromisoformat(created.replace("Z", "+00:00"))
        inserted = (
            inserted.replace(tzinfo=UTC) if inserted.tzinfo is None else inserted.astimezone(UTC)
        )
    except (ValueError, KeyError, OverflowError):
        raise ProviderError("provider_invalid_response") from None
    return {
        "id": remote_id(entity.get("id")),
        "reference": provider_text(
            attrs.get("ota_reservation_code") or attrs.get("unique_id"), 200
        ),
        "source": provider_text(attrs.get("ota_name"), 160),
        "status": provider_text(attrs.get("status"), 40, required=True),
        "guestName": " ".join(
            filter(
                None,
                (
                    provider_text(customer.get("name"), 160),
                    provider_text(customer.get("surname"), 160),
                ),
            )
        )
        or None,
        "arrivalDate": arrival.isoformat() if arrival else None,
        "departureDate": departure.isoformat() if departure else None,
        "amount": provider_money(attrs.get("amount")),
        "currency": currency,
        "roomCount": len(rooms),
        "createdAt": inserted.isoformat(),
    }


def point_maps(raw, index, dates):
    if not isinstance(raw, dict) or len(raw) > len(index):
        raise ProviderError("provider_invalid_response")
    seen = set()
    for key, bucket in raw.items():
        identifier = remote_id(key)
        if (
            identifier not in index
            or identifier in seen
            or not isinstance(bucket, dict)
            or set(bucket) - dates
        ):
            raise ProviderError("provider_invalid_response")
        seen.add(identifier)
        yield identifier, bucket


def channel_json(entity, property_id):
    if (
        not isinstance(entity, dict)
        or entity.get("type") != "channel"
        or not isinstance(entity.get("attributes"), dict)
    ):
        raise ProviderError("provider_invalid_response")
    attrs = entity["attributes"]
    properties, mappings = attrs.get("properties"), attrs.get("rate_plans")
    actions = attrs.get("actions", [])
    if (
        not isinstance(actions, list)
        or len(actions) > 100
        or any(not isinstance(action, str) or len(action) > 100 for action in actions)
    ):
        raise ProviderError("provider_invalid_response")
    if (
        not isinstance(properties, list)
        or not 1 <= len(properties) <= 1000
        or not isinstance(mappings, list)
        or len(mappings) > 10000
        or any(not isinstance(mapping, dict) for mapping in mappings)
        or not isinstance(attrs.get("is_active"), bool)
    ):
        raise ProviderError("provider_invalid_response")
    property_ids = {remote_id(identifier) for identifier in properties}
    if len(property_ids) != len(properties) or property_id not in property_ids:
        raise ProviderError("provider_invalid_response")
    relationships = entity.get("relationships", {})
    if not isinstance(relationships, dict):
        raise ProviderError("provider_invalid_response")
    property_relationship = relationships.get("properties", {})
    if not isinstance(property_relationship, dict):
        raise ProviderError("provider_invalid_response")
    related = property_relationship.get("data")
    if related is not None and (
        not isinstance(related, list)
        or any(not isinstance(row, dict) for row in related)
        or {remote_id(row.get("id")) for row in related} != property_ids
    ):
        raise ProviderError("provider_invalid_response")
    currency = provider_text(attrs.get("currency"), 3)
    if currency is not None and (
        len(currency) != 3
        or not currency.isascii()
        or not currency.isalpha()
        or not currency.isupper()
    ):
        raise ProviderError("provider_invalid_response")
    return {
        "id": remote_id(entity.get("id")),
        "name": provider_text(attrs.get("title"), 500, required=True),
        "code": provider_text(attrs.get("channel"), 120, required=True),
        "currency": currency,
        "active": attrs["is_active"],
        "supportsLoadFutureReservations": "load_future_reservations" in actions,
        "mappedRateCount": len({remote_id(row.get("rate_plan_id")) for row in mappings}),
        "propertyCount": len(property_ids),
    }


class RemoteChannelsView(CommonMethodView):
    @staticmethod
    @require_system()
    def dispatch_request(property_id):
        args = query_values({"accountId", "page"})
        page = page_number(args.get("page", "1"))
        try:
            _, client = account_client(args.get("accountId"))
            entity = verify_property(client, property_id)
            property_id = remote_id(entity["id"])
            return remote_channels(client, property_id, page, single_property=True)
        except ProviderError as error:
            provider_error(error)


class RemoteBookingsView(CommonMethodView):
    @staticmethod
    @require_system()
    def dispatch_request(property_id):
        args = query_values({"accountId", "page"})
        page = page_number(args.get("page", "1"))
        try:
            _, client = account_client(request.args.get("accountId"), action="channels.view")
            entity = verify_property(client, property_id)
            property_id = remote_id(entity["id"])
            result = client._request(
                "GET",
                "/bookings",
                query={
                    "filter[property_id]": property_id,
                    "pagination[page]": page,
                    "pagination[limit]": 25,
                    "order[inserted_at]": "desc",
                },
            )
            rows, pagination = read_page(result, page)
            bookings = [booking_json(row, property_id) for row in rows]
            if len({row["id"] for row in bookings}) != len(bookings):
                raise ProviderError("provider_invalid_response")
            return {"bookings": bookings, "pagination": pagination}
        except ProviderError as error:
            provider_error(error)


class RemoteInventoryView(CommonMethodView):
    @staticmethod
    @require_system()
    def dispatch_request(property_id):
        start_value, end_value = RequestData.date_range()
        query_values({"accountId", "start", "end", "start_date", "end_date"})
        try:
            start, end = iso_date(start_value), iso_date(end_value)
            if not 0 <= (end - start).days < 31:
                raise ValueError
        except ValueError:
            raise ApiError(
                422,
                "invalid_channex_window",
                "Chọn khoảng ngày hợp lệ, tối đa 31 ngày và gồm ngày kết thúc.",
            ) from None
        dates = [(start + timedelta(days=i)).isoformat() for i in range((end - start).days + 1)]
        try:
            _, client = account_client(request.args.get("accountId"), action="channels.view")
            property_entity = verify_property(client, property_id)
            property_id = remote_id(property_entity["id"])
            catalog = catalog_options(
                SimpleNamespace(property_id=property_id),
                client,
                property_entity["attributes"]["currency"],
            )
            rooms = {r["id"]: r for r in catalog["roomTypes"]}
            plans = {r["id"]: r for r in catalog["ratePlans"]}
            filters = {
                "filter[property_id]": property_id,
                "filter[date][gte]": start.isoformat(),
                "filter[date][lte]": end.isoformat(),
            }
            availability_raw = client._request("GET", "/availability", query=filters).get("data")
            rates_raw = client._request(
                "GET", "/restrictions", query={**filters, "filter[restrictions]": "rate,stop_sell"}
            ).get("data")
            availability, rates = {}, {}
            for identifier, bucket in point_maps(availability_raw, rooms, set(dates)):
                if any(
                    value is not None
                    and (
                        isinstance(value, bool)
                        or not isinstance(value, int)
                        or not 0 <= value <= 1000000
                    )
                    for value in bucket.values()
                ):
                    raise ProviderError("provider_invalid_response")
                availability[identifier] = bucket
            for identifier, bucket in point_maps(rates_raw, plans, set(dates)):
                rates[identifier] = {}
                for day, point in bucket.items():
                    if not isinstance(point, dict) or (
                        point.get("stop_sell") is not None
                        and not isinstance(point["stop_sell"], bool)
                    ):
                        raise ProviderError("provider_invalid_response")
                    rates[identifier][day] = {
                        "rate": provider_money(point.get("rate")),
                        "stopSell": point.get("stop_sell"),
                    }
            return {
                "start": start.isoformat(),
                "end": end.isoformat(),
                "dates": dates,
                "availability": [
                    {
                        "roomTypeId": r["id"],
                        "name": r["name"],
                        "values": availability.get(r["id"], {}),
                    }
                    for r in rooms.values()
                ],
                "rates": [
                    {
                        "ratePlanId": r["id"],
                        "roomTypeId": r["roomTypeId"],
                        "name": r["name"],
                        "currency": r["currency"],
                        "values": rates.get(r["id"], {}),
                    }
                    for r in plans.values()
                ],
            }
        except ProviderError as error:
            provider_error(error)


def remote_channels(client, property_id, page, *, single_property=False):
    result = client._request(
        "GET",
        "/channels",
        query={
            "filter[property_id]": property_id,
            "pagination[page]": page,
            "pagination[limit]": 25,
            "order[title]": "asc",
        },
    )
    rows, pagination = read_page(result, page)
    return {
        "channels": [
            value
            for row in rows
            if (value := channel_json(row, property_id))
            and (not single_property or value["propertyCount"] == 1)
        ],
        "pagination": pagination,
    }
