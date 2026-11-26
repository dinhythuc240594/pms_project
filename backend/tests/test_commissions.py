"""Room-net commissions keep their rate, cash history, and hotel scope."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from threading import Event, get_ident
from unittest.mock import patch
from zoneinfo import ZoneInfo

from sqlalchemy import event, func, select

from pms_api.bookings.models import Charge, LedgerEntry, Reservation
from pms_api.catalog.models import Master
from pms_api.core_models import utcnow
from pms_api.extensions import db
from pms_api.finance.models import CashDocument, CommissionPayout, CommissionSettlement
from pms_api.security import set_context
from pms_api.subscriptions import lock_tenant
from tests.domain_fixture import DomainTestCase


class CommissionTests(DomainTestCase):
    def booking(self, *, discount=False, charges=False, percent="10", **input):
        rate = self.request(
            "patch", "/masters/bookingSources", {"id": "direct-a", "commission": percent}
        )
        self.assertEqual(rate.status_code, 200, rate.json)
        if discount:
            promotion = self.request(
                "post",
                "/pricing/promotions",
                {"name": "Room discount", "kind": "earlybird", "minDaysBefore": 0, "percent": "25"},
            )
            self.assertEqual(promotion.status_code, 201, promotion.json)
        start = utcnow().astimezone(ZoneInfo("Asia/Ho_Chi_Minh")).date()
        result = self.request(
            "post",
            "/reservations",
            {
                "guest": "Commission guest",
                "room": "101",
                "sourceId": "direct-a",
                "checkIn": str(start),
                "checkOut": str(start + timedelta(days=2)),
                **input,
            },
        )
        self.assertEqual(result.status_code, 201, result.json)
        if charges:
            for kind, amount in [("fee", "20"), ("tax", "10"), ("discount", "5")]:
                result = self.request(
                    "post",
                    f"/reservations/{result.json['id']}/charges",
                    {"type": kind, "unitPrice": amount, "description": kind},
                    key="commission-charge-" + kind,
                )
                self.assertEqual(result.status_code, 201, result.json)
            result = self.request(
                "post",
                f"/reservations/{result.json['id']}/charges",
                {"serviceId": "service-a", "quantity": "1"},
                key="commission-service",
            )
            self.assertEqual(result.status_code, 201, result.json)
        return result.json

    def close(self, row, fund="fund-a"):
        paid = self.request(
            "post",
            f"/reservations/{row['id']}/payments",
            {"amount": row["total"], "methodId": "cash-a", "fundId": fund},
            key="commission-booking-payment",
        )
        self.assertEqual(paid.status_code, 201, paid.json)
        for status in ["IN_HOUSE", "CHECKED_OUT"]:
            result = self.request("post", f"/reservations/{row['id']}/status", {"status": status})
            self.assertEqual(result.status_code, 200, result.json)
        return result.json

    def settle(self, row, **data):
        result = self.request("post", "/commissions/settle", {"bookingId": row["id"], **data})
        self.assertEqual(result.status_code, 201, result.json)
        return result.json

    def payout(self, item, amount="4", key="commission-payout", **options):
        return self.request(
            "post",
            f"/commissions/{item['id']}/payments",
            {"amount": amount, "fundId": "fund-a", "note": "Agency payment"},
            key=key,
            **options,
        )

    def test_room_discount_basis_excludes_services_tax_and_generic_adjustments(self):
        row = self.booking(discount=True, charges=True)
        self.assertEqual(row["pricingSnapshot"]["commission"]["percent"], "10.0000")
        self.assertEqual(row["total"], "195.0000")
        closed = self.close(row)
        self.request(
            "patch",
            "/masters/bookingSources",
            {"id": "direct-a", "commission": "90", "name": "New agency name"},
        )
        item = self.settle(closed)
        self.assertEqual(item["roomNet"], "150.0000")
        self.assertEqual(item["amount"], "15.0000")
        self.assertEqual(item["baseAmount"], "15.0000")
        self.assertEqual(item["sourceName"], "Direct")
        self.assertEqual(item["percent"], "10.0000")
        self.assertTrue(item["needsReview"])
        self.assertEqual(item["status"], "NEEDS_REVIEW")
        self.assertEqual(self.payout(item).status_code, 409)
        reviewed = self.request("get", "/commissions?status=NEEDS_REVIEW").json
        self.assertEqual(reviewed["items"][0]["id"], item["id"])
        self.assertEqual(reviewed["summary"]["accrued"], "15.0000")
        again = self.request("post", "/commissions/settle", {"bookingId": row["id"]})
        self.assertEqual(again.status_code, 200, again.json)
        self.assertEqual(again.json["id"], item["id"])

    def test_confirmed_edits_preserve_snapshot_and_new_source_changes_prospectively(self):
        row = self.booking()
        self.request("patch", "/masters/bookingSources", {"id": "direct-a", "commission": "80"})
        changed = self.request(
            "patch",
            f"/reservations/{row['id']}",
            {
                "checkOut": str(
                    utcnow().astimezone(ZoneInfo("Asia/Ho_Chi_Minh")).date() + timedelta(days=3)
                )
            },
        )
        self.assertEqual(changed.status_code, 200, changed.json)
        self.assertEqual(changed.json["pricingSnapshot"]["commission"]["percent"], "10.0000")
        source = self.request(
            "post",
            "/masters/bookingSources",
            {"name": "Agency B", "type": "Travel Agency", "commission": "20"},
        )
        self.assertEqual(source.status_code, 201, source.json)
        changed = self.request(
            "patch", f"/reservations/{row['id']}", {"sourceId": source.json["id"]}
        )
        self.assertEqual(changed.status_code, 200, changed.json)
        self.assertEqual(changed.json["pricingSnapshot"]["commission"]["percent"], "20.0000")

    def test_partial_payments_replay_overpayment_and_reversal_use_cashbook(self):
        item = self.settle(self.close(self.booking()))
        first = self.payout(item)
        self.assertEqual(first.status_code, 201, first.json)
        self.assertEqual(first.json["paid"], "4.0000")
        self.assertEqual(self.payout(item).json, first.json)
        self.assertEqual(self.payout(item, "5").status_code, 409)
        self.assertEqual(self.payout(item, "17", "commission-overpay").status_code, 409)
        paid = self.payout(item, "16", "commission-second")
        self.assertEqual(paid.status_code, 201, paid.json)
        self.assertEqual(paid.json["status"], "PAID")
        self.assertEqual(
            self.request("get", "/commissions?status=PAID").json["items"][0]["id"], item["id"]
        )
        cash_id = first.json["payments"][0]["cashDocumentId"]
        reverse = self.request(
            "post",
            f"/cash-documents/{cash_id}/reverse",
            {"reason": "Returned agency payment"},
            key="commission-reverse",
        )
        self.assertEqual(reverse.status_code, 201, reverse.json)
        listed = self.request("get", "/commissions").json
        self.assertEqual(listed["items"][0]["paid"], "16.0000")
        self.assertEqual(listed["items"][0]["balance"], "4.0000")
        self.assertEqual(listed["summary"]["balance"], "4.0000")
        self.assertEqual(self.request("get", "/commissions?status=PAID").json["items"], [])
        self.assertEqual(
            self.request("get", "/commissions?status=PARTIAL").json["summary"]["paid"], "16.0000"
        )
        self.assertTrue(
            next(
                payment
                for payment in listed["items"][0]["payments"]
                if payment["cashDocumentId"] == cash_id
            )["reversed"]
        )
        book = self.request("get", f"/cashbook?documentId={cash_id}").json
        self.assertEqual(book["pagination"]["totalItems"], 2)
        self.assertEqual(
            {document["id"] for document in book["cashDocuments"]}, {cash_id, reverse.json["id"]}
        )
        self.assertEqual(book["summary"]["closing"], "0.0000")
        self.assertEqual(
            self.request("get", "/cashbook?documentId=foreign-document").json["ledger"], []
        )
        other, headers = self.login("owner-b@test.local")
        foreign = self.request(
            "post",
            f"/api/tenants/{self.other_tenant_id}/cash-documents",
            {
                "type": "receipt",
                "fundId": "fund-b",
                "amount": "1",
                "description": "Foreign document",
            },
            client=other,
            headers=headers,
            key="commission-foreign-document",
        )
        self.assertEqual(foreign.status_code, 201, foreign.json)
        self.assertEqual(
            self.request("get", "/cashbook?documentId=" + foreign.json["id"]).json["ledger"], []
        )

    def test_legacy_rate_requires_explicit_owner_or_accountant_confirmation(self):
        closed = self.close(self.booking())
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            row = db.session.get(Reservation, closed["id"])
            row.pricing_snapshot = {
                key: value for key, value in row.pricing_snapshot.items() if key != "commission"
            }
            db.session.commit()
        listed = self.request("get", "/commissions").json
        self.assertTrue(listed["candidates"][0]["missingRate"])
        denied = self.request("post", "/commissions/settle", {"bookingId": closed["id"]})
        self.assertEqual(denied.status_code, 409, denied.json)
        accountant, headers = self.login("accountant@test.local")
        result = self.request(
            "post",
            "/commissions/settle",
            {"bookingId": closed["id"], "legacyPercent": "12.5", "confirmLegacyRate": True},
            client=accountant,
            headers=headers,
        )
        self.assertEqual(result.status_code, 201, result.json)
        self.assertEqual(result.json["amount"], "25.0000")

    def test_payout_rejects_unsettled_foreign_roles_wrong_currency_and_adjusted_stays(self):
        row = self.booking()
        unsettled = self.request("post", "/commissions/settle", {"bookingId": row["id"]})
        self.assertEqual(unsettled.status_code, 409, unsettled.json)
        closed = self.close(row)
        item = self.settle(closed)
        desk, headers = self.login("frontdesk@test.local")
        self.assertEqual(self.payout(item, client=desk, headers=headers).status_code, 403)
        other, headers = self.login("owner-b@test.local")
        self.assertEqual(self.payout(item, client=other, headers=headers).status_code, 403)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.add(
                Master(
                    id="usd-commission",
                    tenant_id=self.tenant_id,
                    catalog="funds",
                    name="USD fund",
                    data={"currency": "USD", "type": "cash"},
                )
            )
            db.session.commit()
        wrong = self.request(
            "post",
            f"/commissions/{item['id']}/payments",
            {"amount": "1", "fundId": "usd-commission", "note": "Wrong currency"},
            key="commission-currency",
        )
        self.assertEqual(wrong.status_code, 409, wrong.json)
        adjustment = self.request(
            "post",
            f"/reservations/{row['id']}/adjustments",
            {
                "type": "debit",
                "amount": "1",
                "reason": "After checkout",
                "fundId": "fund-a",
                "methodId": "cash-a",
            },
            key="commission-adjustment",
        )
        self.assertEqual(adjustment.status_code, 201, adjustment.json)
        blocked = self.payout(item, key="commission-after-adjustment")
        self.assertEqual(blocked.status_code, 409, blocked.json)
        listed = self.request("get", "/commissions").json
        self.assertTrue(listed["items"][0]["needsReview"])
        self.assertEqual(listed["items"][0]["amount"], "20.0000")

    def test_zero_commission_filters_and_existing_snapshot_reject_manual_rate(self):
        item = self.settle(self.close(self.booking(percent="0")))
        self.assertEqual(item["amount"], "0.0000")
        self.assertEqual(item["status"], "PAID")
        self.assertEqual(self.payout(item).status_code, 409)
        for query in [
            "status=UNPAID",
            "currency=USD",
            "sourceId=not-this-source",
            "endDate=2000-01-01",
        ]:
            self.assertEqual(self.request("get", "/commissions?" + query).json["items"], [])
        self.assertEqual(
            self.request("get", "/commissions?status=PAID&sourceId=direct-a").json["items"][0][
                "id"
            ],
            item["id"],
        )
        changed = self.request(
            "post",
            "/commissions/settle",
            {"bookingId": item["bookingId"], "legacyPercent": "20", "confirmLegacyRate": True},
        )
        self.assertEqual(changed.status_code, 409, changed.json)
        for query in ["currency=XXX", "status=BAD", "startDate=2030-01-01&endDate=2029-01-01"]:
            self.assertEqual(self.request("get", "/commissions?" + query).status_code, 422)

    def test_payout_validation_and_rollback_leave_no_partial_cash_or_payout(self):
        item = self.settle(self.close(self.booking()))
        path = f"/commissions/{item['id']}/payments"
        income = self.request(
            "post", "/masters/cashbookCategories", {"name": "Income", "type": "INCOME"}
        ).json["id"]
        inactive = self.request(
            "post", "/masters/funds", {"name": "Inactive", "type": "cash"}
        ).json["id"]
        self.request("post", f"/masters/funds/{inactive}/toggle", {})
        for index, values in enumerate(
            [
                {"amount": "0"},
                {"amount": "NaN"},
                {"amount": "1.00001"},
                {"fundId": "fund-b"},
                {"fundId": inactive},
                {"categoryId": income},
                {"currency": "VND"},
            ]
        ):
            result = self.request(
                "post",
                path,
                {"amount": "4", "fundId": "fund-a", **values},
                key=f"invalid-commission-{index}",
            )
            self.assertEqual(result.status_code, 422, result.json)
        self.assertEqual(
            self.request("post", path, {"amount": "4", "fundId": "fund-a"}).status_code, 422
        )
        spent = self.request(
            "post",
            "/cash-documents",
            {"type": "expense", "fundId": "fund-a", "amount": "195", "description": "Spend fund"},
            key="commission-fund-spent",
        )
        self.assertEqual(spent.status_code, 201, spent.json)
        insufficient = self.payout(item, "10", "commission-no-cash")
        self.assertEqual(insufficient.status_code, 409, insufficient.json)
        with patch(
            "pms_api.finance.commissions.ledger",
            side_effect=RuntimeError("Simulated ledger failure"),
        ):
            with self.assertRaisesRegex(RuntimeError, "Simulated ledger failure"):
                self.payout(item, "4", "commission-atomic-failure")
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(
                db.session.scalar(select(func.count()).select_from(CommissionPayout)), 0
            )
            self.assertEqual(db.session.scalar(select(func.count()).select_from(CashDocument)), 1)
            self.assertEqual(db.session.scalar(select(func.sum(LedgerEntry.amount))), Decimal("5"))
        retry = self.payout(item, "4", "commission-atomic-failure")
        self.assertEqual(retry.status_code, 201, retry.json)

    def test_concurrent_settlement_and_payments_serialize_and_retries_replay(self):
        row = self.close(self.booking())
        clients = [self.login(), self.login()]

        def reconcile(index):
            client, headers = clients[index]
            return self.request(
                "post",
                "/commissions/settle",
                {"bookingId": row["id"]},
                client=client,
                headers=headers,
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            reconciled = list(pool.map(reconcile, range(2)))
        self.assertEqual(sorted(result.status_code for result in reconciled), [200, 201])
        self.assertEqual(reconciled[0].json["id"], reconciled[1].json["id"])
        item = reconciled[0].json

        def pay(index, amount, key):
            client, headers = clients[index]
            return self.payout(item, amount, key, client=client, headers=headers)

        with ThreadPoolExecutor(max_workers=2) as pool:
            paid = list(
                pool.map(lambda index: pay(index, "15", f"commission-race-{index}"), range(2))
            )
        self.assertEqual(sorted(result.status_code for result in paid), [201, 409])
        with ThreadPoolExecutor(max_workers=2) as pool:
            retry = list(
                pool.map(lambda index: pay(index, "5", "commission-race-replay"), range(2))
            )
        self.assertEqual([result.status_code for result in retry], [201, 201])
        self.assertEqual(retry[0].json, retry[1].json)
        self.assertEqual(retry[0].json["paid"], "20.0000")
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(
                db.session.scalar(select(func.count()).select_from(CommissionSettlement)), 1
            )
            self.assertEqual(
                db.session.scalar(select(func.count()).select_from(CommissionPayout)), 2
            )
            self.assertEqual(db.session.scalar(select(func.count()).select_from(CashDocument)), 2)
            self.assertEqual(
                db.session.scalar(select(func.sum(LedgerEntry.amount))), Decimal("180")
            )

    def test_waiting_payout_sees_correction_committed_before_write_lock(self):
        item = self.settle(self.close(self.booking()))
        client, headers = self.login()
        waiting = Event()
        worker_id = [None]

        def observe_lock(conn, cursor, statement, parameters, context, many):
            if (
                get_ident() == worker_id[0]
                and "FROM tenants" in statement
                and "FOR UPDATE" in statement
            ):
                waiting.set()

        def pay():
            worker_id[0] = get_ident()
            return self.payout(item, client=client, headers=headers)

        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            lock_tenant(self.tenant_id)
            booking = db.session.scalar(
                select(Reservation).where(Reservation.id == item["bookingId"]).with_for_update()
            )
            event.listen(db.engine, "before_cursor_execute", observe_lock)
            try:
                with ThreadPoolExecutor(max_workers=1) as pool:
                    future = pool.submit(pay)
                    try:
                        self.assertTrue(
                            waiting.wait(5), "Payout did not attempt the tenant write lock"
                        )
                        db.session.add(
                            Charge(
                                tenant_id=self.tenant_id,
                                reservation_id=booking.id,
                                description="After checkout correction",
                                kind="discount",
                                quantity=1,
                                unit_price=1,
                                amount=-1,
                                currency="VND",
                                base_currency="VND",
                                base_amount=-1,
                                exchange_rate=1,
                                user_id=self.owner_id,
                            )
                        )
                        db.session.commit()
                    finally:
                        db.session.rollback()
                    result = future.result(timeout=10)
            finally:
                event.remove(db.engine, "before_cursor_execute", observe_lock)
        self.assertEqual(result.status_code, 409, result.json)
        self.assertEqual(result.json["error"]["code"], "commission_needs_review")
        self.assertEqual(self.request("get", "/cashbook").json["summary"]["closing"], "200.0000")

    def test_foreign_payout_keeps_booking_fx_after_exchange_rate_change(self):
        self.assertEqual(
            self.request(
                "put", "/pricing/exchange-rates", {"currency": "USD", "rate": "3.33333333"}
            ).status_code,
            200,
        )
        fund = self.request(
            "post", "/masters/funds", {"name": "USD agency fund", "currency": "USD", "type": "bank"}
        ).json["id"]
        item = self.settle(self.close(self.booking(currency="USD"), fund))
        self.assertEqual(item["baseAmount"], "20.0000")
        self.request("put", "/pricing/exchange-rates", {"currency": "USD", "rate": "8.5"})
        paid = self.request(
            "post",
            f"/commissions/{item['id']}/payments",
            {"amount": "4", "fundId": fund},
            key="commission-usd-pay",
        )
        self.assertEqual(paid.status_code, 201, paid.json)
        document = self.request("get", "/cashbook?currency=USD&fundType=bank").json[
            "cashDocuments"
        ][0]
        self.assertEqual(document["baseAmount"], "13.3333")
        self.assertEqual(document["exchangeRate"], "3.33333333")
        reversed_payment = self.request(
            "post",
            f"/cash-documents/{document['id']}/reverse",
            {"reason": "USD agency reversal"},
            key="commission-usd-reverse",
        )
        self.assertEqual(reversed_payment.status_code, 201, reversed_payment.json)
        self.assertEqual(reversed_payment.json["baseAmount"], document["baseAmount"])
        self.assertEqual(
            self.request("get", "/commissions?currency=USD").json["items"][0]["paid"], "0.0000"
        )

    def test_pages_are_bounded_with_full_filtered_totals_and_business_checkout_dates(self):
        checked_out = datetime(2030, 1, 1, 18, tzinfo=UTC)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            for index in range(35):
                db.session.add(
                    Reservation(
                        id=f"commission-page-{index:03d}",
                        tenant_id=self.tenant_id,
                        guest_name="Historic commission",
                        status="CHECKED_OUT",
                        source_id="direct-a",
                        source_name="Direct",
                        check_in=checked_out.date(),
                        check_out=checked_out.date() + timedelta(days=9),
                        checked_out_at=checked_out,
                        currency="VND",
                        base_currency="VND",
                        exchange_rate=1,
                        base_amount=100,
                        pricing_snapshot={
                            "commission": {
                                "sourceId": "direct-a",
                                "sourceName": "Direct",
                                "percent": "10.0000",
                            }
                        },
                    )
                )
            db.session.flush()
            for index in range(25):
                db.session.add(
                    CommissionSettlement(
                        id=f"commission-settlement-{index:03d}",
                        tenant_id=self.tenant_id,
                        reservation_id=f"commission-page-{index:03d}",
                        source_id="direct-a",
                        source_name="Direct",
                        percent=10,
                        room_net=100,
                        base_room_net=100,
                        amount=10,
                        currency="VND",
                        base_currency="VND",
                        base_amount=10,
                        exchange_rate=1,
                        business_date=checked_out.date() + timedelta(days=1),
                        user_id=self.owner_id,
                    )
                )
            db.session.commit()
            statements = []

            def capture(conn, cursor, statement, parameters, context, many):
                if statement.startswith("SELECT reservations.id"):
                    statements.append(statement)

            event.listen(db.engine, "before_cursor_execute", capture)
            try:
                first = self.request(
                    "get", "/commissions?startDate=2030-01-02&endDate=2030-01-02&pageSize=20"
                ).json
            finally:
                event.remove(db.engine, "before_cursor_execute", capture)
        self.assertEqual(first["pagination"], {"page": 1, "pageSize": 20, "totalItems": 35})
        self.assertEqual(len(first["items"]) + len(first["candidates"]), 20)
        self.assertEqual(first["summary"]["accrued"], "250.0000")
        self.assertTrue(
            any("LIMIT" in statement and "OFFSET" in statement for statement in statements)
        )
        second = self.request(
            "get", "/commissions?startDate=2030-01-02&endDate=2030-01-02&pageSize=20&page=2"
        ).json
        self.assertEqual(len(second["items"]), 5)
        self.assertEqual(len(second["candidates"]), 10)
        self.assertEqual(second["summary"], first["summary"])
        filtered = self.request(
            "get",
            "/commissions?startDate=2030-01-02&endDate=2030-01-02&pageSize=20&page=2&status=UNPAID&sourceId=direct-a",
        ).json
        self.assertEqual(filtered["pagination"]["totalItems"], 25)
        self.assertEqual(len(filtered["items"]), 5)
        self.assertEqual(filtered["candidates"], [])
        self.assertEqual(filtered["summary"]["balance"], "250.0000")
        excluded = self.request("get", "/commissions?endDate=2030-01-01").json
        self.assertEqual(excluded["pagination"]["totalItems"], 0)
        changed = self.request("patch", "/settings", {"timezone": "UTC"})
        self.assertEqual(changed.status_code, 200, changed.json)
        frozen_dates = self.request(
            "get", "/commissions?startDate=2030-01-02&endDate=2030-01-02"
        ).json
        self.assertEqual(frozen_dates["pagination"]["totalItems"], 25)
        self.assertEqual(frozen_dates["summary"]["accrued"], "250.0000")
        for query in ["page=0", "pageSize=501", "page=invalid"]:
            self.assertEqual(self.request("get", "/commissions?" + query).status_code, 422)
