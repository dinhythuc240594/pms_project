"""System SaaS billing is isolated from hotel accounts and uses real PostgreSQL."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from decimal import Decimal
from pathlib import Path
from threading import Barrier

from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.exc import DBAPIError

from pms_api.core_models import AuditLog, Plan, Subscription, Tenant, User, uid, utcnow
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class ManagerBillingTests(DomainTestCase):
    def setUp(self):
        super().setUp()
        self.admin, self.admin_headers = self.login("admin@test.local")

    def system(self, method, path="/api/billing/invoices", body=None, **options):
        options.setdefault("client", self.admin)
        options.setdefault("headers", self.admin_headers)
        return self.request(method, path, body, **options)

    def invoice(self, **changes):
        response = self.system(
            "POST",
            body={
                "tenantId": self.tenant_id,
                "description": "PRO monthly subscription",
                "amount": "100.1250",
                "currency": "VND",
                "dueDate": "2026-10-01",
                **changes,
            },
            key=uid(),
        )
        self.assertEqual(response.status_code, 201, response.json)
        return response.json

    def pay(self, invoice, amount="25.1250", key="billing-payment-1", **changes):
        return self.system(
            "POST",
            f"/api/billing/invoices/{invoice['id']}/payments",
            {"amount": amount, "method": "bank", "reference": "BANK-123", **changes},
            key=key,
        )

    def test_routes_require_system_authority_and_csrf(self):
        invoice = self.invoice()
        paths = ["/api/billing/invoices", "/api/manager/overview"]
        for email in ("owner-a@test.local", "frontdesk@test.local", "accountant@test.local"):
            client, csrf = self.login(email)
            for path in paths:
                denied = self.system("GET", path, client=client, headers=csrf)
                self.assertEqual(denied.status_code, 403, denied.json)
            for path, body in (
                ("/api/billing/invoices", {"tenantId": self.tenant_id}),
                (f"/api/billing/invoices/{invoice['id']}/payments", {"amount": "1"}),
                (f"/api/billing/invoices/{invoice['id']}/void", {"reason": "Test"}),
            ):
                self.assertEqual(
                    self.system("POST", path, body, client=client, headers=csrf).status_code, 403
                )
        for path in paths:
            self.assertEqual(
                self.system("GET", path, client=self.app.test_client(), headers={}).status_code,
                401,
            )
        manager, csrf = self.login("manager@test.local")
        for path in paths:
            self.assertEqual(
                self.system("GET", path, client=manager, headers=csrf).status_code, 200
            )
        self.assertEqual(self.system("POST", body={}, headers={}).status_code, 403)
        forbidden_origin = {**self.admin_headers, "Origin": "https://untrusted.example"}
        self.assertEqual(self.system("POST", body={}, headers=forbidden_origin).status_code, 403)
        with self.app.app_context():
            db.session.get(User, "manager").active = False
            db.session.commit()
        self.assertEqual(self.system("GET", client=manager, headers=csrf).status_code, 401)

    def test_create_and_pay_preserve_decimal_money_and_subscription(self):
        from pms_api.bookings.models import IdempotencyRecord, LedgerEntry
        from pms_api.saas_billing.models import SaaSIdempotencyRecord, SaaSPayment

        invoice = self.invoice()
        self.assertEqual(invoice["amount"], "100.1250")
        self.assertEqual(invoice["status"], "unpaid")
        self.assertEqual(invoice["tenantName"], "Hotel a")
        self.assertEqual(invoice["paid"], "0.0000")
        self.assertEqual(invoice["balance"], "100.1250")
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            subscription = db.session.get(Subscription, "sub-a")
            subscription.status = "expired"
            db.session.commit()
        first = self.pay(invoice, note="Manual bank confirmation")
        self.assertEqual(first.status_code, 201, first.json)
        self.assertEqual(first.json["status"], "partial")
        self.assertEqual(first.json["balance"], "75.0000")
        payment = first.json["payments"][0]
        self.assertEqual(payment["reference"], "BANK-123")
        self.assertEqual(payment["note"], "Manual bank confirmation")
        last = self.pay(invoice, "75", "billing-payment-2", method="cash")
        self.assertEqual(last.status_code, 201, last.json)
        self.assertEqual(last.json["status"], "paid")
        self.assertEqual(last.json["balance"], "0.0000")
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            self.assertEqual(db.session.get(Subscription, "sub-a").status, "expired")
            self.assertEqual(db.session.scalar(select(func.count()).select_from(LedgerEntry)), 0)
            self.assertEqual(
                db.session.scalar(select(func.count()).select_from(IdempotencyRecord)), 0
            )
            self.assertEqual(db.session.scalar(select(func.count()).select_from(SaaSPayment)), 2)
            self.assertEqual(
                db.session.scalar(select(func.count()).select_from(SaaSIdempotencyRecord)), 3
            )
            entries = db.session.scalars(
                select(AuditLog).where(AuditLog.entity_type == "saas_invoice")
            ).all()
            self.assertEqual(len(entries), 3)
            self.assertEqual({entry.tenant_id for entry in entries}, {None})
            self.assertEqual({entry.details["tenantId"] for entry in entries}, {self.tenant_id})

    def test_invoice_creation_replay_and_concurrent_duplicate_preserve_one_receivable(self):
        from pms_api.saas_billing.models import SaaSIdempotencyRecord, SaaSInvoice

        body = {
            "tenantId": self.tenant_id,
            "description": "Monthly SaaS",
            "amount": "250.1250",
            "currency": "VND",
            "dueDate": "2026-10-31",
        }
        missing = self.system("POST", body=body)
        self.assertEqual(missing.status_code, 422, missing.json)
        self.assertEqual(missing.json["error"]["code"], "idempotency_required")
        clients = [self.login("admin@test.local"), self.login("admin@test.local")]
        barrier = Barrier(2)

        def concurrent_create(pair):
            barrier.wait(timeout=5)
            return self.system(
                "POST", body=body, client=pair[0], headers=pair[1], key="invoice-create-intent"
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(concurrent_create, clients))
        self.assertEqual([response.status_code for response in responses], [201, 201])
        self.assertEqual(responses[0].json, responses[1].json)
        replay = self.system("POST", body=body, key="invoice-create-intent")
        self.assertEqual(replay.status_code, 201, replay.json)
        self.assertEqual(replay.json, responses[0].json)
        changed = self.system("POST", body={**body, "amount": "251"}, key="invoice-create-intent")
        self.assertEqual(changed.status_code, 409, changed.json)
        self.assertEqual(changed.json["error"]["code"], "idempotency_conflict")
        with self.app.app_context():
            set_context("admin", is_system=True, is_service=True)
            for model in (SaaSInvoice, SaaSIdempotencyRecord):
                self.assertEqual(db.session.scalar(select(func.count()).select_from(model)), 1)
            self.assertEqual(
                db.session.scalar(
                    select(func.count())
                    .select_from(AuditLog)
                    .where(AuditLog.event == "saas.invoice_created")
                ),
                1,
            )
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(db.session.scalars(select(SaaSIdempotencyRecord)).all(), [])
            self.assertEqual(
                db.session.scalars(select(SaaSInvoice.id)).all(), [responses[0].json["id"]]
            )

    def test_validation_rejects_invalid_money_currency_dates_and_unknown_fields(self):
        base = {
            "tenantId": self.tenant_id,
            "description": "Subscription",
            "amount": "100",
            "currency": "VND",
        }
        for changes in (
            {"amount": "0"},
            {"amount": "-1"},
            {"amount": True},
            {"amount": "NaN"},
            {"amount": "Infinity"},
            {"amount": "0.00001"},
            {"amount": "1000000000000000"},
            {"currency": "EUR"},
            {"description": " "},
            {"description": "x" * 501},
            {"dueDate": "2026-02-30"},
            {"dueDate": "20261001"},
            {"tenantId": "missing"},
            {"status": "paid"},
        ):
            with self.subTest(changes=changes):
                result = self.system("POST", body={**base, **changes}, key=uid())
                self.assertEqual(result.status_code, 422, result.json)
        invoice = self.invoice(dueDate=None)
        self.assertIsNone(invoice["dueDate"])
        for changes in (
            {"amount": "0"},
            {"method": "card"},
            {"reference": "x" * 161},
            {"note": "x" * 1001},
            {"actorId": "owner-a"},
        ):
            result = self.pay(invoice, **changes)
            self.assertEqual(result.status_code, 422, result.json)
        self.assertEqual(self.pay(invoice, key=None).status_code, 422)
        self.assertEqual(self.pay(invoice, "1000").status_code, 409)

    def test_payment_replay_conflict_and_concurrent_duplicate_are_atomic(self):
        from pms_api.saas_billing.models import SaaSPayment

        invoice = self.invoice()
        first = self.pay(invoice)
        repeated = self.pay(invoice)
        self.assertEqual(first.status_code, 201, first.json)
        self.assertEqual(repeated.json, first.json)
        self.assertEqual(self.pay(invoice, "26").status_code, 409)
        other = self.invoice()
        self.assertEqual(self.pay(other).status_code, 409)
        manager, csrf = self.login("manager@test.local")
        conflict = self.system(
            "POST",
            f"/api/billing/invoices/{invoice['id']}/payments",
            {"amount": "25.1250", "method": "bank", "reference": "BANK-123"},
            client=manager,
            headers=csrf,
            key="billing-payment-1",
        )
        self.assertEqual(conflict.status_code, 409, conflict.json)
        clients = [self.login("admin@test.local"), self.login("admin@test.local")]
        barrier = Barrier(2)

        def duplicate(pair):
            barrier.wait(timeout=5)
            return self.system(
                "POST",
                f"/api/billing/invoices/{invoice['id']}/payments",
                {"amount": "25", "method": "cash"},
                client=pair[0],
                headers=pair[1],
                key="billing-duplicate-2",
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(duplicate, clients))
        self.assertEqual([response.status_code for response in responses], [201, 201])
        self.assertEqual(responses[0].json, responses[1].json)
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            self.assertEqual(db.session.scalar(select(func.count()).select_from(SaaSPayment)), 2)

    def test_concurrent_payments_cannot_overpay_and_void_cannot_race_payment(self):
        invoice = self.invoice(amount="100")
        clients = [self.login("admin@test.local"), self.login("admin@test.local")]
        barrier = Barrier(2)

        def competing_payment(index):
            pair = clients[index]
            barrier.wait(timeout=5)
            return self.system(
                "POST",
                f"/api/billing/invoices/{invoice['id']}/payments",
                {"amount": "60", "method": "cash"},
                client=pair[0],
                headers=pair[1],
                key=f"billing-overpayment-{index}",
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(competing_payment, range(2)))
        self.assertEqual(sorted(response.status_code for response in responses), [201, 409])
        row = self.system("GET").json["invoices"][0]
        self.assertEqual(row["paid"], "60.0000")
        self.assertEqual(len(row["payments"]), 1)
        self.assertEqual(
            self.system(
                "POST", f"/api/billing/invoices/{invoice['id']}/void", {"reason": "Error"}
            ).status_code,
            409,
        )
        unpaid = self.invoice()
        barrier = Barrier(2)

        def payment_or_void(index):
            pair = clients[index]
            barrier.wait(timeout=5)
            path = f"/api/billing/invoices/{unpaid['id']}/" + ("payments" if index else "void")
            body = {"amount": "10", "method": "cash"} if index else {"reason": "Duplicate"}
            return self.system(
                "POST",
                path,
                body,
                client=pair[0],
                headers=pair[1],
                key="billing-void-race" if index else None,
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(payment_or_void, range(2)))
        self.assertEqual(sum(response.status_code < 400 for response in responses), 1)
        self.assertIn(409, [response.status_code for response in responses])

    def test_void_unpaid_only_and_history_remains_visible(self):
        invoice = self.invoice()
        path = f"/api/billing/invoices/{invoice['id']}/void"
        self.assertEqual(self.system("POST", path, {"reason": " "}).status_code, 422)
        voided = self.system("POST", path, {"reason": "Duplicate invoice"})
        self.assertEqual(voided.status_code, 200, voided.json)
        self.assertEqual(voided.json["status"], "void")
        self.assertEqual(voided.json["balance"], "0.0000")
        self.assertEqual(self.pay(invoice).status_code, 409)
        self.assertEqual(self.system("POST", path, {"reason": "Again"}).status_code, 409)
        rows = self.system("GET", "/api/billing/invoices?status=void").json["invoices"]
        self.assertEqual([row["id"] for row in rows], [invoice["id"]])

    def test_paginated_filters_include_complete_payment_history_and_exclusive_end(self):
        invoices = [self.invoice(description=f"Subscription {index}") for index in range(4)]
        self.invoice(tenantId=self.other_tenant_id)
        self.pay(invoices[0])
        self.pay(invoices[1], "100.1250", "billing-filter-paid")
        self.system(
            "POST", f"/api/billing/invoices/{invoices[2]['id']}/void", {"reason": "Duplicate"}
        )
        page = self.system("GET", "/api/billing/invoices?tenantId=test-hotel-a&page=2&pageSize=2")
        self.assertEqual(page.status_code, 200, page.json)
        self.assertEqual(page.json["pagination"], {"page": 2, "pageSize": 2, "totalItems": 4})
        self.assertEqual(len(page.json["invoices"]), 2)
        self.assertTrue(all(row["tenantId"] == self.tenant_id for row in page.json["invoices"]))
        for status, invoice in zip(("partial", "paid", "void", "unpaid"), invoices, strict=True):
            rows = self.system(
                "GET", f"/api/billing/invoices?tenantId={self.tenant_id}&status={status}"
            ).json
            self.assertEqual([row["id"] for row in rows["invoices"]], [invoice["id"]])
            if status in {"partial", "paid"}:
                self.assertEqual(len(rows["invoices"][0]["payments"]), 1)
        today, tomorrow = utcnow().date(), utcnow().date() + timedelta(days=1)
        current = self.system("GET", f"/api/billing/invoices?start={today}&end={tomorrow}")
        self.assertEqual(current.json["pagination"]["totalItems"], 5)
        excluded = self.system("GET", f"/api/billing/invoices?end={today}")
        self.assertEqual(excluded.json["pagination"]["totalItems"], 0)
        for query in (
            "status=unknown",
            "page=0",
            "pageSize=501",
            "page=bad",
            "start=bad",
            "start=2026-10-10&end=2026-10-01",
        ):
            self.assertEqual(self.system("GET", "/api/billing/invoices?" + query).status_code, 422)

    def test_overview_separates_currencies_period_flow_and_current_debt(self):
        from pms_api.saas_billing.models import SaaSInvoice, SaaSPayment

        now = utcnow()
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
        old = start - timedelta(days=1)
        with self.app.app_context():
            set_context("admin", is_system=True, is_service=True)
            db.session.get(Tenant, self.other_tenant_id).status = "suspended"
            db.session.get(User, "hk").active = False
            db.session.add(Tenant(id="unassigned-hotel", name="Unassigned"))
            db.session.add(
                Plan(id="billing-free", name="Free", code="FREE", price=0, currency="VND")
            )
            db.session.flush()
            db.session.get(Subscription, "sub-b").plan_id = "billing-free"
            for key, amount, currency, created in (
                ("old", "100", "VND", old),
                ("new", "200", "VND", now),
                ("usd", "9.5000", "USD", now),
                ("void", "900", "VND", now),
                ("end", "50", "USD", end),
            ):
                db.session.add(
                    SaaSInvoice(
                        id=key,
                        tenant_id=self.tenant_id,
                        description=key,
                        amount=Decimal(amount),
                        currency=currency,
                        due_date=(start - timedelta(days=2)).date(),
                        created_at=created,
                        user_id="admin",
                    )
                )
            db.session.flush()
            for key, invoice_id, amount, created in (
                ("past", "old", "20", old),
                ("current", "old", "30", now),
                ("new-payment", "new", "25", now),
                ("usd-payment", "usd", "1.1250", now),
            ):
                db.session.add(
                    SaaSPayment(
                        id=key,
                        tenant_id=self.tenant_id,
                        invoice_id=invoice_id,
                        amount=Decimal(amount),
                        method="bank",
                        reference="",
                        note="",
                        user_id="admin",
                        created_at=created,
                    )
                )
            db.session.commit()
        self.assertEqual(
            self.system("POST", "/api/billing/invoices/void/void", {"reason": "Void"}).status_code,
            200,
        )
        result = self.system("GET", f"/api/manager/overview?start={start.date()}&end={end.date()}")
        self.assertEqual(result.status_code, 200, result.json)
        self.assertEqual(result.json["tenants"], {"total": 3, "active": 2, "suspended": 1})
        self.assertEqual(result.json["users"], {"active": 6})
        self.assertEqual(result.json["plans"], {"FREE": 1, "PRO": 1, "unassigned": 1})
        currencies = {row["currency"]: row for row in result.json["currencies"]}
        self.assertEqual(
            currencies["VND"],
            {
                "currency": "VND",
                "invoiced": "200.0000",
                "received": "55.0000",
                "refunded": "0.0000",
                "outstanding": "225.0000",
                "overdue": "225.0000",
            },
        )
        self.assertEqual(
            currencies["USD"],
            {
                "currency": "USD",
                "invoiced": "9.5000",
                "received": "1.1250",
                "refunded": "0.0000",
                "outstanding": "58.3750",
                "overdue": "58.3750",
            },
        )
        self.assertEqual(len(result.json["recentPayments"]), 3)
        self.assertNotIn("guest", str(result.json).lower())
        default = self.system("GET", "/api/manager/overview").json
        self.assertEqual(
            (default["start"], default["end"]), (start.date().isoformat(), end.date().isoformat())
        )
        for query in ("start=bad", "start=20261001", "start=2026-10-02&end=2026-10-01"):
            self.assertEqual(self.system("GET", "/api/manager/overview?" + query).status_code, 422)

    def test_forced_rls_preserves_owner_reads_private_cache_and_immutable_payment_history(self):
        from pms_api.saas_billing.models import SaaSIdempotencyRecord, SaaSInvoice, SaaSPayment

        invoice = self.invoice()
        self.assertEqual(self.pay(invoice).status_code, 201)
        with self.app.app_context():
            set_context("owner-a", self.tenant_id)
            self.assertEqual(db.session.scalars(select(SaaSInvoice.id)).all(), [invoice["id"]])
            self.assertEqual(len(db.session.scalars(select(SaaSPayment)).all()), 1)
            self.assertEqual(db.session.scalars(select(SaaSIdempotencyRecord)).all(), [])
            self.assertEqual(
                db.session.scalars(
                    select(AuditLog).where(AuditLog.entity_type == "saas_invoice")
                ).all(),
                [],
            )
            with self.assertRaises(DBAPIError):
                db.session.add(
                    SaaSInvoice(
                        tenant_id=self.tenant_id,
                        description="Forbidden",
                        amount=1,
                        currency="VND",
                        user_id=self.owner_id,
                    )
                )
                db.session.flush()
            db.session.rollback()
            set_context("admin", is_system=True, is_service=True)
            with self.assertRaises(DBAPIError):
                db.session.execute(text("UPDATE saas_payments SET amount=1"))
            db.session.rollback()
            set_context("admin", is_system=True, is_service=True)
            with self.assertRaises(DBAPIError):
                db.session.execute(text("DELETE FROM saas_payments"))
            db.session.rollback()
            set_context("admin", is_system=True, is_service=True)
            payment = db.session.scalar(select(SaaSPayment))
            with self.assertRaises(DBAPIError):
                db.session.add(
                    SaaSPayment(
                        tenant_id=self.other_tenant_id,
                        invoice_id=payment.invoice_id,
                        amount=1,
                        method="cash",
                        user_id="admin",
                    )
                )
                db.session.flush()
            db.session.rollback()
            set_context("admin", is_system=True, is_service=True)
            with self.assertRaises(DBAPIError):
                db.session.add(
                    SaaSPayment(
                        tenant_id=self.tenant_id,
                        invoice_id=invoice["id"],
                        amount=1000,
                        method="cash",
                        user_id="admin",
                    )
                )
                db.session.flush()
            db.session.rollback()
            set_context("admin", is_system=True, is_service=True)
            flags = db.session.execute(
                text(
                    "SELECT relrowsecurity,relforcerowsecurity FROM pg_class "
                    "WHERE relname IN ('saas_invoices','saas_payments','saas_idempotency_records')"
                )
            ).all()
            self.assertEqual(flags, [(True, True)] * 3)

    def test_billing_downgrade_refuses_business_records_without_losing_data(self):
        invoice = self.invoice()
        self.pay(invoice)
        before = self.system("GET").json
        migration = (
            ScriptDirectory(str(Path(__file__).resolve().parents[1] / "migrations"))
            .get_revision("0013_manager_billing")
            .module
        )
        engine = create_engine(self.app.config["DATABASE_MIGRATION_URL"], hide_parameters=True)
        try:
            with self.assertRaises(DBAPIError) as refused:
                with engine.begin() as connection:
                    with Operations.context(MigrationContext.configure(connection)):
                        migration.downgrade()
            self.assertIn(
                "saas billing records exist; downgrade refused", str(refused.exception).lower()
            )
        finally:
            engine.dispose()
        self.assertEqual(self.system("GET").json, before)
        self.assertEqual(self.client.get("/api/ready").status_code, 200)
        with self.app.app_context():
            self.assertEqual(
                set(db.session.execute(text("SELECT version_num FROM alembic_version")).scalars()),
                self.app.extensions["migration_heads"],
            )
