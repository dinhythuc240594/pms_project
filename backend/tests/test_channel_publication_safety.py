"""A failed price update or readback must never open room availability."""

from copy import deepcopy
from unittest import TestCase
from unittest.mock import Mock, call

from pms_api.channels.client import ProviderError
from pms_api.channels.publication import stage_ari


class PublicationSafetyTests(TestCase):
    def setUp(self):
        self.availability = [
            {
                "property_id": "property",
                "room_type_id": "room",
                "date": "2030-01-01",
                "availability": 2,
            }
        ]
        self.restrictions = [
            {
                "property_id": "property",
                "rate_plan_id": "rate",
                "date": "2030-01-01",
                "rate": "110.0000",
                "stop_sell": False,
            }
        ]
        self.client = Mock()
        self.client.availability.return_value = {"room": {"2030-01-01": 0}}
        self.client.restrictions.return_value = {
            "rate": {"2030-01-01": {"rate": "110.00", "stop_sell": False}}
        }

    def test_close_then_price_then_verify_without_opening(self):
        original = deepcopy(self.availability)
        stage_ari(self.client, self.availability, self.restrictions)
        self.assertEqual(
            self.client.mock_calls,
            [
                call.push_availability([{**self.availability[0], "availability": 0}]),
                call.availability("property", "2030-01-01", "2030-01-01"),
                call.push_restrictions(self.restrictions),
                call.restrictions("property", "2030-01-01", "2030-01-01"),
            ],
        )
        self.assertEqual(self.availability, original)

    def test_price_failure_leaves_only_zero_availability_published(self):
        self.client.push_restrictions.side_effect = ProviderError("provider_unavailable", True)
        with self.assertRaises(ProviderError):
            stage_ari(self.client, self.availability, self.restrictions)
        self.client.push_availability.assert_called_once_with(
            [{**self.availability[0], "availability": 0}]
        )
        self.client.restrictions.assert_not_called()

    def test_unverified_prices_and_restrictions_never_reopen(self):
        for remote in (
            None,
            {"rate": []},
            {},
            {"rate": {"2030-01-01": {"rate": "100", "stop_sell": False}}},
            {"rate": {"2030-01-01": {"rate": "110", "stop_sell": True}}},
            {"rate": {"2030-01-01": {"rate": "NaN", "stop_sell": False}}},
        ):
            with self.subTest(remote=remote):
                self.client.reset_mock()
                self.client.restrictions.return_value = remote
                with self.assertRaises(ProviderError) as raised:
                    stage_ari(self.client, self.availability, self.restrictions)
                self.assertEqual(raised.exception.code, "channel_rate_unverified")
                self.assertTrue(raised.exception.retryable)
                self.client.push_availability.assert_called_once()

    def test_close_failure_never_changes_prices_or_opens(self):
        self.client.push_availability.side_effect = ProviderError("provider_unavailable", True)
        with self.assertRaises(ProviderError):
            stage_ari(self.client, self.availability, self.restrictions)
        self.client.push_restrictions.assert_not_called()

    def test_unverified_close_never_changes_prices(self):
        self.client.availability.return_value = {"room": {"2030-01-01": 2}}
        with self.assertRaises(ProviderError) as raised:
            stage_ari(self.client, self.availability, self.restrictions)
        self.assertEqual(raised.exception.code, "channel_inventory_unverified")
        self.client.push_restrictions.assert_not_called()
