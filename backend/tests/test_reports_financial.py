"""Known booking/POS/cash fixture reconciles reporting without touching pms_local."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from unittest.mock import patch

from pms_api.bookings.models import (
    Charge,
    LedgerEntry,
    Payment,
    Refund,
    Reservation,
    ReservationNight,
    ReservationRoom,
)
from pms_api.bookings.routes import totals
from pms_api.catalog.models import Master, PhysicalRoom
from pms_api.extensions import db
from pms_api.finance.models import CashDocument, PosInvoice, PosPayment, PosRefund
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class FinancialReportsTests(DomainTestCase):
    now = datetime(2026, 10, 4, 8, tzinfo=UTC)

    def at(self, day, hour=3):
        return datetime(2026, 10, day, hour, tzinfo=UTC)

    def stay(self, key, status, first, last, price, *, currency="VND", tenant=None):
        tenant = tenant or self.tenant_id
        suffix = "a" if tenant == self.tenant_id else "b"
        set_context("owner-" + suffix, tenant)
        room_id = "report-" + key
        start, end = date(2026, 10, first), date(2026, 10, last)
        db.session.add(
            PhysicalRoom(id=room_id, tenant_id=tenant, room_type_id="rt-" + suffix, number=room_id)
        )
        row = Reservation(
            id=key,
            tenant_id=tenant,
            status=status,
            check_in=start,
            check_out=end,
            currency=currency,
            base_currency=currency,
            exchange_rate=Decimal(1),
            base_amount=Decimal(price) * (end - start).days,
            pricing_snapshot={},
            guest_name="Report fixture",
            checked_out_at=self.at(last) if status == "CHECKED_OUT" else None,
        )
        db.session.add(row)
        db.session.flush()
        db.session.add(
            ReservationRoom(
                tenant_id=tenant,
                reservation_id=key,
                room_id=room_id,
                room_number=room_id,
                room_type_id="rt-" + suffix,
                check_in=start,
                check_out=end,
                active=status in {"CONFIRMED", "IN_HOUSE"},
            )
        )
        for offset in range((end - start).days):
            db.session.add(
                ReservationNight(
                    tenant_id=tenant,
                    reservation_id=key,
                    room_id=room_id,
                    room_number=room_id,
                    room_type_id="rt-" + suffix,
                    date=start + timedelta(days=offset),
                    price=Decimal(price),
                    base_currency=currency,
                    exchange_rate=Decimal(1),
                    base_amount=Decimal(price),
                )
            )
        return row

    def charge(self, booking, key, amount, day, *, hour=2):
        value = Decimal(amount)
        db.session.add(
            Charge(
                id=key,
                tenant_id=self.tenant_id,
                reservation_id=booking,
                description=key,
                kind="discount" if value < 0 else "service",
                quantity=1,
                unit_price=abs(value),
                amount=value,
                base_currency="VND",
                exchange_rate=Decimal(1),
                base_amount=value,
                currency="VND",
                user_id=self.owner_id,
                created_at=self.at(day, hour),
            )
        )

    def ledger(self, key, kind, amount, day, **links):
        row = LedgerEntry(
            id=key,
            tenant_id=self.tenant_id,
            user_id=self.owner_id,
            fund_id=links.pop("fund_id", "fund-a"),
            kind=kind,
            currency="VND",
            amount=Decimal(amount),
            base_currency="VND",
            exchange_rate=Decimal(1),
            base_amount=Decimal(amount),
            description=key,
            booked_at=date(2026, 10, day),
            created_at=self.at(day),
            **links,
        )
        db.session.add(row)
        return row

    def pay(self, booking, key, amount, day, *, pos=False):
        model = PosPayment if pos else Payment
        link = {"invoice_id" if pos else "reservation_id": booking}
        db.session.add(
            model(
                id=key,
                tenant_id=self.tenant_id,
                **link,
                method_id="cash-a",
                fund_id="fund-a",
                method_name="Cash",
                fund_name="Cash fund",
                amount=Decimal(amount),
                base_currency="VND",
                exchange_rate=Decimal(1),
                base_amount=Decimal(amount),
                currency="VND",
                user_id=self.owner_id,
                created_at=self.at(day),
            )
        )
        db.session.flush()
        ledger_links = (
            {"pos_invoice_id": booking, "pos_payment_id": key}
            if pos
            else {"reservation_id": booking, "payment_id": key}
        )
        self.ledger("l-" + key, "pos_payment" if pos else "payment", amount, day, **ledger_links)

    def refund(self, booking, payment, key, amount, day, *, pos=False):
        model = PosRefund if pos else Refund
        link = {"invoice_id" if pos else "reservation_id": booking}
        db.session.add(
            model(
                id=key,
                tenant_id=self.tenant_id,
                **link,
                payment_id=payment,
                amount=Decimal(amount),
                base_currency="VND",
                exchange_rate=Decimal(1),
                base_amount=Decimal(amount),
                currency="VND",
                user_id=self.owner_id,
                reason="Fixture correction",
                created_at=self.at(day),
            )
        )
        db.session.flush()
        ledger_links = (
            {"pos_invoice_id": booking, "pos_refund_id": key}
            if pos
            else {"reservation_id": booking, "refund_id": key}
        )
        self.ledger(
            "l-" + key, "pos_refund" if pos else "refund", -Decimal(amount), day, **ledger_links
        )

    def cash(self, key, kind, amount, day, **changes):
        db.session.add(
            CashDocument(
                id=key,
                tenant_id=self.tenant_id,
                user_id=self.owner_id,
                kind=kind,
                fund_id="fund-a",
                fund_name="Cash fund",
                currency="VND",
                amount=Decimal(amount),
                base_currency="VND",
                exchange_rate=Decimal(1),
                base_amount=Decimal(amount),
                description=key,
                effective_date=date(2026, 10, day),
                created_at=self.at(day),
                **changes,
            )
        )
        db.session.flush()
        sign = -1 if kind in {"expense", "transfer"} else 1
        links = {"cash_document_id": key}
        if kind == "reversal":
            links["reversal_of_id"] = "l-" + changes["reversal_of_id"]
        self.ledger(
            "l-" + key,
            "transfer_out" if kind == "transfer" else kind,
            sign * Decimal(amount),
            day,
            **links,
        )
        if kind == "transfer":
            self.ledger(
                "in-" + key, "transfer_in", amount, day, fund_id="bank-a", cash_document_id=key
            )

    def test_closed_bills_cash_current_deposits_debt_and_adr_reconcile_independently(self):
        with self.app.app_context():
            closed = self.stay("closed", "CHECKED_OUT", 1, 3, "100")
            in_house = self.stay("open", "IN_HOUSE", 3, 6, "80")
            future = self.stay("future", "CONFIRMED", 6, 7, "200")
            self.stay("cancelled", "CANCELLED", 3, 4, "90")
            self.stay("usd", "CHECKED_OUT", 2, 3, "999", currency="USD")
            self.stay("foreign", "CHECKED_OUT", 2, 3, "9999", tenant=self.other_tenant_id)
            set_context(self.owner_id, self.tenant_id)
            db.session.add(
                Master(
                    id="bank-a",
                    tenant_id=self.tenant_id,
                    catalog="funds",
                    name="Bank fund",
                    data={"type": "bank"},
                )
            )
            self.charge("closed", "closed-service", "20", 3)
            self.charge("closed", "closed-tax", "10", 3)
            self.charge("closed", "closed-discount", "-5", 3)
            self.charge("closed", "later-credit", "-25", 4)
            self.charge("open", "linked-pos-charge", "20", 3)
            for key, total, posted, cancelled, booking in (
                ("retail", "40", 3, None, None),
                ("returned", "60", 2, 4, None),
                ("linked", "20", 3, None, "open"),
                ("draft", "900", None, None, None),
            ):
                db.session.add(
                    PosInvoice(
                        id=key,
                        tenant_id=self.tenant_id,
                        user_id=self.owner_id,
                        status="CANCELLED" if cancelled else "POSTED" if posted else "DRAFT",
                        currency="VND",
                        total=Decimal(total),
                        base_currency="VND",
                        exchange_rate=Decimal(1),
                        base_amount=Decimal(total),
                        draft_items=[],
                        reservation_id=booking,
                        posted_at=self.at(posted) if posted else None,
                        cancelled_at=self.at(cancelled) if cancelled else None,
                    )
                )
            db.session.flush()
            self.cash("opening", "opening", "100", 2)
            self.pay("closed", "closed-deposit", "100", 2)
            self.pay("closed", "closed-settle", "125", 3)
            self.refund("closed", "closed-settle", "closed-refund", "25", 4)
            self.pay("open", "open-pay", "50", 3)
            self.pay("future", "future-deposit", "30", 3)
            self.pay("retail", "retail-pay", "25", 3, pos=True)
            self.refund("retail", "retail-pay", "retail-refund", "5", 4, pos=True)
            self.pay("returned", "returned-pay", "60", 2, pos=True)
            self.refund("returned", "returned-pay", "returned-refund", "60", 4, pos=True)
            self.cash("receipt", "receipt", "50", 3)
            self.cash("expense", "expense", "10", 3)
            self.cash("expense-reverse", "reversal", "10", 4, reversal_of_id="expense")
            self.cash(
                "transfer", "transfer", "30", 3, to_fund_id="bank-a", to_fund_name="Bank fund"
            )
            db.session.commit()
            set_context(self.owner_id, self.tenant_id)
            # The report must use exactly the booking/payment/refund accounting
            # formula, including the posted charge and credit adjustment.
            self.assertEqual(totals(closed), (Decimal(200), Decimal(200), Decimal(0)))
            self.assertEqual(totals(in_house), (Decimal(260), Decimal(50), Decimal(210)))
            self.assertEqual(totals(future), (Decimal(200), Decimal(30), Decimal(170)))
        with patch("pms_api.reports.routes.utcnow", return_value=self.now):
            response = self.request("get", "/reports/financial?start=2026-10-03&end=2026-10-05")
        self.assertEqual(response.status_code, 200, response.json)
        result = response.json
        self.assertEqual(
            result["summary"],
            {
                "forecastRoomRevenue": "160.0000",
                "roomRevenue": "80.0000",
                "servedNights": 1,
                "adr": "80.0000",
                "realizedRevenue": "180.0000",
                "recognizedRevenue": "0.0000",
                "cashReceived": "230.0000",
                "cashRefunded": "90.0000",
                "netReceipts": "140.0000",
                "income": "320.0000",
                "outflow": "130.0000",
                "netCash": "190.0000",
                "opening": "260.0000",
                "closing": "450.0000",
            },
        )
        self.assertEqual(result["snapshot"]["deposits"], "30.0000")
        self.assertEqual(result["snapshot"]["debt"], "400.0000")
        self.assertEqual(result["rows"][0]["realizedRevenue"], "265.0000")
        self.assertEqual(result["rows"][1]["realizedRevenue"], "-85.0000")
        # Reporting end is exclusive; cashbook end is inclusive. Same ledger,
        # including transfer/reversal history, must reconcile at matched dates.
        book = self.request("get", "/cashbook?startDate=2026-10-03&endDate=2026-10-04").json
        for key in ("opening", "income", "outflow", "closing"):
            self.assertEqual(result["summary"][key], book["summary"][key])
        for row in result["rows"]:
            self.assertEqual(
                Decimal(row["opening"]) + Decimal(row["income"]) - Decimal(row["outflow"]),
                Decimal(row["closing"]),
            )

    def test_front_desk_sees_real_lists_and_alerts_but_no_financial_values(self):
        with self.app.app_context():
            self.stay("arrival", "CONFIRMED", 4, 5, "100")
            self.stay("departure", "IN_HOUSE", 3, 4, "100")
            self.stay("overdue", "IN_HOUSE", 2, 3, "100")
            room = db.session.get(PhysicalRoom, "room-a-101")
            room.condition = "dirty"
            db.session.commit()
        client, headers = self.login("frontdesk@test.local")
        with patch("pms_api.reports.routes.utcnow", return_value=self.now):
            response = self.request(
                "get", "/reports/dashboard?date=2026-10-04", client=client, headers=headers
            )
        self.assertEqual(response.status_code, 200, response.json)
        data = response.json
        self.assertEqual(data["occupied"], 2)
        self.assertEqual(data["arriving"], 1)
        self.assertEqual(data["departing"], 1)
        self.assertEqual([row["id"] for row in data["arrivalBookings"]], ["arrival"])
        self.assertEqual([row["id"] for row in data["departureBookings"]], ["departure"])
        self.assertEqual([row["id"] for row in data["alerts"]["overdueDepartures"]], ["overdue"])
        self.assertEqual([row["number"] for row in data["alerts"]["dirtyRooms"]], ["101"])
        self.assertIsNone(data["financial"])
        for row in data["chart"]:
            self.assertNotIn("roomRevenue", row)
            self.assertNotIn("realizedRevenue", row)
        for row in (
            data["arrivalBookings"]
            + data["departureBookings"]
            + data["alerts"]["overdueDepartures"]
        ):
            self.assertNotIn("balance", row)
        forbidden = self.request(
            "get",
            "/reports/financial?start=2026-10-03&end=2026-10-05",
            client=client,
            headers=headers,
        )
        self.assertEqual(forbidden.status_code, 403, forbidden.json)

    def test_local_posting_day_and_effective_ledger_date_are_distinct_clocks(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            # 18:30 UTC Oct2 is 01:30 Oct3 in this hotel's timezone.
            db.session.add(
                PosInvoice(
                    id="late-pos",
                    tenant_id=self.tenant_id,
                    user_id=self.owner_id,
                    status="POSTED",
                    currency="VND",
                    total=Decimal("0.1234"),
                    base_currency="VND",
                    exchange_rate=Decimal(1),
                    base_amount=Decimal("0.1234"),
                    draft_items=[],
                    posted_at=self.at(2, 18) + timedelta(minutes=30),
                )
            )
            self.ledger("effective-before", "receipt", "5.0000", 2)
            db.session.flush()
            db.session.add(
                LedgerEntry(
                    id="legacy-timestamp",
                    tenant_id=self.tenant_id,
                    user_id=self.owner_id,
                    fund_id="fund-a",
                    kind="receipt",
                    currency="VND",
                    amount=Decimal("0.1234"),
                    base_currency="VND",
                    exchange_rate=Decimal(1),
                    base_amount=Decimal("0.1234"),
                    description="Legacy timestamp-only entry",
                    booked_at=None,
                    created_at=self.at(2, 18) + timedelta(minutes=30),
                )
            )
            db.session.commit()
        with patch("pms_api.reports.routes.utcnow", return_value=self.now):
            response = self.request("get", "/reports/financial?start=2026-10-03&end=2026-10-04")
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json["summary"]["realizedRevenue"], "0.1234")
        self.assertEqual(response.json["summary"]["opening"], "5.0000")
        self.assertEqual(response.json["summary"]["netCash"], "0.1234")
        self.assertEqual(response.json["summary"]["closing"], "5.1234")
