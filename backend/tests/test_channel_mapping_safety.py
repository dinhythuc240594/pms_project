"""Validate publication and explicitly accepted inbound plans before saving."""

from copy import deepcopy
from uuid import UUID

from pms_api.channels.client import ProviderError
from tests.test_channels_integration import PROPERTY, REMOTE_RATE, REMOTE_ROOM, ChannelTestCase

EXTRA = str(UUID(int=99))


class MappingSafetyTests(ChannelTestCase):
    def save(self, **changes):
        return self.request(
            "put",
            "/channels/mappings",
            json={
                "roomTypeId": "rt-a",
                "channexRoomTypeId": REMOTE_ROOM,
                "channexRatePlanId": REMOTE_RATE,
                "active": True,
                **changes,
            },
        )

    def add_extra(self, **attributes):
        rates = self.catalog("rate_plans", PROPERTY)
        extra = deepcopy(rates[0])
        extra["id"] = EXTRA
        extra["attributes"].update(attributes)
        rates.append(extra)
        self.provider.catalog.side_effect = lambda resource, prop: (
            rates if resource == "rate_plans" else self.catalog(resource, prop)
        )

    def test_unknown_and_unsupported_primary_plan_cannot_be_saved(self):
        self.assertEqual(self.save(channexRatePlanId=EXTRA).status_code, 422)
        self.add_extra(rate_mode="derived")
        response = self.save(channexRatePlanId=EXTRA)
        self.assertEqual(response.status_code, 422, response.json)
        self.assertEqual(response.json["error"]["code"], "channel_rate_plan_unsupported")

    def test_derived_inbound_is_explicit_and_currency_and_room_are_verified(self):
        self.add_extra(rate_mode="derived", inherit_rate=True)
        response = self.save(inboundRatePlanIds=[EXTRA])
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json["inboundRatePlanIds"], [EXTRA])
        self.add_extra(rate_mode="derived", currency="USD")
        self.assertEqual(self.save(inboundRatePlanIds=[EXTRA]).status_code, 422)

    def test_existing_accepted_ids_survive_legacy_save_and_cannot_be_removed_after_use(self):
        self.add_extra(rate_mode="derived")
        self.assertEqual(self.save(inboundRatePlanIds=[EXTRA]).status_code, 200)
        self.import_booking()
        response = self.save()
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json["inboundRatePlanIds"], [EXTRA])
        response = self.save(inboundRatePlanIds=[])
        self.assertEqual(response.status_code, 409, response.json)

    def test_catalog_failure_does_not_prevent_closing_existing_mapping(self):
        self.import_booking()
        self.provider.catalog.side_effect = ProviderError("provider_unavailable", True)
        response = self.save(active=False)
        self.assertEqual(response.status_code, 200, response.json)
        self.assertTrue(response.json["pauseRequested"])
        response = self.save(inboundRatePlanIds=[EXTRA])
        self.assertEqual(response.status_code, 409, response.json)

    def test_invalid_aliases_and_unknown_fields_are_rejected(self):
        for value in (None, "x", [REMOTE_RATE], [EXTRA, EXTRA], [True], ["bad"]):
            with self.subTest(value=value):
                self.assertEqual(self.save(inboundRatePlanIds=value).status_code, 422)
        self.assertEqual(self.save(unexpected=True).status_code, 422)
