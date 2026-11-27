"""Dedicated PostgreSQL proofs for tenant POS, cash invariants and races."""

from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import event, select, text
from sqlalchemy.exc import DBAPIError

from pms_api.bookings.models import LedgerEntry
from pms_api.catalog.models import Master
from pms_api.core_models import utcnow
from pms_api.extensions import db
from pms_api.finance.models import CashDocument, PosInvoice, PosInvoiceItem, PosPayment, PosRefund
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class FinanceIntegrationTests(DomainTestCase):
    def test_workspace_caps_keep_old_history_searchable_and_cashbook_totals_complete(self):
        created = utcnow() - timedelta(days=2)
        day = date.today() - timedelta(days=1)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            for index in range(105):
                db.session.add(
                    PosInvoice(
                        id=f"history-invoice-{index:03d}",
                        tenant_id=self.tenant_id,
                        user_id=self.owner_id,
                        currency="VND",
                        total=Decimal("40.0000"),
                        base_currency="VND",
                        exchange_rate=Decimal("1"),
                        base_amount=Decimal("40.0000"),
                        customer_name="Ancient Guest" if index == 0 else "Recent Guest",
                        note="literal%_needle" if index == 0 else "Other order",
                        draft_items=[
                            {
                                "serviceId": "service-a",
                                "description": "Breakfast",
                                "quantity": "2.0000",
                                "unitPrice": "20.0000",
                                "amount": "40.0000",
                            }
                        ],
                        created_at=created + timedelta(seconds=index),
                    )
                )
                db.session.add(
                    CashDocument(
                        id=f"history-cash-{index:03d}",
                        tenant_id=self.tenant_id,
                        user_id=self.owner_id,
                        kind="receipt",
                        fund_id="fund-a",
                        fund_name="Cash fund",
                        amount=Decimal("1.0000"),
                        currency="VND",
                        base_currency="VND",
                        exchange_rate=Decimal("1"),
                        base_amount=Decimal("1.0000"),
                        description="History receipt",
                        effective_date=day,
                        created_at=created + timedelta(seconds=index),
                    )
                )
            db.session.flush()
            for index in range(105):
                db.session.add(
                    LedgerEntry(
                        id=f"history-ledger-{index:03d}",
                        tenant_id=self.tenant_id,
                        user_id=self.owner_id,
                        fund_id="fund-a",
                        kind="receipt",
                        currency="VND",
                        amount=Decimal("1.0000"),
                        base_currency="VND",
                        exchange_rate=Decimal("1"),
                        base_amount=Decimal("1.0000"),
                        description="History receipt",
                        booked_at=day,
                        cash_document_id=f"history-cash-{index:03d}",
                        created_at=created + timedelta(seconds=index),
                    )
                )
            db.session.commit()
            set_context("owner-b", self.other_tenant_id)
            db.session.add(
                PosInvoice(
                    id="foreign-history",
                    tenant_id=self.other_tenant_id,
                    user_id="owner-b",
                    currency="VND",
                    total=Decimal("1.0000"),
                    base_currency="VND",
                    exchange_rate=Decimal("1"),
                    base_amount=Decimal("1.0000"),
                    customer_name="Ancient Guest",
                    note="literal%_needle",
                    draft_items=[],
                )
            )
            db.session.commit()
        workspace = self.request("get", "/workspace").json
        for key in ("posInvoices", "cashDocuments", "ledger"):
            self.assertEqual(len(workspace[key]), 100)
        self.assertNotIn("history-invoice-000", {row["id"] for row in workspace["posInvoices"]})
        for query in ("ancient", "literal%25_needle", "history-invoice-000"):
            result = self.request("get", "/pos/invoices?q=" + query)
            self.assertEqual(result.status_code, 200, result.json)
            self.assertEqual(
                [row["id"] for row in result.json["posInvoices"]], ["history-invoice-000"]
            )
        page = self.request("get", "/pos/invoices?page=11&pageSize=10").json
        self.assertEqual(page["pagination"]["totalItems"], 105)
        self.assertEqual(len(page["posInvoices"]), 5)
        self.assertEqual(page["posInvoices"][-1]["id"], "history-invoice-000")
        detail = self.request("get", "/pos/invoices/history-invoice-000")
        self.assertEqual(detail.status_code, 200, detail.json)
        self.assertEqual(detail.json["total"], "40.0000")
        book = self.request("get", "/cashbook?page=11&pageSize=10").json
        self.assertEqual(book["summary"]["closing"], "105.0000")
        self.assertEqual(book["pagination"]["totalItems"], 105)
        self.assertEqual(len(book["cashDocuments"]), 5)
        reversed_row = self.request(
            "post",
            "/cash-documents/history-cash-000/reverse",
            {"reason": "Old receipt correction"},
            key="old-receipt-correction",
        )
        self.assertEqual(reversed_row.status_code, 201, reversed_row.json)
        historical = self.request("get", f"/cashbook?endDate={day}&page=11&pageSize=10").json
        self.assertEqual(historical["summary"]["closing"], "105.0000")
        self.assertTrue(
            any(row["reversalOfId"] == "history-cash-000" for row in historical["cashDocuments"])
        )
        self.assertEqual(self.request("get", "/cashbook").json["summary"]["closing"], "104.0000")

    def test_invoice_page_batches_children_and_preserves_snapshot_and_exact_totals(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            for index in range(3):
                db.session.add(
                    PosInvoice(
                        id=f"batch-invoice-{index}",
                        tenant_id=self.tenant_id,
                        user_id=self.owner_id,
                        currency="VND",
                        total=Decimal("40.0000"),
                        base_currency="VND",
                        exchange_rate=Decimal("1"),
                        base_amount=Decimal("40.0000"),
                        status="POSTED",
                        draft_items=[],
                        posted_at=utcnow(),
                    )
                )
            db.session.flush()
            for index in range(3):
                db.session.add(
                    PosInvoiceItem(
                        tenant_id=self.tenant_id,
                        invoice_id=f"batch-invoice-{index}",
                        service_id="service-a",
                        description="Snapshot Breakfast",
                        quantity=Decimal("2.0000"),
                        unit_price=Decimal("20.0000"),
                        amount=Decimal("40.0000"),
                        base_currency="VND",
                        exchange_rate=Decimal("1"),
                        base_amount=Decimal("40.0000"),
                    )
                )
                db.session.add(
                    PosPayment(
                        id=f"batch-payment-{index}",
                        tenant_id=self.tenant_id,
                        user_id=self.owner_id,
                        invoice_id=f"batch-invoice-{index}",
                        fund_id="fund-a",
                        fund_name="Cash fund",
                        method_id="cash-a",
                        method_name="Cash",
                        currency="VND",
                        amount=Decimal("25.0000"),
                        base_currency="VND",
                        exchange_rate=Decimal("1"),
                        base_amount=Decimal("25.0000"),
                    )
                )
            db.session.flush()
            for index in range(3):
                db.session.add(
                    PosRefund(
                        tenant_id=self.tenant_id,
                        user_id=self.owner_id,
                        invoice_id=f"batch-invoice-{index}",
                        payment_id=f"batch-payment-{index}",
                        currency="VND",
                        amount=Decimal("5.0000"),
                        base_currency="VND",
                        exchange_rate=Decimal("1"),
                        base_amount=Decimal("5.0000"),
                        reason="Return",
                    )
                )
            db.session.commit()
            statements = []

            def capture(connection, cursor, statement, parameters, context, executemany):
                if statement.lstrip().lower().startswith("select") and any(
                    "from " + table in statement.lower()
                    for table in (
                        "pos_invoices",
                        "pos_invoice_items",
                        "pos_payments",
                        "pos_refunds",
                    )
                ):
                    statements.append(statement)

            event.listen(db.engine, "before_cursor_execute", capture)
            try:
                response = self.request("get", "/pos/invoices")
            finally:
                event.remove(db.engine, "before_cursor_execute", capture)
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(len(statements), 5)  # Count, invoice headers, and three child batches.
        self.assertEqual(len(response.json["posInvoices"]), 3)
        for row in response.json["posInvoices"]:
            self.assertEqual(row["items"][0]["description"], "Snapshot Breakfast")
            self.assertEqual(row["paid"], "20.0000")
            self.assertEqual(row["refunded"], "5.0000")
            self.assertEqual(row["balance"], "20.0000")
            self.assertEqual(row, self.request("get", "/pos/invoices/" + row["id"]).json)

    def test_cash_and_bank_filters_reconcile_separately_and_expose_only_actor_names(self):
        with self.app.app_context():
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
            db.session.commit()
        self.assertEqual(self.cash("receipt", "100", "filtered-cash-001").status_code, 201)
        self.assertEqual(
            self.cash("transfer", "30", "filtered-transfer-001", toFundId="bank-a").status_code, 201
        )
        for kind, amount in (("cash", "70.0000"), ("bank", "30.0000")):
            result = self.request("get", "/cashbook?fundType=" + kind)
            self.assertEqual(result.status_code, 200, result.json)
            self.assertEqual(result.json["summary"]["closing"], amount)
            self.assertEqual(len(result.json["fundBalances"]), 1)
        self.assertEqual(self.request("get", "/cashbook?fundType=other").status_code, 422)
        accountant, headers = self.login("accountant@test.local")
        workspace = self.request("get", "/workspace", client=accountant, headers=headers).json
        self.assertEqual(workspace["users"], [])
        self.assertEqual(workspace["cashbookActors"], [{"id": "owner-a", "name": "owner-a"}])

    def invoice(self, **changes):
        data = {
            "customerName": "Retail guest",
            "items": [{"serviceId": "service-a", "quantity": "2"}],
        }
        data.update(changes)
        result = self.request("post", "/pos/invoices", data, key="invoice-create-01")
        self.assertEqual(result.status_code, 201, result.json)
        return result.json

    def post_invoice(self, row, **data):
        result = self.request(
            "post", f"/pos/invoices/{row['id']}/post", data, key="invoice-post-01"
        )
        self.assertEqual(result.status_code, 201, result.json)
        return result.json

    def payment(self, row, amount="25", key="invoice-payment-01"):
        return self.request(
            "post",
            f"/pos/invoices/{row['id']}/payments",
            {"amount": amount, "fundId": "fund-a", "methodId": "cash-a"},
            key=key,
        )

    def cash(self, kind, amount, key, **changes):
        data = {"type": kind, "amount": amount, "fundId": "fund-a", "description": "Cash fixture"}
        data.update(changes)
        return self.request("post", "/cash-documents", data, key=key)

    def test_draft_snapshot_post_partial_payments_refund_and_cancel(self):
        row = self.invoice()
        self.assertEqual(row["status"], "DRAFT")
        self.assertEqual(row["total"], "40.0000")
        self.assertEqual(self.payment(row).status_code, 409)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            service = db.session.get(Master, "service-a")
            service.data, service.name = {"price": "999"}, "Changed service"
            db.session.commit()
        posted = self.post_invoice(row)
        self.assertEqual(posted["total"], "40.0000")
        self.assertEqual(posted["items"][0]["description"], "Breakfast")
        path = f"/pos/invoices/{row['id']}"
        self.assertEqual(
            self.request("patch", path, {"note": "changed"}, key="invoice-edit-late").status_code,
            409,
        )
        payment = self.payment(row)
        self.assertEqual(payment.status_code, 201, payment.json)
        self.assertEqual(payment.json["balance"], "15.0000")
        self.assertEqual(self.payment(row).json, payment.json)
        self.assertEqual(self.payment(row, "16", "invoice-overpay-01").status_code, 409)
        payment_id = payment.json["payments"][0]["id"]
        refunded = self.request(
            "post",
            path + f"/payments/{payment_id}/refund",
            {"amount": "5", "reason": "Return"},
            key="invoice-refund-01",
        )
        self.assertEqual(refunded.status_code, 201, refunded.json)
        self.assertEqual(refunded.json["paid"], "20.0000")
        cancelled = self.request(
            "post", path + "/cancel", {"reason": "Cancel retail"}, key="invoice-cancel-01"
        )
        self.assertEqual(cancelled.status_code, 201, cancelled.json)
        self.assertEqual(cancelled.json["paid"], "0.0000")
        self.assertEqual(cancelled.json["balance"], "0.0000")
        cashbook = self.request("get", "/cashbook").json
        self.assertEqual(cashbook["summary"]["closing"], "0.0000")
        self.assertEqual(len(cashbook["ledger"]), 3)

    def test_booking_post_has_one_charge_and_no_duplicate_cash_or_revenue(self):
        start = date.today()
        booking = self.request(
            "post",
            "/reservations",
            {
                "guest": "POS room",
                "room": "101",
                "sourceId": "direct-a",
                "checkIn": start.isoformat(),
                "checkOut": (start + timedelta(days=1)).isoformat(),
            },
        )
        self.assertEqual(booking.status_code, 201, booking.json)
        row = self.invoice()
        posted = self.post_invoice(row, bookingId=booking.json["id"])
        self.assertEqual(posted["bookingId"], booking.json["id"])
        self.assertEqual(posted["balance"], "0.0000")
        self.assertEqual(self.payment(row).status_code, 409)
        path = f"/reservations/{booking.json['id']}"
        updated = self.request("get", path).json
        self.assertEqual(updated["total"], "140.0000")
        self.assertEqual(len(updated["charges"]), 1)
        self.assertEqual(self.request("get", "/cashbook").json["ledger"], [])
        cancelled = self.request(
            "post",
            f"/pos/invoices/{row['id']}/cancel",
            {"reason": "Return room order"},
            key="invoice-room-cancel",
        )
        self.assertEqual(cancelled.status_code, 201, cancelled.json)
        updated = self.request("get", path).json
        self.assertEqual(updated["total"], "100.0000")
        self.assertEqual(len(updated["charges"]), 2)

    def test_cash_opening_period_equation_transfer_and_unique_reversal(self):
        yesterday = (date.today() - timedelta(days=1)).isoformat()
        opening = self.cash("opening", "100", "opening-create-01", date=yesterday)
        self.assertEqual(opening.status_code, 201, opening.json)
        self.assertEqual(
            self.cash("opening", "1", "opening-duplicate", date=yesterday).status_code, 409
        )
        receipt = self.cash("receipt", "25", "receipt-create-01")
        self.assertEqual(receipt.status_code, 201, receipt.json)
        expense = self.cash("expense", "50", "expense-create-01")
        self.assertEqual(expense.status_code, 201, expense.json)
        period = self.request(
            "get", f"/cashbook?startDate={date.today()}&endDate={date.today()}"
        ).json
        self.assertEqual(period["summary"]["opening"], "100.0000")
        self.assertEqual(period["summary"]["income"], "25.0000")
        self.assertEqual(period["summary"]["outflow"], "50.0000")
        self.assertEqual(period["summary"]["closing"], "75.0000")
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.add(
                Master(id="fund-second", tenant_id=self.tenant_id, catalog="funds", name="Bank")
            )
            db.session.commit()
        transfer = self.cash("transfer", "20", "transfer-create-01", toFundId="fund-second")
        self.assertEqual(transfer.status_code, 201, transfer.json)
        book = self.request("get", "/cashbook").json
        self.assertEqual(book["summary"]["closing"], "75.0000")
        balances = {row["fundId"]: row["balance"] for row in book["fundBalances"]}
        self.assertEqual(balances, {"fund-a": "55.0000", "fund-second": "20.0000"})
        reverse_path = f"/cash-documents/{transfer.json['id']}/reverse"
        reversed_row = self.request(
            "post", reverse_path, {"reason": "Wrong fund"}, key="transfer-reverse-01"
        )
        self.assertEqual(reversed_row.status_code, 201, reversed_row.json)
        self.assertEqual(
            self.request(
                "post", reverse_path, {"reason": "Wrong fund"}, key="transfer-reverse-01"
            ).json,
            reversed_row.json,
        )
        self.assertEqual(
            self.request(
                "post", reverse_path, {"reason": "Again"}, key="transfer-reverse-02"
            ).status_code,
            409,
        )
        book = self.request("get", "/cashbook?fundId=fund-a").json
        self.assertEqual(book["summary"]["closing"], "75.0000")
        self.assertEqual(len([entry for entry in book["ledger"] if entry["reversalOfId"]]), 1)

    def test_insufficient_funds_cancel_is_atomic_and_refund_rejects_overage(self):
        row = self.post_invoice(self.invoice())
        payment = self.payment(row, "40")
        self.assertEqual(payment.status_code, 201, payment.json)
        self.assertEqual(self.cash("withdrawal", "40", "cash-withdraw-01").status_code, 201)
        path = f"/pos/invoices/{row['id']}"
        cancel = self.request(
            "post", path + "/cancel", {"reason": "Empty fund"}, key="cancel-empty-fund"
        )
        self.assertEqual(cancel.status_code, 409, cancel.json)
        current = self.request("get", path).json
        self.assertEqual(current["status"], "POSTED")
        self.assertEqual(current["paid"], "40.0000")
        self.assertEqual(current["payments"][0]["refunds"], [])
        refund = self.request(
            "post",
            path + f"/payments/{payment.json['payments'][0]['id']}/refund",
            {"amount": "41", "reason": "Too much"},
            key="refund-over-limit",
        )
        self.assertEqual(refund.status_code, 409, refund.json)

    def test_concurrent_expenses_cannot_spend_same_balance_twice(self):
        self.assertEqual(self.cash("receipt", "100", "race-cash-seed").status_code, 201)
        clients = [self.login(), self.login()]

        def spend(index):
            pair = clients[index]
            return self.request(
                "post",
                "/cash-documents",
                {"type": "expense", "amount": "70", "fundId": "fund-a", "description": "Race"},
                key=f"race-expense-{index}",
                client=pair[0],
                headers=pair[1],
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(spend, range(2)))
        self.assertEqual(sorted(result.status_code for result in results), [201, 409])
        self.assertEqual(self.request("get", "/cashbook").json["summary"]["closing"], "30.0000")

    def test_global_idempotency_permission_and_tenant_boundaries(self):
        row = self.invoice()
        self.assertEqual(self.cash("receipt", "10", "invoice-create-01").status_code, 409)
        self.assertEqual(
            self.cash("receipt", "10", "cash-foreign-fund", fundId="fund-b").status_code, 422
        )
        client, headers = self.login("owner-b@test.local")
        other = self.request("get", f"/pos/invoices/{row['id']}", client=client, headers=headers)
        self.assertEqual(other.status_code, 403)
        client, headers = self.login("hk@test.local")
        self.assertEqual(
            self.request("get", "/pos/invoices", client=client, headers=headers).status_code, 403
        )
        self.assertEqual(
            self.request("get", "/cashbook", client=client, headers=headers).status_code, 403
        )
        client, headers = self.login("frontdesk@test.local")
        result = self.request(
            "post",
            "/cash-documents",
            {"type": "receipt", "amount": "1", "fundId": "fund-a", "description": "Denied"},
            client=client,
            headers=headers,
            key="frontdesk-cash-denied",
        )
        self.assertEqual(result.status_code, 403)

    def test_posted_snapshots_and_cash_records_are_database_immutable(self):
        row = self.post_invoice(self.invoice())
        receipt = self.cash("receipt", "10", "cash-immutable-01")
        self.assertEqual(receipt.status_code, 201, receipt.json)
        for statement, target in [
            ("UPDATE pos_invoices SET total=1 WHERE id=:id", row["id"]),
            ("DELETE FROM pos_invoice_items WHERE invoice_id=:id", row["id"]),
            ("UPDATE cash_documents SET amount=1 WHERE id=:id", receipt.json["id"]),
        ]:
            with self.subTest(statement=statement), self.app.app_context():
                set_context(self.owner_id, self.tenant_id)
                with self.assertRaises(DBAPIError):
                    db.session.execute(text(statement), {"id": target})
                db.session.rollback()

    def test_opening_before_history_and_currency_precision_are_enforced(self):
        self.assertEqual(self.cash("receipt", "10", "historical-receipt").status_code, 201)
        self.assertEqual(
            self.cash("opening", "100", "opening-wrong-date", date=str(date.today())).status_code,
            409,
        )
        result = self.cash(
            "opening", "100", "opening-correct-date", date=str(date.today() - timedelta(days=1))
        )
        self.assertEqual(result.status_code, 201, result.json)
        for amount in ["NaN", "Infinity", "0.00001", "-1", True]:
            self.assertEqual(
                self.cash("expense", amount, "bad-value-" + str(amount)).status_code, 422
            )
        self.assertEqual(
            self.cash("receipt", "1", "wrong-currency-01", currency="USD").status_code, 409
        )
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            entries = list(
                db.session.scalars(select(LedgerEntry).where(LedgerEntry.kind == "opening"))
            )
            self.assertEqual(len(entries), 1)
            self.assertGreater(
                entries[0].created_at.astimezone(ZoneInfo("Asia/Ho_Chi_Minh")).date(),
                entries[0].booked_at,
            )

    def test_pos_refund_uses_inactive_original_fund(self):
        row = self.post_invoice(self.invoice())
        payment = self.payment(row)
        self.assertEqual(payment.status_code, 201, payment.json)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.get(Master, "fund-a").active = False
            db.session.commit()
        refunded = self.request(
            "post",
            f"/pos/invoices/{row['id']}/payments/{payment.json['payments'][0]['id']}/refund",
            {"amount": "5", "reason": "Inactive original fund"},
            key="refund-inactive-fund",
        )
        self.assertEqual(refunded.status_code, 201, refunded.json)
