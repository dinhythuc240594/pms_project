"""Safe local manager roster and tenant-scoped remote dropdown catalogs."""

from copy import deepcopy
from datetime import timedelta
from unittest.mock import patch
from uuid import UUID

from cryptography.fernet import Fernet
from sqlalchemy import select

from pms_api.admin.client_models import TenantClientProfile
from pms_api.catalog.models import PhysicalRoom, RoomType
from pms_api.channels.client import ProviderError
from pms_api.channels.models import ChannelConnection, ChannelJob, ChannelMapping
from pms_api.core_models import Plan, utcnow
from pms_api.extensions import db
from pms_api.security import set_context
from tests.system_scope_fixture import grant_system_access
from tests.test_channels_integration import PROPERTY, REMOTE_RATE, REMOTE_ROOM, ChannelTestCase


class ChannelCatalogTests(ChannelTestCase):
    def setUp(self):
        super().setUp()
        provider_patch = patch("pms_api.channels.routes.ChannexClient", return_value=self.provider)
        provider_patch.start()
        self.addCleanup(provider_patch.stop)
        self.provider.catalog.reset_mock()

    def catalog(self, resource, property_id):
        rows = super().catalog(resource, property_id)
        rows[0]["attributes"]["title"] = "Standard" if resource == "room_types" else "Flexible"
        return rows

    def test_catalog_uses_saved_property_and_allows_configured_paused_connection(self):
        self.config["active"] = False
        self.assertEqual(self.request("put", "/channels/config", json=self.config).status_code, 200)
        response = self.request("get", "/channels/catalog")
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(
            response.json,
            {
                "roomTypes": [{"id": REMOTE_ROOM, "name": "Standard"}],
                "ratePlans": [
                    {
                        "id": REMOTE_RATE,
                        "name": "Flexible",
                        "roomTypeId": REMOTE_ROOM,
                        "currency": "VND",
                        "supported": True,
                    }
                ],
            },
        )
        self.assertEqual(
            {call.args[1] for call in self.provider.catalog.call_args_list}, {PROPERTY}
        )
        self.provider.push_availability.assert_not_called()

    def test_catalog_authorization_and_entitlement(self):
        anonymous = self.app.test_client().get(f"/api/tenants/{self.tenant_id}/channels/catalog")
        self.assertEqual(anonymous.status_code, 401)
        for user, expected in (
            ("frontdesk", 200),
            ("hk", 403),
            ("accountant", 403),
            ("owner-b", 403),
            ("manager", 403),
            ("admin", 403),
        ):
            with self.subTest(user=user):
                client, headers = self.login(f"{user}@test.local")
                response = self.request("get", "/channels/catalog", client=client, headers=headers)
                self.assertEqual(response.status_code, expected, response.json)
                if user in {"manager", "admin"}:
                    self.assertEqual(response.json["error"]["code"], "tenant_denied")
                    grant_system_access(self, user)
                    response = self.request(
                        "get", "/channels/catalog", client=client, headers=headers
                    )
                    self.assertEqual(response.status_code, 200, response.json)
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            db.session.get(Plan, "default-pro").features = {"OTA_SYNC": False}
            db.session.commit()
        response = self.request("get", "/channels/catalog")
        self.assertEqual(response.status_code, 403, response.json)
        self.assertIn("feature_disabled", str(response.json))

    def test_catalog_reads_encrypted_credentials_without_returning_key(self):
        with patch.dict(
            self.app.config, {"CHANNEX_ENCRYPTION_KEY": Fernet.generate_key().decode()}
        ):
            response = self.request(
                "put",
                "/channels/config",
                json={
                    "environment": "staging",
                    "propertyId": PROPERTY,
                    "active": False,
                    "apiKey": "fixture-encrypted-key",
                },
            )
            self.assertEqual(response.status_code, 200, response.json)
            self.env.stop()
            response = self.request("get", "/channels/catalog")
            self.assertEqual(response.status_code, 200, response.json)
            self.assertNotIn("fixture-encrypted-key", str(response.json))

    def test_missing_connection_credentials_and_unreadable_secret_fail_safely(self):
        client, headers = self.login("owner-b@test.local")
        response = self.request(
            "get",
            f"/api/tenants/{self.other_tenant_id}/channels/catalog",
            client=client,
            headers=headers,
        )
        self.assertEqual(response.status_code, 409, response.json)
        self.env.stop()
        response = self.request("get", "/channels/catalog")
        self.assertEqual(response.status_code, 503, response.json)
        self.provider.catalog.assert_not_called()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            row = db.session.scalar(select(ChannelConnection))
            row.secrets_ciphertext = "fixture-private-ciphertext"
            db.session.commit()
        response = self.request("get", "/channels/catalog")
        self.assertEqual(response.status_code, 503, response.json)
        self.assertNotIn("fixture-private", str(response.json))
        self.provider.catalog.assert_not_called()

    def test_unsupported_plans_remain_visible(self):
        rates = self.catalog("rate_plans", PROPERTY)
        for number, changes in enumerate(
            (
                {"sell_mode": "per_person"},
                {"rate_mode": "derived"},
                {"currency": "USD"},
                {"inherit_rate": True},
            ),
            start=10,
        ):
            rate = deepcopy(rates[0])
            rate["id"] = str(UUID(int=number))
            rate["attributes"].update(changes)
            rates.append(rate)
        self.provider.catalog.side_effect = lambda resource, property_id: (
            self.catalog(resource, property_id) if resource == "room_types" else rates
        )
        response = self.request("get", "/channels/catalog")
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(
            [r["supported"] for r in response.json["ratePlans"]], [True, False, False, False, False]
        )

    def test_malformed_duplicate_and_cross_property_catalogs_fail_without_partial_results(self):
        room, rate = (
            self.catalog("room_types", PROPERTY)[0],
            self.catalog("rate_plans", PROPERTY)[0],
        )
        invalid_rooms = [
            None,
            {**room, "id": "not-uuid"},
            {**room, "attributes": []},
            {**room, "attributes": {"title": 42}},
            {**room, "relationships": {"property": {"data": {"id": str(UUID(int=9))}}}},
        ]
        invalid_rates = [
            {**rate, "attributes": {**rate["attributes"], "currency": []}},
            {**rate, "attributes": {**rate["attributes"], "inherit_rate": "false"}},
            {
                **rate,
                "relationships": {
                    "property": {"data": {"id": str(UUID(int=9))}},
                    "room_type": {"data": {"id": REMOTE_ROOM}},
                },
            },
            {
                **rate,
                "relationships": {
                    "property": {"data": {"id": PROPERTY}},
                    "room_type": {"data": {"id": str(UUID(int=9))}},
                },
            },
        ]
        cases = [([bad], [rate]) for bad in invalid_rooms]
        cases += [([room], [bad]) for bad in invalid_rates]
        cases += [([room, room], [rate]), ({}, [rate])]
        for rooms, rates in cases:
            with self.subTest(rooms=rooms, rates=rates):
                self.provider.catalog.side_effect = lambda resource, _: (
                    rooms if resource == "room_types" else rates
                )
                response = self.request("get", "/channels/catalog")
                self.assertEqual(response.status_code, 502, response.json)
                self.assertNotIn("roomTypes", response.json)

    def test_provider_failure_and_catalog_limit_have_safe_messages(self):
        for error, status in (
            (ProviderError("provider_unavailable", True), 503),
            (ProviderError("channel_catalog_too_large"), 422),
        ):
            with self.subTest(error=error.code):
                self.provider.catalog.side_effect = error
                response = self.request("get", "/channels/catalog")
                self.assertEqual(response.status_code, status, response.json)
                self.assertIn(error.code, str(response.json))

    def test_manager_roster_is_local_and_returns_only_safe_fields_and_scoped_counts(self):
        now = utcnow()
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            db.session.add(
                TenantClientProfile(
                    tenant_id=self.tenant_id, city="Huế", customer_notes="private notes"
                )
            )
            db.session.get(PhysicalRoom, "room-a-102").active = False
            for number, (suffix, active, pending) in enumerate(
                (("pending", True, True), ("paused", False, False), ("retired", False, True)),
                start=20,
            ):
                db.session.add(
                    RoomType(
                        id=f"rt-{suffix}", tenant_id=self.tenant_id, name=suffix, active=active
                    )
                )
                db.session.flush()
                db.session.add(
                    ChannelMapping(
                        tenant_id=self.tenant_id,
                        room_type_id=f"rt-{suffix}",
                        remote_room_type_id=str(UUID(int=number)),
                        remote_rate_plan_id=str(UUID(int=number + 10)),
                        active=True,
                        pause_requested=pending,
                    )
                )
            for tenant, number, status in (
                (self.tenant_id, 1, "succeeded"),
                (self.tenant_id, 2, "failed"),
                (self.other_tenant_id, 3, "queued"),
            ):
                db.session.add(
                    ChannelJob(
                        id=f"job-{number}",
                        tenant_id=tenant,
                        actor_id=self.owner_id,
                        kind="pull_bookings",
                        status=status,
                        error_code="provider_rejected" if status == "failed" else None,
                        created_at=now + timedelta(seconds=number),
                        payload={"private": "fixture-secret"},
                    )
                )
            db.session.commit()
        for user in ("manager", "admin"):
            client, headers = self.login(f"{user}@test.local")
            response = self.request("get", "/api/admin/channex", client=client, headers=headers)
            self.assertEqual(response.status_code, 200, response.json)
            self.assertEqual(client.get("/api/auth/session").json["user"]["memberships"], [])
            hotels = {hotel["tenantId"]: hotel for hotel in response.json["hotels"]}
            self.assertEqual(set(hotels), {self.tenant_id, self.other_tenant_id})
            first, second = hotels[self.tenant_id], hotels[self.other_tenant_id]
            self.assertEqual(
                (
                    first["roomCount"],
                    first["roomTypeCount"],
                    first["mappingCount"],
                    first["closingCount"],
                ),
                (1, 2, 1, 2),
            )
            self.assertEqual(
                (
                    second["roomCount"],
                    second["roomTypeCount"],
                    second["mappingCount"],
                    second["closingCount"],
                ),
                (2, 1, 0, 0),
            )
            self.assertEqual(first["city"], "Huế")
            self.assertIsNone(second["connection"])
            self.assertEqual(first["latestJob"]["status"], "failed")
            self.assertEqual(second["latestJob"]["status"], "queued")
            self.assertEqual(
                set(first),
                {
                    "tenantId",
                    "name",
                    "city",
                    "roomCount",
                    "status",
                    "connection",
                    "mappingCount",
                    "closingCount",
                    "roomTypeCount",
                    "latestJob",
                },
            )
            self.assertEqual(
                set(first["connection"]),
                {
                    "environment",
                    "propertyId",
                    "active",
                    "credentialsConfigured",
                    "credentialError",
                    "credentialSource",
                    "verifiedAt",
                    "webhookRegistered",
                },
            )
            self.assertEqual(set(first["latestJob"]), {"kind", "status", "errorCode", "createdAt"})
            self.assertNotIn("fixture-secret", str(response.json))
            self.assertNotIn("private notes", str(response.json))
        self.provider.catalog.assert_not_called()

    def test_empty_catalog_and_absent_latest_job_are_explicit(self):
        self.provider.catalog.side_effect = lambda *_: []
        response = self.request("get", "/channels/catalog")
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json, {"roomTypes": [], "ratePlans": []})
        grant_system_access(self)
        client, headers = self.login("manager@test.local")
        response = self.request("get", "/api/admin/channex", client=client, headers=headers)
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(
            {hotel["tenantId"] for hotel in response.json["hotels"]},
            {self.tenant_id, self.other_tenant_id},
        )
        self.assertTrue(all(hotel["latestJob"] is None for hotel in response.json["hotels"]))

    def test_roster_denies_tenant_users_and_keeps_broken_credentials_as_status(self):
        response = self.request("get", "/api/admin/channex")
        self.assertEqual(response.status_code, 403, response.json)
        self.assertEqual(self.app.test_client().get("/api/admin/channex").status_code, 401)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.scalar(select(ChannelConnection)).secrets_ciphertext = "private-ciphertext"
            db.session.commit()
        grant_system_access(self)
        client, headers = self.login("manager@test.local")
        response = self.request("get", "/api/admin/channex", client=client, headers=headers)
        self.assertEqual(response.status_code, 200, response.json)
        connection = next(h for h in response.json["hotels"] if h["tenantId"] == self.tenant_id)[
            "connection"
        ]
        self.assertFalse(connection["credentialsConfigured"])
        self.assertEqual(connection["credentialSource"], "encrypted")
        self.assertIsNotNone(connection["credentialError"])
        self.assertNotIn("private-ciphertext", str(response.json))
