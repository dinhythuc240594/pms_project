"""Room locations are explicit metadata, independent of numbering and booking links."""

from sqlalchemy import select

from pms_api.bookings.models import ReservationNight, ReservationRoom
from pms_api.catalog.models import PhysicalRoom
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class RoomLocationPostgresTests(DomainTestCase):
    def room_snapshot(self):
        result = self.request("get", "/workspace")
        self.assertEqual(result.status_code, 200, result.json)
        return {room["id"]: room for room in result.json["rooms"]}

    def booking(self):
        result = self.request(
            "post",
            "/reservations",
            json={
                "guest": "Guest with room location",
                "room": "101",
                "sourceId": "direct-a",
                "checkIn": "2026-11-01",
                "checkOut": "2026-11-03",
            },
        )
        self.assertEqual(result.status_code, 201, result.json)
        return result.json

    def booking_links(self, booking_id):
        with self.app.app_context():
            set_context(tenant_id=self.tenant_id, user_id=self.owner_id)
            links = [
                (row.id, row.room_id, row.room_type_id, row.room_number)
                for row in db.session.scalars(
                    select(ReservationRoom)
                    .where(ReservationRoom.reservation_id == booking_id)
                    .order_by(ReservationRoom.id)
                )
            ]
            nights = [
                (row.id, row.room_id, row.date, row.price)
                for row in db.session.scalars(
                    select(ReservationNight)
                    .where(ReservationNight.reservation_id == booking_id)
                    .order_by(ReservationNight.id)
                )
            ]
            db.session.rollback()
            return links, nights

    def test_room_locations_round_trip_independently_of_room_number(self):
        for number, floor, area in (("1001", "10", None), ("A101", "1", "Villa-A")):
            created = self.request(
                "post",
                "/masters/rooms",
                json={"number": number, "typeId": "rt-a", "floor": floor, "area": area},
            )
            self.assertEqual(created.status_code, 201, created.json)
            self.assertEqual(created.json["id"], number)
            self.assertEqual(created.json["floor"], floor)
            self.assertEqual(created.json["area"], area)
        rooms = self.room_snapshot()
        self.assertEqual(rooms["1001"]["floor"], "10")
        self.assertEqual(rooms["A101"]["area"], "Villa-A")
        self.assertIsNone(rooms["101"]["floor"])
        self.assertIsNone(rooms["101"]["area"])
        unassigned = self.request(
            "post", "/masters/rooms", json={"number": "Villa-B", "typeId": "rt-a"}
        )
        self.assertEqual(unassigned.status_code, 201, unassigned.json)
        self.assertIsNone(unassigned.json["floor"])
        self.assertIsNone(unassigned.json["area"])

    def test_location_patch_normalizes_preserves_and_clears_fields(self):
        saved = self.request(
            "patch",
            "/masters/rooms",
            json={"id": "101", "floor": " 10 ", "area": " Villa-A "},
        )
        self.assertEqual(saved.status_code, 200, saved.json)
        self.assertEqual((saved.json["floor"], saved.json["area"]), ("10", "Villa-A"))
        preserved = self.request("patch", "/masters/rooms", json={"id": "101", "floor": "11"})
        self.assertEqual(preserved.status_code, 200, preserved.json)
        self.assertEqual(preserved.json["area"], "Villa-A")
        condition = self.request(
            "patch", "/masters/rooms", json={"id": "101", "condition": "dirty"}
        )
        self.assertEqual(condition.status_code, 200, condition.json)
        self.assertEqual((condition.json["floor"], condition.json["area"]), ("11", "Villa-A"))
        cleared = self.request(
            "patch", "/masters/rooms", json={"id": "101", "floor": None, "area": " \t "}
        )
        self.assertEqual(cleared.status_code, 200, cleared.json)
        self.assertIsNone(cleared.json["floor"])
        self.assertIsNone(cleared.json["area"])
        self.assertIsNone(self.room_snapshot()["101"]["area"])

    def test_locations_validate_types_and_length_without_partial_writes(self):
        for field in ("floor", "area"):
            accepted = self.request("patch", "/masters/rooms", json={"id": "101", field: "ầ" * 120})
            self.assertEqual(accepted.status_code, 200, accepted.json)
            for value in ("x" * 121, 10, True, [], {}):
                with self.subTest(field=field, value=value):
                    invalid = self.request(
                        "patch", "/masters/rooms", json={"id": "101", field: value}
                    )
                    self.assertEqual(invalid.status_code, 422, invalid.json)
                    self.assertEqual(invalid.json["error"]["code"], "VALIDATION_ERROR")
            self.assertEqual(self.room_snapshot()["101"][field], "ầ" * 120)
        invalid_create = self.request(
            "post",
            "/masters/rooms",
            json={"number": "A101", "typeId": "rt-a", "floor": "1", "area": 1},
        )
        self.assertEqual(invalid_create.status_code, 422, invalid_create.json)
        self.assertNotIn("A101", self.room_snapshot())

    def test_locations_can_change_for_booked_rooms_without_changing_identity_or_booking(self):
        booking = self.booking()
        links = self.booking_links(booking["id"])
        before = self.room_snapshot()["101"]
        updated = self.request(
            "patch",
            "/masters/rooms",
            json={"id": "101", "floor": "10", "area": "Villa-A"},
        )
        self.assertEqual(updated.status_code, 200, updated.json)
        self.assertEqual(updated.json["uuid"], before["uuid"])
        self.assertEqual(updated.json["typeId"], before["typeId"])
        self.assertEqual(updated.json["condition"], before["condition"])
        self.assertEqual(self.booking_links(booking["id"]), links)
        detail = self.request("get", f"/reservations/{booking['id']}")
        self.assertEqual(detail.status_code, 200, detail.json)
        self.assertEqual(detail.json["rooms"], ["101"])
        self.assertEqual(detail.json["version"], booking["version"])
        with self.app.app_context():
            set_context(tenant_id=self.tenant_id, user_id=self.owner_id)
            self.assertEqual(db.session.get(PhysicalRoom, before["uuid"]).housekeeping_revision, 0)
            db.session.rollback()

    def test_room_type_updates_and_room_reactivation_preserve_locations(self):
        saved = self.request(
            "patch",
            "/masters/rooms",
            json={"id": "101", "floor": "10", "area": "Villa-A"},
        )
        self.assertEqual(saved.status_code, 200, saved.json)
        for numbers in (["101", "102", "1001"], ["102", "1001"], ["101", "102", "1001"]):
            updated = self.request(
                "patch", "/masters/roomTypes", json={"id": "rt-a", "roomNumbers": numbers}
            )
            self.assertEqual(updated.status_code, 200, updated.json)
            rooms = self.room_snapshot()
            self.assertEqual(rooms["101"]["uuid"], saved.json["uuid"])
            self.assertEqual((rooms["101"]["floor"], rooms["101"]["area"]), ("10", "Villa-A"))
            self.assertIsNone(rooms["1001"]["floor"])
            self.assertIsNone(rooms["1001"]["area"])
        reassigned = self.request(
            "post", "/masters/roomTypes", json={"name": "Villa", "roomNumbers": ["101"]}
        )
        self.assertEqual(reassigned.status_code, 201, reassigned.json)
        room = self.room_snapshot()["101"]
        self.assertEqual(room["typeId"], reassigned.json["id"])
        self.assertEqual(room["uuid"], saved.json["uuid"])
        self.assertEqual((room["floor"], room["area"]), ("10", "Villa-A"))

    def test_location_writes_enforce_tenant_and_settings_permissions(self):
        saved = self.request(
            "patch", "/masters/rooms", json={"id": "101", "floor": "10", "area": "Villa-A"}
        )
        self.assertEqual(saved.status_code, 200, saved.json)
        crossed = self.request(
            "patch",
            f"/api/tenants/{self.other_tenant_id}/masters/rooms",
            json={"id": "101", "area": "Crossed"},
        )
        self.assertEqual(crossed.status_code, 403, crossed.json)
        frontdesk, headers = self.login("frontdesk@test.local")
        denied = self.request(
            "patch",
            "/masters/rooms",
            json={"id": "101", "area": "Reception"},
            client=frontdesk,
            headers=headers,
        )
        self.assertEqual(denied.status_code, 403, denied.json)
        owner_b, headers_b = self.login("owner-b@test.local")
        other = self.request(
            "get",
            f"/api/tenants/{self.other_tenant_id}/workspace",
            client=owner_b,
            headers=headers_b,
        )
        self.assertEqual(other.status_code, 200, other.json)
        self.assertTrue(
            all(room["floor"] is None and room["area"] is None for room in other.json["rooms"])
        )
        self.assertEqual(self.room_snapshot()["101"]["area"], "Villa-A")

    def test_migration_leaves_existing_rooms_unassigned_and_preserves_booking_links(self):
        booking = self.booking()
        links = self.booking_links(booking["id"])
        before = self.room_snapshot()
        runner = self.app.test_cli_runner()
        down = runner.invoke(args=["db", "downgrade", "0031_channel_onboarding"])
        self.assertEqual(down.exit_code, 0, down.output)
        self.addCleanup(lambda: runner.invoke(args=["db", "upgrade"]))
        upgraded = runner.invoke(args=["db", "upgrade"])
        self.assertEqual(upgraded.exit_code, 0, upgraded.output)
        self.assertEqual(self.room_snapshot(), before)
        self.assertEqual(self.booking_links(booking["id"]), links)
        detail = self.request("get", f"/reservations/{booking['id']}")
        self.assertEqual(detail.status_code, 200, detail.json)
        self.assertEqual(detail.json["rooms"], ["101"])
        assigned = self.request(
            "patch", "/masters/rooms", json={"id": "101", "floor": "10", "area": "Villa-A"}
        )
        self.assertEqual(assigned.status_code, 200, assigned.json)
        refused = runner.invoke(args=["db", "downgrade", "0031_channel_onboarding"])
        self.assertNotEqual(refused.exit_code, 0)
        self.assertEqual(self.room_snapshot()["101"]["area"], "Villa-A")
        self.assertEqual(self.booking_links(booking["id"]), links)
