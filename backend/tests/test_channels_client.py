"""Provider contract checks use no Flask, credentials, database or network."""

import importlib.util
import io
import json
import socket
import ssl
import unittest
from pathlib import Path
from unittest.mock import Mock
from urllib.error import HTTPError, URLError
from uuid import UUID

spec = importlib.util.spec_from_file_location(
    "channex_client", Path(__file__).resolve().parents[1] / "pms_api/channels/client.py"
)
client = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)


class Response(io.BytesIO):
    status = 200


class ChannexClientTests(unittest.TestCase):
    def test_ari_readback_uses_property_and_inclusive_date_filters(self):
        from urllib.parse import parse_qs, urlsplit

        identifier = str(UUID(int=1))
        for method, resource in (
            ("availability", "availability"),
            ("restrictions", "restrictions"),
        ):
            with self.subTest(method=method):
                provider, transport = self.provider({"data": {"fixture": {}}})
                self.assertEqual(
                    getattr(provider, method)(identifier, "2030-01-01", "2030-01-02"),
                    {"fixture": {}},
                )
                request = transport.open.call_args.args[0]
                target = urlsplit(request.full_url)
                query = parse_qs(target.query)
                self.assertTrue(target.path.endswith("/" + resource))
                self.assertEqual(query["filter[property_id]"], [identifier])
                self.assertEqual(query["filter[date][gte]"], ["2030-01-01"])
                self.assertEqual(query["filter[date][lte]"], ["2030-01-02"])
                if method == "restrictions":
                    self.assertEqual(query["filter[restrictions]"], ["rate,stop_sell"])
                transport.open.return_value = Response(b'{"data": []}')
                with self.assertRaises(client.ProviderError):
                    getattr(provider, method)(identifier, "2030-01-01", "2030-01-02")

    def test_booking_lookup_checks_entity_identity_and_uses_fixed_endpoint(self):
        identifier = str(UUID(int=4))
        entity = {
            "id": identifier,
            "type": "booking",
            "attributes": {"revision_id": str(UUID(int=14))},
        }
        provider, transport = self.provider({"data": entity})
        self.assertEqual(provider.booking(identifier), entity)
        request = transport.open.call_args.args[0]
        self.assertEqual(request.method, "GET")
        self.assertEqual(
            request.full_url, "https://staging.channex.io/api/v1/bookings/" + identifier
        )
        for invalid in (
            {},
            {**entity, "id": str(UUID(int=5))},
            {**entity, "type": "booking_revision"},
            {**entity, "attributes": []},
        ):
            with self.subTest(entity=invalid):
                transport.open.return_value = Response(json.dumps({"data": invalid}).encode())
                with self.assertRaises(client.ProviderError):
                    provider.booking(identifier)

    def test_async_envelopes_are_explicit_and_keep_actual_status(self):
        provider, transport = self.provider({"async_meta": {"id": "fixture-operation"}})
        transport.open.return_value.status = 202
        with self.assertRaises(client.ProviderError):
            provider._request("POST", "/channels", {})
        transport.open.return_value = Response(b'{"async_meta":{"id":"fixture-operation"}}')
        transport.open.return_value.status = 202
        result = provider._request("POST", "/channels", {}, allow_async=True, timeout=45)
        self.assertEqual(result["_http_status"], 202)
        self.assertEqual(result["async_meta"], {"id": "fixture-operation"})
        self.assertEqual(transport.open.call_args.kwargs["timeout"], 45)
        for raw in (b'{"async_meta":[]}', b'{"async_meta":{},"errors":{"secret":"hidden"}}'):
            transport.open.return_value = Response(raw)
            with self.assertRaises(client.ProviderError) as caught:
                provider._request("POST", "/channels", {}, allow_async=True)
            self.assertNotIn("hidden", str(caught.exception))

    def test_empty_delete_response_requires_explicit_permission(self):
        provider, transport = self.provider({})
        transport.open.return_value = Response(b"")
        transport.open.return_value.status = 204
        result = provider._request("DELETE", "/channels/" + str(UUID(int=1)), allow_empty=True)
        self.assertEqual(result, {"meta": {"message": "Success"}, "_http_status": 204})
        transport.open.return_value = Response(b"")
        transport.open.return_value.status = 204
        with self.assertRaises(client.ProviderError):
            provider._request("GET", "/channels")

    def test_remote_properties_use_fixed_pagination_and_title_order(self):
        provider, transport = self.provider({"data": [], "meta": {"total": 0}})
        provider.properties(2)
        req = transport.open.call_args.args[0]
        self.assertEqual(req.method, "GET")
        self.assertTrue(req.full_url.startswith("https://staging.channex.io/api/v1/properties?"))
        self.assertIn("pagination%5Bpage%5D=2", req.full_url)
        self.assertIn("pagination%5Blimit%5D=25", req.full_url)
        self.assertIn("order%5Btitle%5D=asc", req.full_url)

    def test_property_creation_uses_fixed_post_and_property_wrapper_once(self):
        identifier = str(UUID(int=10))
        entity = {"id": identifier, "type": "property", "attributes": {"title": "New hotel"}}
        provider, transport = self.provider({"data": entity})
        values = {"title": "New hotel", "currency": "VND", "property_type": "hotel"}
        self.assertEqual(provider.create_property(values), entity)
        req = transport.open.call_args.args[0]
        self.assertEqual(req.method, "POST")
        self.assertEqual(req.full_url, "https://staging.channex.io/api/v1/properties")
        self.assertEqual(json.loads(req.data), {"property": values})
        self.assertEqual(transport.open.call_count, 1)
        for data in ([], {}, {"id": "not-a-uuid"}):
            with self.subTest(data=data):
                transport.open.return_value = Response(json.dumps({"data": data}).encode())
                with self.assertRaises(client.ProviderError):
                    provider.create_property(values)

    def test_property_creation_timeout_does_not_retry_or_expose_transport_details(self):
        provider, transport = self.provider({})
        transport.open.side_effect = TimeoutError("private-key provider detail")
        with self.assertRaises(client.ProviderError) as caught:
            provider.create_property({"title": "New hotel", "currency": "VND"})
        self.assertEqual(transport.open.call_count, 1)
        self.assertEqual(caught.exception.code, "provider_unavailable")
        self.assertNotIn("private-key", str(caught.exception))

    def test_catalog_entity_reads_and_writes_have_fixed_resource_paths(self):
        identifier = str(UUID(int=1))
        provider, transport = self.provider({"data": {"id": identifier, "attributes": {}}})
        transport.open.side_effect = lambda *_args, **_kwargs: Response(
            json.dumps({"data": {"id": identifier, "attributes": {}}}).encode()
        )
        for resource, wrapper in (("room_types", "room_type"), ("rate_plans", "rate_plan")):
            with self.subTest(resource=resource):
                provider.catalog_entity(resource, identifier)
                self.assertTrue(
                    transport.open.call_args.args[0].full_url.endswith(f"/{resource}/{identifier}")
                )
                provider.write_catalog(resource, {"title": "Standard"})
                req = transport.open.call_args.args[0]
                self.assertEqual(req.method, "POST")
                self.assertTrue(req.full_url.endswith("/" + resource))
                self.assertEqual(json.loads(req.data), {wrapper: {"title": "Standard"}})
                provider.write_catalog(resource, {"title": "Renamed"}, identifier)
                req = transport.open.call_args.args[0]
                self.assertEqual(req.method, "PUT")
                self.assertTrue(req.full_url.endswith(f"/{resource}/{identifier}"))
                self.assertNotIn("force", req.full_url)
        for resource, identifier in (("channels", str(UUID(int=1))), ("room_types", "../bad")):
            with self.assertRaises(client.ProviderError):
                provider.write_catalog(resource, {}, identifier)

    def provider(self, response):
        transport = Mock()
        transport.open.return_value = Response(json.dumps(response).encode())
        return client.ChannexClient("staging", "fixture-key", transport), transport

    def test_fixed_host_header_and_feed_query(self):
        provider, transport = self.provider({"data": []})
        self.assertEqual(provider.feed("11111111-1111-1111-1111-111111111111"), [])
        req = transport.open.call_args.args[0]
        self.assertTrue(
            req.full_url.startswith("https://staging.channex.io/api/v1/booking_revisions/feed?")
        )
        self.assertIn("filter%5Bproperty_id%5D=", req.full_url)
        self.assertIn("order%5Binserted_at%5D=asc", req.full_url)
        self.assertEqual(req.get_header("User-api-key"), "fixture-key")
        self.assertEqual(transport.open.call_args.kwargs["timeout"], 15)

    def test_no_arbitrary_base_or_header_injection(self):
        for environment, key in [("http://localhost", "a"), ("production", "a\nb")]:
            with self.assertRaises(client.ProviderError):
                client.ChannexClient(environment, key)

    def test_feed_pagination_preserves_rows_and_verifies_page_metadata(self):
        identifier = str(UUID(int=1))
        rows = [{"id": str(UUID(int=2))}]
        provider, transport = self.provider(
            {"data": rows, "meta": {"page": 2, "limit": 100, "total": 101}}
        )
        self.assertEqual(provider.feed(identifier, page=2), rows)
        req = transport.open.call_args.args[0]
        self.assertIn("pagination%5Bpage%5D=2", req.full_url)
        self.assertIn("pagination%5Blimit%5D=100", req.full_url)
        self.assertIn("order%5Binserted_at%5D=asc", req.full_url)
        self.assertEqual(transport.open.call_count, 1)
        for meta in (
            {"page": 1},
            {"page": True},
            {"limit": 50},
            {"total": -1},
            {"total": True},
        ):
            with self.subTest(meta=meta):
                transport.open.return_value = Response(
                    json.dumps({"data": rows, "meta": meta}).encode()
                )
                with self.assertRaises(client.ProviderError):
                    provider.feed(identifier, page=2)

    def test_feed_page_is_bounded_before_any_remote_request(self):
        provider, transport = self.provider({"data": []})
        for page in (True, 0, -1, "2", 2**31):
            with self.subTest(page=page):
                with self.assertRaises(client.ProviderError):
                    provider.feed(str(UUID(int=1)), page=page)
        transport.open.assert_not_called()

    def test_ari_warnings_are_not_success(self):
        provider, _ = self.provider({"data": [], "meta": {"warnings": [{"warning": "invalid"}]}})
        with self.assertRaises(client.ProviderError) as caught:
            provider.push_availability([])
        self.assertEqual(caught.exception.code, "provider_rejected")

    def test_provider_error_diagnostics_are_optional_and_preserve_public_contract(self):
        error = client.ProviderError("provider_unavailable", True)
        self.assertIsNone(error.http_status)
        self.assertIsNone(error.failure_type)
        error = client.ProviderError(
            "provider_unavailable", True, http_status=503, failure_type="transport"
        )
        self.assertEqual(error.code, "provider_unavailable")
        self.assertEqual(str(error), "provider_unavailable")
        self.assertTrue(error.retryable)
        self.assertEqual(error.http_status, 503)
        self.assertEqual(error.failure_type, "transport")

    def test_http_failures_keep_status_and_never_expose_provider_details(self):
        provider, transport = self.provider({})
        for status, code, retryable in (
            (400, "provider_rejected", False),
            (429, "provider_rate_limited", True),
            (500, "provider_unavailable", True),
            (503, "provider_unavailable", True),
        ):
            with self.subTest(status=status):
                transport.open.side_effect = HTTPError(
                    "https://private.example.test",
                    status,
                    "private-key",
                    {"Authorization": "private-header"},
                    io.BytesIO(b"private response"),
                )
                self.addCleanup(transport.open.side_effect.close)
                with self.assertRaises(client.ProviderError) as caught:
                    provider.feed("11111111-1111-1111-1111-111111111111")
                error = caught.exception
                self.assertEqual(error.http_status, status)
                self.assertIsNone(error.failure_type)
                self.assertEqual(error.retryable, retryable)
                self.assertEqual(error.code, code)
                self.assertEqual(str(error), code)
                self.assertNotIn("private", repr(vars(error)))

    def test_transport_failures_use_only_safe_bounded_classifications(self):
        provider, transport = self.provider({})
        for failure, failure_type in (
            (TimeoutError("private timeout"), "timeout"),
            (URLError(socket.timeout("private timeout")), "timeout"),
            (URLError(socket.gaierror(-2, "private host")), "dns"),
            (URLError(ssl.SSLError("private certificate")), "tls"),
            (URLError(ConnectionRefusedError("private connection")), "connection"),
            (ConnectionResetError("private connection"), "connection"),
            (OSError("private transport"), "transport"),
            (URLError("private URL and key"), "transport"),
        ):
            with self.subTest(failure=type(failure).__name__, failure_type=failure_type):
                transport.open.side_effect = failure
                with self.assertRaises(client.ProviderError) as caught:
                    provider.feed("11111111-1111-1111-1111-111111111111")
                error = caught.exception
                self.assertEqual(error.failure_type, failure_type)
                self.assertIsNone(error.http_status)
                self.assertEqual(error.code, "provider_unavailable")
                self.assertEqual(str(error), "provider_unavailable")
                self.assertTrue(error.retryable)
                self.assertNotIn("private", repr(vars(error)))

    def test_non_json_and_oversized_responses_rejected(self):
        provider, transport = self.provider({})
        for body in (b"not json", b"x" * (2 * 1024 * 1024 + 1)):
            transport.open.return_value = Response(body)
            with self.assertRaises(client.ProviderError):
                provider.feed("11111111-1111-1111-1111-111111111111")

    def test_ack_has_safe_uuid_path_and_empty_object(self):
        provider, transport = self.provider({"meta": {"message": "Success"}})
        revision = "22222222-2222-2222-2222-222222222222"
        provider.ack(revision)
        req = transport.open.call_args.args[0]
        self.assertTrue(req.full_url.endswith(f"/booking_revisions/{revision}/ack"))
        self.assertEqual(json.loads(req.data), {})
        with self.assertRaises(client.ProviderError):
            provider.ack("../../properties")

    def test_property_verification_requires_requested_id(self):
        property_id = "11111111-1111-1111-1111-111111111111"
        provider, transport = self.provider({"data": {"id": property_id}})
        self.assertEqual(provider.property(property_id)["id"], property_id)
        self.assertTrue(transport.open.call_args.args[0].full_url.endswith(property_id))
        for data in ([], {}, {"id": "22222222-2222-2222-2222-222222222222"}):
            transport.open.return_value = Response(json.dumps({"data": data}).encode())
            with self.assertRaises(client.ProviderError):
                provider.property(property_id)

    def test_catalog_requires_complete_bounded_response_and_safe_metadata(self):
        property_id = str(UUID(int=1))
        provider, transport = self.provider({"data": [], "meta": {"total": 0}})
        self.assertEqual(provider.catalog("room_types", property_id), [])
        self.assertIn("filter%5Bproperty_id%5D=", transport.open.call_args.args[0].full_url)
        for body, code in (
            ({"data": [], "meta": []}, "provider_invalid_response"),
            ({"data": {}, "meta": {"total": 0}}, "provider_invalid_response"),
            ({"data": [], "meta": {"total": True}}, "provider_invalid_response"),
            ({"data": [], "meta": {"total": -1}}, "provider_invalid_response"),
            ({"data": [], "meta": {"total": 1}}, "provider_invalid_response"),
            ({"data": [], "meta": {"total": 101}}, "channel_catalog_too_large"),
        ):
            with self.subTest(body=body):
                transport.open.return_value = Response(json.dumps(body).encode())
                with self.assertRaises(client.ProviderError) as caught:
                    provider.catalog("rate_plans", property_id)
                self.assertEqual(caught.exception.code, code)

    def webhook(self, property_id, callback, secret="fixture-secret-" + "a" * 32, number=3):
        return {
            "id": str(UUID(int=number)),
            "type": "webhook",
            "attributes": {
                "callback_url": callback,
                "event_mask": "*",
                "is_global": False,
                "is_active": True,
                "send_data": True,
                "request_params": {},
                "headers": {"X-Channex-Webhook-Secret": secret},
            },
            "relationships": {"property": {"data": {"id": property_id, "type": "property"}}},
        }

    def test_webhook_creation_scopes_property_event_and_secret(self):
        property_id = "11111111-1111-1111-1111-111111111111"
        callback = "https://api.example.test/api/channex/webhooks/hotel-a"
        secret = "fixture-secret-" + "a" * 32
        webhook = self.webhook(property_id, callback, secret)
        provider, _ = self.provider({})
        provider._request = Mock(
            side_effect=[
                {"data": [], "meta": {"page": 1, "limit": 100, "total": 0}},
                {"data": webhook},
            ]
        )
        self.assertEqual(provider.setup_webhook(property_id, callback, secret), webhook["id"])
        call = provider._request.call_args_list[-1]
        self.assertEqual(call.args[:2], ("POST", "/webhooks"))
        body = call.kwargs.get("body", call.args[2] if len(call.args) > 2 else None)["webhook"]
        self.assertEqual(body["property_id"], property_id)
        self.assertEqual(body["callback_url"], callback)
        self.assertEqual(body["event_mask"], "*")
        self.assertEqual(body["headers"], {"X-Channex-Webhook-Secret": secret})
        self.assertIs(body["is_active"], True)
        self.assertIs(body["is_global"], False)
        self.assertIs(body["send_data"], True)

    def test_webhook_retry_adopts_existing_without_duplicate(self):
        property_id = "11111111-1111-1111-1111-111111111111"
        callback = "https://api.example.test/api/channex/webhooks/hotel-a"
        secret = "fixture-secret-" + "a" * 32
        webhook = self.webhook(property_id, callback, secret)
        provider, _ = self.provider({})
        provider._request = Mock(
            return_value={
                "data": [webhook],
                "meta": {"page": 1, "limit": 100, "total": 1},
            }
        )
        self.assertEqual(provider.setup_webhook(property_id, callback, secret), webhook["id"])
        self.assertEqual(provider._request.call_count, 1)

    def test_webhook_updates_only_exact_callback_and_property(self):
        property_id = "11111111-1111-1111-1111-111111111111"
        callback = "https://api.example.test/api/channex/webhooks/hotel-a"
        secret = "fixture-secret-" + "a" * 32
        unrelated = self.webhook(property_id, "https://another.example.test/callback", number=4)
        wrong_property = self.webhook("22222222-2222-2222-2222-222222222222", callback, number=5)
        existing = self.webhook(property_id, callback, "old-secret-" + "b" * 32)
        updated = self.webhook(property_id, callback, secret)
        provider, _ = self.provider({})
        provider._request = Mock(
            side_effect=[
                {"data": [unrelated, wrong_property, existing], "meta": {"total": 3}},
                {"data": updated},
            ]
        )
        self.assertEqual(provider.setup_webhook(property_id, callback, secret), existing["id"])
        self.assertEqual(
            provider._request.call_args_list[-1].args[:2], ("PUT", "/webhooks/" + existing["id"])
        )

    def test_webhook_pagination_reconciles_later_page(self):
        property_id = "11111111-1111-1111-1111-111111111111"
        callback = "https://api.example.test/api/channex/webhooks/hotel-a"
        secret = "fixture-secret-" + "a" * 32
        webhook = self.webhook(property_id, callback, secret)
        provider, _ = self.provider({})
        provider._request = Mock(
            side_effect=[
                {
                    "data": [
                        self.webhook(property_id, "https://another.example.test/callback", number=n)
                        for n in range(100, 200)
                    ],
                    "meta": {"page": 1, "limit": 100, "total": 101},
                },
                {"data": [webhook], "meta": {"page": 2, "limit": 100, "total": 101}},
            ]
        )
        self.assertEqual(provider.setup_webhook(property_id, callback, secret), webhook["id"])
        self.assertEqual(provider._request.call_args_list[1].kwargs["query"]["pagination[page]"], 2)
        self.assertEqual(provider._request.call_count, 2)

    def test_webhook_duplicate_or_invalid_result_fails_closed(self):
        property_id = "11111111-1111-1111-1111-111111111111"
        callback = "https://api.example.test/api/channex/webhooks/hotel-a"
        secret = "fixture-secret-" + "a" * 32
        webhook = self.webhook(property_id, callback, secret)
        provider, _ = self.provider({})
        provider._request = Mock(return_value={"data": [webhook, webhook], "meta": {"total": 2}})
        with self.assertRaises(client.ProviderError):
            provider.setup_webhook(property_id, callback, secret)
        self.assertEqual(provider._request.call_count, 1)
        provider._request = Mock(
            side_effect=[
                {"data": [], "meta": {"total": 0}},
                {"data": self.webhook(property_id, "https://wrong.example.test/callback")},
            ]
        )
        with self.assertRaises(client.ProviderError):
            provider.setup_webhook(property_id, callback, secret)


if __name__ == "__main__":
    unittest.main()
