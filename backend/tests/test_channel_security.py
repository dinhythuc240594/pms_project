"""Adversarial provider responses fail closed before reaching OTA jobs or API views."""

import unittest
from email.message import Message
from http.client import BadStatusLine, IncompleteRead
from io import BytesIO
from unittest.mock import Mock, patch
from urllib.request import BaseHandler, build_opener
from urllib.response import addinfourl

from flask import Flask

from pms_api.admin.channex_channels import adapter_json, channel_adapters, fields_json
from pms_api.admin.channex_insights import booking_json
from pms_api.channels.client import ProviderError
from pms_api.channels.exceptions import IncidentActionView
from pms_api.channels.importer import revision_identity
from pms_api.security import ApiError, register_security
from tests.test_channels_client import Response, client
from tests.test_channels_integration import PROPERTY, revision
from tests.test_channex_channels import adapter


class ChannelInputSecurityTests(unittest.TestCase):
    def test_valid_adapter_fields_and_optional_mapping_modes_stay_supported(self):
        descriptor = adapter()
        descriptor.update(property_mapping=None, mapping_mode=None)
        result = adapter_json(descriptor)
        self.assertEqual(result["kind"], "meta")
        self.assertIsNone(result["propertyMapping"])
        self.assertIsNone(result["mappingMode"])
        fields = {field["key"]: field for field in result["fields"]}
        self.assertEqual(fields["email"]["rules"][0]["influenceField"], "send_email_notifications")
        self.assertTrue(fields["password"]["secret"])
        self.assertNotIn("private-default", str(result))

    def test_adapter_enum_objects_and_arrays_are_safe_provider_errors(self):
        for field in ("kind", "property_mapping", "mapping_mode"):
            for value in ([], {}, ["private-provider-value"]):
                with self.subTest(field=field, value=value):
                    descriptor = adapter()
                    descriptor[field] = value
                    with self.assertRaises(ProviderError) as caught:
                        adapter_json(descriptor)
                    self.assertEqual(caught.exception.code, "provider_invalid_response")

    def test_field_types_and_rule_field_references_reject_composite_values(self):
        for value in ([], {}, ["private-provider-value"]):
            with self.subTest(field="type", value=value):
                with self.assertRaises(ProviderError):
                    fields_json({"hotel_id": {"type": value, "position": 0}})
            with self.subTest(field="influence_field", value=value):
                fields = {
                    "hotel_id": {
                        "type": "string",
                        "position": 0,
                        "rules": [
                            {
                                "apply": "hidden",
                                "when": True,
                                "influence_field": value,
                                "with_value": "",
                            }
                        ],
                    },
                }
                with self.assertRaises(ProviderError):
                    fields_json(fields)

    def test_adapter_list_rejects_composite_kind_with_safe_502(self):
        for value in ([], {}, ["private-provider-value"]):
            with self.subTest(value=value):
                descriptor = adapter()
                descriptor["kind"] = value
                provider = Mock()
                provider._request.return_value = {"data": [descriptor]}
                with self.assertRaises(ApiError) as caught:
                    channel_adapters(provider, {})
                self.assertEqual(caught.exception.status, 502)
                self.assertEqual(caught.exception.code, "provider_invalid_response")
                self.assertNotIn("private-provider-value", caught.exception.message)

    def test_incident_actions_validate_before_writes_and_preserve_valid_replays(self):
        app = Flask(__name__)
        app.config["APP_ENV"] = "testing"
        register_security(app)
        # Exercise the real request validator; permissions have separate integration coverage.
        app.add_url_rule(
            "/api/incident-action",
            "incident_action",
            lambda: IncidentActionView.dispatch_request.__wrapped__("hotel", "incident"),
            methods=["POST"],
        )
        with (
            patch("pms_api.security.set_context"),
            patch("pms_api.security.db") as database,
            patch("pms_api.channels.exceptions.begin_write") as begin_write,
        ):
            for value in ([], {}, ["resolve"], True, 1, None, "unknown"):
                with self.subTest(value=value):
                    response = app.test_client().post(
                        "/api/incident-action",
                        json={"action": value},
                    )
                    self.assertEqual(response.status_code, 422, response.json)
                    self.assertEqual(response.json["error"]["code"], "invalid_incident_action")
            begin_write.assert_not_called()
            database.session.commit.assert_not_called()
            begin_write.return_value = (None, None, {"replayed": True})
            for action in ("assign", "resolve", "reopen"):
                with self.subTest(action=action):
                    response = app.test_client().post(
                        "/api/incident-action",
                        json={"action": action},
                    )
                    self.assertEqual(response.status_code, 200, response.json)
                    self.assertEqual(response.json, {"replayed": True})
            self.assertEqual(begin_write.call_count, 3)


class ChannelResponseSecurityTests(unittest.TestCase):
    def provider(self, body):
        transport = Mock()
        transport.open.return_value = Response(body)
        return client.ChannexClient("staging", "private-fixture-key", transport), transport

    def test_provider_nonfinite_numbers_are_rejected_in_any_field(self):
        for number in (b"NaN", b"Infinity", b"-Infinity", b"1e999", b"-1e999"):
            with self.subTest(number=number):
                provider, _ = self.provider(
                    b'{"data":[],"meta":{"private-fixture-field":' + number + b"}}"
                )
                with self.assertRaises(client.ProviderError) as caught:
                    provider._request("GET", "/channels")
                self.assertEqual(caught.exception.code, "provider_invalid_response")
                self.assertNotIn("private-fixture", str(caught.exception))

    def test_excessive_provider_nesting_is_a_safe_provider_error(self):
        provider, transport = self.provider(
            b'{"data":' + b"[" * 100000 + b"0" + b"]" * 100000 + b"}"
        )
        with self.assertRaises(client.ProviderError) as caught:
            provider._request("GET", "/channels")
        self.assertEqual(caught.exception.code, "provider_invalid_response")
        self.assertFalse(caught.exception.retryable)
        self.assertTrue(transport.open.return_value.closed)

    def test_finite_provider_numbers_keep_the_existing_types(self):
        provider, _ = self.provider(b'{"data":[1,1.25,1e2,-0.5]}')
        values = provider._request("GET", "/channels")["data"]
        self.assertEqual(values, [1, 1.25, 100.0, -0.5])
        self.assertIs(type(values[0]), int)
        self.assertTrue(all(type(value) is float for value in values[1:]))

    def test_malformed_status_or_truncated_body_cannot_crash_the_worker(self):
        for stage, failure in (
            ("headers", BadStatusLine("private-provider-status")),
            ("body", IncompleteRead(b"private-provider-body", 100)),
        ):
            with self.subTest(stage=stage):
                provider, transport = self.provider(b"{}")
                if stage == "headers":
                    transport.open.side_effect = failure
                else:
                    transport.open.return_value.read = Mock(side_effect=failure)
                with self.assertRaises(client.ProviderError) as caught:
                    provider._request("GET", "/channels")
                self.assertEqual(caught.exception.code, "provider_unavailable")
                self.assertTrue(caught.exception.retryable)
                self.assertNotIn("private-provider", str(caught.exception))

    def test_redirects_cannot_forward_credentials_or_reach_internal_services(self):
        class RedirectTransport(BaseHandler):
            handler_order = 100

            def https_open(self, request):
                calls.append(request.full_url)
                headers = Message()
                headers["Location"] = destination
                response = addinfourl(BytesIO(b""), headers, request.full_url, status)
                response.msg = "Redirect"
                return response

        for status in (301, 302, 303, 307, 308):
            for destination in (
                "https://attacker.example.test/steal",
                "http://169.254.169.254/latest/meta-data/",
            ):
                with self.subTest(status=status, destination=destination):
                    calls = []
                    provider = client.ChannexClient(
                        "staging",
                        "private-fixture-key",
                        build_opener(RedirectTransport(), client.NoRedirect()),
                    )
                    with self.assertRaises(client.ProviderError) as caught:
                        provider._request("GET", "/channels")
                    self.assertEqual(caught.exception.code, "provider_rejected")
                    self.assertFalse(caught.exception.retryable)
                    self.assertEqual(calls, ["https://staging.channex.io/api/v1/channels"])
                    self.assertNotIn("private-fixture", str(caught.exception))


class ChannelTimestampSecurityTests(unittest.TestCase):
    def test_overflowing_utc_revision_timestamps_cannot_crash_the_import_worker(self):
        for timestamp in ("0001-01-01T00:00:00+23:59", "9999-12-31T23:59:59-23:59"):
            with self.subTest(timestamp=timestamp):
                entity = revision()
                entity["attributes"]["inserted_at"] = timestamp
                with self.assertRaises(ApiError) as caught:
                    revision_identity(entity, PROPERTY)
                self.assertEqual(caught.exception.code, "invalid_booking_revision")

    def test_overflowing_utc_booking_timestamps_are_safe_provider_errors(self):
        for timestamp in ("0001-01-01T00:00:00+23:59", "9999-12-31T23:59:59-23:59"):
            with self.subTest(timestamp=timestamp):
                entity = revision()
                entity["attributes"]["inserted_at"] = timestamp
                with self.assertRaises(ProviderError) as caught:
                    booking_json(entity, PROPERTY)
                self.assertEqual(caught.exception.code, "provider_invalid_response")
