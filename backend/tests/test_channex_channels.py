"""Native OTA management uses actual authorization, a temporary DB and a fake provider."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Event
from unittest.mock import Mock, patch
from uuid import UUID

from cryptography.fernet import Fernet

from pms_api import create_app
from pms_api.channels.client import ProviderError
from pms_api.channels.credentials import encrypt_credentials
from pms_api.channels.models import ChannelConnection
from pms_api.core_models import AuditLog
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase
from tests.system_scope_fixture import grant_system_access, linked_property
from tests.test_channex_airbnb import airbnb_adapter
from tests.test_channex_remote import PROPERTY, RATE, catalog_entity, property_entity

GROUP, CHANNEL, MAPPING, SECOND_MAPPING = [str(UUID(int=i)) for i in range(4, 8)]
FRONTEND_ORIGIN = "https://pms.xloc.id.vn"


def adapter(code="BookingCom"):
    return {
        "code": code,
        "title": "Booking.com",
        "kind": "meta",
        "actions": [],
        "property_mapping": "single",
        "mapping_mode": "room_rate_multioccupancy",
        "params": {
            "hotel_id": {"type": "string", "position": 0, "title": "Hotel ID"},
            "password": {
                "type": "password",
                "position": 1,
                "title": "Password",
                "default": "private-default",
            },
            "machine_account": {"type": "hidden", "position": 2},
            "send_email_notifications": {"type": "boolean", "position": 3, "default": False},
            "email": {
                "type": "string",
                "position": 4,
                "rules": [
                    {
                        "apply": "hidden",
                        "when": False,
                        "influence_field": "send_email_notifications",
                        "with_value": "",
                    }
                ],
            },
        },
        "rate_params": {
            "room_type_code": {"type": "string", "position": 0},
            "rate_plan_code": {"type": "string", "position": 1},
            "occupancy": {"type": "integer", "position": 2},
            "pricing_type": {"type": "select", "position": 3, "options": ["Standard", "OBP"]},
            "primary_occ": {"type": "boolean", "position": 4},
            "readonly": {"type": "boolean", "position": 5},
        },
    }


def channel_entity():
    return {
        "id": CHANNEL,
        "type": "channel",
        "attributes": {
            "title": "Booking.com Test",
            "channel": "BookingCom",
            "currency": "USD",
            "is_active": False,
            "properties": [PROPERTY],
            "updated_at": "2026-10-13T10:00:00",
            "settings": {
                "hotel_id": "123",
                "password": "private-password",
                "machine_account": "private-machine",
                "future_option": {"do_not_drop": True},
            },
            "rate_plans": [
                {
                    "id": MAPPING,
                    "rate_plan_id": RATE,
                    "settings": {
                        "room_type_code": "456",
                        "rate_plan_code": "789",
                        "occupancy": 2,
                        "pricing_type": "Standard",
                        "primary_occ": True,
                        "readonly": False,
                        "future_setting": {"rate": "5"},
                    },
                }
            ],
        },
        "relationships": {
            "group": {"data": {"id": GROUP}},
            "properties": {"data": [{"id": PROPERTY}]},
        },
    }


class ChannexChannelTests(DomainTestCase):
    @classmethod
    def setUpClass(cls):
        with patch(
            "tests.domain_fixture.create_app",
            side_effect=lambda environ, **kwargs: create_app(
                {**environ, "CORS_ORIGINS": FRONTEND_ORIGIN}, **kwargs
            ),
        ):
            super().setUpClass()

    def setUp(self):
        super().setUp()
        grant_system_access(self)
        linked_property(self, PROPERTY)
        self.manager, self.headers = self.login("manager@test.local")
        self.provider = Mock(api_key="private-source-key", base="https://staging.channex.io/api/v1")
        prop = property_entity()
        prop["relationships"] = {
            "groups": {
                "data": [{"id": GROUP, "type": "group", "attributes": {"title": "LOHA group"}}]
            }
        }
        self.provider.property.return_value = prop
        self.provider.catalog.side_effect = lambda resource, _: [catalog_entity(resource)]
        self.channel = channel_entity()
        self.descriptor = adapter()
        self.descriptors = None
        self.provider._request.side_effect = self.provider_request
        self.readiness = []
        self.async_result = False
        config = patch.dict(
            self.app.config, {"CHANNEX_MANAGER_API_KEY_STAGING": "private-source-key"}
        )
        config.start()
        self.addCleanup(config.stop)
        factory = patch("pms_api.admin.channex_remote.ChannexClient", return_value=self.provider)
        self.factory = factory.start()
        self.addCleanup(factory.stop)

    def provider_request(self, method, path, body=None, query=None, **kwargs):
        if path == "/channels/list":
            return {
                "data": deepcopy(
                    self.descriptors if self.descriptors is not None else [self.descriptor]
                )
            }
        if path == "/channels/adapter":
            return {"data": deepcopy(self.descriptor)}
        if path == f"/channels/{CHANNEL}" and method == "GET":
            return {"data": deepcopy(self.channel)}
        if path.endswith("/check_readiness"):
            return {"data": deepcopy(self.readiness), "meta": {"message": "Success"}}
        if path == "/channels/test_connection":
            return {"data": {"success": False, "errors": "private-password"}}
        if path == "/channels/connection_details":
            return {
                "data": {
                    "type": "connection_details",
                    "attributes": {"currency": "USD", "token": "private-provider-token"},
                }
            }
        if path == "/channels/mapping_details":
            return {
                "data": {
                    "pricing_type": "Standard",
                    "password": "private-password",
                    "rooms": [
                        {
                            "id": 456,
                            "title": "Double",
                            "rates": [
                                {
                                    "id": 789,
                                    "title": "Standard",
                                    "occupancies": [2],
                                    "readonly": False,
                                    "pricing": "Standard",
                                    "token": "private-rate-token",
                                }
                            ],
                        }
                    ],
                }
            }
        if self.async_result:
            return {"async_meta": {"id": CHANNEL}, "_http_status": 202}
        if path == "/channels" or (method == "PUT" and path == f"/channels/{CHANNEL}"):
            changes = deepcopy(body["channel"])
            changes.pop("group_id", None)
            mappings = changes.get("rate_plans")
            if mappings is not None:
                for index, row in enumerate(mappings):
                    row["id"] = str(UUID(int=index + 6))
            self.channel["attributes"].update(changes)
            return {"data": deepcopy(self.channel)}
        if path.endswith("/activate") or path.endswith("/deactivate"):
            self.channel["attributes"]["is_active"] = path.endswith("/activate")
            return {"meta": {"message": "Success"}}
        if method == "DELETE":
            return {"meta": {"message": "Success"}}
        raise AssertionError((method, path))

    def remote(self, suffix, *, method="GET", body=None, client=None, headers=None):
        path = f"/api/admin/channex/properties/{PROPERTY}" + suffix
        if method == "GET":
            path += "?accountId=system:staging"
        elif body is not None:
            body = {"accountId": "system:staging", **body}
        return self.request(
            method,
            path,
            body,
            client=client or self.manager,
            headers=self.headers if headers is None else headers,
        )

    def detail(self):
        response = self.remote(f"/channels/{CHANNEL}")
        self.assertEqual(response.status_code, 200, response.json)
        return response.json["channel"]

    def hotel_source(self):
        config = patch.dict(
            self.app.config,
            {"CHANNEX_ENCRYPTION_KEY": Fernet.generate_key().decode("ascii")},
        )
        config.start()
        self.addCleanup(config.stop)
        api_key = "private-encrypted-hotel-source-key"
        webhook_secret = "private-hotel-webhook-secret-long-enough"
        with self.app.app_context():
            set_context("manager", is_system=True, is_service=True)
            encrypted = encrypt_credentials(
                self.tenant_id, "staging", PROPERTY, api_key, webhook_secret
            )
            row = db.session.query(ChannelConnection).filter_by(tenant_id=self.tenant_id).one()
            row.credential_ref = "unused-environment-reference"
            row.webhook_secret_ref = "unused-webhook-reference"
            row.secrets_ciphertext = encrypted
            row.active = True
            db.session.commit()
        path = (
            f"/api/admin/channex/properties/{PROPERTY}/channel-adapters"
            f"?accountId=hotel%3A{self.tenant_id}"
        )
        return path, (api_key, webhook_secret, encrypted)

    def assert_cors_json(self, response, status, secrets):
        self.assertEqual(response.status_code, status, response.get_data(as_text=True))
        self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), FRONTEND_ORIGIN)
        self.assertEqual(response.headers.get("Access-Control-Allow-Credentials"), "true")
        self.assertTrue(response.is_json)
        for secret in (*secrets, "private-default", "private-provider-body"):
            self.assertNotIn(secret, response.get_data(as_text=True))

    def test_encrypted_hotel_adapters_return_credentialed_frontend_cors(self):
        path, secrets = self.hotel_source()
        response = self.manager.get(path, headers={"Origin": FRONTEND_ORIGIN})
        self.assert_cors_json(response, 200, secrets)
        self.assertEqual(response.json["adapters"][0]["code"], "BookingCom")
        self.assertEqual(response.json["groups"], [{"id": GROUP, "name": "LOHA group"}])
        self.assertEqual(response.json["rateOptions"][0]["id"], RATE)
        self.factory.assert_called_with("staging", secrets[0])
        self.assertNotIn("machine_account", str(response.json))

    def test_hotel_adapter_provider_failures_keep_cors_and_sanitized_json(self):
        path, secrets = self.hotel_source()
        for code, retryable, status in (
            ("provider_rejected", False, 502),
            ("provider_unavailable", True, 503),
        ):
            with self.subTest(code=code):
                self.provider._request.side_effect = ProviderError(code, retryable)
                response = self.manager.get(path, headers={"Origin": FRONTEND_ORIGIN})
                self.assert_cors_json(response, status, secrets)
                self.assertEqual(response.json["error"]["code"], code)

    def test_hotel_adapter_unauthenticated_request_keeps_cors_without_provider_read(self):
        path, secrets = self.hotel_source()
        self.factory.reset_mock()
        self.provider.reset_mock()
        response = self.app.test_client().get(path, headers={"Origin": FRONTEND_ORIGIN})
        self.assert_cors_json(response, 401, secrets)
        self.assertEqual(response.json["error"]["code"], "unauthenticated")
        self.factory.assert_not_called()
        self.provider.property.assert_not_called()
        self.provider._request.assert_not_called()

    def test_hotel_adapter_untrusted_origin_cannot_read_credentialed_json(self):
        path, secrets = self.hotel_source()
        response = self.manager.get(path, headers={"Origin": "https://untrusted.example"})
        self.assertEqual(response.status_code, 200, response.json)
        self.assertNotIn("Access-Control-Allow-Origin", response.headers)
        self.assertNotIn("Access-Control-Allow-Credentials", response.headers)
        for secret in secrets:
            self.assertNotIn(secret, response.get_data(as_text=True))

    def test_adapter_catalog_includes_popular_meta_channels_and_airbnb(self):
        self.descriptors = []
        for code, title in (
            ("BookingCom", "Booking.com"),
            ("Agoda", "Agoda"),
            ("Expedia", "Expedia"),
        ):
            descriptor = adapter(code)
            descriptor["title"] = title
            self.descriptors.append(descriptor)
        self.descriptors.append(airbnb_adapter())
        response = self.remote("/channel-adapters")
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(
            [(row["code"], row["kind"], row["oauth"]) for row in response.json["adapters"]],
            [
                ("BookingCom", "meta", False),
                ("Agoda", "meta", False),
                ("Expedia", "meta", False),
                ("AirBNB", "ota", True),
            ],
        )
        self.assertEqual(response.json["unavailableAdapters"], [])
        self.assertNotIn("private", str(response.json))
        self.assertEqual(self.writes(), [])

    def test_adapter_catalog_isolates_unsupported_channels_and_skips_cm_fields(self):
        future = adapter("FutureOTA")
        future["title"] = "Future OTA"
        future["kind"] = "ota"
        future["params"]["hotel_id"]["type"] = "future-control"
        future["params"]["hotel_id"]["default"] = "private-future-default"
        meta = adapter("HotelMetasearch")
        meta.update(kind="meta", params="private-malformed-meta-fields")
        cm = adapter("OtherChannelManager")
        cm.update(kind="cm", rate_params="private-malformed-cm-fields")
        self.descriptors = [self.descriptor, future, meta, cm]
        response = self.remote("/channel-adapters")
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual([row["code"] for row in response.json["adapters"]], ["BookingCom"])
        self.assertEqual(
            response.json["unavailableAdapters"],
            [
                {"code": "FutureOTA", "name": "Future OTA"},
                {"code": "HotelMetasearch", "name": "Booking.com"},
            ],
        )
        self.assertEqual(response.json["rateOptions"][0]["id"], RATE)
        self.assertNotIn("private", str(response.json))
        self.assertNotIn("future-control", str(response.json))
        self.assertEqual(self.writes(), [])

    def test_all_unsupported_ota_remain_explicitly_unavailable(self):
        unsupported = adapter("FutureOTA")
        unsupported["title"] = "Future OTA"
        unsupported["rate_params"]["occupancy"]["type"] = "future-control"
        self.descriptors = [unsupported]
        response = self.remote("/channel-adapters")
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json["adapters"], [])
        self.assertEqual(
            response.json["unavailableAdapters"], [{"code": "FutureOTA", "name": "Future OTA"}]
        )
        self.assertEqual(self.writes(), [])

    def test_adapter_catalog_duplicate_or_malformed_public_identity_still_fails_closed(self):
        duplicate = adapter()
        duplicate.update(kind="meta", params="skipped-private-fields")
        for descriptors in (
            [self.descriptor, duplicate],
            [{**self.descriptor, "code": "../invalid"}],
            [{**self.descriptor, "title": ""}],
            [{**self.descriptor, "kind": "unknown-kind"}],
        ):
            with self.subTest(descriptors=descriptors):
                self.descriptors = descriptors
                response = self.remote("/channel-adapters")
                self.assertEqual(response.status_code, 502, response.json)
                self.assertEqual(response.json["error"]["code"], "provider_invalid_response")
                self.assertNotIn("private", str(response.json))
                self.assertEqual(self.writes(), [])

    def test_selected_unsupported_ota_descriptor_probe_and_create_never_write(self):
        self.descriptor = adapter("FutureOTA")
        self.descriptor["params"]["hotel_id"]["type"] = "future-control"
        response = self.remote("/channel-adapters/FutureOTA")
        self.assertEqual(response.status_code, 502, response.json)
        self.assertEqual(response.json["error"]["code"], "provider_invalid_response")
        for suffix, body in (
            (
                "/channel-probe/test_connection",
                {"code": "FutureOTA", "settings": {"hotel_id": "123"}},
            ),
            ("/channels", {**self.create_body(), "code": "FutureOTA"}),
        ):
            with self.subTest(suffix=suffix):
                response = self.remote(suffix, method="POST", body=body)
                self.assertEqual(response.status_code, 502, response.json)
                self.assertEqual(response.json["error"]["code"], "provider_invalid_response")
                self.assertNotIn("private", str(response.json))
                self.assertEqual(self.writes(), [])
        self.assertFalse(
            any(
                call.args[1].endswith("test_connection")
                for call in self.provider._request.call_args_list
            )
        )

    def create_body(self):
        return {
            "code": "BookingCom",
            "name": "New OTA",
            "groupId": GROUP,
            "settings": {"hotel_id": "123", "password": "new-private-password"},
            "mappings": [],
        }

    def writes(self):
        return [
            call
            for call in self.provider._request.call_args_list
            if call.args[0] in {"PUT", "DELETE"}
            or (
                call.args[0] == "POST"
                and not call.args[1].endswith(
                    ("test_connection", "connection_details", "mapping_details", "check_readiness")
                )
            )
        ]

    def test_adapter_and_detail_expose_only_public_fields_and_secret_presence(self):
        response = self.remote("/channel-adapters")
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json["groups"], [{"id": GROUP, "name": "LOHA group"}])
        self.assertEqual(response.json["rateOptions"][0]["occupancy"], 2)
        self.assertNotIn("private", str(response.json))
        self.assertNotIn("machine_account", str(response.json))
        detail = self.detail()
        self.assertEqual(detail["settings"], {"hotel_id": "123"})
        self.assertEqual(detail["secrets"], ["password"])
        self.assertEqual(len(detail["revision"]), 64)
        self.assertNotIn("private", str(detail))
        self.assertNotIn("future_setting", str(detail))
        self.assertEqual(detail["mappings"][0]["id"], MAPPING)

    def test_create_is_inactive_scoped_and_audits_no_secrets(self):
        response = self.remote("/channels", method="POST", body=self.create_body())
        self.assertEqual(response.status_code, 201, response.json)
        self.assertFalse(response.json["channel"]["active"])
        call = self.writes()[0]
        self.assertEqual(call.args[:2], ("POST", "/channels"))
        values = call.args[2]["channel"]
        self.assertEqual(values["properties"], [PROPERTY])
        self.assertEqual(values["group_id"], GROUP)
        self.assertNotIn("is_active", values)
        self.assertNotIn("machine_account", values["settings"])
        self.assertEqual(values["settings"]["email"], "")
        self.assertNotIn("new-private", str(response.json))
        with self.app.app_context():
            set_context("manager", is_system=True, is_service=True)
            log = db.session.query(AuditLog).filter_by(event="channex.channel.created").one()
            self.assertEqual(log.details, {"propertyId": PROPERTY, "environment": "staging"})

    def test_update_preserves_unmentioned_settings_and_mapping_rows(self):
        second = deepcopy(self.channel["attributes"]["rate_plans"][0])
        second.update(id=SECOND_MAPPING)
        second["settings"]["occupancy"] = 1
        self.channel["attributes"]["rate_plans"].append(second)
        revision = self.detail()["revision"]
        response = self.remote(
            f"/channels/{CHANNEL}",
            method="PATCH",
            body={
                "revision": revision,
                "settings": {"hotel_id": "123", "password": ""},
                "mappings": [{"id": MAPPING, "ratePlanId": RATE, "settings": {"occupancy": 3}}],
            },
        )
        self.assertEqual(response.status_code, 200, response.json)
        values = self.writes()[0].args[2]["channel"]
        self.assertEqual(values["settings"]["password"], "private-password")
        self.assertEqual(values["settings"]["future_option"], {"do_not_drop": True})
        self.assertEqual(values["settings"]["machine_account"], "private-machine")
        self.assertEqual(len(values["rate_plans"]), 2)
        self.assertEqual(values["rate_plans"][1]["settings"]["occupancy"], 1)
        self.assertEqual(values["rate_plans"][0]["settings"]["future_setting"], {"rate": "5"})
        self.assertEqual(values["rate_plans"][0]["settings"]["occupancy"], 3)
        self.assertNotIn("private-password", str(response.json))

    def test_public_connection_identity_change_requires_unmapping_but_secret_rotation_does_not(
        self,
    ):
        revision = self.detail()["revision"]
        response = self.remote(
            f"/channels/{CHANNEL}",
            method="PATCH",
            body={"revision": revision, "settings": {"hotel_id": "999"}},
        )
        self.assertEqual(response.status_code, 409, response.json)
        self.assertEqual(response.json["error"]["code"], "channel_settings_mapped")
        self.assertEqual(self.writes(), [])
        response = self.remote(
            f"/channels/{CHANNEL}",
            method="PATCH",
            body={"revision": revision, "settings": {"password": "rotated-private-password"}},
        )
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(len(self.channel["attributes"]["rate_plans"]), 1)
        self.assertEqual(self.channel["attributes"]["settings"]["hotel_id"], "123")
        self.assertNotIn("rotated-private-password", str(response.json))
        response = self.remote(
            f"/channels/{CHANNEL}",
            method="PATCH",
            body={
                "revision": response.json["channel"]["revision"],
                "settings": {"hotel_id": "999"},
                "mappings": [{"id": MAPPING, "ratePlanId": RATE, "settings": None}],
            },
        )
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(self.channel["attributes"]["settings"]["hotel_id"], "999")
        self.assertEqual(self.channel["attributes"]["rate_plans"], [])

    def test_two_loha_writers_serialize_and_second_stale_edit_is_rejected(self):
        revision = self.detail()["revision"]
        other, other_headers = self.login("manager@test.local")
        started, release, second_read = Event(), Event(), Event()
        normal = self.provider_request

        def transport(method, path, *args, **kwargs):
            if path == f"/channels/{CHANNEL}":
                if method == "GET" and started.is_set():
                    second_read.set()
                elif method == "PUT":
                    started.set()
                    if not release.wait(5):
                        raise AssertionError("Timed out releasing first writer")
            return normal(method, path, *args, **kwargs)

        self.provider._request.side_effect = transport
        with ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(
                self.remote,
                f"/channels/{CHANNEL}",
                method="PATCH",
                body={"revision": revision, "name": "First writer"},
            )
            self.assertTrue(started.wait(3))
            second = executor.submit(
                self.remote,
                f"/channels/{CHANNEL}",
                method="PATCH",
                body={"revision": revision, "name": "Second writer"},
                client=other,
                headers=other_headers,
            )
            try:
                self.assertFalse(
                    second_read.wait(0.2),
                    "The second writer read while the first held its channel lock",
                )
            finally:
                release.set()
            self.assertEqual(first.result(timeout=5).status_code, 200)
            response = second.result(timeout=5)
            self.assertEqual(response.status_code, 409, response.json)
            self.assertEqual(response.json["error"]["code"], "channel_changed")
        self.assertEqual(self.channel["attributes"]["title"], "First writer")
        self.assertEqual(len(self.writes()), 1)

    def test_explicit_remove_uses_full_remaining_set_and_omission_does_not_remove(self):
        revision = self.detail()["revision"]
        response = self.remote(
            f"/channels/{CHANNEL}",
            method="PATCH",
            body={
                "revision": revision,
                "mappings": [{"id": MAPPING, "ratePlanId": RATE, "settings": None}],
            },
        )
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(self.writes()[0].args[2]["channel"]["rate_plans"], [])

    def test_stale_active_and_multi_property_changes_fail_before_provider_writes(self):
        revision = self.detail()["revision"]
        self.channel["attributes"]["settings"]["hotel_id"] = "external-change"
        response = self.remote(
            f"/channels/{CHANNEL}", method="PATCH", body={"revision": revision, "name": "Stale"}
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json["error"]["code"], "channel_changed")
        self.channel["attributes"]["is_active"] = True
        response = self.remote(
            f"/channels/{CHANNEL}",
            method="PATCH",
            body={"revision": self.detail()["revision"], "settings": {"hotel_id": "456"}},
        )
        self.assertEqual(response.status_code, 409)
        other = str(UUID(int=20))
        revision = self.detail()["revision"]
        self.channel["attributes"]["properties"].append(other)
        self.channel["relationships"]["properties"]["data"].append({"id": other})
        response = self.remote(f"/channels/{CHANNEL}")
        self.assertEqual(response.status_code, 409, response.json)
        self.assertEqual(response.json["error"]["code"], "channel_multiple_properties")
        self.assertNotIn("private-password", str(response.json))
        response = self.remote(
            f"/channels/{CHANNEL}",
            method="PATCH",
            body={"revision": revision, "name": "Multi hotel"},
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.writes(), [])

    def test_external_edit_during_catalog_load_is_not_overwritten(self):
        revision = self.detail()["revision"]
        normal = self.provider.catalog.side_effect

        def changed_catalog(resource, property_id):
            result = normal(resource, property_id)
            self.channel["attributes"]["settings"]["password"] = "externally-rotated-password"
            return result

        self.provider.catalog.side_effect = changed_catalog
        response = self.remote(
            f"/channels/{CHANNEL}",
            method="PATCH",
            body={
                "revision": revision,
                "settings": {"password": ""},
                "mappings": [{"id": MAPPING, "ratePlanId": RATE, "settings": {"occupancy": 3}}],
            },
        )
        self.assertEqual(response.status_code, 409, response.json)
        self.assertEqual(response.json["error"]["code"], "channel_changed")
        self.assertEqual(self.writes(), [])
        self.assertEqual(
            self.channel["attributes"]["settings"]["password"], "externally-rotated-password"
        )

    def test_external_edit_during_readiness_blocks_activation(self):
        revision = self.detail()["revision"]
        normal = self.provider_request

        def changed_readiness(method, path, *args, **kwargs):
            result = normal(method, path, *args, **kwargs)
            if path.endswith("/check_readiness"):
                self.channel["attributes"]["rate_plans"] = []
            return result

        self.provider._request.side_effect = changed_readiness
        response = self.remote(
            f"/channels/{CHANNEL}/activate",
            method="POST",
            body={"revision": revision, "confirm": True},
        )
        self.assertEqual(response.status_code, 409, response.json)
        self.assertEqual(response.json["error"]["code"], "channel_changed")
        self.assertFalse(self.channel["attributes"]["is_active"])
        self.assertFalse(
            any(
                call.args[1].endswith("/activate") for call in self.provider._request.call_args_list
            )
        )

    def test_unsafe_field_and_foreign_property_rate_or_group_never_write(self):
        for changes in (
            {"settings": {"machine_account": "forged"}},
            {"groupId": str(UUID(int=999))},
            {"mappings": [{"ratePlanId": str(UUID(int=999)), "settings": {}}]},
            {"settings": {"hotel_id": {"url": "https://evil.test"}}},
            {"is_active": True},
        ):
            with self.subTest(changes=changes):
                response = self.remote(
                    "/channels", method="POST", body={**self.create_body(), **changes}
                )
                self.assertEqual(response.status_code, 422, response.json)
        self.assertEqual(self.writes(), [])

    def test_probes_preserve_private_values_server_side_and_allowlist_output(self):
        revision = self.detail()["revision"]
        for action in ("test_connection", "connection_details", "mapping_details"):
            response = self.remote(
                "/channel-probe/" + action,
                method="POST",
                body={
                    "code": "BookingCom",
                    "channelId": CHANNEL,
                    "revision": revision,
                    "settings": {"hotel_id": "123"},
                },
            )
            self.assertEqual(response.status_code, 200, response.json)
            self.assertNotIn("private", str(response.json))
            self.assertEqual(
                self.provider._request.call_args.args[2]["settings"]["password"], "private-password"
            )
        self.assertEqual(response.json["rooms"][0]["rates"][0]["id"], "789")
        self.assertFalse(
            self.remote(
                "/channel-probe/test_connection",
                method="POST",
                body={"code": "BookingCom", "settings": {"hotel_id": "123"}},
            ).json["success"]
        )

    def test_readiness_blocks_activation_and_lifecycle_requires_confirmation(self):
        revision = self.detail()["revision"]
        self.readiness = [{"id": CHANNEL, "error_code": "private-provider-secret"}]
        response = self.remote(
            f"/channels/{CHANNEL}/readiness", method="POST", body={"revision": revision}
        )
        self.assertEqual(response.status_code, 200, response.json)
        self.assertFalse(response.json["ready"])
        self.assertNotIn("private", str(response.json))
        response = self.remote(
            f"/channels/{CHANNEL}/activate",
            method="POST",
            body={"revision": revision, "confirm": True},
        )
        self.assertEqual(response.status_code, 409, response.json)
        self.assertEqual(self.writes(), [])
        self.readiness = []
        self.assertEqual(
            self.remote(
                f"/channels/{CHANNEL}/activate", method="POST", body={"revision": revision}
            ).status_code,
            422,
        )
        response = self.remote(
            f"/channels/{CHANNEL}/activate",
            method="POST",
            body={"revision": revision, "confirm": True},
        )
        self.assertEqual(response.status_code, 200, response.json)
        self.assertTrue(response.json["channel"]["active"])
        response = self.remote(
            f"/channels/{CHANNEL}",
            method="DELETE",
            body={"revision": response.json["channel"]["revision"], "confirm": True},
        )
        self.assertEqual(response.status_code, 409, response.json)
        response = self.remote(
            f"/channels/{CHANNEL}/deactivate",
            method="POST",
            body={"revision": self.detail()["revision"], "confirm": True},
        )
        self.assertEqual(response.status_code, 200, response.json)
        self.assertFalse(response.json["channel"]["active"])
        response = self.remote(
            f"/channels/{CHANNEL}",
            method="DELETE",
            body={"revision": self.detail()["revision"], "confirm": True},
        )
        self.assertEqual(response.status_code, 200, response.json)
        self.assertTrue(response.json["deleted"])

    def test_system_roles_csrf_and_provider_failure(self):
        grant_system_access(self, "admin")
        for user, expected in (
            ("admin@test.local", 201),
            ("owner-a@test.local", 403),
            ("frontdesk@test.local", 403),
        ):
            client, headers = self.login(user)
            response = self.remote(
                "/channels", method="POST", body=self.create_body(), client=client, headers=headers
            )
            self.assertEqual(response.status_code, expected, response.json)
        self.assertEqual(
            self.remote(
                "/channels", method="POST", body=self.create_body(), headers={}
            ).status_code,
            403,
        )
        self.provider._request.side_effect = ProviderError("provider_unavailable", True)
        response = self.remote("/channels", method="POST", body=self.create_body())
        self.assertEqual(response.status_code, 503, response.json)
        self.assertNotIn("private", str(response.json))

    def test_async_mutations_are_pending_and_do_not_claim_success(self):
        self.async_result = True
        response = self.remote("/channels", method="POST", body=self.create_body())
        self.assertEqual(response.status_code, 202, response.json)
        self.assertTrue(response.json["pending"])
        self.assertNotIn("channel", response.json)

    def test_airbnb_uses_owner_oauth_and_dedicated_mapping_flow(self):
        self.descriptor = adapter("AirBNB")
        response = self.remote(
            "/channels", method="POST", body={**self.create_body(), "code": "AirBNB"}
        )
        self.assertEqual(response.status_code, 409, response.json)
        self.channel["attributes"]["channel"] = "AirBNB"
        response = self.remote(
            f"/channels/{CHANNEL}",
            method="PATCH",
            body={"revision": self.detail()["revision"], "mappings": []},
        )
        self.assertEqual(response.status_code, 409, response.json)
        response = self.remote(
            f"/channels/{CHANNEL}/deactivate",
            method="POST",
            body={"revision": self.detail()["revision"], "confirm": True},
        )
        self.assertEqual(response.status_code, 409, response.json)
        self.assertEqual(self.writes(), [])
