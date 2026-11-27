"""Remote viewers never import, ACK or publish provider data or expose credentials."""

from copy import deepcopy
from unittest.mock import patch

from pms_api.channels.client import ProviderError
from tests.system_scope_fixture import grant_system_access
from tests.test_channels_integration import PROPERTY, REMOTE_RATE, REMOTE_ROOM, ChannelTestCase

BOOKING = "11111111-1111-4111-8111-111111111111"
CHANNEL = "33333333-3333-4333-8333-333333333333"


class ChannexInsightsTests(ChannelTestCase):
    def setUp(self):
        super().setUp()
        grant_system_access(self, "manager", "admin")
        self.client, self.headers = self.login("manager@test.local")
        provider = patch("pms_api.admin.channex_remote.ChannexClient", return_value=self.provider)
        provider.start()
        self.addCleanup(provider.stop)
        self.provider.property.return_value = {
            "id": PROPERTY,
            "type": "property",
            "attributes": {
                "title": "LOHA Staging",
                "currency": "VND",
                "timezone": "Asia/Ho_Chi_Minh",
            },
        }
        self.booking = {
            "id": BOOKING,
            "type": "booking",
            "attributes": {
                "property_id": PROPERTY,
                "unique_id": "BDC-history",
                "ota_name": "Booking.com",
                "status": "new",
                "customer": {"name": "Test", "surname": "Guest", "mail": "hidden@example.test"},
                "arrival_date": "2026-10-20",
                "departure_date": "2026-10-22",
                "inserted_at": "2026-10-11T09:00:00",
                "amount": "50.25",
                "currency": "USD",
                "rooms": [{}],
                "guarantee": {"card_number": "4111111111111111", "cvv": "123"},
            },
        }
        self.availability = {REMOTE_ROOM: {"2026-10-12": 2}}
        self.rates = {
            REMOTE_RATE: {
                "2026-10-12": {"rate": "500000", "stop_sell": False},
                "2026-10-13": {"stop_sell": True},
            }
        }
        self.channel = {
            "id": CHANNEL,
            "type": "channel",
            "attributes": {
                "title": "Booking.com LOHA",
                "channel": "BookingCom",
                "currency": "USD",
                "is_active": True,
                "properties": [PROPERTY],
                "rate_plans": [{"rate_plan_id": REMOTE_RATE, "settings": {"secret": "hidden"}}],
                "settings": {"api_token": "private-channel-token"},
            },
        }
        self.provider._request.side_effect = self.remote_request

    def catalog(self, resource, property_id):
        rows = super().catalog(resource, property_id)
        rows[0]["attributes"]["title"] = "Couple" if resource == "room_types" else "Couple Standard"
        return rows

    def remote_request(self, method, path, **kwargs):
        self.assertEqual(method, "GET")
        self.assertEqual(kwargs["query"]["filter[property_id]"], PROPERTY)
        if path == "/bookings":
            return {"data": [deepcopy(self.booking)], "meta": {"total": 1, "page": 1, "limit": 25}}
        if path == "/channels":
            self.assertEqual(kwargs["query"]["order[title]"], "asc")
            return {"data": [deepcopy(self.channel)], "meta": {"total": 1, "page": 1, "limit": 25}}
        if path == "/availability":
            return {"data": deepcopy(self.availability)}
        if path == "/restrictions":
            self.assertEqual(kwargs["query"]["filter[restrictions]"], "rate,stop_sell")
            return {"data": deepcopy(self.rates)}
        self.fail("Unexpected provider endpoint")

    def get(self, resource, query=""):
        path = f"/api/admin/channex/properties/{PROPERTY}/{resource}?accountId=hotel:{self.tenant_id}{query}"
        return self.request("get", path)

    def test_booking_list_includes_history_redacts_private_fields_and_keeps_original_money(self):
        response = self.get("bookings")
        self.assertEqual(response.status_code, 200, response.json)
        row = response.json["bookings"][0]
        self.assertEqual(
            (row["id"], row["guestName"], row["amount"], row["currency"]),
            (BOOKING, "Test Guest", "50.25", "USD"),
        )
        self.assertEqual(row["createdAt"], "2026-10-11T09:00:00+00:00")
        self.assertEqual(response.json["pagination"]["totalItems"], 1)
        for private in (
            "guarantee",
            "card_number",
            "cvv",
            "hidden@example.test",
            "4111111111111111",
        ):
            self.assertNotIn(private, response.get_data(as_text=True))
        self.provider.feed.assert_not_called()
        self.provider.ack.assert_not_called()
        self.provider.push_availability.assert_not_called()
        self.assertEqual(self.local_bookings(), [])

    def test_remote_view_is_system_only_for_both_resources(self):
        for user, expected in (
            ("owner-a", 403),
            ("frontdesk", 403),
            ("admin", 200),
            ("manager", 200),
        ):
            self.client, self.headers = self.login(f"{user}@test.local")
            with self.subTest(user=user):
                self.assertEqual(self.get("bookings").status_code, expected)
                self.assertEqual(self.get("channels").status_code, expected)
                self.assertEqual(
                    self.get("inventory", "&start=2026-10-12&end=2026-10-13").status_code, expected
                )

    def test_bookings_reject_other_property_and_invalid_money_without_leaking_names(self):
        for change in (
            {"property_id": "22222222-2222-4222-8222-222222222222"},
            {"amount": "NaN"},
            {"amount": True},
            {"arrival_date": "2026-02-30"},
        ):
            original = deepcopy(self.booking)
            self.booking["attributes"].update(change)
            response = self.get("bookings")
            self.assertEqual(response.status_code, 502, response.json)
            self.assertNotIn("Test Guest", response.get_data(as_text=True))
            self.booking = original

    def test_booking_pagination_and_extra_or_duplicate_query_fields_are_validated(self):
        for query in ("&page=0", "&page=2147483648", "&url=https://example.com", "&page=1&page=2"):
            self.provider._request.reset_mock()
            response = self.get("bookings", query)
            self.assertEqual(response.status_code, 422, response.json)
            self.provider._request.assert_not_called()

    def test_native_channels_are_scoped_paginated_and_redact_settings(self):
        response = self.get("channels")
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(
            response.json["channels"],
            [
                {
                    "id": CHANNEL,
                    "name": "Booking.com LOHA",
                    "code": "BookingCom",
                    "currency": "USD",
                    "active": True,
                    "supportsLoadFutureReservations": False,
                    "mappedRateCount": 1,
                    "propertyCount": 1,
                }
            ],
        )
        self.assertEqual(response.json["pagination"]["totalItems"], 1)
        for private in ("private-channel-token", "settings", "secret", "api_token"):
            self.assertNotIn(private, response.get_data(as_text=True))
        self.provider.feed.assert_not_called()
        self.provider.ack.assert_not_called()
        self.channel["attributes"]["actions"] = ["load_future_reservations"]
        loaded = self.get("channels")
        self.assertTrue(loaded.json["channels"][0]["supportsLoadFutureReservations"])

    def test_native_channels_reject_foreign_property_and_malformed_fields(self):
        for change in (
            {"properties": [BOOKING]},
            {"properties": [PROPERTY, PROPERTY]},
            {"is_active": "true"},
            {"currency": "usd"},
            {"rate_plans": [{"rate_plan_id": "not-a-uuid"}]},
            {"actions": {"load_future_reservations": True}},
            {"actions": [1]},
        ):
            original = deepcopy(self.channel)
            self.channel["attributes"].update(change)
            response = self.get("channels")
            self.assertEqual(response.status_code, 502, response.json)
            self.assertNotIn("private-channel-token", response.get_data(as_text=True))
            self.channel = original

    def test_channel_query_validation_happens_before_provider_request(self):
        for query in ("&page=-1", "&page=1&page=2", "&token=secret", "&url=https://bad.test"):
            self.provider._request.reset_mock()
            response = self.get("channels", query)
            self.assertEqual(response.status_code, 422, response.json)
            self.provider._request.assert_not_called()

    def test_channel_relationships_must_agree_with_property_scope(self):
        for relationships, expected in (
            ({"properties": {"data": [{"id": PROPERTY}]}}, 200),
            ({"properties": {"data": [{"id": BOOKING}]}}, 502),
            ({"properties": {"data": "invalid"}}, 502),
            ({"properties": "invalid"}, 502),
            ("invalid", 502),
        ):
            self.channel["relationships"] = relationships
            response = self.get("channels")
            self.assertEqual(response.status_code, expected, response.json)
            self.assertNotIn("private-channel-token", response.get_data(as_text=True))

    def test_inventory_inclusive_dates_and_missing_values_are_not_zero(self):
        response = self.get("inventory", "&start=2026-10-12&end=2026-10-13")
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json["dates"], ["2026-10-12", "2026-10-13"])
        self.assertEqual(response.json["availability"][0]["values"], {"2026-10-12": 2})
        self.assertEqual(
            response.json["rates"][0]["values"]["2026-10-13"], {"rate": None, "stopSell": True}
        )
        self.provider.push_restrictions.assert_not_called()

    def test_invalid_inventory_window_never_calls_provider(self):
        for query in (
            "",
            "&start=2026-10-13&end=2026-10-12",
            "&start=2026-10-01&end=2026-11-01",
            "&start=bad&end=2026-10-12",
        ):
            self.provider._request.reset_mock()
            self.assertEqual(self.get("inventory", query).status_code, 422)
            self.provider._request.assert_not_called()

    def test_inventory_rejects_unknown_targets_dates_negative_counts_and_invalid_rates(self):
        for value in (-1, True, "2"):
            self.availability[REMOTE_ROOM]["2026-10-12"] = value
            self.assertEqual(
                self.get("inventory", "&start=2026-10-12&end=2026-10-13").status_code, 502
            )
        self.availability = {"22222222-2222-4222-8222-222222222222": {"2026-10-12": 1}}
        self.assertEqual(self.get("inventory", "&start=2026-10-12&end=2026-10-13").status_code, 502)
        self.availability = {REMOTE_ROOM: {"2026-10-14": 1}}
        self.assertEqual(self.get("inventory", "&start=2026-10-12&end=2026-10-13").status_code, 502)
        self.availability = {}
        self.rates[REMOTE_RATE]["2026-10-12"]["rate"] = "Infinity"
        self.assertEqual(self.get("inventory", "&start=2026-10-12&end=2026-10-13").status_code, 502)

    def test_temporary_provider_failure_is_safe_and_retryable(self):
        self.provider._request.side_effect = ProviderError("provider_unavailable", True)
        response = self.get("bookings")
        self.assertEqual(response.status_code, 503, response.json)
        self.assertNotIn("fixture-api-key", response.get_data(as_text=True))
