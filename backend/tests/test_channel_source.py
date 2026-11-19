"""Source selection authorization runs without provider network or a database."""

import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import UUID

from flask import Flask, g

from pms_api.admin.channex_airbnb import airbnb_connection_link, state_signer
from pms_api.channels.routes import manager_source_config
from pms_api.security import ApiError

PROPERTY = str(UUID(int=1))


class ChannelSourceTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.context = self.app.test_request_context()
        self.context.push()
        self.addCleanup(self.context.pop)
        g.user = SimpleNamespace(global_role="SYSTEM_MANAGER")
        self.app.config["CHANNEX_MANAGER_API_KEY_STAGING"] = "private-manager-staging-key"
        self.body = {"accountId": "system:staging", "propertyId": PROPERTY, "active": True}
        linked = patch("pms_api.channels.routes.connection", return_value=SimpleNamespace(
            property_id=PROPERTY, environment="staging",
        ))
        linked.start()
        self.addCleanup(linked.stop)

    def test_system_source_requires_the_existing_authorized_property(self):
        with patch("pms_api.channels.routes.connection", return_value=None):
            with self.assertRaises(ApiError) as caught:
                manager_source_config("hotel-a", self.body)
        self.assertEqual(caught.exception.status, 403)

    def test_system_source_is_resolved_on_server_without_mutating_input(self):
        result = manager_source_config("hotel-a", self.body)
        self.assertEqual(
            result,
            {
                "environment": "staging",
                "propertyId": PROPERTY,
                "active": True,
                "apiKey": "private-manager-staging-key",
            },
        )
        self.assertNotIn("apiKey", self.body)

    def test_tenant_roles_cannot_select_server_sources(self):
        for role in ("USER", "HOTEL_OWNER", "FRONT_DESK"):
            with self.subTest(role=role):
                g.user.global_role = role
                with self.assertRaises(ApiError) as caught:
                    manager_source_config("hotel-a", self.body)
                self.assertEqual(caught.exception.status, 403)

    def test_ambiguous_payload_and_other_hotel_source_are_rejected(self):
        for change in (
            {"apiKey": "browser-key"},
            {"active": "true"},
            {"accountId": "hotel:other"},
            {"accountId": []},
        ):
            with self.subTest(change=change), self.assertRaises(ApiError) as caught:
                manager_source_config("hotel-a", {**self.body, **change})
            self.assertEqual(caught.exception.status, 422)

    def test_own_hotel_source_cannot_be_repointed_to_another_property(self):
        source = SimpleNamespace(api_key="private-hotel-key")
        with (
            patch("pms_api.admin.channex_remote.account_client", return_value=("staging", source)),
            patch(
                "pms_api.channels.routes.connection",
                return_value=SimpleNamespace(property_id=PROPERTY),
            ),
        ):
            body = {**self.body, "accountId": "hotel:hotel-a"}
            self.assertEqual(manager_source_config("hotel-a", body)["apiKey"], source.api_key)
            with self.assertRaises(ApiError) as caught:
                manager_source_config("hotel-a", {**body, "propertyId": str(UUID(int=99))})
            self.assertEqual(caught.exception.code, "invalid_channel_source")

    def test_missing_source_key_returns_safe_error(self):
        self.app.config["CHANNEX_MANAGER_API_KEY_STAGING"] = None
        with self.assertRaises(ApiError) as caught:
            manager_source_config("hotel-a", self.body)
        self.assertEqual(caught.exception.status, 503)
        self.assertNotIn("private-manager", caught.exception.message)


class ChannelAirbnbReturnTests(unittest.TestCase):
    def test_return_destination_and_signed_state_keep_the_tenant_context(self):
        origin = "http://127.0.0.1:5173"
        app = Flask(__name__)
        app.config.update(CORS_ORIGINS=[origin], APP_ENV="testing")
        group = str(UUID(int=7))
        prop = {"id": PROPERTY, "relationships": {"groups": {"data": [{"id": group}]}}}
        provider = Mock()
        provider._request.return_value = {
            "data": {
                "type": "connection_link",
                "attributes": {"url": "https://www.airbnb.com/connect"},
            }
        }
        with (
            app.test_request_context(headers={"Origin": origin}),
            patch("pms_api.channels.onboarding.invalidate_linked_inventory") as invalidate,
        ):
            g.auth_session = SimpleNamespace(token_hash="private-session-signing-key")
            for role, path in (
                ("USER", "/id/ota"),
                ("SYSTEM_MANAGER", "/manager/tenants/hotel-a/ota"),
                ("SUPER_ADMIN", "/manager/tenants/hotel-a/ota"),
            ):
                with self.subTest(role=role):
                    g.user = SimpleNamespace(id="actor", global_role=role)
                    result = airbnb_connection_link(
                        "staging",
                        provider,
                        prop,
                        {
                            "accountId": "hotel:hotel-a",
                            "name": "Hotel Airbnb",
                            "returnOrigin": origin,
                            "groupId": group,
                        },
                        tenant_id="hotel-a",
                    )
                    values = provider._request.call_args.kwargs["body"]["connection_link"]
                    self.assertEqual(values["redirect_uri"], origin + path)
                    self.assertEqual(values["failure_redirect_uri"], origin + path)
                    state = state_signer().loads(values["token"])
                    self.assertEqual(state["tenantId"], "hotel-a")
                    self.assertEqual(state["actor"], "actor")
                    self.assertNotIn(values["token"], str(result))
                    invalidate.assert_called_with("staging", PROPERTY)
