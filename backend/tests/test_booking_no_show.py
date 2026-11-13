"""No-show closes inventory without silently posting or refunding money."""

from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from zoneinfo import ZoneInfo

from sqlalchemy import select

from pms_api.bookings.models import ReservationRoom
from pms_api.catalog.models import RoomTypeAvailability
from pms_api.core_models import utcnow
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class BookingNoShowTests(DomainTestCase):
    def booking(self, start=None, room="101"):
        start = start or utcnow().astimezone(ZoneInfo("Asia/Ho_Chi_Minh")).date()
        result = self.request(
            "post",
            "/reservations",
            json={
                "guest": "No-show guest",
                "room": room,
                "sourceId": "direct-a",
                "checkIn": str(start),
                "checkOut": str(start + timedelta(days=2)),
            },
        )
        self.assertEqual(result.status_code, 201, result.json)
        return result.json

    def no_show(self, booking):
        return self.request(
            "post", f"/reservations/{booking['id']}/status", json={"status": "NO_SHOW"}
        )

    def test_no_show_releases_room_preserves_money_and_cancels_only_its_housekeeping_tasks(self):
        row = self.booking()
        path = f"/reservations/{row['id']}"
        fee = self.request(
            "post",
            path + "/charges",
            json={"type": "fee", "description": "Agreed fee", "unitPrice": "10"},
            key="before-fee",
        )
        self.assertEqual(fee.status_code, 201, fee.json)
        payment = self.request(
            "post",
            path + "/payments",
            json={"amount": "50", "methodId": "cash-a", "fundId": "fund-a"},
            key="before-payment",
        )
        self.assertEqual(payment.status_code, 201, payment.json)
        refund = self.request(
            "post",
            path + f"/payments/{payment.json['payments'][0]['id']}/refund",
            json={"amount": "10", "reason": "Before no-show"},
            key="before-refund",
        )
        self.assertEqual(refund.status_code, 201, refund.json)
        before = self.request("get", path).json
        unrelated = self.booking(room="102")
        plan = self.request("post", "/housekeeping/tasks", json={"date": row["checkIn"]})
        self.assertEqual(plan.status_code, 201, plan.json)
        task = next(task for task in plan.json["tasks"] if task["bookingId"] == row["id"])
        ledger = self.request("get", "/workspace").json["ledger"]

        result = self.no_show(row)
        self.assertEqual(result.status_code, 200, result.json)
        self.assertEqual(result.json["status"], "NO_SHOW")
        self.assertIsNotNone(result.json["noShowAt"])
        for key in (
            "total",
            "paid",
            "balance",
            "pricingSnapshot",
            "nightlyRates",
            "charges",
            "payments",
        ):
            self.assertEqual(result.json[key], before[key], key)
        workspace = self.request("get", "/workspace").json
        self.assertEqual(workspace["ledger"], ledger)
        self.assertEqual(
            next(room["condition"] for room in workspace["rooms"] if room["id"] == "101"), "clean"
        )
        tasks = self.request("get", "/housekeeping/tasks?date=" + row["checkIn"]).json["tasks"]
        self.assertEqual(
            next(item["status"] for item in tasks if item["id"] == task["id"]), "cancelled"
        )
        self.assertEqual(
            next(item["status"] for item in tasks if item["bookingId"] == unrelated["id"]),
            "pending",
        )
        retry = self.request("post", "/housekeeping/tasks", json={"date": row["checkIn"]})
        self.assertEqual(retry.status_code, 201, retry.json)
        self.assertEqual(retry.json["created"], 0)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertTrue(
                all(
                    not link.active
                    for link in db.session.scalars(
                        select(ReservationRoom).where(ReservationRoom.reservation_id == row["id"])
                    )
                )
            )
            self.assertTrue(
                all(
                    day.booked_rooms == 1
                    for day in db.session.scalars(select(RoomTypeAvailability))
                )
            )
            db.session.rollback()
        replacement = self.booking(start=datetime.fromisoformat(row["checkIn"]).date())
        self.assertNotEqual(replacement["id"], row["id"])
        self.assertTrue(
            any(event["details"].get("to") == "NO_SHOW" for event in result.json["history"])
        )

    def test_no_show_uses_hotel_local_date_and_rejects_future_arrivals(self):
        start = datetime(2026, 11, 15).date()
        row = self.booking(start)
        result = self.request("patch", "/settings", json={"timezone": "Pacific/Honolulu"})
        self.assertEqual(result.status_code, 200, result.json)
        instant = datetime(2026, 11, 15, 1, tzinfo=timezone.utc)
        with patch("pms_api.bookings.routes.datetime") as clock:
            clock.now.side_effect = lambda zone: instant.astimezone(zone)
            rejected = self.no_show(row)
            self.assertEqual(rejected.status_code, 409, rejected.json)
            self.assertEqual(rejected.json["error"]["code"], "arrival_not_due")
            self.assertEqual(
                self.request("patch", "/settings", json={"timezone": "UTC"}).status_code, 200
            )
            self.assertEqual(self.no_show(row).status_code, 200)

    def test_no_show_is_terminal_and_respects_tenant_role_and_checkin_boundaries(self):
        row = self.booking()
        path = f"/reservations/{row['id']}"
        hk, headers = self.login("hk@test.local")
        denied = self.request(
            "post", path + "/status", json={"status": "NO_SHOW"}, client=hk, headers=headers
        )
        self.assertEqual(denied.status_code, 403, denied.json)
        owner_b, headers_b = self.login("owner-b@test.local")
        crossed = self.request(
            "post", path + "/status", json={"status": "NO_SHOW"}, client=owner_b, headers=headers_b
        )
        self.assertEqual(crossed.status_code, 403, crossed.json)
        result = self.no_show(row)
        self.assertEqual(result.status_code, 200, result.json)
        for status in ("CONFIRMED", "IN_HOUSE", "CHECKED_OUT", "CANCELLED", "NO_SHOW"):
            response = self.request("post", path + "/status", json={"status": status})
            self.assertEqual(response.status_code, 409, response.json)
        edit = self.request("patch", path, json={"guest": "Edited"})
        self.assertEqual(edit.status_code, 409, edit.json)
        replacement = self.booking()
        entered = self.request(
            "post", f"/reservations/{replacement['id']}/status", json={"status": "IN_HOUSE"}
        )
        self.assertEqual(entered.status_code, 200, entered.json)
        self.assertEqual(self.no_show(replacement).status_code, 409)
        checkout = self.request(
            "post", f"/reservations/{replacement['id']}/status", json={"status": "CHECKED_OUT"}
        )
        self.assertEqual(checkout.status_code, 409, checkout.json)
        self.assertEqual(checkout.json["error"]["code"], "unpaid_balance")

    def test_no_show_allows_only_explicit_manual_financial_actions(self):
        row = self.booking()
        self.assertEqual(self.no_show(row).status_code, 200)
        path = f"/reservations/{row['id']}"
        fee = self.request(
            "post",
            path + "/charges",
            json={"type": "fee", "description": "Manual no-show fee", "unitPrice": "20"},
            key="manual-fee",
        )
        self.assertEqual(fee.status_code, 201, fee.json)
        payment = self.request(
            "post",
            path + "/payments",
            json={"amount": "20", "methodId": "cash-a", "fundId": "fund-a"},
            key="manual-payment",
        )
        self.assertEqual(payment.status_code, 201, payment.json)
        refund = self.request(
            "post",
            path + f"/payments/{payment.json['payments'][0]['id']}/refund",
            json={"amount": "10", "reason": "Manual refund"},
            key="manual-refund",
        )
        self.assertEqual(refund.status_code, 201, refund.json)
        self.assertEqual(refund.json["status"], "NO_SHOW")
        self.assertEqual(refund.json["paid"], "10.0000")
        self.assertEqual(len(self.request("get", "/workspace").json["ledger"]), 2)

    def test_no_show_migration_round_trip_and_downgrade_preserves_history(self):
        runner = self.app.test_cli_runner()
        downgraded = runner.invoke(args=["db", "downgrade", "0019_cash_categories"])
        self.assertEqual(downgraded.exit_code, 0, downgraded.output)
        upgraded = runner.invoke(args=["db", "upgrade"])
        self.assertEqual(upgraded.exit_code, 0, upgraded.output)
        row = self.booking()
        self.assertEqual(
            self.request("get", f"/reservations/{row['id']}").json["status"], "CONFIRMED"
        )
        self.assertEqual(self.no_show(row).status_code, 200)
        blocked = runner.invoke(args=["db", "downgrade", "0019_cash_categories"])
        self.assertNotEqual(blocked.exit_code, 0)
        preserved = self.request("get", f"/reservations/{row['id']}")
        self.assertEqual(preserved.status_code, 200, preserved.json)
        self.assertEqual(preserved.json["status"], "NO_SHOW")
        self.assertIsNotNone(preserved.json["noShowAt"])
