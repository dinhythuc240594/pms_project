"""In-house changes preserve served room nights and reconcile money atomically."""

from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import select

from pms_api.bookings.models import ReservationNight
from pms_api.catalog.models import PhysicalRoom, RoomType
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class StayChangeTests(DomainTestCase):
    def stay(self, *, days=3, elapsed=1):
        self.today = datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date()
        result = self.request(
            "post",
            "/reservations",
            {
                "guest": "Moving guest",
                "room": "101",
                "sourceId": "direct-a",
                "checkIn": (self.today - timedelta(days=elapsed)).isoformat(),
                "checkOut": (self.today + timedelta(days=days)).isoformat(),
            },
        )
        self.assertEqual(result.status_code, 201, result.json)
        result = self.request(
            "post", f"/reservations/{result.json['id']}/status", {"status": "IN_HOUSE"}
        )
        self.assertEqual(result.status_code, 200, result.json)
        return result.json

    def preview(self, booking, **changes):
        body = {
            "rooms": ["102"],
            "effectiveDate": self.today.isoformat(),
            "checkOut": booking["checkOut"],
            "expectedVersion": booking["version"],
            **changes,
        }
        result = self.request("post", f"/reservations/{booking['id']}/stay-change/preview", body)
        self.assertEqual(result.status_code, 200, result.json)
        return body, result.json

    def confirm(self, booking, body, preview, key="stay-change-proof"):
        return self.request(
            "post",
            f"/reservations/{booking['id']}/stay-change",
            {
                **body,
                "previewToken": preview["previewToken"],
                "reason": "Guest requested change",
            },
            key=key,
        )

    def test_move_preserves_served_nights_and_frozen_existing_rates(self):
        booking = self.stay()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.get(RoomType, "rt-a").base_price = Decimal("250")
            db.session.commit()
        body, preview = self.preview(booking)
        moved = self.confirm(booking, body, preview)
        self.assertEqual(moved.status_code, 200, moved.json)
        self.assertEqual(moved.json["rooms"], ["102"])
        self.assertEqual(Decimal(moved.json["total"]), Decimal(booking["total"]))
        self.assertEqual(
            moved.json["roomStays"],
            [
                {"room": "101", "start": booking["checkIn"], "end": self.today.isoformat()},
                {"room": "102", "start": self.today.isoformat(), "end": booking["checkOut"]},
            ],
        )
        replay = self.confirm(booking, body, preview)
        self.assertEqual(replay.status_code, 200, replay.json)
        self.assertEqual(replay.json, moved.json)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(len(list(db.session.scalars(select(ReservationNight)))), 4)
            self.assertEqual(db.session.get(PhysicalRoom, "room-a-101").condition, "dirty")

    def test_extension_quotes_only_new_nights_and_rejects_conflicting_room(self):
        booking = self.stay(days=1)
        new_end = (self.today + timedelta(days=2)).isoformat()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.get(RoomType, "rt-a").base_price = Decimal("250")
            db.session.commit()
        body, preview = self.preview(booking, rooms=["101"], checkOut=new_end)
        self.assertEqual(Decimal(preview["total"]), Decimal("450"))
        conflict = self.request(
            "post",
            "/reservations",
            {
                "guest": "Another guest",
                "room": "101",
                "checkIn": booking["checkOut"],
                "checkOut": new_end,
            },
        )
        self.assertEqual(conflict.status_code, 201, conflict.json)
        result = self.confirm(booking, body, preview)
        self.assertEqual(result.status_code, 409, result.json)

    def test_rate_change_between_preview_and_confirmation_requires_new_preview(self):
        booking = self.stay(days=1)
        body, preview = self.preview(
            booking, rooms=["101"], checkOut=(self.today + timedelta(days=2)).isoformat()
        )
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.get(RoomType, "rt-a").base_price = Decimal("200")
            db.session.commit()
        result = self.confirm(booking, body, preview)
        self.assertEqual(result.status_code, 409, result.json)
        self.assertEqual(result.json["error"]["code"], "preview_changed")

    def test_early_departure_requires_refund_then_checks_out_without_penalty(self):
        booking = self.stay(days=2)
        paid = self.request(
            "post",
            f"/reservations/{booking['id']}/payments",
            {
                "amount": booking["total"],
                "methodId": "cash-a",
                "fundId": "fund-a",
            },
            key="stay-prepaid-money",
        )
        self.assertEqual(paid.status_code, 201, paid.json)
        booking = paid.json
        body, preview = self.preview(booking, rooms=["101"], checkOut=self.today.isoformat())
        self.assertEqual(Decimal(preview["refundRequired"]), Decimal("200"))
        blocked = self.confirm(booking, body, preview)
        self.assertEqual(blocked.status_code, 409, blocked.json)
        payment = booking["payments"][0]
        refund = self.request(
            "post",
            f"/reservations/{booking['id']}/payments/{payment['id']}/refund",
            {
                "amount": "200",
                "reason": "Early departure",
                "fundId": "fund-a",
            },
            key="stay-refund-surplus",
        )
        self.assertEqual(refund.status_code, 201, refund.json)
        body, preview = self.preview(refund.json, rooms=["101"], checkOut=self.today.isoformat())
        done = self.confirm(refund.json, body, preview, key="stay-depart-now-proof")
        self.assertEqual(done.status_code, 200, done.json)
        self.assertEqual(done.json["status"], "CHECKED_OUT")
        self.assertEqual(Decimal(done.json["total"]), Decimal("100"))

    def test_other_tenant_and_housekeeping_cannot_change_stay(self):
        booking = self.stay()
        for email in ("owner-b@test.local", "hk@test.local"):
            client, headers = self.login(email)
            result = self.request(
                "post",
                f"/reservations/{booking['id']}/stay-change/preview",
                {},
                client=client,
                headers=headers,
            )
            self.assertEqual(result.status_code, 403, result.json)
