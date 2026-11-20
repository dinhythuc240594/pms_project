"""Small PMS Channex adapter. URLs are fixed; provider bodies never become errors.

Contract: https://docs.channex.io/api-v.1-documentation/bookings-collection
ARI: https://docs.channex.io/api-v.1-documentation/ari
"""

import json
import math
import socket
import ssl
from http.client import HTTPException as HTTPClientError
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .errors import ProviderError as ProviderError
from .identifiers import remote_id as remote_id

BASES = {
    "staging": "https://staging.channex.io/api/v1",
    "production": "https://app.channex.io/api/v1",
}
MAX_RESPONSE = 2 * 1024 * 1024


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def finite_number(value):
    number = float(value)
    if not math.isfinite(number):
        raise ValueError
    return number


class ChannexClient:
    def __init__(self, environment, api_key, transport=None):
        if (
            not isinstance(environment, str)
            or environment not in BASES
            or not isinstance(api_key, str)
            or not api_key
            or len(api_key) > 1024
            or any(ord(c) < 32 or ord(c) > 126 for c in api_key)
        ):
            raise ProviderError("credentials_unavailable")
        self.base, self.api_key = BASES[environment], api_key
        self.transport = transport or build_opener(NoRedirect())

    def _request(
        self,
        method,
        path,
        body=None,
        query=None,
        *,
        allow_async=False,
        allow_empty=False,
        timeout=15,
    ):
        url = self.base + path + ("?" + urlencode(query) if query else "")
        raw = json.dumps(body, allow_nan=False).encode() if body is not None else None
        req = Request(
            url,
            data=raw,
            method=method,
            headers={
                "user-api-key": self.api_key,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        try:
            with self.transport.open(req, timeout=timeout) as response:
                if not 200 <= response.status < 300:
                    raise ProviderError("provider_rejected")
                status = response.status
                data = response.read(MAX_RESPONSE + 1)
            if len(data) > MAX_RESPONSE:
                raise ProviderError("provider_response_too_large")
            if allow_empty and method == "DELETE" and status == 204 and not data:
                return {"meta": {"message": "Success"}, "_http_status": status}
            result = json.loads(data, parse_float=finite_number, parse_constant=finite_number)
            if (
                not isinstance(result, dict)
                or "errors" in result
                or not (
                    {"data", "meta"} & result.keys()
                    or (allow_async and isinstance(result.get("async_meta"), dict))
                )
            ):
                raise ProviderError("provider_invalid_response")
            if "async_meta" in result and (
                not allow_async or not isinstance(result["async_meta"], dict)
            ):
                raise ProviderError("provider_invalid_response")
            if not isinstance(result.get("meta", {}), dict):
                raise ProviderError("provider_invalid_response")
            if result.get("meta", {}).get("warnings"):
                raise ProviderError("provider_rejected")
            return {**result, "_http_status": status} if allow_async or allow_empty else result
        except HTTPError as error:
            error.close()
            code = (
                "provider_rate_limited"
                if error.code == 429
                else "provider_unavailable"
                if error.code >= 500
                else "provider_rejected"
            )
            raise ProviderError(
                code, error.code == 429 or error.code >= 500, http_status=error.code
            ) from None
        except (URLError, TimeoutError, socket.timeout, OSError, HTTPClientError) as error:
            reason = error.reason if isinstance(error, URLError) else error
            if isinstance(reason, (TimeoutError, socket.timeout)):
                failure_type = "timeout"
            elif isinstance(reason, ssl.SSLError):
                failure_type = "tls"
            elif isinstance(reason, socket.gaierror):
                failure_type = "dns"
            elif isinstance(reason, ConnectionError):
                failure_type = "connection"
            else:
                failure_type = "transport"
            raise ProviderError("provider_unavailable", True, failure_type=failure_type) from None
        except ValueError, UnicodeDecodeError, RecursionError:
            raise ProviderError("provider_invalid_response") from None

    def feed(self, property_id, page=1):
        if type(page) is not int or not 1 <= page <= 2**31 - 1:
            raise ProviderError("provider_invalid_response")
        result = self._request(
            "GET",
            "/booking_revisions/feed",
            query={
                "filter[property_id]": remote_id(property_id),
                "order[inserted_at]": "asc",
                "pagination[page]": page,
                "pagination[limit]": 100,
            },
        )
        rows = result.get("data")
        meta = result.get("meta", {})
        total = meta.get("total", len(rows) if isinstance(rows, list) else 0)
        if (
            not isinstance(rows, list)
            or len(rows) > 100
            or type(meta.get("page", page)) is not int
            or meta.get("page", page) != page
            or meta.get("limit", 100) != 100
            or type(total) is not int
            or total < len(rows)
        ):
            raise ProviderError("provider_invalid_response")
        return rows

    def property(self, property_id):
        property_id = remote_id(property_id)
        result = self._request("GET", f"/properties/{property_id}")
        entity = result.get("data")
        if not isinstance(entity, dict) or entity.get("id") != property_id:
            raise ProviderError("provider_invalid_response")
        return entity

    def properties(self, page):
        return self._request(
            "GET",
            "/properties",
            query={"pagination[page]": page, "pagination[limit]": 25, "order[title]": "asc"},
        )

    def create_property(self, values):
        result = self._request("POST", "/properties", {"property": values})
        entity = result.get("data")
        if not isinstance(entity, dict):
            raise ProviderError("provider_invalid_response")
        remote_id(entity.get("id"))
        return entity

    def catalog_entity(self, resource, identifier):
        if resource not in {"room_types", "rate_plans"}:
            raise ProviderError("provider_invalid_response")
        identifier = remote_id(identifier)
        result = self._request("GET", f"/{resource}/{identifier}")
        entity = result.get("data")
        if not isinstance(entity, dict) or entity.get("id") != identifier:
            raise ProviderError("provider_invalid_response")
        return entity

    def write_catalog(self, resource, values, identifier=None):
        if resource not in {"room_types", "rate_plans"}:
            raise ProviderError("provider_invalid_response")
        path = "/" + resource
        if identifier is not None:
            identifier = remote_id(identifier)
            path += "/" + identifier
        result = self._request(
            "POST" if identifier is None else "PUT", path, {resource[:-1]: values}
        )
        entity = result.get("data")
        if not isinstance(entity, dict) or (
            identifier is not None and entity.get("id") != identifier
        ):
            raise ProviderError("provider_invalid_response") from None
        remote_id(entity.get("id"))
        return entity

    def setup_webhook(self, property_id, callback_url, webhook_secret):
        """Reconcile only our exact property callback, including after an uncertain commit."""
        property_id = remote_id(property_id)
        if (
            not isinstance(webhook_secret, str)
            or not 32 <= len(webhook_secret) <= 1024
            or any(ord(char) < 32 or ord(char) > 126 for char in webhook_secret)
        ):
            raise ProviderError("credentials_unavailable")

        def matches(entity):
            try:
                attributes = entity["attributes"]
                related = entity["relationships"].get("property", {}).get("data")
                return (
                    attributes.get("callback_url") == callback_url
                    and attributes.get("is_global", False) is False
                    and isinstance(related, dict)
                    and related.get("id") == property_id
                )
            except KeyError, TypeError, AttributeError:
                raise ProviderError("provider_invalid_response") from None

        found, seen, expected_total = [], set(), None
        for page in range(1, 11):
            result = self._request(
                "GET",
                "/webhooks",
                query={"pagination[page]": page, "pagination[limit]": 100},
            )
            rows, meta = result.get("data"), result.get("meta", {})
            total, size = meta.get("total"), meta.get("limit", 100)
            if (
                not isinstance(rows, list)
                or type(total) is not int
                or total < 0
                or type(size) is not int
                or not 1 <= size <= 100
                or meta.get("page", page) != page
                or len(rows) != min(size, max(0, total - len(seen)))
                or (expected_total is not None and total != expected_total)
            ):
                raise ProviderError("provider_invalid_response")
            if total > 1000:
                raise ProviderError("channel_webhook_list_too_large")
            expected_total = total
            for entity in rows:
                if not isinstance(entity, dict) or not isinstance(entity.get("attributes"), dict):
                    raise ProviderError("provider_invalid_response")
                webhook_id = remote_id(entity.get("id"))
                if webhook_id in seen:
                    raise ProviderError("provider_invalid_response")
                seen.add(webhook_id)
                if matches(entity):
                    found.append(entity)
            if len(seen) == total:
                break
        else:
            raise ProviderError("channel_webhook_list_too_large")
        if len(found) > 1:
            raise ProviderError("channel_webhook_ambiguous")
        values = {
            "callback_url": callback_url,
            "property_id": property_id,
            "event_mask": "*",
            "is_global": False,
            "is_active": True,
            "send_data": True,
            "request_params": {},
            "headers": {"X-Channex-Webhook-Secret": webhook_secret},
        }
        if found:
            entity = found[0]
            webhook_id = remote_id(entity["id"])
            if all(
                entity["attributes"].get(key) == value
                for key, value in values.items()
                if key != "property_id"
            ):
                return webhook_id
            result = self._request("PUT", f"/webhooks/{webhook_id}", {"webhook": values})
        else:
            webhook_id = None
            result = self._request("POST", "/webhooks", {"webhook": values})
        entity = result.get("data")
        if (
            not isinstance(entity, dict)
            or not matches(entity)
            or any(
                entity["attributes"].get(key) != value
                for key, value in values.items()
                if key != "property_id"
            )
        ):
            raise ProviderError("provider_invalid_response")
        saved_id = remote_id(entity.get("id"))
        if webhook_id is not None and saved_id != webhook_id:
            raise ProviderError("provider_invalid_response")
        return saved_id

    def booking(self, booking_id):
        booking_id = remote_id(booking_id)
        result = self._request("GET", f"/bookings/{booking_id}")
        entity = result.get("data")
        if (
            not isinstance(entity, dict)
            or entity.get("type") != "booking"
            or entity.get("id") != booking_id
            or not isinstance(entity.get("attributes"), dict)
        ):
            raise ProviderError("provider_invalid_response")
        return entity

    def revision(self, revision_id):
        result = self._request("GET", f"/booking_revisions/{remote_id(revision_id)}")
        if not isinstance(result.get("data"), dict):
            raise ProviderError("provider_invalid_response")
        return result["data"]

    def ack(self, revision_id):
        self._request("POST", f"/booking_revisions/{remote_id(revision_id)}/ack", {})

    def load_future_reservations(self, channel_id):
        result = self._request(
            "POST",
            f"/channels/{remote_id(channel_id)}/execute/load_future_reservations",
            {},
            allow_async=True,
        )
        if not isinstance(result.get("meta", {}).get("message"), str) and not result.get(
            "async_meta"
        ):
            raise ProviderError("provider_invalid_response")
        return result

    def push_availability(self, values):
        self._request("POST", "/availability", {"values": values})

    def push_restrictions(self, values):
        self._request("POST", "/restrictions", {"values": values})

    def restrictions(self, property_id, start, end):
        result = self._request(
            "GET",
            "/restrictions",
            query={
                "filter[property_id]": remote_id(property_id),
                "filter[date][gte]": start,
                "filter[date][lte]": end,
                "filter[restrictions]": "rate,stop_sell",
            },
        )
        if not isinstance(result.get("data"), dict):
            raise ProviderError("provider_invalid_response")
        return result["data"]

    def availability(self, property_id, start, end):
        result = self._request(
            "GET",
            "/availability",
            query={
                "filter[property_id]": remote_id(property_id),
                "filter[date][gte]": start,
                "filter[date][lte]": end,
            },
        )
        if not isinstance(result.get("data"), dict):
            raise ProviderError("provider_invalid_response")
        return result["data"]

    def catalog(self, resource, property_id):
        if resource not in {"room_types", "rate_plans"}:
            raise ProviderError("provider_invalid_response")
        result = self._request(
            "GET",
            "/" + resource,
            query={
                "filter[property_id]": remote_id(property_id),
                "pagination[page]": 1,
                "pagination[limit]": 100,
            },
        )
        rows = result.get("data")
        metadata = result.get("meta", {})
        if not isinstance(rows, list) or not isinstance(metadata, dict):
            raise ProviderError("provider_invalid_response")
        total = metadata.get("total", len(rows))
        if type(total) is not int or total < 0:
            raise ProviderError("provider_invalid_response")
        if len(rows) > 100 or total > 100:
            raise ProviderError("channel_catalog_too_large")
        if total != len(rows):
            raise ProviderError("provider_invalid_response")
        return rows
