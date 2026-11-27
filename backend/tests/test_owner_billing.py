"""Owner billing reads share Manager records without granting billing write authority."""

from datetime import timedelta
from decimal import Decimal

from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from pms_api.core_models import (
    Plan,
    Subscription,
    SubscriptionHistory,
    Tenant,
    TenantUser,
    User,
    uid,
    utcnow,
)
from pms_api.extensions import db
from pms_api.saas_billing.models import SaaSIdempotencyRecord, SaaSInvoice, SaaSPayment
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase
from tests.system_scope_fixture import grant_system_access


class OwnerBillingTests(DomainTestCase):
    def setUp(self):
        super().setUp()
        self.admin, self.admin_headers = self.login("admin@test.local")

    def manager(self, method, path="/api/billing/invoices", body=None):
        return self.request(
            method, path, body, client=self.admin, headers=self.admin_headers, key=uid()
        )

    def invoice(self, **changes):
        response = self.manager(
            "POST",
            body={
                "tenantId": self.tenant_id,
                "description": "Subscription invoice",
                "amount": "100.1250",
                "currency": "VND",
                **changes,
            },
        )
        self.assertEqual(response.status_code, 201, response.json)
        return response.json

    def pay(self, invoice, amount):
        response = self.manager(
            "POST",
            f"/api/billing/invoices/{invoice['id']}/payments",
            {"amount": amount, "method": "bank", "reference": "BANK-42", "note": "Confirmed"},
        )
        self.assertEqual(response.status_code, 201, response.json)
        return response.json

    def test_owner_reads_match_manager_and_summary_covers_all_pages_by_currency(self):
        partial = self.pay(self.invoice(), "25.1250")
        paid = self.pay(self.invoice(amount="4.5000", currency="USD"), "4.5000")
        unpaid = self.invoice(amount="9.1250", currency="USD")
        void = self.invoice(amount="999.0000")
        self.assertEqual(
            self.manager(
                "POST", f"/api/billing/invoices/{void['id']}/void", {"reason": "Duplicate"}
            ).status_code,
            200,
        )
        self.pay(self.invoice(tenantId=self.other_tenant_id, amount="5000"), "1000")
        expected = self.manager("GET", f"/api/billing/invoices?tenantId={self.tenant_id}").json
        seen = []
        for page in range(1, 5):
            response = self.request("GET", f"/billing/invoices?page={page}&pageSize=1")
            self.assertEqual(response.status_code, 200, response.json)
            self.assertEqual(
                response.json["pagination"], {"page": page, "pageSize": 1, "totalItems": 4}
            )
            seen.extend(response.json["invoices"])
        self.assertEqual(seen, expected["invoices"])
        injected = self.request("GET", f"/billing/invoices?tenantId={self.other_tenant_id}")
        self.assertEqual(injected.json, expected)
        partial_only = self.request("GET", "/billing/invoices?status=partial")
        self.assertEqual([row["id"] for row in partial_only.json["invoices"]], [partial["id"]])
        self.assertEqual(
            self.request("GET", "/billing/invoices?page=5&pageSize=1").json["invoices"], []
        )
        for invoice in seen:
            detail = self.request("GET", f"/billing/invoices/{invoice['id']}")
            self.assertEqual(detail.status_code, 200, detail.json)
            self.assertEqual(detail.json, invoice)
        self.assertEqual(partial["balance"], "75.0000")
        self.assertEqual(paid["balance"], "0.0000")
        self.assertEqual(unpaid["paid"], "0.0000")
        response = self.request("GET", "/billing")
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(
            {row["currency"]: row for row in response.json["summary"]},
            {
                "VND": {
                    "currency": "VND",
                    "amount": "100.1250",
                    "paid": "25.1250",
                    "balance": "75.0000",
                },
                "USD": {
                    "currency": "USD",
                    "amount": "13.6250",
                    "paid": "4.5000",
                    "balance": "9.1250",
                },
            },
        )
        self.assertNotIn("actorId", str(response.json))

    def test_membership_policy_is_enforced_for_each_read_and_foreign_document(self):
        invoice = self.invoice()
        foreign = self.invoice(tenantId=self.other_tenant_id, description="Private Hotel B")
        paths = (
            "/billing",
            "/billing/invoices",
            "/billing/history",
            f"/billing/invoices/{invoice['id']}",
        )
        for email in ("frontdesk@test.local", "hk@test.local", "accountant@test.local"):
            client, csrf = self.login(email)
            for path in paths:
                result = self.request("GET", path, client=client, headers=csrf)
                self.assertEqual(result.status_code, 403, (email, path, result.json))
        for path in paths:
            result = self.request("GET", path, client=self.app.test_client(), headers={})
            self.assertEqual(result.status_code, 401, result.json)
            foreign_path = f"/api/tenants/{self.other_tenant_id}{path}"
            self.assertEqual(self.request("GET", foreign_path).status_code, 403)
        for invoice_id in (foreign["id"], "missing"):
            result = self.request("GET", f"/billing/invoices/{invoice_id}")
            self.assertEqual(result.status_code, 404, result.json)
            self.assertNotIn("Private Hotel B", str(result.json))
        # An owner in one hotel remains staff in another; role is selected per tenant.
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            db.session.add(
                TenantUser(tenant_id=self.other_tenant_id, user_id=self.owner_id, role="ACCOUNTANT")
            )
            db.session.commit()
        for path in paths:
            self.assertEqual(
                self.request("GET", f"/api/tenants/{self.other_tenant_id}{path}").status_code, 403
            )
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            db.session.scalar(
                select(TenantUser).where(
                    TenantUser.user_id == self.owner_id, TenantUser.tenant_id == self.tenant_id
                )
            ).active = False
            db.session.commit()
        for path in paths:
            self.assertEqual(self.request("GET", path).status_code, 403)

    def test_subscription_and_paginated_history_preserve_manager_snapshots(self):
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            for index in range(3):
                db.session.add(
                    SubscriptionHistory(
                        id=f"history-{index}",
                        tenant_id=self.tenant_id,
                        plan_id="default-pro",
                        action="renewed",
                        plan_name=f"Historical Pro {index}",
                        plan_code="PRO",
                        cycle="month",
                        status="active",
                        room_count=20,
                        amount=Decimal("19.1250"),
                        currency="USD",
                        user_id="admin",
                        effective_date=utcnow() - timedelta(days=index),
                        created_at=utcnow() - timedelta(days=index),
                    )
                )
            db.session.add(
                SubscriptionHistory(
                    tenant_id=self.other_tenant_id,
                    plan_id="default-pro",
                    action="created",
                    plan_name="Private Hotel B",
                )
            )
            db.session.commit()
        manager = self.manager("GET", f"/api/tenants/{self.tenant_id}/subscription").json
        self.assertEqual(
            self.request("GET", "/billing").json["subscription"], manager["subscription"]
        )
        history = []
        for page in (1, 2):
            result = self.request("GET", f"/billing/history?page={page}&pageSize=2")
            self.assertEqual(result.status_code, 200, result.json)
            self.assertEqual(
                result.json["pagination"], {"page": page, "pageSize": 2, "totalItems": 3}
            )
            history.extend(result.json["history"])
        self.assertEqual(
            history,
            [
                {key: value for key, value in row.items() if key not in {"actorId", "actorName"}}
                for row in manager["history"]
            ],
        )
        self.assertNotIn("Private Hotel B", str(history))

    def test_system_accounts_need_legacy_owner_membership_for_tenant_billing(self):
        invoice = self.invoice()
        paths = (
            "/billing",
            "/billing/invoices",
            "/billing/history",
            f"/billing/invoices/{invoice['id']}",
        )
        for account in ("admin", "manager"):
            client, headers = self.login(f"{account}@test.local")
            # A successful Manager read must not elevate the following tenant reads.
            self.assertEqual(client.get("/api/billing/invoices").status_code, 200)
            for path in paths:
                self.assertEqual(
                    self.request("GET", path, client=client, headers=headers).status_code, 403
                )

            grant_system_access(self, account, role="FRONT_DESK")
            for path in paths:
                self.assertEqual(
                    self.request("GET", path, client=client, headers=headers).status_code, 403
                )
            owner = self.request("PATCH", f"/users/{account}", {"role": "HOTEL_OWNER"})
            self.assertEqual(owner.status_code, 200, owner.json)
            for path in paths:
                response = self.request("GET", path, client=client, headers=headers)
                self.assertEqual(response.status_code, 200, response.json)
                foreign = self.request(
                    "GET",
                    f"/api/tenants/{self.other_tenant_id}{path}",
                    client=client,
                    headers=headers,
                )
                self.assertEqual(foreign.status_code, 403, foreign.json)
            with self.app.app_context():
                set_context(account, self.tenant_id)
                self.assertEqual(db.session.scalars(select(SaaSInvoice.id)).all(), [invoice["id"]])
                self.assertEqual(db.session.scalars(select(SaaSIdempotencyRecord)).all(), [])
            revoked = self.request("PATCH", f"/users/{account}", {"active": False})
            self.assertEqual(revoked.status_code, 200, revoked.json)
            for path in paths:
                self.assertEqual(
                    self.request("GET", path, client=client, headers=headers).status_code, 403
                )

    def test_inactive_identity_cannot_read_billing_with_an_active_owner_membership(self):
        invoice = self.pay(self.invoice(), "10")
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            db.session.get(User, self.owner_id).active = False
            db.session.commit()
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(db.session.scalars(select(SaaSInvoice)).all(), [])
            self.assertEqual(db.session.scalars(select(SaaSPayment)).all(), [])
        for path in (
            "/billing",
            "/billing/invoices",
            "/billing/history",
            f"/billing/invoices/{invoice['id']}",
        ):
            self.assertEqual(self.request("GET", path).status_code, 401)

    def test_reads_work_for_expired_or_disabled_plans_and_never_renew_or_write(self):
        invoice = self.invoice()
        persisted = self.request("GET", f"/billing/invoices/{invoice['id']}").json
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            subscription = db.session.get(Subscription, "sub-a")
            subscription.status = "expired"
            subscription.end_date = utcnow() - timedelta(days=10)
            db.session.get(Plan, "default-pro").active = False
            db.session.commit()
        before = self.manager("GET", f"/api/tenants/{self.tenant_id}/subscription").json
        for path in (
            "/billing",
            "/billing/invoices",
            "/billing/history",
            f"/billing/invoices/{invoice['id']}",
        ):
            self.assertEqual(self.request("GET", path).status_code, 200, path)
            for method in ("POST", "PATCH", "PUT", "DELETE"):
                self.assertEqual(
                    self.request(method, path, {"endDate": "2099-01-01"}).status_code,
                    405,
                    (method, path),
                )
        for path in (
            f"/billing/invoices/{invoice['id']}/payments",
            f"/billing/invoices/{invoice['id']}/void",
            "/billing/renew",
        ):
            self.assertIn(self.request("POST", path, {"amount": "1"}).status_code, {404, 405})
        for path in (
            "/api/billing/invoices",
            f"/api/billing/invoices/{invoice['id']}/payments",
            f"/api/billing/invoices/{invoice['id']}/void",
        ):
            self.assertEqual(self.request("POST", path, {}).status_code, 403)
        self.assertEqual(
            self.request("PUT", f"/api/tenants/{self.tenant_id}/subscription", {}).status_code,
            403,
        )
        after = self.manager("GET", f"/api/tenants/{self.tenant_id}/subscription").json
        self.assertEqual(before, after)
        self.assertEqual(self.request("GET", f"/billing/invoices/{invoice['id']}").json, persisted)
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            db.session.get(Tenant, self.tenant_id).status = "suspended"
            db.session.commit()
        for path in (
            "/billing",
            "/billing/invoices",
            "/billing/history",
            f"/billing/invoices/{invoice['id']}",
        ):
            self.assertEqual(self.request("GET", path).status_code, 200, path)

    def test_empty_history_and_summary_and_invalid_paging(self):
        result = self.request("GET", "/billing")
        self.assertEqual(result.status_code, 200, result.json)
        self.assertEqual(result.json["summary"], [])
        for collection in ("invoices", "history"):
            result = self.request("GET", f"/billing/{collection}")
            self.assertEqual(result.status_code, 200, result.json)
            self.assertEqual(result.json[collection], [])
            self.assertEqual(result.json["pagination"]["totalItems"], 0)
            for query in ("page=0", "page=-1", "page=x", "pageSize=0", "pageSize=501"):
                result = self.request("GET", f"/billing/{collection}?{query}")
                self.assertEqual(result.status_code, 422, result.json)
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            db.session.delete(db.session.get(Subscription, "sub-a"))
            db.session.commit()
        result = self.request("GET", "/billing")
        self.assertEqual(result.status_code, 200, result.json)
        self.assertIsNone(result.json["subscription"])

    def test_forced_rls_allows_only_current_owner_select_and_denies_writes(self):
        invoice = self.pay(self.invoice(), "10")
        foreign = self.pay(self.invoice(tenantId=self.other_tenant_id), "20")
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(db.session.scalars(select(SaaSInvoice.id)).all(), [invoice["id"]])
            self.assertEqual(
                db.session.scalars(select(SaaSPayment.id)).all(), [invoice["payments"][0]["id"]]
            )
            self.assertEqual(db.session.scalars(select(SaaSIdempotencyRecord)).all(), [])
            for actor, tenant_id in (
                ("frontdesk", self.tenant_id),
                ("accountant", self.tenant_id),
                ("hk", self.tenant_id),
                (self.owner_id, self.other_tenant_id),
                ("", self.tenant_id),
                (self.owner_id, ""),
            ):
                set_context(actor, tenant_id)
                self.assertEqual(
                    db.session.scalars(select(SaaSInvoice)).all(), [], (actor, tenant_id)
                )
                self.assertEqual(
                    db.session.scalars(select(SaaSPayment)).all(), [], (actor, tenant_id)
                )
            set_context(self.owner_id, self.tenant_id)
            for table in ("saas_invoices", "saas_payments"):
                for command in (f"DELETE FROM {table}", f"UPDATE {table} SET tenant_id=tenant_id"):
                    self.assertEqual(db.session.execute(text(command)).rowcount, 0)
            for model, values in (
                (SaaSInvoice, {"description": "Forbidden", "currency": "VND"}),
                (SaaSPayment, {"invoice_id": invoice["id"], "method": "cash"}),
            ):
                set_context(self.owner_id, self.tenant_id)
                with self.assertRaises(DBAPIError):
                    db.session.add(
                        model(tenant_id=self.tenant_id, amount=1, user_id=self.owner_id, **values)
                    )
                    db.session.flush()
                db.session.rollback()
            set_context("admin", is_system=True)
            self.assertEqual(
                set(db.session.scalars(select(SaaSInvoice.id))), {invoice["id"], foreign["id"]}
            )
