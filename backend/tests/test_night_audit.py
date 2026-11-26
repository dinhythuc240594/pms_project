"""A hotel day closes once; revenue and cash remain distinct immutable books."""

from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.exc import DBAPIError

from pms_api.bookings.models import LedgerEntry, ReservationNight
from pms_api.extensions import db
from pms_api.reconciliation.models import NightAudit, RevenueRecognition
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class NightAuditTests(DomainTestCase):
    def setUp(self):
        super().setUp()
        self.today = datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date()
        self.day = (self.today - timedelta(days=1)).isoformat()

    def make_stay(self, *, checkin=True):
        result = self.request(
            "post",
            "/reservations",
            {
                "guest": "Audit guest",
                "room": "101",
                "checkIn": self.day,
                "checkOut": (self.today + timedelta(days=1)).isoformat(),
            },
        )
        self.assertEqual(result.status_code, 201, result.json)
        if checkin:
            result = self.request(
                "post", f"/reservations/{result.json['id']}/status", {"status": "IN_HOUSE"}
            )
            self.assertEqual(result.status_code, 200, result.json)
        return result.json

    def preview(self, day=None):
        result = self.request("get", "/reconciliation/night-audit?date=" + (day or self.day))
        self.assertEqual(result.status_code, 200, result.json)
        return result.json

    def close(self, preview, key="audit-close-proof"):
        return self.request(
            "post",
            "/reconciliation/night-audit",
            {
                "date": preview["date"],
                "previewToken": preview["previewToken"],
                "reason": "Night shift reviewed",
            },
            key=key,
        )

    def test_close_posts_nights_once_without_creating_cash(self):
        self.make_stay()
        preview = self.preview()
        self.assertEqual(Decimal(preview["totals"][0]["amount"]), Decimal("100"))
        first = self.close(preview)
        self.assertEqual(first.status_code, 201, first.json)
        self.assertTrue(first.json["periodLocked"])
        replay = self.close(preview)
        self.assertEqual(replay.status_code, 201, replay.json)
        self.assertEqual(replay.json, first.json)
        again = self.close(preview, key="audit-another-key")
        self.assertEqual(again.status_code, 409, again.json)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(db.session.scalar(select(func.count()).select_from(LedgerEntry)), 0)
        report = self.request(
            "get", f"/reports/financial?start={self.day}&end={self.today.isoformat()}&currency=VND"
        )
        self.assertEqual(report.status_code, 200, report.json)
        self.assertEqual(Decimal(report.json["summary"]["recognizedRevenue"]), Decimal("100"))

    def test_unresolved_arrivals_and_current_day_cannot_close(self):
        self.make_stay(checkin=False)
        preview = self.preview()
        self.assertTrue(preview["blockers"])
        self.assertEqual(self.close(preview).status_code, 409)
        current = self.request("get", "/reconciliation/night-audit?date=" + self.today.isoformat())
        self.assertEqual(current.status_code, 422, current.json)

    def test_first_close_starts_a_new_revenue_book_without_reposting_older_nights(self):
        booking = self.request(
            "post",
            "/reservations",
            {
                "guest": "Existing long stay",
                "room": "101",
                "checkIn": (self.today - timedelta(days=3)).isoformat(),
                "checkOut": (self.today + timedelta(days=1)).isoformat(),
            },
        )
        self.assertEqual(booking.status_code, 201, booking.json)
        result = self.request(
            "post", f"/reservations/{booking.json['id']}/status", {"status": "IN_HOUSE"}
        )
        self.assertEqual(result.status_code, 200, result.json)
        preview = self.preview()
        self.assertEqual(Decimal(preview["totals"][0]["amount"]), Decimal("100"))
        self.assertEqual(preview["recognitionStart"], self.day)

    def test_closed_nights_are_locked_in_database_and_new_adjustments_stay_open(self):
        booking = self.make_stay()
        self.assertEqual(self.close(self.preview()).status_code, 201)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            with self.assertRaises(DBAPIError) as caught:
                db.session.execute(
                    text(
                        "UPDATE reservation_nights SET price=1 WHERE tenant_id=:tenant AND date=:day"
                    ),
                    {"tenant": self.tenant_id, "day": date.fromisoformat(self.day)},
                )
                db.session.commit()
            self.assertEqual(caught.exception.orig.sqlstate, "23514")
            db.session.rollback()
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(
                db.session.scalar(
                    select(ReservationNight.price).where(
                        ReservationNight.date == date.fromisoformat(self.day)
                    )
                ),
                Decimal("100"),
            )
        result = self.request(
            "post",
            f"/reservations/{booking['id']}/charges",
            {"type": "discount", "description": "Goodwill after close", "unitPrice": "10"},
            key="audit-adjust-open",
        )
        self.assertEqual(result.status_code, 201, result.json)

    def test_wrong_tenant_and_frontdesk_cannot_close(self):
        self.make_stay()
        preview = self.preview()
        for email in ("owner-b@test.local", "frontdesk@test.local"):
            client, headers = self.login(email)
            response = self.request(
                "post",
                "/reconciliation/night-audit",
                {
                    "date": self.day,
                    "previewToken": preview["previewToken"],
                    "reason": "Denied",
                },
                client=client,
                headers=headers,
                key="audit-denied-proof",
            )
            self.assertEqual(response.status_code, 403, response.json)

    def test_audit_and_revenue_are_tenant_scoped_and_append_only(self):
        self.make_stay()
        self.assertEqual(self.close(self.preview()).status_code, 201)
        with self.app.app_context():
            for model in (NightAudit, RevenueRecognition):
                set_context(self.owner_id, self.tenant_id)
                self.assertEqual(len(db.session.scalars(select(model)).all()), 1)
                set_context()
                self.assertEqual(db.session.scalars(select(model)).all(), [])
                set_context("owner-b", self.other_tenant_id)
                self.assertEqual(db.session.scalars(select(model)).all(), [])
            for statement in (
                "UPDATE night_audits SET reason='rewritten'",
                "DELETE FROM night_audits",
                "UPDATE revenue_recognitions SET amount=1",
                "DELETE FROM revenue_recognitions",
            ):
                set_context(self.owner_id, self.tenant_id)
                with self.assertRaises(DBAPIError) as caught:
                    db.session.execute(text(statement))
                self.assertEqual(caught.exception.orig.sqlstate, "42501")
                db.session.rollback()

    def test_downgrade_refuses_to_discard_posted_audit_history(self):
        self.make_stay()
        result = self.close(self.preview())
        self.assertEqual(result.status_code, 201, result.json)
        revision = ScriptDirectory(
            str(Path(__file__).resolve().parents[1] / "migrations")
        ).get_revision("0041_operational_days")
        engine = create_engine(self.app.config["DATABASE_MIGRATION_URL"], hide_parameters=True)
        try:
            with (
                self.assertRaises(DBAPIError) as caught,
                engine.begin() as connection,
                Operations.context(MigrationContext.configure(connection)),
            ):
                revision.module.downgrade()
            self.assertIn(
                "Night audit history exists; downgrade refused", str(caught.exception.orig)
            )
        finally:
            engine.dispose()
        stored = self.preview()
        self.assertTrue(stored["periodLocked"])
        self.assertEqual(stored["auditId"], result.json["auditId"])
        self.assertEqual(stored["entries"], result.json["entries"])
