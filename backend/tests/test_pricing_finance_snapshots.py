"""FX changes cannot rewrite cashbook compensation or fund currency history."""

from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select

from pms_api.bookings.models import Charge, LedgerEntry, Payment, Refund
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class FinanceSnapshotTests(DomainTestCase):
    def test_closed_stay_adjustments_keep_booking_fx_and_pair_exact_refund_value(self):
        self.assertEqual(
            self.request(
                "PUT", "/pricing/exchange-rates", {"currency": "USD", "rate": "3.33333333"}
            ).status_code,
            200,
        )
        fund = self.request(
            "POST", "/masters/funds", {"name": "USD cash", "type": "cash", "currency": "USD"}
        ).json["id"]
        start = date.today()
        booking = self.request(
            "POST",
            "/reservations",
            {
                "guest": "Closed USD stay",
                "room": "101",
                "sourceId": "direct-a",
                "currency": "USD",
                "checkIn": str(start),
                "checkOut": str(start + timedelta(days=1)),
            },
        )
        self.assertEqual(booking.status_code, 201, booking.json)
        row = booking.json
        path = f"/reservations/{row['id']}"
        paid = self.request(
            "POST",
            path + "/payments",
            {
                "amount": row["total"],
                "fundId": fund,
                "methodId": "cash-a",
            },
            key="closed-usd-payment",
        )
        self.assertEqual(paid.status_code, 201, paid.json)
        payment_id = paid.json["payments"][0]["id"]
        for status in ("IN_HOUSE", "CHECKED_OUT"):
            self.assertEqual(
                self.request("POST", path + "/status", {"status": status}).status_code, 200
            )
        self.assertEqual(
            self.request(
                "PUT", "/pricing/exchange-rates", {"currency": "USD", "rate": "8.5"}
            ).status_code,
            200,
        )
        for kind, amount in (("credit", "1.0001"), ("debit", "0.1234")):
            result = self.request(
                "POST",
                path + "/adjustments",
                {
                    "type": kind,
                    "amount": amount,
                    "reason": "Frozen FX adjustment",
                    "paymentId": payment_id,
                    "methodId": "cash-a",
                    "fundId": fund,
                },
                key="closed-usd-" + kind,
            )
            self.assertEqual(result.status_code, 201, result.json)
            self.assertEqual(Decimal(result.json["balance"]), 0)
        with self.app.app_context():
            set_context(tenant_id=self.tenant_id)
            credits = list(
                db.session.scalars(
                    select(Charge).where(Charge.reservation_id == row["id"]).order_by(Charge.amount)
                )
            )
            refund = db.session.scalar(select(Refund).where(Refund.reservation_id == row["id"]))
            debit = db.session.scalar(
                select(Payment).where(Payment.reservation_id == row["id"], Payment.id != payment_id)
            )
            self.assertEqual(credits[0].base_amount, -refund.base_amount)
            self.assertEqual(refund.base_amount, Decimal("3.3337"))
            self.assertEqual(credits[1].base_amount, debit.base_amount)
            self.assertEqual(debit.base_amount, Decimal("0.4113"))
            self.assertEqual(debit.exchange_rate, Decimal("3.33333333"))

    def test_foreign_cash_reversal_uses_frozen_value_and_locks_fund_currency(self):
        rate = self.request(
            "PUT", "/pricing/exchange-rates", {"currency": "USD", "rate": "3.33333333"}
        )
        self.assertEqual(rate.status_code, 200, rate.json)
        fund = self.request(
            "POST", "/masters/funds", {"name": "USD cash", "type": "cash", "currency": "USD"}
        )
        self.assertEqual(fund.status_code, 201, fund.json)
        fund_id = fund.json["id"]
        created = self.request(
            "POST",
            "/cash-documents",
            {
                "type": "receipt",
                "amount": "1.0001",
                "currency": "USD",
                "fundId": fund_id,
                "description": "FX proof",
            },
            key="cash-fx-proof",
        )
        self.assertEqual(created.status_code, 201, created.json)
        self.assertEqual(Decimal(created.json["baseAmount"]), Decimal("3.3337"))
        changed = self.request("PUT", "/pricing/exchange-rates", {"currency": "USD", "rate": "8.5"})
        self.assertEqual(changed.status_code, 200, changed.json)
        reversed_document = self.request(
            "POST",
            f"/cash-documents/{created.json['id']}/reverse",
            {"reason": "Reverse proof"},
            key="cash-fx-reverse",
        )
        self.assertEqual(reversed_document.status_code, 201, reversed_document.json)
        self.assertEqual(Decimal(reversed_document.json["baseAmount"]), Decimal("3.3337"))
        refused = self.request(
            "PATCH", "/masters/funds", {"id": fund_id, "name": "USD cash", "currency": "VND"}
        )
        self.assertEqual(refused.status_code, 409, refused.json)
        with self.app.app_context():
            set_context(tenant_id=self.tenant_id)
            rows = list(
                db.session.scalars(select(LedgerEntry).where(LedgerEntry.fund_id == fund_id))
            )
            self.assertEqual(len(rows), 2)
            self.assertEqual(sum((row.amount for row in rows), Decimal(0)), 0)
            self.assertEqual(sum((row.base_amount for row in rows), Decimal(0)), 0)
