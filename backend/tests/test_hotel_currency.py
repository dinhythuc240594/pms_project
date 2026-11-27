"""Hotel currency is canonical settings data for owner and channel workspaces."""

from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import Mock
from uuid import UUID

from sqlalchemy import func, select

from pms_api.channels.client import ProviderError
from pms_api.channels.service import validate_mapping_target
from pms_api.core_models import Tenant, TenantUser, User
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import TEST_PASSWORD, DomainTestCase


class HotelCurrencyApiTests(DomainTestCase):
    def setUp(self):
        super().setUp()
        self.manager, self.csrf = self.login("manager@test.local")

    def create(self, **changes):
        return self.request(
            "POST",
            "/api/tenants",
            {"name": "Currency hotel", "ownerUserId": self.owner_id, **changes},
            client=self.manager,
            headers=self.csrf,
        )

    def test_omitted_currency_defaults_to_vnd_and_preserves_other_hotel_defaults(self):
        response = self.create()
        self.assertEqual(response.status_code, 201, response.json)
        self.assertEqual(response.json["currency"], "VND")
        with self.app.app_context():
            set_context("manager", is_system=True)
            hotel = db.session.get(Tenant, response.json["id"])
            self.assertIsNotNone(hotel)
            self.assertEqual(
                hotel.settings,
                {
                    "currency": "VND",
                    "timezone": "Asia/Ho_Chi_Minh",
                    "checkInTime": "14:00",
                    "checkOutTime": "12:00",
                },
            )

    def test_selected_currency_and_vietnamese_city_reach_manager_owner_session_and_workspace(self):
        for raw, expected, city in (
            ("VND", "VND", "Hà Nội"),
            (" usd ", "USD", "Đà Nẵng"),
            (" eur ", "EUR", "Hà Nội"),
            ("JPY", "JPY", "Đà Nẵng"),
            ("THB", "THB", "Hồ Chí Minh"),
            ("SGD", "SGD", "Hà Nội"),
        ):
            with self.subTest(currency=raw):
                response = self.create(currency=raw, city=city)
                self.assertEqual(response.status_code, 201, response.json)
                hotel_id = response.json["id"]
                self.assertEqual(
                    (response.json["currency"], response.json["city"]), (expected, city)
                )
                metadata = next(
                    row
                    for row in self.manager.get("/api/tenants").json["tenants"]
                    if row["id"] == hotel_id
                )
                self.assertEqual(metadata["currency"], expected)
                owner, _ = self.login()
                session_hotel = next(
                    row
                    for row in owner.get("/api/auth/session").json["tenants"]
                    if row["id"] == hotel_id
                )
                self.assertEqual(session_hotel["currency"], expected)
                workspace = owner.get(f"/api/tenants/{hotel_id}/workspace")
                self.assertEqual(workspace.status_code, 200, workspace.json)
                self.assertEqual(workspace.json["settings"]["currency"], expected)
                self.assertEqual(workspace.json["settings"]["timezone"], "Asia/Ho_Chi_Minh")

    def test_new_account_creation_stores_usd_canonically(self):
        response = self.request(
            "POST",
            "/api/tenants",
            {
                "name": "New USD hotel",
                "ownerName": "New owner",
                "ownerEmail": "usd-owner@test.local",
                "ownerPassword": TEST_PASSWORD,
                "currency": "USD",
                "city": "Thành phố Hồ Chí Minh",
            },
            client=self.manager,
            headers=self.csrf,
        )
        self.assertEqual(response.status_code, 201, response.json)
        with self.app.app_context():
            set_context("manager", is_system=True)
            hotel = db.session.get(Tenant, response.json["id"])
            self.assertIsNotNone(hotel)
            self.assertEqual(hotel.settings["currency"], "USD")

    def test_invalid_currency_leaves_no_partial_tenant_identity_or_membership(self):
        def counts():
            with self.app.app_context():
                set_context(is_system=True)
                return tuple(
                    db.session.scalar(select(func.count()).select_from(model))
                    for model in (Tenant, User, TenantUser)
                )

        before = counts()
        for currency in (None, True, 123, [], {}, "", "XXX", "US", "VND/USD"):
            with self.subTest(currency=currency):
                response = self.create(currency=currency)
                self.assertEqual(response.status_code, 422, response.json)
                self.assertEqual(response.json["error"]["code"], "invalid_currency")
                self.assertEqual(counts(), before)

    def test_manager_profile_update_cannot_bypass_currency_change_guards(self):
        response = self.create(currency="USD")
        self.assertEqual(response.status_code, 201, response.json)
        hotel_id = response.json["id"]
        response = self.request(
            "PATCH",
            f"/api/tenants/{hotel_id}",
            {"currency": "VND"},
            client=self.manager,
            headers=self.csrf,
        )
        self.assertEqual(response.status_code, 422, response.json)
        with self.app.app_context():
            set_context("manager", is_system=True)
            hotel = db.session.get(Tenant, hotel_id)
            self.assertIsNotNone(hotel)
            self.assertEqual(hotel.settings["currency"], "USD")


class HotelCurrencyMappingTests(TestCase):
    def test_channel_mapping_accepts_matching_usd_and_rejects_vnd_rates_for_usd_hotel(self):
        property_id, room_id, rate_id = (str(UUID(int=value)) for value in (1, 2, 3))
        connection = SimpleNamespace(property_id=property_id)
        room = {
            "id": room_id,
            "attributes": {},
            "relationships": {"property": {"data": {"id": property_id}}},
        }
        rate = {
            "id": rate_id,
            "attributes": {"currency": "USD", "sell_mode": "per_room", "rate_mode": "manual"},
            "relationships": {
                "property": {"data": {"id": property_id}},
                "room_type": {"data": {"id": room_id}},
            },
        }
        client = Mock()
        client.catalog.side_effect = lambda resource, _: (
            [room] if resource == "room_types" else [rate]
        )
        validate_mapping_target(connection, client, room_id, rate_id, [], "USD")
        rate["attributes"]["currency"] = "VND"
        with self.assertRaises(ProviderError) as caught:
            validate_mapping_target(connection, client, room_id, rate_id, [], "USD")
        self.assertEqual(caught.exception.code, "channel_mapping_invalid")

    def test_channel_mapping_keeps_expanded_currency_and_exact_match_requirement(self):
        property_id, room_id, rate_id = (str(UUID(int=value)) for value in (4, 5, 6))
        connection = SimpleNamespace(property_id=property_id)
        room = {
            "id": room_id,
            "attributes": {},
            "relationships": {"property": {"data": {"id": property_id}}},
        }
        rate = {
            "id": rate_id,
            "attributes": {"currency": "EUR", "sell_mode": "per_room", "rate_mode": "manual"},
            "relationships": {
                "property": {"data": {"id": property_id}},
                "room_type": {"data": {"id": room_id}},
            },
        }
        client = Mock()
        client.catalog.side_effect = lambda resource, _: (
            [room] if resource == "room_types" else [rate]
        )
        for currency in ("EUR", "JPY", "THB", "SGD"):
            rate["attributes"]["currency"] = currency
            validate_mapping_target(connection, client, room_id, rate_id, [], currency)
            with self.assertRaises(ProviderError) as caught:
                validate_mapping_target(connection, client, room_id, rate_id, [], "VND")
            self.assertEqual(caught.exception.code, "channel_mapping_invalid")
