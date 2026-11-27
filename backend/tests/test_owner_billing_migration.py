"""Owner billing access can be rolled back without discarding financial history."""

from decimal import Decimal
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, select, text

from pms_api.core_models import SubscriptionHistory, uid
from pms_api.extensions import db
from pms_api.saas_billing.models import SaaSIdempotencyRecord, SaaSInvoice, SaaSPayment
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class OwnerBillingMigrationTests(DomainTestCase):
    def setUp(self):
        super().setUp()
        self.admin, self.admin_headers = self.login("admin@test.local")

    def manager(self, method, path, body=None):
        return self.request(
            method, path, body, client=self.admin, headers=self.admin_headers, key=uid()
        )

    def billing_snapshot(self):
        with self.app.app_context():
            set_context("admin", is_system=True, is_service=True)
            # Compare complete persisted records, including internal idempotency responses.
            return {
                table: db.session.execute(
                    text(f"SELECT to_jsonb(record) FROM {table} record ORDER BY id")
                )
                .scalars()
                .all()
                for table in (
                    "saas_invoices",
                    "saas_payments",
                    "saas_idempotency_records",
                    "subscription_history",
                )
            }

    def assert_owner_records(self, invoice_ids, payment_ids):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(set(db.session.scalars(select(SaaSInvoice.id))), set(invoice_ids))
            self.assertEqual(set(db.session.scalars(select(SaaSPayment.id))), set(payment_ids))
            self.assertEqual(db.session.scalars(select(SaaSIdempotencyRecord.id)).all(), [])

    def test_policy_round_trip_revokes_and_restores_owner_reads_preserving_history(self):
        created = self.manager(
            "POST",
            "/api/billing/invoices",
            {
                "tenantId": self.tenant_id,
                "description": "Preserved SaaS invoice",
                "amount": "100.1250",
                "currency": "VND",
            },
        )
        self.assertEqual(created.status_code, 201, created.json)
        invoice_id = created.json["id"]
        paid = self.manager(
            "POST",
            f"/api/billing/invoices/{invoice_id}/payments",
            {"amount": "25.1250", "method": "bank", "reference": "ROUND-TRIP"},
        )
        self.assertEqual(paid.status_code, 201, paid.json)
        payment_id = paid.json["payments"][0]["id"]
        foreign = self.manager(
            "POST",
            "/api/billing/invoices",
            {
                "tenantId": self.other_tenant_id,
                "description": "Other hotel's preserved invoice",
                "amount": "20.5000",
                "currency": "USD",
            },
        )
        self.assertEqual(foreign.status_code, 201, foreign.json)
        with self.app.app_context():
            set_context("admin", is_system=True, is_service=True)
            db.session.add(
                SubscriptionHistory(
                    tenant_id=self.tenant_id,
                    plan_id="default-pro",
                    action="renewed",
                    amount=Decimal("100.1250"),
                    currency="VND",
                    user_id="admin",
                )
            )
            db.session.commit()
        before = self.billing_snapshot()
        self.assertEqual(len(before["saas_invoices"]), 2)
        self.assertEqual(len(before["saas_payments"]), 1)
        self.assertEqual(len(before["saas_idempotency_records"]), 3)
        self.assertEqual(len(before["subscription_history"]), 1)
        manager = self.manager("GET", f"/api/billing/invoices?tenantId={self.tenant_id}")
        self.assertEqual(manager.status_code, 200, manager.json)
        document = manager.json["invoices"][0]
        self.assert_owner_records([invoice_id], [payment_id])
        self.assertEqual(self.request("GET", f"/billing/invoices/{invoice_id}").json, document)

        # Exercise the owner-read policy itself while retaining the current financial schema.
        revision = ScriptDirectory(
            str(Path(__file__).resolve().parents[1] / "migrations")
        ).get_revision("0035_owner_saas_billing")

        def policy_change(direction):
            engine = create_engine(self.app.config["DATABASE_MIGRATION_URL"], hide_parameters=True)
            try:
                with (
                    engine.begin() as connection,
                    Operations.context(MigrationContext.configure(connection)),
                ):
                    getattr(revision.module, direction)()
            finally:
                engine.dispose()

        policy_change("downgrade")
        try:
            self.assert_owner_records([], [])
            self.assertEqual(self.request("GET", "/billing/invoices").json["invoices"], [])
            self.assertEqual(
                self.request("GET", f"/billing/invoices/{invoice_id}").status_code, 404
            )
            self.assertEqual(self.billing_snapshot(), before)
            manager = self.manager("GET", f"/api/billing/invoices?tenantId={self.tenant_id}")
            self.assertEqual(manager.status_code, 200, manager.json)
            self.assertEqual(manager.json["invoices"], [document])
        finally:
            policy_change("upgrade")

        self.assert_owner_records([invoice_id], [payment_id])
        self.assertEqual(self.request("GET", f"/billing/invoices/{invoice_id}").json, document)
        self.assertEqual(
            self.request("GET", "/billing").json["summary"],
            [
                {
                    "currency": "VND",
                    "amount": "100.1250",
                    "paid": "25.1250",
                    "balance": "75.0000",
                }
            ],
        )
        self.assertEqual(self.billing_snapshot(), before)
