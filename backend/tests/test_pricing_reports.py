"""Mixed-currency reports use historical money snapshots in a disposable database."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import patch
from zoneinfo import ZoneInfo

from pms_api.bookings.models import LedgerEntry
from pms_api.core_models import uid, utcnow
from pms_api.extensions import db
from pms_api.finance.models import PosInvoice, PosPayment, PosRefund
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class PricingReportsTests(DomainTestCase):
    def prepare_fx(self):
        self.day = utcnow().astimezone(ZoneInfo("Asia/Ho_Chi_Minh")).date()
        result = self.request("PUT", "/pricing/exchange-rates", {"currency": "USD", "rate": "25"})
        self.assertEqual(result.status_code, 200, result.json)
        result = self.request(
            "POST", "/masters/funds", {"name": "USD report cash", "currency": "USD", "type": "cash"}
        )
        self.assertEqual(result.status_code, 201, result.json)
        self.usd_fund = result.json["id"]

    def booking(self, room, currency):
        response = self.request(
            "POST",
            "/reservations",
            {
                "guest": "Report exchange snapshot",
                "room": room,
                "sourceId": "direct-a",
                "checkIn": str(self.day),
                "checkOut": str(self.day + timedelta(days=1)),
                "currency": currency,
            },
        )
        self.assertEqual(response.status_code, 201, response.json)
        return response.json

    def pay(self, booking, amount):
        result = self.request(
            "POST",
            f"/reservations/{booking['id']}/payments",
            {
                "amount": amount,
                "methodId": "cash-a",
                "fundId": self.usd_fund if booking["currency"] == "USD" else "fund-a",
            },
            key=uid(),
        )
        self.assertEqual(result.status_code, 201, result.json)
        return result.json["payments"][0]

    def report(self, kind="financial", query=""):
        response = self.request(
            "GET",
            f"/reports/{kind}?start={self.day}&end={self.day + timedelta(days=1)}{query}",
        )
        self.assertEqual(response.status_code, 200, response.json)
        return response.json

    def test_base_forecast_deposits_debt_and_dashboard_preserve_frozen_fx(self):
        self.prepare_fx()
        usd, vnd = self.booking("101", "USD"), self.booking("102", "VND")
        self.assertEqual(Decimal(usd["total"]), 4)
        self.assertEqual(Decimal(usd["baseAmount"]), 100)
        changed = self.request("PUT", "/pricing/exchange-rates", {"currency": "USD", "rate": "50"})
        self.assertEqual(changed.status_code, 200, changed.json)
        extra = self.request(
            "POST", f"/reservations/{usd['id']}/charges", {"serviceId": "service-a"}, key=uid()
        )
        self.assertEqual(extra.status_code, 201, extra.json)
        payment = self.pay(usd, "2")
        refunded = self.request(
            "POST",
            f"/reservations/{usd['id']}/payments/{payment['id']}/refund",
            {"amount": "0.5", "reason": "Frozen rate refund"},
            key=uid(),
        )
        self.assertEqual(refunded.status_code, 201, refunded.json)
        self.pay(vnd, "20")

        original = self.report()
        self.assertEqual(original["basis"], "original")
        self.assertEqual(original["summary"]["forecastRoomRevenue"], "100.0000")
        self.assertEqual(original["snapshot"]["deposits"], "20.0000")
        self.assertEqual(original["snapshot"]["debt"], "80.0000")
        base = self.report(query="&basis=base&currency=VND")
        self.assertEqual(base["basis"], "base")
        self.assertEqual(base["summary"]["forecastRoomRevenue"], "200.0000")
        self.assertEqual(base["summary"]["cashReceived"], "70.0000")
        self.assertEqual(base["summary"]["cashRefunded"], "12.5000")
        self.assertEqual(base["summary"]["closing"], "57.5000")
        self.assertEqual(base["snapshot"]["deposits"], "57.5000")
        self.assertEqual(base["snapshot"]["debt"], "162.5000")
        self.assertEqual(base["definitions"]["moneyBasis"], "i18n:reports.definitions.moneyBasisBase")
        self.assertEqual(self.report("revenue", "&basis=base")["rows"][0]["amount"], "200.0000")
        self.assertEqual(self.report("revenue", "&currency=USD")["rows"][0]["amount"], "4.0000")
        # The requested base currency filters stored baseCurrency, not original USD.
        self.assertEqual(
            self.report(query="&basis=base&currency=USD")["snapshot"]["debt"], "0.0000"
        )
        dashboard = self.request("GET", f"/reports/dashboard?date={self.day}")
        self.assertEqual(dashboard.status_code, 200, dashboard.json)
        self.assertEqual(dashboard.json["financial"]["basis"], "base")
        self.assertEqual(dashboard.json["financial"]["summary"]["cashReceived"], "70.0000")
        self.assertEqual(dashboard.json["financial"]["snapshot"]["debt"], "162.5000")
        usd_arrival = next(
            row for row in dashboard.json["arrivalBookings"] if row["id"] == usd["id"]
        )
        self.assertEqual(usd_arrival["currency"], "USD")
        self.assertEqual(usd_arrival["balance"], "3.3000")
        checked_in = self.request(
            "POST", f"/reservations/{usd['id']}/status", {"status": "IN_HOUSE"}
        )
        self.assertEqual(checked_in.status_code, 200, checked_in.json)
        with patch("pms_api.reports.application.utcnow", return_value=utcnow() + timedelta(days=1)):
            served = self.report(query="&basis=base")
        self.assertEqual(served["summary"]["servedNights"], 1)
        self.assertEqual(served["summary"]["roomRevenue"], "100.0000")
        self.assertEqual(served["summary"]["adr"], "100.0000")
        for kind in ("financial", "revenue"):
            invalid = self.request(
                "GET",
                f"/reports/{kind}?start={self.day}&end={self.day + timedelta(days=1)}&basis=latest",
            )
            self.assertEqual(invalid.status_code, 422, invalid.json)
            self.assertEqual(invalid.json["error"]["code"], "invalid_basis")

    def seed_retail(self, clock):
        """Frozen USD retail history also exercises pre-existing foreign-money records."""
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            invoice_id, payment_id, refund_id = uid(), uid(), uid()
            snapshot = {"base_currency": "VND", "exchange_rate": Decimal(25)}
            db.session.add(
                PosInvoice(
                    id=invoice_id,
                    tenant_id=self.tenant_id,
                    user_id=self.owner_id,
                    currency="USD",
                    total=Decimal(2),
                    base_amount=Decimal(50),
                    **snapshot,
                    draft_items=[],
                    status="POSTED",
                    posted_at=clock,
                )
            )
            db.session.flush()
            db.session.add(
                PosPayment(
                    id=payment_id,
                    tenant_id=self.tenant_id,
                    invoice_id=invoice_id,
                    user_id=self.owner_id,
                    method_id="cash-a",
                    fund_id=self.usd_fund,
                    method_name="Cash",
                    fund_name="USD report cash",
                    currency="USD",
                    amount=Decimal(1),
                    base_amount=Decimal(25),
                    **snapshot,
                    created_at=clock,
                )
            )
            db.session.flush()
            db.session.add(
                PosRefund(
                    id=refund_id,
                    tenant_id=self.tenant_id,
                    invoice_id=invoice_id,
                    payment_id=payment_id,
                    user_id=self.owner_id,
                    currency="USD",
                    amount=Decimal("0.25"),
                    base_amount=Decimal("6.25"),
                    **snapshot,
                    reason="Retail history refund",
                    created_at=clock,
                )
            )
            db.session.flush()
            for kind, amount, base_amount, links in (
                ("pos_payment", "1", "25", {"pos_payment_id": payment_id}),
                ("pos_refund", "-0.25", "-6.25", {"pos_refund_id": refund_id}),
            ):
                db.session.add(
                    LedgerEntry(
                        tenant_id=self.tenant_id,
                        user_id=self.owner_id,
                        fund_id=self.usd_fund,
                        currency="USD",
                        amount=Decimal(amount),
                        base_amount=Decimal(base_amount),
                        **snapshot,
                        kind=kind,
                        description="Retail report fixture",
                        booked_at=self.day,
                        created_at=clock,
                        pos_invoice_id=invoice_id,
                        **links,
                    )
                )
            db.session.commit()

    def test_base_closed_bill_adjustments_and_retail_reconcile_without_current_fx(self):
        self.prepare_fx()
        row = self.booking("101", "USD")
        clock = datetime.combine(self.day, datetime.min.time(), tzinfo=UTC) + timedelta(hours=3)
        with patch("pms_api.bookings.application.utcnow", return_value=clock):
            extra = self.request(
                "POST", f"/reservations/{row['id']}/charges", {"serviceId": "service-a"}, key=uid()
            )
            self.assertEqual(extra.status_code, 201, extra.json)
            payment = self.pay(row, "4.8")
        with patch("pms_api.bookings.application.utcnow", return_value=clock + timedelta(hours=1)):
            for status in ("IN_HOUSE", "CHECKED_OUT"):
                result = self.request(
                    "POST", f"/reservations/{row['id']}/status", {"status": status}
                )
                self.assertEqual(result.status_code, 200, result.json)
        self.request("PUT", "/pricing/exchange-rates", {"currency": "USD", "rate": "50"})
        with patch("pms_api.bookings.application.utcnow", return_value=clock + timedelta(hours=2)):
            for adjustment in (
                {"type": "credit", "amount": "0.4", "paymentId": payment["id"]},
                {"type": "debit", "amount": "0.2", "methodId": "cash-a", "fundId": self.usd_fund},
            ):
                adjusted = self.request(
                    "POST",
                    f"/reservations/{row['id']}/adjustments",
                    {**adjustment, "reason": "Frozen report correction"},
                    key=uid(),
                )
                self.assertEqual(adjusted.status_code, 201, adjusted.json)
        self.seed_retail(clock)
        base = self.report(query="&basis=base")
        self.assertEqual(base["summary"]["realizedRevenue"], "165.0000")
        self.assertEqual(base["summary"]["cashReceived"], "150.0000")
        self.assertEqual(base["summary"]["cashRefunded"], "16.2500")
        self.assertEqual(base["summary"]["netReceipts"], "133.7500")
        self.assertEqual(base["snapshot"]["debt"], "31.2500")
        self.assertEqual(base["snapshot"]["deposits"], "0.0000")
        original = self.report(query="&currency=USD")
        self.assertEqual(original["summary"]["realizedRevenue"], "6.6000")
        self.assertEqual(original["summary"]["netReceipts"], "5.3500")
        self.assertEqual(original["snapshot"]["debt"], "1.2500")
