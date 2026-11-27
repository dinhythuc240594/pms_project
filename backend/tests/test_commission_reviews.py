"""Commission corrections preserve original accruals and cash documents."""

from decimal import Decimal
from uuid import uuid4

from sqlalchemy import func, select, update
from sqlalchemy.exc import DBAPIError

from pms_api.bookings.models import Reservation
from pms_api.channels.models import ChannelBooking, ChannelBookingReview
from pms_api.core_models import utcnow
from pms_api.extensions import db
from pms_api.finance.models import CashDocument, CommissionReview, CommissionSettlement
from pms_api.security import ApiError, set_context
from tests import test_commissions as fixtures
from tests.domain_fixture import DomainTestCase


class CommissionReviewTests(DomainTestCase):
    booking = fixtures.CommissionTests.booking
    close = fixtures.CommissionTests.close
    settle = fixtures.CommissionTests.settle
    payout = fixtures.CommissionTests.payout

    def preview(self, item):
        response = self.request("get", f"/commissions/{item['id']}/review")
        self.assertEqual(response.status_code, 200, response.json)
        return response.json

    def review(self, item, *, key="commission-review", **changes):
        preview = self.preview(item)
        data = {
            "previewToken": preview["previewToken"],
            "allocations": [
                {
                    "chargeId": line["id"],
                    "roomAmount": line["amount"] if line["kind"] == "discount" else "0",
                }
                for line in preview["charges"]
                if line["allocatable"]
            ],
            "reason": "Đã kiểm tra phân bổ tiền phòng với đại lý",
            **changes,
        }
        response = self.request("post", f"/commissions/{item['id']}/review", data, key=key)
        return response, data

    def correction(self, booking, amount="50", *, key="review-credit"):
        payment = booking["payments"][0]
        response = self.request(
            "post",
            f"/reservations/{booking['id']}/adjustments",
            {
                "type": "credit",
                "amount": amount,
                "reason": "Giảm tiền phòng sau trả phòng",
                "paymentId": payment["id"],
            },
            key=key,
        )
        self.assertEqual(response.status_code, 201, response.json)
        return response.json

    def test_allocation_resolves_old_discount_and_later_changes_reopen_review(self):
        booking = self.close(self.booking(charges=True))
        original = self.settle(booking)
        self.assertTrue(original["needsReview"])
        result, data = self.review(original)
        self.assertEqual(result.status_code, 201, result.json)
        self.assertEqual(result.json["roomNet"], "195.0000")
        self.assertEqual(result.json["amount"], "19.5000")
        self.assertFalse(result.json["needsReview"])
        replay = self.request(
            "post", f"/commissions/{original['id']}/review", data, key="commission-review"
        )
        self.assertEqual(replay.json, result.json)
        self.assertEqual(len(result.json["reviews"]), 1)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            frozen = db.session.get(CommissionSettlement, original["id"])
            self.assertEqual(frozen.amount, Decimal("20"))
            self.assertEqual(frozen.room_net, Decimal("200"))
        self.assertEqual(self.payout(original, "1").status_code, 201)
        self.correction(booking, "20")
        current = self.request("get", "/commissions?status=NEEDS_REVIEW").json["items"][0]
        self.assertTrue(current["needsReview"])
        blocked = self.payout(original, "1", key="review-new-charge-payout")
        self.assertEqual(blocked.status_code, 409, blocked.json)
        second, _ = self.review(original, key="review-second")
        self.assertEqual(second.status_code, 201, second.json)
        self.assertEqual(second.json["amount"], "17.5000")
        self.assertEqual(len(second.json["reviews"]), 2)
        self.assertFalse(second.json["needsReview"])

    def test_overpaid_commission_is_recovered_with_receipts_and_immutable_history(self):
        booking = self.close(self.booking())
        original = self.settle(booking)
        paid = self.payout(original, "20")
        self.assertEqual(paid.status_code, 201, paid.json)
        self.correction(booking)
        reviewed, _ = self.review(original)
        self.assertEqual(reviewed.status_code, 201, reviewed.json)
        self.assertEqual(reviewed.json["amount"], "15.0000")
        self.assertEqual(reviewed.json["recoveryDue"], "5.0000")
        self.assertEqual(reviewed.json["status"], "OVERPAID")
        self.assertEqual(len(self.request("get", "/commissions?status=OVERPAID").json["items"]), 1)
        data = {"amount": "3", "fundId": "fund-a", "note": "Đại lý trả lại hoa hồng"}
        path = f"/commissions/{original['id']}/recoveries"
        recovered = self.request("post", path, data, key="commission-recovery")
        self.assertEqual(recovered.status_code, 201, recovered.json)
        self.assertEqual(recovered.json["paid"], "17.0000")
        self.assertEqual(recovered.json["recoveryDue"], "2.0000")
        self.assertEqual(len(recovered.json["recoveries"]), 1)
        self.assertEqual(
            self.request("post", path, data, key="commission-recovery").json, recovered.json
        )
        self.assertEqual(
            self.request("post", path, {**data, "amount": "3"}, key="over-recover").status_code, 409
        )
        final = self.request("post", path, {**data, "amount": "2"}, key="recover-rest")
        self.assertEqual(final.status_code, 201, final.json)
        self.assertEqual(final.json["balance"], "0.0000")
        self.assertEqual(final.json["status"], "PAID")
        summary = self.request("get", "/commissions").json["summary"]
        self.assertEqual(
            (summary["accrued"], summary["paid"], summary["balance"]),
            ("15.0000", "15.0000", "0.0000"),
        )
        receipt = recovered.json["recoveries"][0]["cashDocumentId"]
        reversal = self.request(
            "post",
            f"/cash-documents/{receipt}/reverse",
            {"reason": "Hoàn trả nhầm"},
            key="recovery-reverse",
        )
        self.assertEqual(reversal.status_code, 201, reversal.json)
        current = self.request("get", "/commissions").json["items"][0]
        self.assertEqual(current["recoveryDue"], "3.0000")
        self.assertTrue(current["recoveries"][0]["reversed"])

    def test_review_rejects_stale_preview_invalid_allocations_and_untrusted_roles(self):
        booking = self.close(self.booking(charges=True))
        original = self.settle(booking)
        preview = self.preview(original)
        data = {"previewToken": preview["previewToken"], "allocations": [], "reason": "Reviewed"}
        path = f"/commissions/{original['id']}/review"
        self.assertEqual(
            self.request("post", path, data, key="review-missing-lines").status_code, 422
        )
        data["allocations"] = [
            {"chargeId": line["id"], "roomAmount": "999"}
            for line in preview["charges"]
            if line["allocatable"]
        ]
        self.assertEqual(self.request("post", path, data, key="review-bad-lines").status_code, 422)
        self.correction(booking, "1")
        stale = self.request("post", path, data, key="review-stale-data")
        self.assertEqual(stale.status_code, 409, stale.json)
        self.assertEqual(stale.json["error"]["code"], "preview_changed")
        for email in ("frontdesk@test.local", "owner-b@test.local"):
            client, headers = self.login(email)
            self.assertEqual(
                self.request("post", path, data, client=client, headers=headers).status_code, 403
            )

    def test_provider_amount_needs_explicit_reconfirmation_within_room_basis(self):
        booking = self.close(self.booking())
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            row = db.session.get(Reservation, booking["id"])
            row.pricing_snapshot = {
                **row.pricing_snapshot,
                "commission": {"providerAmount": "27.50"},
            }
            db.session.commit()
        original = self.settle(booking)
        missing, _ = self.review(original)
        self.assertEqual(missing.status_code, 422, missing.json)
        invalid, _ = self.review(original, providerAmount="201")
        self.assertEqual(invalid.status_code, 422, invalid.json)
        valid, _ = self.review(original, providerAmount="25")
        self.assertEqual(valid.status_code, 201, valid.json)
        self.assertEqual(valid.json["amount"], "25.0000")
        self.assertIsNone(valid.json["percent"])

    def test_unresolved_ota_cannot_be_overridden_by_commission_review(self):
        original = self.settle(self.close(self.booking()))
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            remote_id, revision = str(uuid4()), str(uuid4())
            db.session.add(
                ChannelBooking(
                    tenant_id=self.tenant_id,
                    booking_id=remote_id,
                    reservation_id=original["bookingId"],
                    latest_revision_at=utcnow(),
                    latest_revision_id=revision,
                )
            )
            db.session.flush()
            db.session.add(
                ChannelBookingReview(
                    tenant_id=self.tenant_id,
                    booking_id=remote_id,
                    revision_id=revision,
                    provider_status="modified",
                    revision_at=utcnow(),
                    error_code="booking_changed",
                    details={},
                )
            )
            db.session.commit()
        self.assertTrue(self.preview(original)["blockedByOta"])
        result, _ = self.review(original)
        self.assertEqual(result.status_code, 409, result.json)
        self.assertEqual(result.json["error"]["code"], "commission_needs_review")

    def test_manual_provider_resolution_reopens_review_without_new_charge_or_refund(self):
        booking = self.close(self.booking())
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            row = db.session.get(Reservation, booking["id"])
            row.pricing_snapshot = {
                **row.pricing_snapshot,
                "commission": {"providerAmount": "27.50"},
            }
            db.session.commit()
        original = self.settle(booking)
        reviewed, _ = self.review(original, providerAmount="27.50")
        self.assertEqual(reviewed.status_code, 201, reviewed.json)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            row = db.session.get(Reservation, booking["id"])
            row.pricing_snapshot = {
                **row.pricing_snapshot,
                "commission": {"providerAmount": "30", "providerRevisionId": "revision-2"},
                "channel": {"lastManualResolutionId": "resolution-2"},
            }
            db.session.commit()
        current = self.request("get", "/commissions?status=NEEDS_REVIEW").json["items"]
        self.assertEqual(len(current), 1)
        self.assertTrue(current[0]["needsReview"])
        blocked = self.payout(original, "1", key="provider-revised-payout")
        self.assertEqual(blocked.status_code, 409, blocked.json)
        latest, _ = self.review(original, providerAmount="30", key="provider-revised-review")
        self.assertEqual(latest.status_code, 201, latest.json)
        self.assertFalse(latest.json["needsReview"])
        self.assertEqual(latest.json["amount"], "30.0000")
        self.assertEqual(len(latest.json["reviews"]), 2)

    def test_decisions_are_append_only_tenant_scoped_and_recovery_rolls_back_on_cash_failure(self):
        from unittest.mock import patch

        booking = self.close(self.booking())
        original = self.settle(booking)
        self.assertEqual(self.payout(original, "20").status_code, 201)
        self.correction(booking)
        reviewed, _ = self.review(original)
        self.assertEqual(reviewed.status_code, 201, reviewed.json)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            with self.assertRaises(DBAPIError):
                db.session.execute(update(CommissionReview).values(reason="Rewrite history"))
            db.session.rollback()
            set_context("owner-b", self.other_tenant_id)
            self.assertEqual(
                db.session.scalar(select(func.count()).select_from(CommissionReview)), 0
            )
            db.session.rollback()
            set_context(self.owner_id, self.tenant_id)
            count = db.session.scalar(select(func.count()).select_from(CashDocument))
        path = f"/commissions/{original['id']}/recoveries"
        with patch(
            "pms_api.finance.commissions.ledger",
            side_effect=ApiError(503, "cash_unavailable", "Cash unavailable"),
        ):
            failed = self.request(
                "post",
                path,
                {"amount": "5", "fundId": "fund-a", "note": "Returned commission"},
                key="recovery-rollback",
            )
        self.assertEqual(failed.status_code, 503, failed.json)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(
                db.session.scalar(select(func.count()).select_from(CashDocument)), count
            )
        current = self.request("get", "/commissions").json["items"][0]
        self.assertEqual(current["recoveryDue"], "5.0000")
        self.assertEqual(current["recoveries"], [])
