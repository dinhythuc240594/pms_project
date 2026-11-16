"""BE-08 acceptance proofs against a disposable PostgreSQL database."""

from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

from pms_api.bookings.models import Reservation, ReservationNight, ReservationRoom
from pms_api.catalog.models import PhysicalRoom
from pms_api.core_models import Tenant
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class ReportsAcceptanceTests(DomainTestCase):
    day = date(2026, 10, 4)

    def seed_stay(
        self,
        key,
        *,
        status="CONFIRMED",
        tenant=None,
        currency="VND",
        price="100.0000",
        start=None,
        end=None,
    ):
        """Known immutable nightly prices, with one physical room per stay."""
        tenant = tenant or self.tenant_id
        suffix = "a" if tenant == self.tenant_id else "b"
        start = start or self.day
        end = end or (start + timedelta(days=1))
        with self.app.app_context():
            set_context("owner-" + suffix, tenant)
            room_id = "report-room-" + key
            db.session.add(
                PhysicalRoom(
                    id=room_id,
                    tenant_id=tenant,
                    room_type_id="rt-" + suffix,
                    number="report-" + key,
                )
            )
            db.session.add(
                Reservation(
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
                )
            )
            db.session.flush()
            db.session.add(
                ReservationRoom(
                    tenant_id=tenant,
                    reservation_id=key,
                    room_id=room_id,
                    room_number="report-" + key,
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
                        room_number="report-" + key,
                        room_type_id="rt-" + suffix,
                        date=start + timedelta(days=offset),
                        price=Decimal(price),
                        base_currency=currency,
                        exchange_rate=Decimal(1),
                        base_amount=Decimal(price),
                    )
                )
            db.session.commit()

    def revenue(self, start=None, end=None, currency="VND"):
        start = start or self.day
        end = end or (start + timedelta(days=1))
        query = f"/reports/revenue?start={start}&end={end}"
        if currency is not None:
            query += "&currency=" + currency
        return self.request("get", query)

    def test_forecast_uses_exact_period_currency_and_tenant_and_excludes_cancellations(self):
        # CONFIRMED is legitimately included in the UI's explicitly labelled
        # forecast; this test does not mistake it for realized revenue.
        for key, status, amount in (
            ("forecast", "CONFIRMED", "100.1250"),
            ("stay", "IN_HOUSE", "200.2500"),
            ("history", "CHECKED_OUT", "300.3750"),
            ("cancelled", "CANCELLED", "400.5000"),
        ):
            self.seed_stay(key, status=status, price=amount)
        self.seed_stay("usd", currency="USD", price="90.0000")
        self.seed_stay("foreign", tenant=self.other_tenant_id, price="777.0000")
        self.seed_stay("end-boundary", start=self.day + timedelta(days=1), price="999.0000")
        response = self.revenue()
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(
            response.json["rows"],
            [
                {
                    "date": self.day.isoformat(),
                    "amount": "600.7500",
                    "reserved": 3,
                    "nights": 3,
                    "reservedRooms": 4,
                }
            ],
        )
        self.assertEqual(self.revenue(currency="USD").json["rows"][0]["amount"], "90.0000")
        self.assertEqual(self.revenue(currency="USD").json["rows"][0]["reservedRooms"], 4)

    def test_dashboard_counts_today_statuses_and_never_foreign_tenant(self):
        self.seed_stay("arriving")
        self.seed_stay("in-house", status="IN_HOUSE")
        self.seed_stay("tomorrow", start=self.day + timedelta(days=1))
        self.seed_stay("cancelled", status="CANCELLED")
        self.seed_stay("foreign", tenant=self.other_tenant_id, status="IN_HOUSE")
        response = self.request("get", f"/reports/dashboard?date={self.day}")
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(
            {key: response.json[key] for key in ("arriving", "departing", "occupied")},
            {"arriving": 1, "departing": 0, "occupied": 1},
        )

    def test_departure_is_still_occupied_until_checkout_happens(self):
        self.seed_stay(
            "due-today", status="IN_HOUSE", start=self.day - timedelta(days=1), end=self.day
        )
        response = self.request("get", f"/reports/dashboard?date={self.day}")
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json["departing"], 1)
        self.assertEqual(
            response.json["occupied"], 1, "An IN_HOUSE reservation has not checked out yet."
        )

    def test_front_desk_can_read_operational_dashboard(self):
        client, headers = self.login("frontdesk@test.local")
        response = self.request(
            "get", f"/reports/dashboard?date={self.day}", client=client, headers=headers
        )
        self.assertEqual(response.status_code, 200, response.json)

    def test_financial_reports_stay_denied_to_front_desk_and_housekeeping(self):
        for email in ("frontdesk@test.local", "hk@test.local"):
            with self.subTest(email=email):
                client, headers = self.login(email)
                response = self.request(
                    "get",
                    f"/reports/revenue?start={self.day}&end=2026-10-05",
                    client=client,
                    headers=headers,
                )
                self.assertEqual(response.status_code, 403, response.json)

    def test_other_tenant_cannot_be_selected_by_changing_report_url(self):
        for suffix in ("dashboard?date=2026-10-04", "revenue?start=2026-10-04&end=2026-10-05"):
            with self.subTest(path=suffix):
                response = self.request(
                    "get", f"/api/tenants/{self.other_tenant_id}/reports/{suffix}"
                )
                self.assertEqual(response.status_code, 403, response.json)

    def test_missing_dates_are_client_errors(self):
        for suffix in ("dashboard", "revenue", "revenue?start=2026-10-04"):
            with self.subTest(path=suffix):
                response = self.request("get", "/reports/" + suffix)
                self.assertIn(response.status_code, (400, 422), response.json)

    def test_invalid_dates_are_client_errors_instead_of_uncaught_500(self):
        # Test production-style HTTP responses rather than Flask's testing-mode
        # propagation, while preserving the original app config afterwards.
        with patch.dict(self.app.config, {"PROPAGATE_EXCEPTIONS": False}):
            for suffix in (
                "dashboard?date=not-a-date",
                "dashboard?date=2026-02-30",
                "revenue?start=not-a-date&end=2026-10-05",
                "revenue?start=2026-10-04&end=2026-02-30",
            ):
                with self.subTest(path=suffix):
                    response = self.request("get", "/reports/" + suffix)
                    self.assertIn(response.status_code, (400, 422), response.json)

    def test_reversed_and_empty_periods_are_rejected(self):
        for end in (self.day, self.day - timedelta(days=1)):
            with self.subTest(end=end):
                response = self.revenue(end=end)
                self.assertIn(response.status_code, (400, 422), response.json)

    def test_period_limit_is_enforced_in_api_not_only_frontend(self):
        response = self.revenue(end=self.day + timedelta(days=367))
        self.assertIn(
            response.status_code,
            (400, 422),
            f"Received {len(response.json.get('rows', []))} rows for a 367-day range.",
        )

    def test_money_preserves_all_four_decimal_places_at_supported_numeric_limit(self):
        amount = Decimal("999999999999999.9999")
        self.seed_stay("precise", price=str(amount))
        response = self.revenue()
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(
            Decimal(str(response.json["rows"][0]["amount"])),
            amount,
            "Numeric(19,4) must survive serialization without float rounding.",
        )

    def test_default_report_currency_matches_tenant_settings(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            tenant = db.session.get(Tenant, self.tenant_id)
            tenant.settings = {**(tenant.settings or {}), "currency": "USD"}
            db.session.commit()
        self.seed_stay("usd-default", currency="USD", price="25.1250")
        response = self.revenue(currency=None)
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(Decimal(str(response.json["rows"][0]["amount"])), Decimal("25.1250"))
