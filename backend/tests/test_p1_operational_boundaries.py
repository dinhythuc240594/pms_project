"""Independent boundary proofs for in-house changes and immutable hotel days."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal
from unittest.mock import patch
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError

from pms_api.bookings.models import LedgerEntry, Reservation, ReservationNight
from pms_api.catalog.models import PhysicalRoom, RoomType
from pms_api.extensions import db
from pms_api.finance.models import CashDocument, PosInvoice
from pms_api.reconciliation.models import NightAudit, RevenueRecognition
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class OperationalBoundaryTests(DomainTestCase):
    def setUp(self):
        super().setUp()
        self.today = datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date()
        self.yesterday = self.today - timedelta(days=1)

    def stay(self, *, rooms=None, start=None, end=None, overdue=False):
        start, end = start or self.yesterday, end or self.today + timedelta(days=2)
        response = self.request(
            "post",
            "/reservations",
            {
                "guest": "Boundary guest",
                "rooms": rooms or ["101"],
                "sourceId": "direct-a",
                "checkIn": start.isoformat(),
                "checkOut": end.isoformat(),
            },
        )
        self.assertEqual(response.status_code, 201, response.json)
        if overdue:
            with self.app.app_context():
                set_context(self.owner_id, self.tenant_id)
                row = db.session.get(Reservation, response.json["id"])
                row.status = "IN_HOUSE"
                row.checked_in_at = datetime.combine(start, time(8), tzinfo=UTC)
                db.session.commit()
            response = self.request("get", f"/reservations/{response.json['id']}")
        else:
            response = self.request(
                "post", f"/reservations/{response.json['id']}/status", {"status": "IN_HOUSE"}
            )
        self.assertEqual(response.status_code, 200, response.json)
        return response.json

    def preview_change(self, booking, **changes):
        body = {
            "rooms": booking["rooms"],
            "effectiveDate": self.today.isoformat(),
            "checkOut": booking["checkOut"],
            "expectedVersion": booking["version"],
            **changes,
        }
        response = self.request("post", f"/reservations/{booking['id']}/stay-change/preview", body)
        self.assertEqual(response.status_code, 200, response.json)
        return body, response.json

    def confirm_change(self, booking, body, preview, key="boundary-stay-confirm", **options):
        return self.request(
            "post",
            f"/reservations/{booking['id']}/stay-change",
            {
                **body,
                "previewToken": preview["previewToken"],
                "reason": "Boundary confirmation",
            },
            key=key,
            **options,
        )

    def preview_audit(self, day):
        response = self.request("get", "/reconciliation/night-audit?date=" + day.isoformat())
        self.assertEqual(response.status_code, 200, response.json)
        return response.json

    def close_audit(self, preview, key="boundary-night-close", **options):
        return self.request(
            "post",
            "/reconciliation/night-audit",
            {
                "date": preview["date"],
                "previewToken": preview["previewToken"],
                "reason": "Night reviewed",
            },
            key=key,
            **options,
        )

    def test_overdue_extension_preserves_old_nights_and_adds_each_missing_night_once(self):
        start = self.today - timedelta(days=3)
        booking = self.stay(start=start, end=self.yesterday, overdue=True)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            old = {
                night.id: (night.date, night.price, night.room_id)
                for night in db.session.scalars(select(ReservationNight))
            }
            db.session.get(RoomType, "rt-a").base_price = Decimal("250")
            db.session.commit()
        body, preview = self.preview_change(
            booking, checkOut=(self.today + timedelta(days=1)).isoformat()
        )
        self.assertEqual(Decimal(preview["total"]), Decimal("700"))
        done = self.confirm_change(booking, body, preview)
        self.assertEqual(done.status_code, 200, done.json)
        replay = self.confirm_change(booking, body, preview)
        self.assertEqual(replay.json, done.json)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            nights = list(
                db.session.scalars(select(ReservationNight).order_by(ReservationNight.date))
            )
            self.assertEqual(
                [night.date for night in nights], [start + timedelta(days=i) for i in range(4)]
            )
            for night in nights:
                if night.id in old:
                    self.assertEqual((night.date, night.price, night.room_id), old[night.id])
            self.assertEqual(sum((night.price for night in nights), Decimal(0)), Decimal("700"))

    def test_multiroom_move_keeps_retained_room_rate_and_matches_only_the_replaced_room(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.add(
                PhysicalRoom(
                    id="room-a-103",
                    tenant_id=self.tenant_id,
                    room_type_id="rt-a",
                    number="103",
                    condition="clean",
                )
            )
            db.session.commit()
        booking = self.stay(rooms=["101", "102"])
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            for night in db.session.scalars(
                select(ReservationNight).where(ReservationNight.room_number == "102")
            ):
                night.price = night.base_amount = Decimal("200")
            db.session.commit()
        booking = self.request("get", f"/reservations/{booking['id']}").json
        body, preview = self.preview_change(booking, rooms=["103", "101"])
        for day in (self.today, self.today + timedelta(days=1)):
            prices = {
                row["room"]: Decimal(row["price"])
                for row in preview["nightlyRates"]
                if row["date"] == day.isoformat()
            }
            self.assertEqual(prices, {"101": Decimal("100"), "103": Decimal("200")})
        done = self.confirm_change(booking, body, preview)
        self.assertEqual(done.status_code, 200, done.json)
        self.assertEqual(Decimal(done.json["total"]), Decimal("900"))
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            historical = dict(
                db.session.execute(
                    select(ReservationNight.room_number, ReservationNight.price).where(
                        ReservationNight.date == self.yesterday
                    )
                ).all()
            )
            self.assertEqual(historical, {"101": Decimal("100"), "102": Decimal("200")})

    def test_two_distinct_confirmations_do_not_apply_the_same_stay_change_twice(self):
        booking = self.stay()
        body, preview = self.preview_change(booking, rooms=["102"])
        actors = [self.login(), self.login()]

        def confirm(index):
            client, headers = actors[index]
            return self.confirm_change(
                booking,
                body,
                preview,
                key=f"boundary-stay-race-{index}",
                client=client,
                headers=headers,
            )

        with ThreadPoolExecutor(max_workers=2) as workers:
            results = list(workers.map(confirm, range(2)))
        self.assertEqual(sorted(result.status_code for result in results), [200, 409])
        current = self.request("get", f"/reservations/{booking['id']}").json
        self.assertEqual(current["rooms"], ["102"])
        self.assertEqual(current["total"], booking["total"])

    def test_stale_version_and_invalid_change_dates_fail_without_rewriting_nights(self):
        booking = self.stay()
        body, preview = self.preview_change(booking, rooms=["102"])
        for effective in (
            "bad",
            self.yesterday.isoformat(),
            (self.today + timedelta(days=1)).isoformat(),
        ):
            response = self.request(
                "post",
                f"/reservations/{booking['id']}/stay-change/preview",
                {**body, "effectiveDate": effective},
            )
            self.assertEqual(response.status_code, 422, response.json)
        modified = self.request("patch", f"/reservations/{booking['id']}", {"phone": "0909123456"})
        self.assertEqual(modified.status_code, 200, modified.json)
        stale = self.confirm_change(booking, body, preview)
        self.assertEqual(stale.status_code, 409, stale.json)
        self.assertIn(stale.json["error"]["code"], {"stale_booking", "preview_changed"})
        current = self.request("get", f"/reservations/{booking['id']}").json
        self.assertEqual(current["rooms"], ["101"])
        self.assertEqual(current["total"], booking["total"])

    def test_closed_day_rejects_backdated_opening_cash_and_old_night_deletion(self):
        self.stay()
        closed = self.close_audit(self.preview_audit(self.yesterday))
        self.assertEqual(closed.status_code, 201, closed.json)
        response = self.request(
            "post",
            "/cash-documents",
            {
                "type": "opening",
                "fundId": "fund-a",
                "amount": "25",
                "date": self.yesterday.isoformat(),
                "description": "Backdated opening",
            },
            key="boundary-backdated-cash",
        )
        self.assertEqual(response.status_code, 409, response.json)
        self.assertEqual(response.json["error"]["code"], "period_closed")
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(db.session.scalar(select(func.count()).select_from(CashDocument)), 0)
            self.assertEqual(db.session.scalar(select(func.count()).select_from(LedgerEntry)), 0)
            with self.assertRaises(DBAPIError):
                db.session.execute(
                    text("DELETE FROM reservation_nights WHERE tenant_id=:tenant AND date=:day"),
                    {"tenant": self.tenant_id, "day": self.yesterday},
                )
                db.session.commit()
            db.session.rollback()

    def test_pos_cancel_after_close_posts_a_current_day_credit_without_restating_history(self):
        posted_at = datetime.combine(self.yesterday, time(8), tzinfo=UTC)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.add(
                PosInvoice(
                    id="boundary-pos",
                    tenant_id=self.tenant_id,
                    user_id=self.owner_id,
                    status="POSTED",
                    total=Decimal("40"),
                    currency="VND",
                    base_amount=Decimal("40"),
                    base_currency="VND",
                    exchange_rate=Decimal(1),
                    posted_at=posted_at,
                    draft_items=[],
                )
            )
            db.session.commit()
        first = self.close_audit(self.preview_audit(self.yesterday))
        self.assertEqual(first.status_code, 201, first.json)
        self.assertEqual(Decimal(first.json["totals"][0]["amount"]), Decimal("40"))
        cancelled = self.request(
            "post",
            "/pos/invoices/boundary-pos/cancel",
            {"reason": "Returned after close"},
            key="boundary-pos-cancel",
        )
        self.assertEqual(cancelled.status_code, 201, cancelled.json)
        tomorrow = datetime.combine(self.today + timedelta(days=1), time(12), tzinfo=UTC)
        with patch("pms_api.reconciliation.business_days.utcnow", return_value=tomorrow):
            preview = self.preview_audit(self.today)
            credits = [entry for entry in preview["entries"] if entry["sourceId"] == "boundary-pos"]
            self.assertEqual(len(credits), 1)
            self.assertEqual(Decimal(credits[0]["amount"]), Decimal("-40"))
            self.assertTrue(credits[0]["adjustment"])
            second = self.close_audit(preview, key="boundary-next-close")
            self.assertEqual(second.status_code, 201, second.json)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            old = db.session.scalar(
                select(NightAudit).where(NightAudit.business_date == self.yesterday)
            )
            self.assertEqual(
                old.snapshot,
                {
                    key: value
                    for key, value in first.json.items()
                    if key not in {"auditId", "actor", "reason", "periodLocked"}
                }
                | {"periodLocked": False},
            )
            rows = dict(
                db.session.execute(
                    select(RevenueRecognition.business_date, RevenueRecognition.amount)
                ).all()
            )
            self.assertEqual(rows, {self.yesterday: Decimal("40"), self.today: Decimal("-40")})
            self.assertEqual(db.session.scalar(select(func.count()).select_from(LedgerEntry)), 0)

    def test_day_closes_are_contiguous_and_concurrent_closes_create_one_audit(self):
        day = self.today - timedelta(days=3)
        preview = self.preview_audit(day)
        actors = [self.login(), self.login()]

        def close(index):
            client, headers = actors[index]
            return self.close_audit(
                preview, key=f"boundary-close-race-{index}", client=client, headers=headers
            )

        with ThreadPoolExecutor(max_workers=2) as workers:
            results = list(workers.map(close, range(2)))
        self.assertEqual(sorted(result.status_code for result in results), [201, 409])
        gap = self.request("get", "/reconciliation/night-audit?date=" + self.yesterday.isoformat())
        self.assertEqual(gap.status_code, 409, gap.json)
        self.assertEqual(gap.json["error"]["code"], "audit_sequence")
        current = self.request("get", "/reconciliation/night-audit?date=" + self.today.isoformat())
        self.assertEqual(current.status_code, 422, current.json)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(db.session.scalar(select(func.count()).select_from(NightAudit)), 1)
