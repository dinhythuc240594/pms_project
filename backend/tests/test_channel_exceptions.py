"""Financial OTA extras and operator decisions must reconcile without forged cash."""

import unittest
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, select

from pms_api.bookings.models import (
    Charge,
    LedgerEntry,
    Reservation,
    ReservationNight,
    ReservationRoom,
)
from pms_api.channels.importer import normalize
from pms_api.channels.models import (
    ChannelBookingReview,
    ChannelReviewResolution,
    ChannelRevision,
    ChannelSyncIncident,
)
from pms_api.core_models import Tenant, utcnow
from pms_api.extensions import db
from pms_api.security import ApiError, set_context
from tests.test_channels_integration import PROPERTY, ChannelTestCase, revision


def tax(amount="10", inclusive=False):
    return {
        "name": "City tax",
        "type": "city_tax",
        "is_inclusive": inclusive,
        "total_price": amount,
    }


class FinancialExtrasTests(unittest.TestCase):
    def test_tax_and_service_totals_are_not_double_counted(self):
        entity = revision(amount="230")
        room = entity["attributes"]["rooms"][0]
        room.update(amount="200", taxes=[tax(), tax("20", True)])
        entity["attributes"]["services"] = [{"name": "Breakfast", "total_price": "20"}]
        result = normalize(entity, PROPERTY)
        self.assertEqual(sum(result["rooms"][0]["prices"].values()), Decimal("180"))
        self.assertEqual(sum(line["amount"] for line in result["extras"]), Decimal("50"))
        self.assertEqual(result["amount"], Decimal("230"))

    def test_withheld_and_ambiguous_financials_require_explicit_review(self):
        entity = revision()
        entity["attributes"]["rooms"][0]["collected_taxes"] = [tax()]
        with self.assertRaises(ApiError):
            normalize(entity, PROPERTY)
        entity = revision()
        entity["attributes"]["rooms"][0]["taxes"] = [tax()]
        with self.assertRaises(ApiError):
            normalize(entity, PROPERTY)


class ChannelExceptionTests(ChannelTestCase):
    def setUp(self):
        super().setUp()
        provider = patch("pms_api.channels.exceptions.ChannexClient", return_value=self.provider)
        provider.start()
        self.addCleanup(provider.stop)

    def test_import_posts_exact_extras_without_local_cash(self):
        entity = revision(amount="230")
        entity["attributes"]["rooms"][0].update(amount="200", taxes=[tax()])
        entity["attributes"]["services"] = [{"name": "Breakfast", "total_price": "20"}]
        rows = self.import_booking(entity)
        self.assertEqual(len(rows), 1)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(
                db.session.scalar(select(func.sum(ReservationNight.price))), Decimal("200")
            )
            self.assertEqual(db.session.scalar(select(func.sum(Charge.amount))), Decimal("30"))
            self.assertEqual(db.session.scalar(select(func.count()).select_from(LedgerEntry)), 0)

    def test_cancellation_with_existing_extras_requires_review_before_ack(self):
        entity = revision(amount="230")
        entity["attributes"]["rooms"][0].update(amount="200", taxes=[tax()])
        entity["attributes"]["services"] = [{"name": "Breakfast", "total_price": "20"}]
        booking = self.import_booking(entity)[0]
        self.run_jobs(5)
        self.provider.ack.reset_mock()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            original_charges = list(
                db.session.execute(select(Charge.id, Charge.amount).order_by(Charge.id))
            )

        cancellation = revision(11, "cancelled", amount="0")
        self.enqueue_revision(cancellation)
        self.run_jobs(5)

        self.assertEqual(self.local_bookings()[0]["status"], "CONFIRMED")
        self.provider.ack.assert_not_called()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(
                list(db.session.execute(select(Charge.id, Charge.amount).order_by(Charge.id))),
                original_charges,
            )
            self.assertEqual(
                db.session.scalar(
                    select(ChannelBookingReview.error_code).where(
                        ChannelBookingReview.revision_id == cancellation["id"],
                    )
                ),
                "booking_requires_review",
            )
            self.assertIsNone(
                db.session.scalar(
                    select(ChannelRevision.id).where(
                        ChannelRevision.revision_id == cancellation["id"],
                    )
                )
            )
            self.assertTrue(
                db.session.scalar(
                    select(ReservationRoom.active).where(
                        ReservationRoom.reservation_id == booking["id"],
                    )
                )
            )
        now = utcnow()
        day = now.astimezone(ZoneInfo("Asia/Ho_Chi_Minh")).date().isoformat()
        with patch(
            "pms_api.reconciliation.business_days.utcnow", return_value=now + timedelta(days=1)
        ):
            preview = self.request("get", "/reconciliation/night-audit?date=" + day)
        self.assertEqual(preview.status_code, 200, preview.json)
        self.assertEqual(preview.json["entries"], [])
        self.assertTrue(any(row["status"] == "OTA_REVIEW" for row in preview.json["blockers"]))

    def test_incident_webhook_is_authenticated_deduplicated_and_resolved_with_evidence(self):
        body = {
            "property_id": PROPERTY,
            "event": "sync_error",
            "timestamp": "2030-01-01T00:00:00Z",
            "payload": {
                "channel_id": str(UUID(int=71)),
                "channel_event_id": str(UUID(int=72)),
                "channel_name": "Booking.com",
                "error_type": "rate",
                "secret": "must-not-save",
            },
        }
        path = f"/api/channex/webhooks/{self.tenant_id}"
        self.assertEqual(self.client.post(path, json=body).status_code, 401)
        for _ in range(2):
            response = self.client.post(
                path,
                json=body,
                headers={"X-Channex-Webhook-Secret": "fixture-webhook-secret-32-characters"},
            )
            self.assertEqual(response.status_code, 202, response.json)
        response = self.request("get", "/channels/incidents")
        self.assertEqual(response.status_code, 200, response.json)
        rows = response.json["items"]
        self.assertEqual(len(rows), 1)
        self.assertNotIn("must-not-save", str(rows))
        incident_id = rows[0]["id"]
        denied = self.request(
            "post",
            f"/channels/incidents/{incident_id}/actions",
            {"action": "resolve", "reason": "Checked OTA"},
            key="invalid-action",
        )
        self.assertEqual(denied.status_code, 422, denied.json)
        resolved = self.request(
            "post",
            f"/channels/incidents/{incident_id}/actions",
            {"action": "resolve", "reason": "Checked OTA inventory after retry", "verified": True},
            key="resolved-action",
        )
        self.assertEqual(resolved.status_code, 200, resolved.json)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(
                db.session.scalar(select(func.count()).select_from(ChannelSyncIncident)), 1
            )

    def test_manual_resolution_requires_exact_amounts_and_commits_before_ack(self):
        entity = revision()
        entity["attributes"]["rooms"][0]["collected_taxes"] = [tax()]
        self.import_booking(entity)
        review = self.request("get", "/channels/booking-reviews").json["items"][0]
        booking = self.request(
            "post",
            "/reservations",
            {
                "guest": "Manually reconciled",
                "rooms": ["101"],
                "checkIn": "2030-01-01",
                "checkOut": "2030-01-03",
            },
        )
        self.assertEqual(booking.status_code, 201, booking.json)
        data = {
            "reservationId": booking.json["id"],
            "expectedVersion": booking.json["version"],
            "providerTotal": "200",
            "expectedTotal": "200",
            "confirm": True,
            "reason": "Verified OTA withheld tax and corrected local folio",
        }
        path = f"/channels/booking-reviews/{review['id']}/resolve"
        mismatch = self.request(
            "post", path, {**data, "expectedTotal": "199"}, key="review-wrong-amount"
        )
        self.assertEqual(mismatch.status_code, 409, mismatch.json)
        self.provider.ack.assert_not_called()
        response = self.request("post", path, data, key="review-manual-001")
        self.assertEqual(response.status_code, 200, response.json)
        replay = self.request("post", path, data, key="review-manual-001")
        self.assertEqual(replay.json, response.json)
        self.provider.ack.assert_not_called()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(
                db.session.scalar(select(func.count()).select_from(ChannelReviewResolution)), 1
            )
            self.assertIsNotNone(db.session.scalar(select(ChannelBookingReview.resolved_at)))
            self.assertIsNotNone(db.session.scalar(select(ChannelRevision.id)))
        self.run_jobs(5)
        self.provider.ack.assert_called_once_with(entity["id"])

    def test_closed_day_import_is_retained_for_review_and_never_acknowledged(self):
        from pms_api.pricing.engine import business_date

        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            day = business_date(db.session.get(Tenant, self.tenant_id)) - timedelta(days=1)
        preview = self.request("get", "/reconciliation/night-audit?date=" + day.isoformat())
        self.assertEqual(preview.status_code, 200, preview.json)
        result = self.request(
            "post",
            "/reconciliation/night-audit",
            {
                "date": day.isoformat(),
                "previewToken": preview.json["previewToken"],
                "reason": "Closed day fixture",
            },
            key="closed-ota-day",
        )
        self.assertEqual(result.status_code, 201, result.json)
        entity = revision(
            start=day.isoformat(), end=(day + timedelta(days=1)).isoformat(), amount="100"
        )
        entity["attributes"]["rooms"][0]["days"] = {day.isoformat(): "100"}
        self.assertEqual(self.import_booking(entity), [])
        self.run_jobs(2)
        self.provider.ack.assert_not_called()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(db.session.scalar(select(func.count()).select_from(Reservation)), 0)
            self.assertEqual(
                db.session.scalar(select(ChannelBookingReview.error_code)), "period_closed"
            )
            self.assertEqual(
                db.session.scalar(select(func.count()).select_from(ChannelRevision)), 0
            )

    def test_incidents_keep_tenants_isolated_and_support_scope_only(self):
        body = {
            "property_id": PROPERTY,
            "event": "rate_error",
            "payload": {
                "channel_id": str(UUID(int=73)),
                "channel_event_id": str(UUID(int=74)),
                "error_type": "invalid_rate",
            },
        }
        response = self.client.post(
            f"/api/channex/webhooks/{self.tenant_id}",
            json=body,
            headers={"X-Channex-Webhook-Secret": "fixture-webhook-secret-32-characters"},
        )
        self.assertEqual(response.status_code, 202, response.json)
        incident_id = response.json["incidentId"]
        other, headers = self.login("owner-b@test.local")
        self.assertEqual(
            self.request("get", "/channels/incidents", client=other, headers=headers).status_code,
            403,
        )
        other_rows = self.request(
            "get",
            f"/api/tenants/{self.other_tenant_id}/channels/incidents",
            client=other,
            headers=headers,
        )
        self.assertEqual(other_rows.json["items"], [])
        self.assertEqual(
            self.request(
                "post",
                f"/channels/incidents/{incident_id}/actions",
                {"action": "assign", "assigneeId": "owner-b", "reason": "Wrong tenant"},
                key="cross-assignee",
            ).status_code,
            422,
        )
        desk, headers = self.login("frontdesk@test.local")
        self.assertEqual(
            self.request(
                "post",
                f"/channels/incidents/{incident_id}/actions",
                {"action": "resolve", "verified": True, "reason": "Desk"},
                client=desk,
                headers=headers,
                key="desk-incident",
            ).status_code,
            403,
        )
        manager, headers = self.login("manager@test.local")
        prefix = f"/api/admin/channex/tenants/{self.tenant_id}/channels/incidents"
        self.assertEqual(
            self.request("get", prefix, client=manager, headers=headers).json["items"][0]["id"],
            incident_id,
        )
        response = self.request(
            "post",
            prefix + f"/{incident_id}/actions",
            {
                "action": "resolve",
                "verified": True,
                "reason": "Support verified actual channel rates",
            },
            client=manager,
            headers=headers,
            key="support-incident",
        )
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json["resolvedBy"], "manager")
        malformed = {**body, "payload": {"property_id": str(UUID(int=99))}}
        self.assertEqual(
            self.client.post(
                f"/api/channex/webhooks/{self.tenant_id}",
                json=malformed,
                headers={"X-Channex-Webhook-Secret": "fixture-webhook-secret-32-characters"},
            ).status_code,
            422,
        )
