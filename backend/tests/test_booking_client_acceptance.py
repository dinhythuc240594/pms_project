"""Real API acceptance tests for the client's shared calendar and booking data."""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from tests.domain_fixture import DomainTestCase


class BookingClientAcceptanceTests(DomainTestCase):
    def setUp(self):
        super().setUp()
        self.today = datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date()
        self.start = self.today + timedelta(days=10)

    def make_booking(self, **changes):
        values = {
            "guest": "Calendar guest",
            "phone": "0900000000",
            "room": "101",
            "sourceId": "direct-a",
            "checkIn": self.start.isoformat(),
            "checkOut": (self.start + timedelta(days=2)).isoformat(),
        }
        values.update(changes)
        response = self.request("POST", "/reservations", values)
        self.assertEqual(response.status_code, 201, response.json)
        return response.json

    def availability(self, start=None, days=4, type_id="rt-a"):
        start = start or self.start
        end = start + timedelta(days=days)
        response = self.request("GET", f"/availability?start={start}&end={end}&typeId={type_id}")
        self.assertEqual(response.status_code, 200, response.json)
        return response.json["availability"]

    def detail(self, booking_id):
        response = self.request("GET", f"/reservations/{booking_id}")
        self.assertEqual(response.status_code, 200, response.json)
        return response.json

    def test_workspace_booking_list_and_detail_return_the_same_persisted_stays(self):
        first = self.make_booking(guest="First guest")
        second = self.make_booking(guest="Second guest", room="102")
        note = self.request("POST", f"/reservations/{first['id']}/notes", {"text": "Late arrival"})
        self.assertEqual(note.status_code, 201, note.json)

        listed = self.request("GET", "/reservations")
        workspace = self.request("GET", "/workspace")
        self.assertEqual(listed.status_code, 200, listed.json)
        self.assertEqual(workspace.status_code, 200, workspace.json)
        self.assertEqual(listed.json["bookings"], workspace.json["bookings"])
        self.assertEqual(
            [row["id"] for row in listed.json["bookings"]], [second["id"], first["id"]]
        )
        for row in listed.json["bookings"]:
            self.assertEqual(row, self.detail(row["id"]))
            self.assertTrue(set(row["rooms"]).issubset(r["id"] for r in workspace.json["rooms"]))
            self.assertEqual(len(row["nightlyRates"]), 2)
        self.assertEqual(self.detail(first["id"])["notes"][0]["text"], "Late arrival")

    def test_moving_between_room_types_releases_old_room_and_reserves_new_inventory(self):
        room_type = self.request(
            "POST",
            "/masters/roomTypes",
            {"name": "Deluxe", "price": "175", "capacity": 2, "roomNumbers": ["103"]},
        )
        self.assertEqual(room_type.status_code, 201, room_type.json)
        row = self.make_booking()
        moved = self.request("PATCH", f"/reservations/{row['id']}", {"rooms": ["103"]})
        self.assertEqual(moved.status_code, 200, moved.json)
        self.assertEqual(moved.json["rooms"], ["103"])
        self.assertEqual(moved.json["total"], "350.0000")
        self.assertEqual([night["room"] for night in moved.json["nightlyRates"]], ["103", "103"])
        self.assertEqual([day["booked"] for day in self.availability(days=2)], [0, 0])
        self.assertEqual(
            [day["booked"] for day in self.availability(days=2, type_id=room_type.json["id"])],
            [1, 1],
        )
        replacement = self.make_booking(guest="Replacement guest")
        self.assertNotEqual(replacement["id"], row["id"])
        overlap = self.request(
            "POST",
            "/reservations",
            {
                "guest": "Must not overlap",
                "room": "103",
                "sourceId": "direct-a",
                "checkIn": row["checkIn"],
                "checkOut": row["checkOut"],
            },
        )
        self.assertEqual(overlap.status_code, 409, overlap.json)
        self.assertEqual(overlap.json["error"]["code"], "room_unavailable")

    def test_shifting_and_extending_stay_updates_each_calendar_night(self):
        row = self.make_booking()
        new_start = self.start + timedelta(days=1)
        new_end = self.start + timedelta(days=4)
        saved = self.request(
            "PATCH",
            f"/reservations/{row['id']}",
            {"checkIn": new_start.isoformat(), "checkOut": new_end.isoformat()},
        )
        self.assertEqual(saved.status_code, 200, saved.json)
        self.assertEqual(saved.json["total"], "300.0000")
        self.assertEqual(saved.json["checkIn"], new_start.isoformat())
        self.assertEqual(saved.json["checkOut"], new_end.isoformat())
        self.assertEqual(
            [night["date"] for night in saved.json["nightlyRates"]],
            [(new_start + timedelta(days=offset)).isoformat() for offset in range(3)],
        )
        inventory = self.availability()
        self.assertEqual([day["booked"] for day in inventory], [0, 1, 1, 1])
        self.assertEqual([day["available"] for day in inventory], [2, 1, 1, 1])
        self.make_booking(checkOut=new_start.isoformat())

    def test_extension_into_adjacent_reservation_keeps_original_stay_and_inventory(self):
        row = self.make_booking()
        self.make_booking(
            guest="Next arrival",
            checkIn=row["checkOut"],
            checkOut=(self.start + timedelta(days=3)).isoformat(),
        )
        before, inventory = self.detail(row["id"]), self.availability()
        rejected = self.request(
            "PATCH",
            f"/reservations/{row['id']}",
            {"checkOut": (self.start + timedelta(days=3)).isoformat()},
        )
        self.assertEqual(rejected.status_code, 409, rejected.json)
        self.assertEqual(rejected.json["error"]["code"], "room_unavailable")
        self.assertEqual(self.detail(row["id"]), before)
        self.assertEqual(self.availability(), inventory)

    def test_late_validation_failure_rolls_back_moved_stay_inventory_and_guest(self):
        row = self.make_booking()
        before, inventory = self.detail(row["id"]), self.availability()
        rejected = self.request(
            "PATCH",
            f"/reservations/{row['id']}",
            {
                "rooms": ["102"],
                "checkIn": (self.start + timedelta(days=1)).isoformat(),
                "checkOut": (self.start + timedelta(days=3)).isoformat(),
                "sourceId": "missing-source",
                "guests": [{"id": row["guests"][0]["id"], "name": "Must roll back"}],
            },
        )
        self.assertEqual(rejected.status_code, 422, rejected.json)
        self.assertEqual(rejected.json["error"]["code"], "invalid_master")
        self.assertEqual(self.detail(row["id"]), before)
        self.assertEqual(self.availability(), inventory)
        guests = self.request("GET", "/workspace").json["guests"]
        self.assertEqual(guests, row["guests"])
        self.make_booking(room="102")

    def test_shortening_below_paid_amount_preserves_price_payment_and_inventory(self):
        row = self.make_booking()
        payment = self.request(
            "POST",
            f"/reservations/{row['id']}/payments",
            {"amount": "200", "methodId": "cash-a", "fundId": "fund-a"},
            key="calendar-full-payment",
        )
        self.assertEqual(payment.status_code, 201, payment.json)
        before, inventory = self.detail(row["id"]), self.availability()
        rejected = self.request(
            "PATCH",
            f"/reservations/{row['id']}",
            {"checkOut": (self.start + timedelta(days=1)).isoformat()},
        )
        self.assertEqual(rejected.status_code, 409, rejected.json)
        self.assertEqual(rejected.json["error"]["code"], "refund_required")
        self.assertEqual(self.detail(row["id"]), before)
        self.assertEqual(self.availability(), inventory)

    def test_checked_in_stay_rejects_room_and_date_changes_without_changing_inventory(self):
        row = self.make_booking(
            checkIn=self.today.isoformat(), checkOut=(self.today + timedelta(days=2)).isoformat()
        )
        checked_in = self.request(
            "POST", f"/reservations/{row['id']}/status", {"status": "IN_HOUSE"}
        )
        self.assertEqual(checked_in.status_code, 200, checked_in.json)
        before, inventory = self.detail(row["id"]), self.availability(start=self.today)
        for changes in (
            {"rooms": ["102"]},
            {"checkOut": (self.today + timedelta(days=3)).isoformat()},
        ):
            with self.subTest(changes=changes):
                rejected = self.request("PATCH", f"/reservations/{row['id']}", changes)
                self.assertEqual(rejected.status_code, 409, rejected.json)
                self.assertEqual(rejected.json["error"]["code"], "stay_started")
                self.assertEqual(self.detail(row["id"]), before)
                self.assertEqual(self.availability(start=self.today), inventory)

    def test_invalid_status_transition_does_not_release_reserved_inventory(self):
        row = self.make_booking()
        before, inventory = self.detail(row["id"]), self.availability()
        rejected = self.request(
            "POST", f"/reservations/{row['id']}/status", {"status": "CHECKED_OUT"}
        )
        self.assertEqual(rejected.status_code, 409, rejected.json)
        self.assertEqual(rejected.json["error"]["code"], "invalid_transition")
        self.assertEqual(self.detail(row["id"]), before)
        self.assertEqual(self.availability(), inventory)

    def test_status_rejects_non_string_payloads_without_server_errors(self):
        row = self.make_booking()
        before, inventory = self.detail(row["id"]), self.availability()
        for status in ([], {}, True, None, 42):
            with self.subTest(status=status):
                rejected = self.request(
                    "POST", f"/reservations/{row['id']}/status", {"status": status}
                )
                self.assertEqual(rejected.status_code, 422, rejected.json)
                self.assertEqual(rejected.json["error"]["code"], "invalid_status")
                self.assertEqual(self.detail(row["id"]), before)
                self.assertEqual(self.availability(), inventory)
