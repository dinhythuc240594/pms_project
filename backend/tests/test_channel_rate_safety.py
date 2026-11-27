"""Exact incoming rate plans and provider money must survive an OTA import."""

import unittest
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select

from pms_api.bookings.models import Reservation
from pms_api.channels.importer import normalize, review_details
from pms_api.channels.models import ChannelBookingReview, ChannelMapping, ChannelRevision
from pms_api.core_models import utcnow
from pms_api.extensions import db
from pms_api.security import ApiError, set_context
from tests.test_channels_integration import PROPERTY, REMOTE_ROOM, ChannelTestCase, revision

CHILD_RATE = str(UUID(int=51))


class RateMoneyNormalizationTests(unittest.TestCase):
    def test_provider_commission_is_a_validated_amount_not_a_percent(self):
        entity = revision()
        entity["attributes"]["ota_commission"] = "27.5000"
        self.assertEqual(normalize(entity, PROPERTY)["otaCommission"], Decimal("27.5000"))
        for value in (True, {}, "NaN", "-1", "201", "0.00001"):
            with self.subTest(value=value):
                entity["attributes"]["ota_commission"] = value
                with self.assertRaises(ApiError) as caught:
                    normalize(entity, PROPERTY)
                self.assertEqual(caught.exception.code, "booking_commission_unsupported")

    def test_unhandled_tax_fields_cannot_be_silently_dropped(self):
        for scope in ("booking", "room"):
            for field in ("taxes", "collected_taxes"):
                entity = revision()
                target = entity["attributes"]
                if scope == "room":
                    target = target["rooms"][0]
                target[field] = [{"amount": "10", "is_inclusive": False}]
                with self.subTest(scope=scope, field=field):
                    with self.assertRaises(ApiError) as caught:
                        normalize(entity, PROPERTY)
                    self.assertEqual(caught.exception.code, "booking_financial_extras_unsupported")

    def test_empty_tax_fields_are_accepted(self):
        entity = revision()
        entity["attributes"].update(taxes=[], collected_taxes=[])
        entity["attributes"]["rooms"][0].update(taxes=[], collected_taxes=[])
        self.assertEqual(normalize(entity, PROPERTY)["amount"], Decimal("200"))

    def test_review_retains_bounded_financial_context_without_provider_secrets(self):
        entity = revision()
        entity["attributes"].update(ota_commission="27.50", taxes=[{"amount": "10"}])
        entity["attributes"]["rooms"][0]["taxes"] = [{"amount": "10"}]
        details = review_details(entity)
        self.assertEqual(details["otaCommission"], "27.50")
        self.assertTrue(details["hasTaxes"])
        self.assertEqual(details["rooms"][0]["amount"], "200")
        self.assertEqual(details["rooms"][0]["days"], {"2030-01-01": "100", "2030-01-02": "100"})
        self.assertTrue(details["rooms"][0]["hasTaxes"])
        self.assertNotIn("fixture-sensitive-card", str(details))


class RateMoneyImportTests(ChannelTestCase):
    def add_incoming_rate(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            mapping = db.session.scalar(select(ChannelMapping))
            mapping.inbound_rate_plan_ids = [CHILD_RATE]
            db.session.commit()

    def test_explicit_child_plan_imports_exact_provider_prices_and_revision_snapshot(self):
        self.add_incoming_rate()
        entity = revision()
        entity["attributes"]["ota_commission"] = "27.50"
        entity["attributes"]["rooms"][0]["rate_plan_id"] = CHILD_RATE
        row = self.import_booking(entity)[0]
        channel = row["snapshot"]["channel"]
        self.assertEqual(channel["rooms"][0]["ratePlanId"], CHILD_RATE)
        self.assertEqual(channel["rooms"][0]["roomTypeId"], REMOTE_ROOM)
        self.assertEqual(channel["rooms"][0]["days"], entity["attributes"]["rooms"][0]["days"])
        self.assertEqual(channel["amount"], "200")
        self.assertEqual(channel["otaCommission"], "27.50")
        self.assertEqual(row["snapshot"]["commission"]["providerAmount"], "27.50")
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            receipt = db.session.scalar(select(ChannelRevision))
            self.assertEqual(receipt.money_snapshot, channel)

    def test_unknown_child_plan_remains_unacked_without_parent_fallback(self):
        entity = revision()
        entity["attributes"]["rooms"][0]["rate_plan_id"] = CHILD_RATE
        self.assertEqual(self.import_booking(entity), [])
        self.run_jobs(5)
        self.provider.ack.assert_not_called()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(
                db.session.scalar(select(ChannelBookingReview.error_code)), "booking_unmapped"
            )

    def test_tax_review_keeps_original_stay_and_no_receipt_for_modification(self):
        initial = self.import_booking()[0]
        self.run_jobs(5)
        changed = revision(11, "modified")
        changed["attributes"]["taxes"] = [{"amount": "10"}]
        self.assertEqual(self.import_booking(changed)[0], initial)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(
                db.session.scalar(select(ChannelBookingReview.error_code)),
                "booking_financial_extras_unsupported",
            )
            self.assertEqual(len(list(db.session.scalars(select(ChannelRevision)))), 1)

    def test_changed_total_without_previous_provider_commission_requires_review(self):
        entity = revision()
        entity["attributes"]["ota_commission"] = "27.50"
        original = self.import_booking(entity)[0]
        self.run_jobs(5)
        changed = revision(11, "modified", amount="240")
        changed["attributes"]["rooms"][0]["days"] = {"2030-01-01": "120", "2030-01-02": "120"}
        self.assertEqual(self.import_booking(changed)[0], original)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(
                db.session.scalar(select(ChannelBookingReview.error_code)),
                "booking_commission_missing",
            )

    def test_provider_amount_settlement_uses_actual_amount_instead_of_local_percent(self):
        source = self.request(
            "post",
            "/masters/bookingSources",
            {"name": "BookingCom", "type": "OTA", "commission": "15"},
        )
        self.assertEqual(source.status_code, 201, source.json)
        entity = revision()
        entity["attributes"]["ota_commission"] = "27.50"
        row = self.import_booking(entity)[0]
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            booking = db.session.get(Reservation, row["id"])
            booking.status = "CHECKED_OUT"
            db.session.commit()
        response = self.request("post", "/commissions/settle", {"bookingId": row["id"]})
        self.assertEqual(response.status_code, 201, response.json)
        self.assertEqual(Decimal(response.json["amount"]), Decimal("27.5"))
        self.assertEqual(Decimal(response.json["baseAmount"]), Decimal("27.5"))
        self.assertIsNone(response.json["percent"])
        self.assertEqual(response.json["calculationBasis"], "provider_amount")

    def test_provider_commission_uses_frozen_booking_exchange_rate(self):
        self.assertEqual(
            self.request(
                "put", "/pricing/exchange-rates", {"currency": "USD", "rate": "25000"}
            ).status_code,
            200,
        )
        entity = revision()
        entity["attributes"].update(currency="USD", ota_commission="27.50")
        row = self.import_booking(entity)[0]
        self.assertEqual(
            self.request(
                "put", "/pricing/exchange-rates", {"currency": "USD", "rate": "26000"}
            ).status_code,
            200,
        )
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.get(Reservation, row["id"]).status = "CHECKED_OUT"
            db.session.commit()
        response = self.request("post", "/commissions/settle", {"bookingId": row["id"]})
        self.assertEqual(response.status_code, 201, response.json)
        self.assertEqual(Decimal(response.json["amount"]), Decimal("27.5"))
        self.assertEqual(Decimal(response.json["baseAmount"]), Decimal("687500"))
        self.assertEqual(Decimal(response.json["exchangeRate"]), Decimal("25000"))

    def test_accepted_snapshot_uses_sum_of_rounded_nightly_base_amounts(self):
        self.assertEqual(
            self.request(
                "put", "/pricing/exchange-rates", {"currency": "USD", "rate": "1.00005"}
            ).status_code,
            200,
        )
        entity = revision(amount="2")
        entity["attributes"]["currency"] = "USD"
        entity["attributes"]["rooms"][0]["days"] = {"2030-01-01": "1", "2030-01-02": "1"}
        channel = self.import_booking(entity)[0]["snapshot"]["channel"]
        self.assertEqual(Decimal(channel["baseAmount"]), Decimal("2.0002"))
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(
                db.session.scalar(select(ChannelRevision.money_snapshot))["baseAmount"],
                channel["baseAmount"],
            )

    def test_modified_commission_has_independent_accepted_revision_history(self):
        original = revision()
        original["attributes"]["ota_commission"] = "27.50"
        self.import_booking(original)
        self.run_jobs(5)
        modified = revision(11, "modified")
        modified["attributes"]["ota_commission"] = "30"
        row = self.import_booking(modified)[0]
        self.assertEqual(row["snapshot"]["commission"]["providerAmount"], "30")
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            receipts = {
                r.revision_id: r.money_snapshot for r in db.session.scalars(select(ChannelRevision))
            }
            self.assertEqual(receipts[original["id"]]["otaCommission"], "27.50")
            self.assertEqual(receipts[modified["id"]]["otaCommission"], "30")

    def test_downgrade_cannot_discard_provider_only_commission_settlement(self):
        created = self.request(
            "post",
            "/reservations",
            {
                "guest": "Legacy provider commission",
                "rooms": ["101"],
                "checkIn": "2030-01-01",
                "checkOut": "2030-01-03",
                "source": "Direct",
            },
        )
        self.assertEqual(created.status_code, 201, created.json)
        row = created.json
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            booking = db.session.get(Reservation, row["id"])
            booking.status = "CHECKED_OUT"
            booking.pricing_snapshot = {
                **booking.pricing_snapshot,
                "commission": {"providerAmount": "27.50"},
            }
            db.session.commit()
        response = self.request("post", "/commissions/settle", {"bookingId": row["id"]})
        self.assertEqual(response.status_code, 201, response.json)
        result = self.app.test_cli_runner().invoke(args=["db", "downgrade", "0036_channel_support"])
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("provider money history", str(result.exception))

    def test_unresolved_provider_revision_blocks_commission_payment_until_resolved(self):
        entity = revision()
        entity["attributes"]["ota_commission"] = "27.50"
        row = self.import_booking(entity)[0]
        self.run_jobs(5)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.get(Reservation, row["id"]).status = "CHECKED_OUT"
            db.session.commit()
        settled = self.request("post", "/commissions/settle", {"bookingId": row["id"]})
        self.assertEqual(settled.status_code, 201, settled.json)
        modified = revision(11, "modified")
        modified["attributes"]["taxes"] = [{"amount": "10"}]
        self.import_booking(modified)
        response = self.request(
            "post",
            f"/commissions/{settled.json['id']}/payments",
            {
                "amount": "1",
                "fundId": "fund-a",
                "note": "Provider review guard",
            },
            key="provider-review-payout",
        )
        self.assertEqual(response.status_code, 409, response.json)
        self.assertEqual(response.json["error"]["code"], "commission_needs_review")
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.scalar(select(ChannelBookingReview)).resolved_at = utcnow()
            db.session.commit()
        response = self.request("get", "/commissions?endDate=2030-01-03")
        self.assertEqual(response.status_code, 200, response.json)
        self.assertFalse(response.json["items"][0]["needsReview"])
