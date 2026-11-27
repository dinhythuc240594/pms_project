"""Correct SaaS receipts without deleting history; grant scoped, explicit expiry recovery."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from zoneinfo import ZoneInfo

from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from pms_api.core_models import Subscription, Tenant, uid, utcnow
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class SaaSRecoveryTests(DomainTestCase):
    def setUp(self):
        super().setUp()
        self.admin, self.admin_headers = self.login("admin@test.local")

    def system(self, method, path, data=None, *, key=None, client=None, headers=None):
        return self.request(
            method,
            path,
            data,
            key=key,
            client=client or self.admin,
            headers=self.admin_headers if headers is None else headers,
        )

    def paid_invoice(self):
        created = self.system(
            "POST",
            "/api/billing/invoices",
            {
                "tenantId": self.tenant_id,
                "description": "SaaS",
                "amount": "100",
                "currency": "VND",
            },
            key=uid(),
        )
        self.assertEqual(created.status_code, 201, created.json)
        paid = self.system(
            "POST",
            f"/api/billing/invoices/{created.json['id']}/payments",
            {
                "amount": "100",
                "method": "bank",
                "reference": "BANK-1",
            },
            key=uid(),
        )
        self.assertEqual(paid.status_code, 201, paid.json)
        return paid.json

    def refund_path(self, invoice):
        return (
            f"/api/billing/invoices/{invoice['id']}/payments/{invoice['payments'][0]['id']}/refund"
        )

    def test_refund_replay_owner_history_and_net_receivable(self):
        invoice = self.paid_invoice()
        data = {"amount": "40.1250", "reason": "Recorded against the wrong invoice"}
        path = self.refund_path(invoice)
        first = self.system("POST", path, data, key="saas-refund-intent")
        self.assertEqual(first.status_code, 201, first.json)
        self.assertEqual(first.json["paid"], "59.8750")
        self.assertEqual(first.json["refunded"], "40.1250")
        self.assertEqual(first.json["balance"], "40.1250")
        self.assertEqual(first.json["payments"][0]["amount"], "100.0000")
        self.assertEqual(first.json["payments"][0]["refundable"], "59.8750")
        self.assertEqual(self.system("POST", path, data, key="saas-refund-intent").json, first.json)
        conflict = self.system("POST", path, {**data, "amount": "41"}, key="saas-refund-intent")
        self.assertEqual(conflict.status_code, 409, conflict.json)
        own = self.request("GET", f"/billing/invoices/{invoice['id']}")
        self.assertEqual(own.json["paid"], "59.8750")
        self.assertEqual(own.json["refunds"][0]["reason"], data["reason"])
        overview = self.system("GET", "/api/manager/overview").json
        self.assertEqual(overview["currencies"][0]["received"], "59.8750")
        self.assertEqual(overview["currencies"][0]["refunded"], "40.1250")

    def test_refund_caps_and_repayment_keep_net_balance_exact(self):
        invoice = self.paid_invoice()
        path = self.refund_path(invoice)
        for amount in ("101", "NaN", True, "0", "-1"):
            response = self.system(
                "POST", path, {"amount": amount, "reason": "Correction"}, key=uid()
            )
            self.assertIn(response.status_code, (409, 422), response.json)
        self.assertEqual(
            self.system("POST", path, {"amount": "10", "reason": ""}, key=uid()).status_code, 422
        )
        full = self.system("POST", path, {"amount": "100", "reason": "Wrong receipt"}, key=uid())
        self.assertEqual(full.status_code, 201, full.json)
        self.assertEqual(full.json["status"], "unpaid")
        repaid = self.system(
            "POST",
            f"/api/billing/invoices/{invoice['id']}/payments",
            {
                "amount": "100",
                "method": "cash",
            },
            key=uid(),
        )
        self.assertEqual(repaid.status_code, 201, repaid.json)
        self.assertEqual(repaid.json["paid"], "100.0000")
        self.assertEqual(repaid.json["balance"], "0.0000")

    def test_refund_concurrency_and_immutable_records(self):
        invoice = self.paid_invoice()
        path = self.refund_path(invoice)
        pairs = [self.login("admin@test.local"), self.login("admin@test.local")]
        barrier = Barrier(2)

        def attempt(pair):
            barrier.wait(timeout=5)
            return self.system(
                "POST",
                path,
                {"amount": "60", "reason": "Correction"},
                key=uid(),
                client=pair[0],
                headers=pair[1],
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(attempt, pairs))
        self.assertEqual(sorted(response.status_code for response in results), [201, 409])
        with self.app.app_context():
            set_context("admin", is_system=True)
            with self.assertRaises(DBAPIError):
                db.session.execute(text("UPDATE saas_refunds SET reason='changed'"))
            db.session.rollback()

    def test_refund_is_system_only_and_owner_cannot_read_other_tenant(self):
        invoice = self.paid_invoice()
        path = self.refund_path(invoice)
        for email in ("owner-a@test.local", "frontdesk@test.local", "accountant@test.local"):
            client, headers = self.login(email)
            response = self.system(
                "POST",
                path,
                {"amount": "1", "reason": "Correction"},
                key=uid(),
                client=client,
                headers=headers,
            )
            self.assertEqual(response.status_code, 403, response.json)
        self.assertEqual(
            self.request(
                "GET", f"/api/tenants/{self.other_tenant_id}/billing/invoices/{invoice['id']}"
            ).status_code,
            403,
        )

    def expire(self):
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            sub = db.session.get(Subscription, "sub-a")
            sub.start_date = utcnow() - timedelta(days=10)
            sub.end_date = utcnow() - timedelta(minutes=1)
            db.session.commit()

    def grant(self, until=None, **changes):
        return self.system(
            "POST",
            f"/api/billing/tenants/{self.tenant_id}/operational-access",
            {
                "until": until or (utcnow() + timedelta(days=1)).isoformat(),
                "reason": "Finish current stays",
                **changes,
            },
            key=uid(),
        )

    def test_grace_is_explicit_bounded_audited_and_revocable(self):
        self.expire()
        current = self.system("GET", f"/api/billing/tenants/{self.tenant_id}/operational-access")
        self.assertEqual(current.status_code, 200, current.json)
        self.assertIsNone(current.json["access"])
        granted = self.grant()
        self.assertEqual(granted.status_code, 201, granted.json)
        self.assertTrue(granted.json["access"]["active"])
        self.assertEqual(
            self.grant(until=(utcnow() + timedelta(days=8)).isoformat()).status_code, 422
        )
        self.assertEqual(self.grant(reason="").status_code, 422)
        for until in (
            (utcnow() - timedelta(seconds=1)).isoformat(),
            "2026-10-29T12:00:00",
            "bad",
            True,
        ):
            self.assertEqual(self.grant(until=until).status_code, 422)
        workspace = self.request("GET", "/workspace").json
        self.assertFalse(workspace["subscription"]["effectiveActive"])
        self.assertTrue(workspace["subscription"]["operationalAccess"]["active"])
        denied = self.request(
            "POST",
            "/reservations",
            {"guest": "New", "checkIn": "2030-01-01", "checkOut": "2030-01-02", "rooms": ["101"]},
        )
        self.assertEqual(denied.status_code, 403, denied.json)
        revoked = self.system(
            "POST",
            f"/api/billing/tenants/{self.tenant_id}/operational-access",
            {
                "until": None,
                "reason": "Recovery complete",
            },
            key=uid(),
        )
        self.assertEqual(revoked.status_code, 201, revoked.json)
        self.assertFalse(revoked.json["access"]["active"])

    def test_grace_never_overrides_suspension_cancelled_subscription_or_staff_authority(self):
        self.assertEqual(self.grant().status_code, 409)
        self.expire()
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            db.session.get(Tenant, self.tenant_id).status = "suspended"
            db.session.commit()
        self.assertEqual(self.grant().status_code, 409)
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            db.session.get(Tenant, self.tenant_id).status = "active"
            db.session.get(Subscription, "sub-a").status = "cancelled"
            db.session.commit()
        self.assertEqual(self.grant().status_code, 409)
        client, headers = self.login("owner-a@test.local")
        self.assertEqual(
            self.system(
                "POST",
                f"/api/billing/tenants/{self.tenant_id}/operational-access",
                {
                    "until": None,
                    "reason": "Owner cannot grant",
                },
                key=uid(),
                client=client,
                headers=headers,
            ).status_code,
            403,
        )

    def test_grace_allows_only_existing_stay_completion_and_still_checks_disabled_features(self):
        today = utcnow().astimezone(ZoneInfo("Asia/Ho_Chi_Minh")).date()
        response = self.request(
            "POST",
            "/reservations",
            {
                "guest": "Already staying",
                "room": "101",
                "sourceId": "direct-a",
                "checkIn": today.isoformat(),
                "checkOut": (today + timedelta(days=1)).isoformat(),
            },
        )
        self.assertEqual(response.status_code, 201, response.json)
        booking = response.json
        status = self.request(
            "POST", f"/reservations/{booking['id']}/status", {"status": "IN_HOUSE"}, key=uid()
        )
        self.assertEqual(status.status_code, 200, status.json)
        self.expire()
        payment_path = f"/reservations/{booking['id']}/payments"
        payment_data = {"amount": "100", "fundId": "fund-a", "methodId": "cash-a"}
        self.assertEqual(
            self.request("POST", payment_path, payment_data, key=uid()).status_code, 403
        )
        self.assertEqual(self.grant().status_code, 201)
        denied_pos = self.request("POST", "/pos/invoices", {}, key=uid())
        self.assertEqual(denied_pos.status_code, 403, denied_pos.json)
        paid = self.request("POST", payment_path, payment_data, key=uid())
        self.assertEqual(paid.status_code, 201, paid.json)
        checked_out = self.request(
            "POST", f"/reservations/{booking['id']}/status", {"status": "CHECKED_OUT"}, key=uid()
        )
        self.assertEqual(checked_out.status_code, 200, checked_out.json)
        from pms_api.admin.feature_models import TenantFeatureOverride

        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            db.session.add(
                TenantFeatureOverride(
                    tenant_id=self.tenant_id,
                    code="CASHBOOK",
                    enabled=False,
                    notes="Disabled",
                    granted_by="admin",
                )
            )
            db.session.commit()
        payment_id = paid.json["payments"][0]["id"]
        refused = self.request(
            "POST",
            f"/reservations/{booking['id']}/payments/{payment_id}/refund",
            {"amount": "1", "reason": "Return"},
            key=uid(),
        )
        self.assertEqual(refused.status_code, 403, refused.json)
        self.assertEqual(refused.json["error"]["code"], "feature_disabled")

    def test_grace_replay_and_immutable_decisions(self):
        self.expire()
        path = f"/api/billing/tenants/{self.tenant_id}/operational-access"
        body = {"until": (utcnow() + timedelta(days=1)).isoformat(), "reason": "Recovery"}
        first = self.system("POST", path, body, key="explicit-grace-intent")
        self.assertEqual(first.status_code, 201, first.json)
        self.assertEqual(
            self.system("POST", path, body, key="explicit-grace-intent").json, first.json
        )
        self.assertEqual(
            self.system(
                "POST", path, {**body, "reason": "Changed"}, key="explicit-grace-intent"
            ).status_code,
            409,
        )
        with self.app.app_context():
            set_context("admin", is_system=True)
            with self.assertRaises(DBAPIError):
                db.session.execute(text("UPDATE saas_operational_access SET reason='changed'"))
            db.session.rollback()

    def test_renewed_term_never_reuses_an_old_operational_grant(self):
        self.expire()
        self.assertEqual(self.grant().status_code, 201)
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            sub = db.session.get(Subscription, "sub-a")
            sub.end_date = utcnow() - timedelta(seconds=1)
            db.session.commit()
        workspace = self.request("GET", "/workspace")
        self.assertEqual(workspace.status_code, 200, workspace.json)
        self.assertFalse(workspace.json["subscription"]["operationalAccess"]["active"])

    def test_void_after_full_refund_keeps_the_period_cash_history_visible(self):
        invoice = self.paid_invoice()
        returned = self.system(
            "POST",
            self.refund_path(invoice),
            {"amount": "100", "reason": "Wrong invoice"},
            key=uid(),
        )
        self.assertEqual(returned.status_code, 201, returned.json)
        voided = self.system(
            "POST", f"/api/billing/invoices/{invoice['id']}/void", {"reason": "Replaced"}
        )
        self.assertEqual(voided.status_code, 200, voided.json)
        overview = self.system("GET", "/api/manager/overview").json
        rows = {row["currency"]: row for row in overview["currencies"]}
        self.assertEqual(rows["VND"]["received"], "0.0000")
        self.assertEqual(rows["VND"]["refunded"], "100.0000")
        self.assertEqual(rows["VND"]["outstanding"], "0.0000")

    def test_refund_owner_read_is_tenant_scoped_and_staff_cannot_read_receipts(self):
        from pms_api.saas_billing.models import SaaSRefund

        invoice = self.paid_invoice()
        response = self.system(
            "POST", self.refund_path(invoice), {"amount": "10", "reason": "Correction"}, key=uid()
        )
        self.assertEqual(response.status_code, 201, response.json)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(len(db.session.scalars(select(SaaSRefund)).all()), 1)
            set_context("owner-b", self.other_tenant_id)
            self.assertEqual(db.session.scalars(select(SaaSRefund)).all(), [])
            set_context("frontdesk", self.tenant_id)
            self.assertEqual(db.session.scalars(select(SaaSRefund)).all(), [])

    def test_recovery_grant_never_bypasses_a_revoked_identity(self):
        from pms_api.core_models import User

        self.expire()
        self.assertEqual(self.grant().status_code, 201)
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            db.session.get(User, self.owner_id).active = False
            db.session.commit()
        self.assertEqual(self.request("GET", "/workspace").status_code, 401)

    def test_saas_recovery_downgrade_cannot_discard_refund_or_grace_history(self):
        invoice = self.paid_invoice()
        self.assertEqual(
            self.system(
                "POST",
                self.refund_path(invoice),
                {"amount": "10", "reason": "Correction"},
                key=uid(),
            ).status_code,
            201,
        )
        down = self.app.test_cli_runner().invoke(args=["db", "downgrade", "0038_commission_review"])
        self.assertNotEqual(down.exit_code, 0)
        own = self.request("GET", f"/billing/invoices/{invoice['id']}")
        self.assertEqual(own.status_code, 200, own.json)
        self.assertEqual(own.json["refunded"], "10.0000")
        self.assertEqual(own.json["paid"], "90.0000")
