"""Day reconciliation persists evidence without closing periods or posting money."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from unittest.mock import patch

from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError

from pms_api.bookings.models import LedgerEntry, Reservation
from pms_api.core_models import AuditLog, Tenant
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class DayReconciliationTests(DomainTestCase):
    day = date(2026, 10, 18)

    def setUp(self):
        super().setUp()
        self.clock = patch(
            "pms_api.reconciliation.routes.utcnow",
            return_value=datetime(2026, 10, 18, 3, tzinfo=UTC),
        )
        self.clock.start()
        self.addCleanup(self.clock.stop)

    def stay(self, key, status, start, end, tenant=None):
        tenant = tenant or self.tenant_id
        with self.app.app_context():
            set_context("owner-a" if tenant == self.tenant_id else "owner-b", tenant)
            db.session.add(
                Reservation(
                    id=key,
                    tenant_id=tenant,
                    guest_name=key,
                    status=status,
                    check_in=start,
                    check_out=end,
                    currency="VND",
                    base_currency="VND",
                    base_amount=0,
                    exchange_rate=1,
                    pricing_snapshot={},
                )
            )
            db.session.commit()

    def movement(self, key, amount, day, *, kind="receipt", tenant=None, created_at=None):
        tenant = tenant or self.tenant_id
        suffix = "a" if tenant == self.tenant_id else "b"
        with self.app.app_context():
            set_context("owner-" + suffix, tenant)
            db.session.add(
                LedgerEntry(
                    id=key,
                    tenant_id=tenant,
                    fund_id="fund-" + suffix,
                    user_id="owner-" + suffix,
                    kind=kind,
                    amount=Decimal(amount),
                    currency="VND",
                    base_currency="VND",
                    base_amount=Decimal(amount),
                    exchange_rate=1,
                    description=key,
                    booked_at=day,
                    created_at=created_at or datetime(2026, 10, 18, 3, tzinfo=UTC),
                )
            )
            db.session.commit()

    def preview(self, **kwargs):
        return self.request("get", "/reconciliation?date=2026-10-18", **kwargs)

    def confirm(self, preview, key="confirm-day-0001", **kwargs):
        return self.request(
            "post",
            "/reconciliation/confirm",
            json={
                "date": str(self.day),
                "previewToken": preview["previewToken"],
                "note": "Đã đối chiếu",
            },
            key=key,
            **kwargs,
        )

    def test_preview_separates_unresolved_current_stays_and_excludes_other_tenant(self):
        self.stay("arriving", "CONFIRMED", self.day, self.day + timedelta(days=1))
        self.stay(
            "overdue-arrival",
            "CONFIRMED",
            self.day - timedelta(days=1),
            self.day + timedelta(days=1),
        )
        self.stay("departing", "IN_HOUSE", self.day - timedelta(days=1), self.day)
        self.stay(
            "tomorrow", "CONFIRMED", self.day + timedelta(days=1), self.day + timedelta(days=2)
        )
        self.stay("cancelled", "CANCELLED", self.day, self.day + timedelta(days=1))
        self.stay(
            "foreign", "CONFIRMED", self.day, self.day + timedelta(days=1), self.other_tenant_id
        )
        response = self.preview()
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(
            {row["id"] for row in response.json["arrivals"]}, {"arriving", "overdue-arrival"}
        )
        self.assertEqual([row["id"] for row in response.json["departures"]], ["departing"])
        self.assertEqual(response.json["timezone"], "Asia/Ho_Chi_Minh")
        self.assertFalse(response.json["periodLocked"])

    def test_fund_opening_day_movements_and_closing_follow_booked_date(self):
        self.movement("opening", "100", self.day - timedelta(days=1), kind="opening")
        self.movement("in", "70", self.day)
        self.movement("out", "-20", self.day, kind="expense")
        self.movement("tomorrow", "999", self.day + timedelta(days=1))
        self.movement("foreign", "777", self.day, tenant=self.other_tenant_id)
        response = self.preview()
        self.assertEqual(response.status_code, 200, response.json)
        fund = response.json["funds"][0]
        self.assertEqual(
            [fund[key] for key in ("opening", "income", "outflow", "closing")],
            ["100.0000", "70.0000", "20.0000", "150.0000"],
        )
        self.assertEqual(response.json["summary"]["netCash"], "50.0000")

    def test_confirmation_replays_snapshot_and_does_not_post_or_close_money(self):
        self.movement("opening", "100", self.day - timedelta(days=1), kind="opening")
        preview = self.preview().json
        result = self.confirm(preview)
        self.assertEqual(result.status_code, 201, result.json)
        self.assertEqual(result.json["actorId"], self.owner_id)
        self.assertEqual(result.json["snapshot"]["previewToken"], preview["previewToken"])
        self.movement("later", "10", self.day)
        replay = self.confirm(preview)
        self.assertEqual(replay.status_code, 201, replay.json)
        self.assertEqual(replay.json, result.json)
        history = self.request("get", "/reconciliation/history?date=2026-10-18")
        self.assertEqual(history.json["pagination"]["totalItems"], 1)
        self.assertEqual(history.json["confirmations"][0], result.json)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(db.session.scalar(select(func.count()).select_from(LedgerEntry)), 2)
            self.assertEqual(
                db.session.scalar(
                    select(func.count())
                    .select_from(AuditLog)
                    .where(AuditLog.event == "reconciliation.confirmed")
                ),
                1,
            )

    def test_guest_receipts_are_separate_from_generic_cash_movements(self):
        self.movement("guest-payment", "100", self.day, kind="payment")
        self.movement("pos-payment", "25", self.day, kind="pos_payment")
        self.movement("guest-refund", "-20", self.day, kind="refund")
        self.movement("pos-refund", "-5", self.day, kind="pos_refund")
        self.movement("other-receipt", "10", self.day)
        self.movement("expense", "-3", self.day, kind="expense")
        response = self.preview()
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(
            response.json["summary"],
            {
                "cashReceived": "125.0000",
                "cashRefunded": "25.0000",
                "netReceipts": "100.0000",
                "income": "135.0000",
                "outflow": "28.0000",
                "netCash": "107.0000",
            },
        )

    def test_legacy_unbooked_timestamp_falls_on_the_hotel_date(self):
        self.movement(
            "hotel-midnight", "11", None, created_at=datetime(2026, 10, 17, 17, tzinfo=UTC)
        )
        self.movement(
            "before-hotel-midnight",
            "7",
            None,
            created_at=datetime(2026, 10, 17, 16, 59, tzinfo=UTC),
        )
        fund = self.preview().json["funds"][0]
        self.assertEqual(fund["opening"], "7.0000")
        self.assertEqual(fund["income"], "11.0000")
        self.assertEqual(fund["closing"], "18.0000")

    def test_changed_preview_requires_reloading_before_confirmation(self):
        preview = self.preview().json
        self.movement("new-money", "10", self.day)
        result = self.confirm(preview)
        self.assertEqual(result.status_code, 409, result.json)
        self.assertEqual(result.json["error"]["code"], "preview_changed")
        self.assertEqual(
            self.request("get", "/reconciliation/history?date=2026-10-18").json["confirmations"], []
        )

    def test_confirm_requires_idempotency_and_rejects_reused_key_with_changed_note(self):
        preview = self.preview().json
        self.assertEqual(self.confirm(preview, key=None).status_code, 422)
        self.assertEqual(self.confirm(preview).status_code, 201)
        response = self.request(
            "post",
            "/reconciliation/confirm",
            json={
                "date": str(self.day),
                "previewToken": preview["previewToken"],
                "note": "changed",
            },
            key="confirm-day-0001",
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json["error"]["code"], "idempotency_conflict")

    def test_roles_tenant_and_suspended_writes_are_enforced(self):
        for email in ("frontdesk@test.local", "hk@test.local"):
            client, headers = self.login(email)
            self.assertEqual(self.preview(client=client, headers=headers).status_code, 403)
        accountant, headers = self.login("accountant@test.local")
        preview = self.preview(client=accountant, headers=headers)
        self.assertEqual(preview.status_code, 200, preview.json)
        self.assertEqual(
            self.confirm(preview.json, client=accountant, headers=headers).status_code, 201
        )
        self.assertEqual(
            self.request(
                "get", f"/api/tenants/{self.other_tenant_id}/reconciliation?date=2026-10-18"
            ).status_code,
            403,
        )
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            db.session.get(Tenant, self.tenant_id).status = "suspended"
            db.session.commit()
        self.assertEqual(self.confirm(self.preview().json, key="suspended-0001").status_code, 403)

    def test_saved_snapshot_is_append_only_and_hidden_by_rls(self):
        from pms_api.reconciliation.models import DayReconciliation

        saved = self.confirm(self.preview().json).json
        with self.app.app_context():
            set_context("owner-b", self.other_tenant_id)
            self.assertEqual(
                db.session.scalar(select(func.count()).select_from(DayReconciliation)), 0
            )
            db.session.rollback()
            set_context(self.owner_id, self.tenant_id)
            with self.assertRaises(DBAPIError):
                db.session.execute(
                    text("UPDATE day_reconciliations SET note='changed' WHERE id=:id"),
                    {"id": saved["id"]},
                )
            db.session.rollback()

    def test_future_and_malformed_days_are_not_confirmable(self):
        for day in ("bad", "2026-02-30", "2099-01-01"):
            response = self.request("get", "/reconciliation?date=" + day)
            self.assertEqual(response.status_code, 422, response.json)
