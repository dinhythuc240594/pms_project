"""Advanced reports use tenant snapshots, without posting any financial records."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import patch

from sqlalchemy import func, select

from pms_api.bookings.models import (
    Guest,
    LedgerEntry,
    Reservation,
    ReservationGuest,
    ReservationNight,
    ReservationRoom,
)
from pms_api.catalog.models import Master
from pms_api.core_models import Plan
from pms_api.extensions import db
from pms_api.security import set_context
from tests import test_reports_acceptance
from tests.domain_fixture import DomainTestCase


class BusinessReportTests(DomainTestCase):
    day = test_reports_acceptance.ReportsAcceptanceTests.day
    seed_stay = test_reports_acceptance.ReportsAcceptanceTests.seed_stay

    def report(self, report="source", *, currency="VND", basis="original", **options):
        return self.request(
            "GET",
            f"/reports/business?report={report}&start={self.day}&end={self.day + timedelta(days=1)}&currency={currency}&basis={basis}",
            **options,
        )

    def update_booking(self, key, **changes):
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            row = db.session.get(Reservation, key)
            for field, value in changes.items():
                setattr(row, field, value)
            db.session.commit()

    @patch("pms_api.reports.routes.utcnow", return_value=datetime(2026, 10, 5, tzinfo=timezone.utc))
    def test_source_room_and_room_type_preserve_money_currency_dates_and_tenant(self, _clock):
        self.seed_stay("served", status="CHECKED_OUT", price="100.1250")
        self.seed_stay("forecast", price="20.2500")
        self.seed_stay("cancelled", status="CANCELLED", price="999.9999")
        self.seed_stay("usd", currency="USD", price="2.1250")
        self.seed_stay("foreign", tenant=self.other_tenant_id, price="888.8888")
        self.seed_stay("boundary", start=self.day + timedelta(days=1), price="777.7777")
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            booking = db.session.get(Reservation, "usd")
            booking.base_currency, booking.base_amount, booking.exchange_rate = (
                "VND",
                Decimal("53125"),
                Decimal("25000"),
            )
            night = db.session.scalar(
                select(ReservationNight).where(ReservationNight.reservation_id == "usd")
            )
            night.base_currency, night.base_amount, night.exchange_rate = (
                "VND",
                Decimal("53125"),
                Decimal("25000"),
            )
            db.session.get(Master, "direct-a").name = "Renamed current source"
            before = db.session.scalar(select(func.count(LedgerEntry.id)))
            db.session.commit()
        for report in ("source", "room", "roomType"):
            response = self.report(report)
            self.assertEqual(response.status_code, 200, response.json)
            self.assertEqual(
                response.json["summary"],
                {
                    "bookings": 2,
                    "nights": 2,
                    "servedNights": 1,
                    "forecastRoomRevenue": "120.3750",
                    "roomRevenue": "100.1250",
                },
            )
            self.assertEqual(
                self.report(report, currency="USD").json["summary"]["forecastRoomRevenue"], "2.1250"
            )
            self.assertEqual(
                self.report(report, basis="base").json["summary"]["forecastRoomRevenue"],
                "53245.3750",
            )
        self.assertEqual(self.report().json["rows"][0]["label"], "Direct")
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            self.assertEqual(db.session.scalar(select(func.count(LedgerEntry.id))), before)

    def test_multi_room_type_joins_never_duplicate_nightly_amounts(self):
        self.seed_stay("multi", price="100.1250")
        with self.app.app_context():
            set_context("owner-a", self.tenant_id)
            db.session.add(
                ReservationRoom(
                    tenant_id=self.tenant_id,
                    reservation_id="multi",
                    room_id="room-a-101",
                    room_number="101",
                    room_type_id="rt-a",
                    check_in=self.day,
                    check_out=self.day + timedelta(days=1),
                )
            )
            db.session.add(
                ReservationNight(
                    tenant_id=self.tenant_id,
                    reservation_id="multi",
                    room_id="room-a-101",
                    room_number="101",
                    room_type_id="rt-a",
                    date=self.day,
                    price=Decimal("33.3333"),
                    base_currency="VND",
                    exchange_rate=Decimal(1),
                    base_amount=Decimal("33.3333"),
                )
            )
            db.session.commit()
        result = self.report("roomType").json
        self.assertEqual(len(result["rows"]), 1)
        self.assertEqual(result["rows"][0]["bookings"], 1)
        self.assertEqual(result["rows"][0]["nights"], 2)
        self.assertEqual(result["rows"][0]["forecastRoomRevenue"], "133.4583")

    def test_cancellations_use_actual_local_cancel_date_and_full_stay_value(self):
        self.seed_stay(
            "in-period",
            status="CANCELLED",
            price="100.1250",
            start=self.day - timedelta(days=2),
            end=self.day,
        )
        self.update_booking(
            "in-period", cancelled_at=datetime(2026, 10, 4, 16, 59, tzinfo=timezone.utc)
        )
        self.seed_stay("end-boundary", status="CANCELLED", price="900.0000")
        self.update_booking(
            "end-boundary", cancelled_at=datetime(2026, 10, 4, 17, tzinfo=timezone.utc)
        )
        self.seed_stay("no-date", status="CANCELLED", price="800.0000")
        self.seed_stay("foreign", tenant=self.other_tenant_id, status="CANCELLED", price="777.0000")
        self.update_booking("foreign", cancelled_at=datetime(2026, 10, 4, 5, tzinfo=timezone.utc))
        response = self.report("cancellations")
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(
            response.json["rows"],
            [
                {
                    "date": "2026-10-04",
                    "source": "Direct",
                    "bookings": 1,
                    "nights": 2,
                    "cancelledRoomValue": "200.2500",
                }
            ],
        )
        self.assertEqual(
            response.json["definitions"]["cancellations"],
            "i18n:reports.definitions.cancellations",
        )

    def test_nationality_counts_linked_guests_once_and_discloses_current_profile(self):
        self.seed_stay(
            "stay",
            status="CHECKED_OUT",
            start=self.day - timedelta(days=1),
            end=self.day + timedelta(days=2),
        )
        self.seed_stay("usd", status="IN_HOUSE", currency="USD")
        self.seed_stay("confirmed")
        with self.app.app_context():
            set_context("owner-a", self.tenant_id)
            db.session.add(
                Guest(
                    id="guest",
                    tenant_id=self.tenant_id,
                    name="Private name",
                    nationality=" VN ",
                    phone="private",
                )
            )
            db.session.flush()
            for booking in ("stay", "usd", "confirmed"):
                db.session.add(
                    ReservationGuest(
                        tenant_id=self.tenant_id, reservation_id=booking, guest_id="guest"
                    )
                )
            db.session.commit()
        result = self.report("nationality", currency="USD").json
        self.assertEqual(
            result["rows"], [{"nationality": "VN", "guests": 1, "bookings": 2, "guestNights": 2}]
        )
        self.assertEqual(
            result["definitions"]["nationality"], "i18n:reports.definitions.nationality"
        )
        self.assertNotIn("private", str(result).lower())
        with self.app.app_context():
            set_context("owner-a", self.tenant_id)
            db.session.get(Guest, "guest").nationality = ""
            db.session.commit()
        self.assertEqual(
            self.report("nationality").json["rows"][0]["nationality"],
            "i18n:reports.definitions.unknownNationality",
        )

    def test_report_metadata_returns_frontend_keys_without_translating_business_data(self):
        self.seed_stay("localized")
        self.update_booking("localized", source_name="Nguồn riêng")
        english = self.report("source", headers={"Accept-Language": "en-US"}).json
        chinese = self.report("source", headers={"Accept-Language": "zh-CN"}).json
        vietnamese = self.report("source").json

        definition_key = "i18n:reports.definitions.period"
        self.assertEqual(english["definitions"]["period"], definition_key)
        self.assertEqual(chinese["definitions"]["period"], definition_key)
        self.assertEqual(vietnamese["definitions"]["period"], definition_key)
        self.assertEqual(english["rows"][0]["label"], "Nguồn riêng")
        self.assertEqual(chinese["rows"][0]["label"], "Nguồn riêng")

    def test_discount_report_uses_saved_original_and_base_amounts_not_current_config(self):
        self.seed_stay("voucher", currency="USD")
        self.seed_stay("promotion")
        self.seed_stay("cancelled", status="CANCELLED")
        created_at = datetime(2026, 10, 3, 17, tzinfo=timezone.utc)
        snapshot = {
            "discount": {
                "id": "old-voucher",
                "kind": "voucher",
                "name": "Saved name",
                "code": "OLD",
            },
            "discountAmount": "0.1250",
            "discountBase": "3125.0000",
        }
        self.update_booking(
            "voucher", created_at=created_at, base_currency="VND", pricing_snapshot=snapshot
        )
        self.update_booking(
            "promotion",
            created_at=created_at,
            pricing_snapshot={
                "discount": {"id": "promo", "kind": "earlybird", "name": "Saved promotion"},
                "discountAmount": "12.3456",
                "discountBase": "12.3456",
            },
        )
        self.update_booking("cancelled", created_at=created_at, pricing_snapshot=snapshot)
        original = self.report("discounts", currency="USD").json
        self.assertEqual(
            original["rows"],
            [
                {
                    "kind": "voucher",
                    "label": "Saved name",
                    "code": "OLD",
                    "bookings": 1,
                    "discountAmount": "0.1250",
                }
            ],
        )
        self.assertEqual(
            self.report("discounts", basis="base").json["summary"]["discountAmount"], "3137.3456"
        )
        self.assertEqual(original["definitions"]["discounts"], "i18n:reports.definitions.discounts")

    def test_advanced_report_validates_filters_and_enforces_role_tenant_and_feature(self):
        for query in (
            "report=unknown&end=2026-10-05",
            "report=source&basis=bad&end=2026-10-05",
            "report=source&currency=XXX&end=2026-10-05",
            "report=source&end=2026-10-04",
        ):
            response = self.request("GET", "/reports/business?start=2026-10-04&" + query)
            self.assertEqual(response.status_code, 422, response.json)
        frontdesk, headers = self.login("frontdesk@test.local")
        self.assertEqual(self.report(client=frontdesk, headers=headers).status_code, 403)
        accountant, headers = self.login("accountant@test.local")
        self.assertEqual(self.report(client=accountant, headers=headers).status_code, 200)
        self.assertEqual(
            self.request(
                "GET",
                f"/api/tenants/{self.other_tenant_id}/reports/business?start=2026-10-04&end=2026-10-05",
            ).status_code,
            403,
        )
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            db.session.get(Plan, "default-pro").features = {"REPORTS_ADVANCED": False}
            db.session.commit()
        response = self.report()
        self.assertEqual(response.status_code, 403, response.json)
        self.assertEqual(response.json["error"]["details"]["feature"], "REPORTS_ADVANCED")
        self.assertEqual(
            self.request("GET", "/reports/revenue?start=2026-10-04&end=2026-10-05").status_code, 200
        )
