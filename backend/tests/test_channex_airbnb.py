"""Airbnb OAuth context and native listing mutations use mocked providers only."""

import time
from copy import deepcopy
from unittest.mock import Mock, patch
from uuid import UUID

from pms_api.admin.channex_channels import revision
from pms_api.channels.client import ProviderError
from pms_api.core_models import AuditLog
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase
from tests.system_scope_fixture import grant_system_access, linked_property
from tests.test_channex_remote import PROPERTY, RATE, catalog_entity, property_entity

GROUP, CHANNEL, MAPPING = [str(UUID(int=value)) for value in (7, 8, 9)]
ORIGIN = "http://127.0.0.1:5173"
LISTING = "123456789012345"


def remote_channel():
    return {
        "type": "channel",
        "id": CHANNEL,
        "attributes": {
            "title": "Airbnb LOHA",
            "channel": "AirBNB",
            "currency": "USD",
            "is_active": False,
            "settings": {"access_token": "provider-oauth-secret"},
            "properties": [PROPERTY],
            "rate_plans": [],
            "updated_at": "2026-10-13T00:00:00",
        },
        "relationships": {
            "group": {"data": {"id": GROUP, "type": "group"}},
            "properties": {"data": [{"id": PROPERTY, "type": "property"}]},
        },
    }


def airbnb_adapter():
    return {
        "code": "AirBNB",
        "title": "Airbnb",
        "kind": "ota",
        "property_mapping": "multiple",
        "mapping_mode": "listing",
        "params": {"access_token": {"type": "password", "position": 0}},
        "rate_params": {},
    }


class AirbnbTests(DomainTestCase):
    def setUp(self):
        super().setUp()
        grant_system_access(self)
        linked_property(self, PROPERTY)
        self.manager, self.manager_headers = self.login("manager@test.local")
        self.manager_headers["Origin"] = ORIGIN
        self.provider = Mock(
            api_key="fixture-manager-secret", base="https://staging.channex.io/api/v1"
        )
        self.prop = property_entity()
        self.prop["relationships"] = {
            "groups": {"data": [{"id": GROUP, "type": "group", "attributes": {"title": "LOHA"}}]}
        }
        self.provider.property.side_effect = lambda _: deepcopy(self.prop)
        self.provider.catalog_entity.side_effect = lambda resource, _: catalog_entity(resource)
        self.channel = remote_channel()
        self.calls = []
        self.mapping_pending = False
        self.provider._request.side_effect = self.transport
        provider = patch("pms_api.admin.channex_remote.ChannexClient", return_value=self.provider)
        config = patch.dict(
            self.app.config, {"CHANNEX_MANAGER_API_KEY_STAGING": "fixture-manager-secret"}
        )
        provider.start()
        config.start()
        self.addCleanup(provider.stop)
        self.addCleanup(config.stop)

    def transport(self, method, path, body=None, query=None, **kwargs):
        self.calls.append((method, path, deepcopy(body), query, kwargs))
        if method == "GET" and path.startswith("/channels/") and path.endswith("/action/listings"):
            return {
                "data": {
                    "listing_id_dictionary": {
                        "values": [
                            {
                                "id": LISTING,
                                "title": "LOHA apartment",
                                "occupancies": [1, 2],
                                "email": "private-owner@example.local",
                                "access_token": "provider-oauth-secret",
                            }
                        ]
                    }
                }
            }
        if method == "GET" and path.startswith("/channels/adapter"):
            return {"data": airbnb_adapter()}
        if method == "GET" and path.startswith("/channels/"):
            return {"data": deepcopy(self.channel)}
        if method == "POST" and path == "/meta/airbnb/connection_link":
            return {
                "data": {
                    "type": "connection_link",
                    "attributes": {"url": "https://www.airbnb.com/oauth2/auth?client_id=fixture"},
                }
            }
        if method == "POST" and path.endswith("/mappings"):
            if self.mapping_pending:
                return {"_http_status": 202, "meta": {"message": "Accepted"}}
            self.channel["attributes"]["rate_plans"].append(
                {
                    "id": MAPPING,
                    "rate_plan_id": RATE,
                    "settings": {"listing_id": LISTING, "access_token": "mapping-secret"},
                }
            )
            return {
                "_http_status": 200,
                "data": {
                    "type": "channel_rate_plan",
                    "id": MAPPING,
                    "attributes": {
                        "id": MAPPING,
                        "settings": {"listing_id": LISTING, "access_token": "mapping-secret"},
                    },
                    "relationships": {"channel": {"data": {"id": CHANNEL, "type": "channel"}}},
                },
            }
        if method == "DELETE" and path.endswith("/mappings/" + MAPPING):
            self.channel["attributes"]["rate_plans"] = []
            return {"_http_status": 204, "meta": {"message": "Success"}}
        raise AssertionError((method, path))

    def path(self, suffix):
        return f"/api/admin/channex/properties/{PROPERTY}" + suffix

    def call(self, suffix, body=None, *, method="POST", client=None, headers=None):
        path = self.path(suffix)
        if method == "GET":
            path += "?accountId=system:staging"
        return self.request(
            method,
            path,
            body,
            client=client or self.manager,
            headers=self.manager_headers if headers is None else headers,
        )

    def link(self, **extra):
        body = {
            "accountId": "system:staging",
            "name": "Airbnb LOHA",
            "returnOrigin": ORIGIN,
            "groupId": GROUP,
            **extra,
        }
        response = self.call("/airbnb/connection-link", body)
        self.assertEqual(response.status_code, 200, response.json)
        return next(
            call[2]["connection_link"]
            for call in reversed(self.calls)
            if call[1] == "/meta/airbnb/connection_link"
        )

    def confirm(self, token, *, channel_id=CHANNEL, client=None, headers=None):
        return self.request(
            "POST",
            "/api/admin/channex/airbnb/confirm",
            {"channelId": channel_id, "token": token},
            client=client or self.manager,
            headers=self.manager_headers if headers is None else headers,
        )

    def mapping_body(self, **changes):
        return {
            "accountId": "system:staging",
            "revision": revision(self.provider, self.channel),
            "listingId": LISTING,
            "ratePlanId": RATE,
            **changes,
        }

    def test_owner_link_binds_group_property_session_without_exposing_secrets(self):
        values = self.link()
        self.assertEqual(values["group_id"], GROUP)
        self.assertEqual(values["properties"], [PROPERTY])
        self.assertEqual(values["redirect_uri"], ORIGIN + "/manager/channex")
        response = self.confirm(values["token"])
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json["property"]["id"], PROPERTY)
        self.assertEqual(response.json["accountId"], "system:staging")
        self.assertEqual(response.json["channel"]["secrets"], ["access_token"])
        self.assertNotIn("provider-oauth-secret", response.get_data(as_text=True))
        self.assertNotIn("fixture-manager-secret", response.get_data(as_text=True))
        self.assertFalse(any(call[1].endswith("/activate") for call in self.calls))

    def test_state_rejects_changed_session_actor_tampering_expiry_and_environment(self):
        token = self.link()["token"]
        admin, admin_headers = self.login("admin@test.local")
        admin_headers["Origin"] = ORIGIN
        self.assertEqual(self.confirm(token, client=admin, headers=admin_headers).status_code, 422)
        newer_manager, newer_headers = self.login("manager@test.local")
        newer_headers["Origin"] = ORIGIN
        self.assertEqual(
            self.confirm(token, client=newer_manager, headers=newer_headers).status_code, 422
        )
        self.assertEqual(self.confirm(token + "x").status_code, 422)
        with patch(
            "itsdangerous.timed.TimestampSigner.get_timestamp", return_value=int(time.time()) + 7201
        ):
            self.assertEqual(self.confirm(token).status_code, 422)
        with patch(
            "pms_api.admin.channex_airbnb.account_client",
            return_value=("production", self.provider),
        ):
            self.assertEqual(self.confirm(token).status_code, 409)

    def test_origin_group_and_oauth_url_are_allowlisted(self):
        body = {
            "accountId": "system:staging",
            "name": "LOHA",
            "returnOrigin": "https://attacker.example",
            "groupId": GROUP,
        }
        response = self.call("/airbnb/connection-link", body)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.calls, [])
        body["returnOrigin"] = ORIGIN
        body["groupId"] = str(UUID(int=999))
        self.assertEqual(self.call("/airbnb/connection-link", body).status_code, 422)
        self.assertFalse(any(call[0] == "POST" for call in self.calls))
        body["groupId"] = GROUP
        original = self.provider._request.side_effect

        def foreign_url(method, path, *args, **kwargs):
            if path == "/meta/airbnb/connection_link":
                return {
                    "data": {
                        "type": "connection_link",
                        "attributes": {"url": "https://www.airbnb.com@attacker.example/oauth"},
                    }
                }
            return original(method, path, *args, **kwargs)

        self.provider._request.side_effect = foreign_url
        response = self.call("/airbnb/connection-link", body)
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("attacker", response.get_data(as_text=True))

    def test_reconnect_uses_verified_existing_group_and_rejects_other_channel_callback(self):
        values = self.link(channelId=CHANNEL)
        self.assertEqual(values["channel_id"], CHANNEL)
        self.assertEqual(
            self.confirm(values["token"], channel_id=str(UUID(int=888))).status_code, 422
        )
        response = self.call(
            "/airbnb/connection-link",
            {
                "accountId": "system:staging",
                "name": "LOHA",
                "returnOrigin": ORIGIN,
                "channelId": CHANNEL,
            },
        )
        self.assertEqual(response.status_code, 200, response.json)

    def test_channel_property_adapter_and_multi_property_guards(self):
        token = self.link()["token"]
        for mode in ("foreign", "adapter", "multiple"):
            with self.subTest(mode=mode):
                self.channel = remote_channel()
                if mode == "foreign":
                    self.channel["attributes"]["properties"] = [str(UUID(int=55))]
                    self.channel["relationships"]["properties"]["data"] = [
                        {"id": str(UUID(int=55))}
                    ]
                elif mode == "adapter":
                    self.channel["attributes"]["channel"] = "BookingCom"
                else:
                    self.channel["attributes"]["properties"].append(str(UUID(int=55)))
                    self.channel["relationships"]["properties"]["data"].append(
                        {"id": str(UUID(int=55))}
                    )
                self.assertGreaterEqual(self.confirm(token).status_code, 400)
                response = self.call(f"/channels/{CHANNEL}/airbnb/mappings", self.mapping_body())
                self.assertGreaterEqual(response.status_code, 400)
        self.assertFalse(
            any(call[1].endswith("/mappings") and call[0] == "POST" for call in self.calls)
        )

    def test_listing_read_and_mapping_create_retain_only_public_listing_data(self):
        response = self.call(f"/channels/{CHANNEL}/airbnb/listings", method="GET")
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(
            response.json, {"listings": [{"id": LISTING, "name": "LOHA apartment", "capacity": 2}]}
        )
        response = self.call(f"/channels/{CHANNEL}/airbnb/mappings", self.mapping_body())
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json["status"], "completed")
        self.assertEqual(
            response.json["channel"]["mappings"][0]["settings"], {"listing_id": LISTING}
        )
        self.assertNotIn("mapping-secret", response.get_data(as_text=True))
        write = next(
            call for call in self.calls if call[0] == "POST" and call[1].endswith("/mappings")
        )
        self.assertEqual(
            write[2], {"mapping": {"rate_plan_id": RATE, "settings": {"listing_id": LISTING}}}
        )
        self.assertEqual(write[4]["timeout"], 45)
        self.assertTrue(write[4]["allow_async"])
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            audit = (
                db.session.query(AuditLog).filter_by(event="channex.airbnb.mapping.created").one()
            )
            self.assertNotIn("secret", str(audit.details))

    def test_create_blocks_active_stale_unknown_listing_and_wrong_rate_property(self):
        body = self.mapping_body(revision="0" * 64)
        self.assertEqual(self.call(f"/channels/{CHANNEL}/airbnb/mappings", body).status_code, 409)
        self.channel["attributes"]["is_active"] = True
        self.assertEqual(
            self.call(f"/channels/{CHANNEL}/airbnb/mappings", self.mapping_body()).status_code, 409
        )
        self.channel["attributes"]["is_active"] = False
        self.assertEqual(
            self.call(
                f"/channels/{CHANNEL}/airbnb/mappings", self.mapping_body(listingId="missing")
            ).status_code,
            422,
        )
        original = self.provider.catalog_entity.side_effect

        def wrong_property(resource, identifier):
            entity = original(resource, identifier)
            entity["relationships"]["property"]["data"]["id"] = str(UUID(int=555))
            return entity

        self.provider.catalog_entity.side_effect = wrong_property
        self.assertEqual(
            self.call(f"/channels/{CHANNEL}/airbnb/mappings", self.mapping_body()).status_code, 502
        )
        self.assertFalse(
            any(call[1].endswith("/mappings") and call[0] == "POST" for call in self.calls)
        )

    def test_async_create_reports_pending_and_active_unmap_requires_explicit_confirmation(self):
        self.mapping_pending = True
        response = self.call(f"/channels/{CHANNEL}/airbnb/mappings", self.mapping_body())
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json["status"], "pending")
        self.assertEqual(response.json["channel"]["mappings"], [])
        self.channel["attributes"]["is_active"] = True
        self.channel["attributes"]["rate_plans"] = [
            {"id": MAPPING, "rate_plan_id": RATE, "settings": {"listing_id": LISTING}}
        ]
        body = {
            "accountId": "system:staging",
            "revision": revision(self.provider, self.channel),
            "confirm": False,
        }
        path = f"/channels/{CHANNEL}/airbnb/mappings/{MAPPING}"
        self.assertEqual(self.call(path, body, method="DELETE").status_code, 422)
        body["confirm"] = True
        response = self.call(path, body, method="DELETE")
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json["channel"]["mappings"], [])
        self.assertTrue(response.json["channel"]["active"])
        self.assertFalse(any(call[1].endswith("/deactivate") for call in self.calls))

    def test_roles_csrf_and_provider_errors_do_not_expose_owner_data(self):
        body = {
            "accountId": "system:staging",
            "name": "LOHA",
            "returnOrigin": ORIGIN,
            "groupId": GROUP,
        }
        self.assertEqual(
            self.call(
                "/airbnb/connection-link", body, client=self.client, headers=self.headers
            ).status_code,
            403,
        )
        self.assertEqual(
            self.call("/airbnb/connection-link", body, headers={"Origin": ORIGIN}).status_code, 403
        )
        self.provider._request.side_effect = ProviderError(
            "private-provider-oauth-secret", retryable=True
        )
        response = self.call(f"/channels/{CHANNEL}/airbnb/listings", method="GET")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("private-provider", response.get_data(as_text=True))

    def test_malformed_mapping_response_is_safe_and_requires_reload_after_uncertain_write(self):
        original = self.provider._request.side_effect

        def malformed_response(method, path, *args, **kwargs):
            result = original(method, path, *args, **kwargs)
            if method == "POST" and path.endswith("/mappings"):
                result["data"]["attributes"]["settings"] = ["private-provider-secret"]
            return result

        self.provider._request.side_effect = malformed_response
        response = self.call(f"/channels/{CHANNEL}/airbnb/mappings", self.mapping_body())
        self.assertEqual(response.status_code, 502, response.json)
        self.assertNotIn("private-provider-secret", response.get_data(as_text=True))
        self.assertIn("Tải lại", response.json["error"]["message"])
