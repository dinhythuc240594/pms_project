"""Client OTA management is tenant bound even when a provider key can see more hotels."""

from copy import deepcopy
from unittest.mock import Mock, patch
from uuid import UUID

from sqlalchemy import select

from pms_api.admin.channex_channels import revision
from pms_api.admin.feature_models import FeatureControl
from pms_api.channels.client import ProviderError
from pms_api.channels.models import ChannelConnection
from pms_api.core_models import AuditLog, Tenant, TenantUser
from pms_api.extensions import db
from pms_api.security import set_context
from tests import test_channex_airbnb as fake_airbnb
from tests import test_channex_channels as fake_channels
from tests.domain_fixture import DomainTestCase
from tests.system_scope_fixture import grant_system_access, linked_property
from tests.test_channex_airbnb import (
    CHANNEL as AIRBNB_CHANNEL,
)
from tests.test_channex_airbnb import (
    GROUP as AIRBNB_GROUP,
)
from tests.test_channex_airbnb import (
    LISTING,
    ORIGIN,
    remote_channel,
)
from tests.test_channex_airbnb import (
    MAPPING as AIRBNB_MAPPING,
)
from tests.test_channex_channels import CHANNEL, GROUP, adapter, channel_entity
from tests.test_channex_remote import PROPERTY, RATE, catalog_entity, property_entity


class TenantRemoteChannelFixture(DomainTestCase):
    def setUp(self):
        super().setUp()
        self.provider = Mock(api_key="private-hotel-key", base="https://staging.channex.io/api/v1")
        self.prop = property_entity()
        self.prop["relationships"] = {
            "groups": {"data": [{"id": GROUP, "attributes": {"title": "Hotel group"}}]}
        }
        self.provider.property.side_effect = lambda _: deepcopy(self.prop)
        self.provider.catalog.side_effect = lambda resource, _: [catalog_entity(resource)]
        self.provider.catalog_entity.side_effect = lambda resource, _: catalog_entity(resource)
        self.channel = channel_entity()
        self.descriptor, self.descriptors = adapter(), None
        self.readiness, self.async_result = [], False
        self.provider._request.side_effect = self.transport
        factory = patch("pms_api.channels.remote.ChannexClient", return_value=self.provider)
        self.factory = factory.start()
        self.addCleanup(factory.stop)
        linked_property(self, PROPERTY)
        _, self.stored_secrets = fake_channels.ChannexChannelTests.hotel_source(self)

    def transport(self, method, path, body=None, query=None, **kwargs):
        if method == "GET" and path == "/channels":
            page = query["pagination[page]"]
            return {
                "data": [deepcopy(self.channel)] if page == 1 else [],
                "meta": {"total": 1, "page": page, "limit": 25},
            }
        return fake_channels.ChannexChannelTests.provider_request(
            self, method, path, body, query, **kwargs
        )

    def remote(self, suffix="", *, method="GET", body=None, client=None, headers=None, tenant=None):
        return self.request(
            method,
            f"/api/tenants/{tenant or self.tenant_id}/channels/remote" + suffix,
            body,
            client=client,
            headers=headers,
        )

    def detail(self):
        response = self.remote("/" + CHANNEL)
        self.assertEqual(response.status_code, 200, response.json)
        return response.json["channel"]

    def writes(self):
        return fake_channels.ChannexChannelTests.writes(self)


class TenantRemoteChannelTests(TenantRemoteChannelFixture):
    def test_hotel_catalog_includes_popular_meta_channels_and_airbnb(self):
        self.descriptors = []
        for code, title in (
            ("BookingCom", "Booking.com"),
            ("Agoda", "Agoda"),
            ("Expedia", "Expedia"),
        ):
            descriptor = adapter(code)
            descriptor["title"] = title
            self.descriptors.append(descriptor)
        self.descriptors.append(fake_airbnb.airbnb_adapter())
        response = self.remote("/adapters")
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(
            [row["code"] for row in response.json["adapters"]],
            ["BookingCom", "Agoda", "Expedia", "AirBNB"],
        )
        self.assertEqual(response.json["unavailableAdapters"], [])
        for secret in (*self.stored_secrets, "private-default"):
            self.assertNotIn(secret, response.get_data(as_text=True))
        self.factory.assert_called_with("staging", self.stored_secrets[0])
        self.assertEqual(self.writes(), [])

    def test_reads_use_stored_hotel_source_and_keep_provider_secrets_private(self):
        for suffix in ("", "/adapters", "/adapters/BookingCom", "/" + CHANNEL):
            with self.subTest(suffix=suffix):
                response = self.remote(suffix)
                self.assertEqual(response.status_code, 200, response.json)
                for secret in (*self.stored_secrets, "private-password", "private-machine"):
                    self.assertNotIn(secret, response.get_data(as_text=True))
        self.factory.assert_called_with("staging", self.stored_secrets[0])
        self.provider.property.assert_called_with(PROPERTY)
        call = next(
            call for call in self.provider._request.call_args_list if call.args[1] == "/channels"
        )
        self.assertEqual(call.kwargs["query"]["filter[property_id]"], PROPERTY)
        self.assertEqual(self.detail()["secrets"], ["password"])

    def test_membership_read_roles_write_roles_csrf_and_entitlements(self):
        for email, expected_read in (
            ("frontdesk@test.local", 200),
            ("hk@test.local", 403),
            ("accountant@test.local", 403),
            ("owner-b@test.local", 403),
        ):
            client, headers = self.login(email)
            self.assertEqual(self.remote(client=client).status_code, expected_read)
            self.assertEqual(
                self.remote(
                    method="POST",
                    body=fake_channels.ChannexChannelTests.create_body(self),
                    client=client,
                    headers=headers,
                ).status_code,
                403,
            )
        self.assertEqual(
            self.remote(
                method="POST", body=fake_channels.ChannexChannelTests.create_body(self), headers={}
            ).status_code,
            403,
        )
        self.assertEqual(self.remote(tenant=self.other_tenant_id).status_code, 403)
        with self.app.app_context():
            set_context("admin", is_system=True, is_service=True)
            db.session.add(FeatureControl(code="OTA_SYNC", enabled_global=False))
            db.session.commit()
        self.assertEqual(self.remote().status_code, 403)
        self.assertEqual(
            self.remote(
                method="POST", body=fake_channels.ChannexChannelTests.create_body(self)
            ).status_code,
            403,
        )
        self.assertEqual(self.writes(), [])

    def test_account_and_property_overrides_are_rejected_before_provider_calls(self):
        for suffix in (
            "?accountId=system:staging",
            "?propertyId=" + PROPERTY,
            "/adapters?accountId=hotel:test-hotel-b",
        ):
            self.assertEqual(self.remote(suffix).status_code, 422)
        for extra in ({"accountId": "hotel:test-hotel-b"}, {"propertyId": str(UUID(int=99))}):
            response = self.remote(
                method="POST", body={**fake_channels.ChannexChannelTests.create_body(self), **extra}
            )
            self.assertEqual(response.status_code, 422, response.json)
        self.factory.assert_not_called()

    def test_other_property_channels_and_shared_channels_never_expose_settings(self):
        other = str(UUID(int=99))
        self.channel["attributes"]["properties"] = [other]
        self.channel["relationships"]["properties"]["data"] = [{"id": other}]
        response = self.remote("/" + CHANNEL)
        self.assertEqual(response.status_code, 502, response.json)
        self.assertNotIn("private-password", str(response.json))
        self.channel["attributes"]["properties"] = [PROPERTY, other]
        self.channel["relationships"]["properties"]["data"] = [{"id": PROPERTY}, {"id": other}]
        self.assertEqual(self.remote().json["channels"], [])
        response = self.remote("/" + CHANNEL)
        self.assertEqual(response.status_code, 409, response.json)
        response = self.remote(
            "/" + CHANNEL,
            method="PATCH",
            body={"revision": revision(self.provider, self.channel), "name": "New name"},
        )
        self.assertEqual(response.status_code, 409, response.json)
        self.assertEqual(self.writes(), [])

    def test_owner_create_probe_edit_activate_deactivate_delete_and_tenant_audit(self):
        response = self.remote(
            method="POST", body=fake_channels.ChannexChannelTests.create_body(self)
        )
        self.assertEqual(response.status_code, 201, response.json)
        create = self.writes()[-1]
        self.assertEqual(create.args[2]["channel"]["properties"], [PROPERTY])
        self.assertEqual(create.args[2]["channel"]["group_id"], GROUP)
        response = self.remote(
            "/probe/connection_details",
            method="POST",
            body={"code": "BookingCom", "settings": {"hotel_id": "123"}},
        )
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json["currency"], "USD")
        self.assertNotIn("private-provider-token", str(response.json))
        response = self.remote(
            "/" + CHANNEL,
            method="PATCH",
            body={"revision": self.detail()["revision"], "name": "Hotel Booking.com"},
        )
        self.assertEqual(response.status_code, 200, response.json)
        for action in ("readiness", "activate", "deactivate"):
            response = self.remote(
                "/" + CHANNEL + "/" + action,
                method="POST",
                body={"revision": self.detail()["revision"], "confirm": True},
            )
            self.assertEqual(response.status_code, 200, response.json)
        response = self.remote(
            "/" + CHANNEL,
            method="DELETE",
            body={"revision": self.detail()["revision"], "confirm": True},
        )
        self.assertEqual(response.status_code, 200, response.json)
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            logs = list(
                db.session.scalars(select(AuditLog).where(AuditLog.event.like("channex.channel.%")))
            )
            self.assertTrue(logs)
            self.assertTrue(
                all(
                    log.tenant_id == self.tenant_id and log.user_id == self.owner_id for log in logs
                )
            )
            self.assertNotIn("private-password", str([log.details for log in logs]))

    def test_revision_confirmation_and_wrong_group_rate_stay_enforced(self):
        for suffix, method, body, code in (
            ("/" + CHANNEL, "PATCH", {"revision": "0" * 64, "name": "New"}, "channel_changed"),
            (
                "/" + CHANNEL,
                "DELETE",
                {"revision": self.detail()["revision"]},
                "channel_confirmation_required",
            ),
            (
                "",
                "POST",
                {
                    **fake_channels.ChannexChannelTests.create_body(self),
                    "groupId": str(UUID(int=99)),
                },
                "channel_group_wrong_property",
            ),
            (
                "",
                "POST",
                {
                    **fake_channels.ChannexChannelTests.create_body(self),
                    "mappings": [{"ratePlanId": str(UUID(int=99)), "settings": {}}],
                },
                "channel_rate_wrong_property",
            ),
        ):
            response = self.remote(suffix, method=method, body=body)
            self.assertEqual(response.json["error"]["code"], code, response.json)
        self.assertEqual(self.writes(), [])

    def test_unconfigured_suspended_and_provider_failure_are_safe(self):
        self.provider._request.side_effect = ProviderError("provider_unavailable", True)
        response = self.remote("/adapters")
        self.assertEqual(response.status_code, 503, response.json)
        self.assertNotIn(self.stored_secrets[0], str(response.json))
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            db.session.get(Tenant, self.tenant_id).status = "suspended"
            db.session.commit()
        self.assertEqual(
            self.remote(
                method="POST", body=fake_channels.ChannexChannelTests.create_body(self)
            ).status_code,
            403,
        )
        owner_b, headers_b = self.login("owner-b@test.local")
        response = self.remote(tenant=self.other_tenant_id, client=owner_b, headers=headers_b)
        self.assertEqual(response.status_code, 409, response.json)
        self.assertEqual(response.json["error"]["code"], "channel_unconfigured")


class TenantAirbnbTests(TenantRemoteChannelFixture):
    def setUp(self):
        super().setUp()
        self.channel = remote_channel()
        self.prop["relationships"]["groups"]["data"][0]["id"] = AIRBNB_GROUP
        self.calls, self.mapping_pending = [], False
        self.provider._request.side_effect = lambda *args, **kwargs: (
            fake_airbnb.AirbnbTests.transport(self, *args, **kwargs)
        )
        self.headers["Origin"] = ORIGIN

    def link(self):
        response = self.remote(
            "/airbnb-link",
            method="POST",
            body={"name": "Hotel Airbnb", "returnOrigin": ORIGIN, "groupId": AIRBNB_GROUP},
        )
        self.assertEqual(response.status_code, 200, response.json)
        return next(
            call[2]["connection_link"]
            for call in reversed(self.calls)
            if call[1] == "/meta/airbnb/connection_link"
        )

    def test_owner_airbnb_link_returns_to_client_and_confirm_is_bound_to_tenant_session(self):
        values = self.link()
        self.assertEqual(values["redirect_uri"], ORIGIN + "/id/ota")
        response = self.remote(
            "/airbnb-confirm",
            method="POST",
            body={"channelId": AIRBNB_CHANNEL, "token": values["token"]},
        )
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json["channel"]["id"], AIRBNB_CHANNEL)
        self.assertNotIn("provider-oauth-secret", str(response.json))
        other_session, other_headers = self.login()
        response = self.remote(
            "/airbnb-confirm",
            method="POST",
            body={"channelId": AIRBNB_CHANNEL, "token": values["token"]},
            client=other_session,
            headers=other_headers,
        )
        self.assertEqual(response.status_code, 422, response.json)
        # An owner belonging to two hotels still cannot replay one hotel's OAuth state into the other.
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            db.session.add(
                TenantUser(
                    tenant_id=self.other_tenant_id, user_id=self.owner_id, role="HOTEL_OWNER"
                )
            )
            from pms_api.channels.credentials import encrypt_credentials

            other_property = str(UUID(int=90))
            db.session.add(
                ChannelConnection(
                    tenant_id=self.other_tenant_id,
                    environment="staging",
                    property_id=other_property,
                    credential_ref="unused",
                    webhook_secret_ref="unused",
                    secrets_ciphertext=encrypt_credentials(
                        self.other_tenant_id,
                        "staging",
                        other_property,
                        "private-other-key",
                        "other-webhook-secret-" + "x" * 32,
                    ),
                    actor_id=self.owner_id,
                )
            )
            db.session.commit()
        self.prop["id"] = other_property
        response = self.remote(
            "/airbnb-confirm",
            method="POST",
            tenant=self.other_tenant_id,
            body={"channelId": AIRBNB_CHANNEL, "token": values["token"]},
        )
        self.assertEqual(response.status_code, 422, response.json)
        self.assertEqual(response.json["error"]["code"], "invalid_airbnb_state")

    def test_manager_airbnb_return_keeps_the_managed_hotel_context(self):
        grant_system_access(self)
        manager, headers = self.login("manager@test.local")
        headers["Origin"] = ORIGIN
        response = self.remote(
            "/airbnb-link",
            method="POST",
            body={"name": "Managed Airbnb", "returnOrigin": ORIGIN, "groupId": AIRBNB_GROUP},
            client=manager,
            headers=headers,
        )
        self.assertEqual(response.status_code, 200, response.json)
        values = next(
            call[2]["connection_link"]
            for call in reversed(self.calls)
            if call[1] == "/meta/airbnb/connection_link"
        )
        expected = ORIGIN + f"/manager/tenants/{self.tenant_id}/ota"
        self.assertEqual(values["redirect_uri"], expected)
        self.assertEqual(values["failure_redirect_uri"], expected)
        response = self.remote(
            "/airbnb-confirm",
            method="POST",
            body={"channelId": AIRBNB_CHANNEL, "token": values["token"]},
            client=manager,
            headers=headers,
        )
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json["channel"]["id"], AIRBNB_CHANNEL)

    def test_airbnb_listings_and_mapping_create_remove_hide_secrets_and_check_revisions(self):
        response = self.remote("/" + AIRBNB_CHANNEL + "/airbnb/listings")
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json["listings"][0]["id"], LISTING)
        self.assertNotIn("private-owner", str(response.json))
        response = self.remote(
            "/" + AIRBNB_CHANNEL + "/airbnb/mappings",
            method="POST",
            body={
                "revision": revision(self.provider, self.channel),
                "listingId": LISTING,
                "ratePlanId": RATE,
            },
        )
        self.assertEqual(response.status_code, 200, response.json)
        self.assertNotIn("mapping-secret", str(response.json))
        response = self.remote(
            "/" + AIRBNB_CHANNEL + "/airbnb/mappings/" + AIRBNB_MAPPING,
            method="DELETE",
            body={"revision": response.json["channel"]["revision"], "confirm": True},
        )
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json["channel"]["mappings"], [])
