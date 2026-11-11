"""Physical rooms and booking guest details exercised through the tenant API."""

from sqlalchemy import select

from pms_api.bookings.models import Guest
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class RoomGuestAcceptanceTests(DomainTestCase):
    def create_booking(self, **changes):
        response = self.request(
            "POST",
            "/reservations",
            {
                "room": "101",
                "sourceId": "direct-a",
                "guests": [{"name": "Guest A"}],
                "checkIn": "2026-11-01",
                "checkOut": "2026-11-03",
                **changes,
            },
        )
        self.assertEqual(response.status_code, 201, response.json)
        return response.json

    def test_standalone_guest_routes_are_removed_and_booking_contacts_can_be_saved(self):
        booking = self.create_booking(
            guests=[
                {
                    "name": "  Nguyễn An  ",
                    "phone": " 0900000000 ",
                    "email": " an@example.com ",
                    "identityNumber": " ID-123 ",
                    "nationality": " VN ",
                }
            ]
        )
        guest = booking["guests"][0]
        self.assertEqual(guest["name"], "Nguyễn An")
        self.assertEqual(guest["identityNumber"], "ID-123")
        self.assertTrue(guest["active"])
        for method, path, data in (
            ("GET", "/guests", None),
            ("POST", "/guests", {"name": "Unused guest"}),
            ("PATCH", f"/guests/{guest['id']}", {"phone": "Must not save"}),
        ):
            with self.subTest(method=method):
                response = self.request(method, path, data)
                self.assertEqual(response.status_code, 404, response.json)
        updated = self.request(
            "PATCH",
            f"/reservations/{booking['id']}",
            {"guests": [{"id": guest["id"], "phone": "0911111111"}]},
        )
        self.assertEqual(updated.status_code, 200, updated.json)
        expected = {**guest, "phone": "0911111111"}
        self.assertEqual(updated.json["guests"], [expected])
        self.assertEqual(updated.json["phone"], "0911111111")
        self.assertEqual(
            self.request("GET", f"/reservations/{booking['id']}").json["guests"], [expected]
        )
        self.assertEqual(self.request("GET", "/workspace").json["guests"], [expected])

    def test_invalid_guest_profiles_do_not_create_partial_records(self):
        for changes in (
            {"name": " "},
            {"name": "x" * 161},
            {"phone": 123},
            {"phone": "x" * 41},
            {"email": "missing-at.example.com"},
            {"email": "bad email@example.com"},
            {"email": "guest@"},
            {"email": "@example.com"},
            {"email": "guest@@example.com"},
            {"email": "guest\tname@example.com"},
            {"identityNumber": "x" * 81},
            {"nationality": "x" * 81},
            {"active": "false"},
        ):
            with self.subTest(changes=changes):
                result = self.request(
                    "POST",
                    "/reservations",
                    {
                        "room": "101",
                        "sourceId": "direct-a",
                        "guests": [{"name": "Invalid", **changes}],
                        "checkIn": "2026-11-01",
                        "checkOut": "2026-11-03",
                    },
                )
                self.assertEqual(result.status_code, 422, result.json)
        snapshot = self.request("GET", "/workspace").json
        self.assertEqual(snapshot["guests"], [])
        self.assertEqual(snapshot["bookings"], [])

    def test_invalid_guest_update_rolls_back_all_contact_changes(self):
        booking = self.create_booking(
            guests=[{"name": "Guest A", "phone": "0900000000", "email": "original@example.com"}]
        )
        guest = booking["guests"][0]
        before = self.request("GET", "/workspace").json
        response = self.request(
            "PATCH",
            f"/reservations/{booking['id']}",
            {
                "guests": [
                    {
                        "id": guest["id"],
                        "name": "Must roll back",
                        "phone": "Changed",
                        "email": "invalid",
                    }
                ]
            },
        )
        self.assertEqual(response.status_code, 422, response.json)
        snapshot = self.request("GET", "/workspace").json
        self.assertEqual(snapshot["guests"], [guest])
        self.assertEqual(snapshot["bookings"], before["bookings"])

    def test_deactivated_guest_keeps_booking_history_and_cannot_join_new_booking(self):
        booking = self.create_booking(guests=[{"name": "Guest A", "phone": "0900000000"}])
        guest = booking["guests"][0]
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            row = db.session.scalar(select(Guest).where(Guest.id == guest["id"]))
            row.name, row.active = "Renamed guest", False
            db.session.commit()
        snapshot = self.request("GET", "/workspace").json
        self.assertEqual(snapshot["guests"], [{**guest, "name": "Renamed guest", "active": False}])
        history = next(row for row in snapshot["bookings"] if row["id"] == booking["id"])
        self.assertEqual(history["guest"], "Guest A")
        self.assertEqual(history["phone"], "0900000000")
        self.assertEqual(history["guests"][0]["id"], guest["id"])
        self.assertEqual(history["guests"][0]["name"], "Renamed guest")
        rejected = self.request(
            "POST",
            "/reservations",
            {
                "room": "102",
                "sourceId": "direct-a",
                "guests": [{"id": guest["id"]}],
                "checkIn": "2026-11-01",
                "checkOut": "2026-11-03",
            },
        )
        self.assertEqual(rejected.status_code, 404, rejected.json)
        self.assertEqual(len(self.request("GET", "/reservations").json["bookings"]), 1)

    def test_booking_guest_permissions_allow_frontdesk_write_and_accountant_read_only(self):
        booking = self.create_booking()
        guest = booking["guests"][0]
        for email, contacts_visible, write_status in (
            ("frontdesk@test.local", True, 200),
            ("accountant@test.local", True, 403),
            ("hk@test.local", False, 403),
        ):
            with self.subTest(email=email):
                client, headers = self.login(email)
                listed = self.request("GET", "/workspace", client=client, headers=headers)
                self.assertEqual(listed.status_code, 200, listed.json)
                self.assertEqual(bool(listed.json["guests"]), contacts_visible)
                saved = self.request(
                    "PATCH",
                    f"/reservations/{booking['id']}",
                    {
                        "guests": [
                            {
                                "id": guest["id"],
                                "phone": "0911111111" if write_status == 200 else "0999999999",
                            }
                        ]
                    },
                    client=client,
                    headers=headers,
                )
                self.assertEqual(saved.status_code, write_status, saved.json)
                created = self.request(
                    "POST",
                    "/reservations",
                    {
                        "room": "102",
                        "sourceId": "direct-a",
                        "guests": [{"name": email}],
                        "checkIn": "2026-11-01",
                        "checkOut": "2026-11-03",
                    },
                    client=client,
                    headers=headers,
                )
                self.assertEqual(
                    created.status_code, 201 if write_status == 200 else 403, created.json
                )
        guests = self.request("GET", "/workspace").json["guests"]
        self.assertEqual(len(guests), 2)
        self.assertEqual(
            next(row for row in guests if row["id"] == guest["id"])["phone"], "0911111111"
        )

    def test_booking_guest_read_and_update_are_isolated_between_hotels(self):
        own_booking = self.create_booking(guests=[{"name": "Hotel A private guest"}])
        own = own_booking["guests"][0]
        client, headers = self.login("owner-b@test.local")
        base = f"/api/tenants/{self.other_tenant_id}"
        other = self.request(
            "POST",
            base + "/reservations",
            {
                "room": "101",
                "sourceId": "direct-b",
                "guests": [{"name": "Hotel B private guest"}],
                "checkIn": "2026-11-01",
                "checkOut": "2026-11-03",
            },
            client=client,
            headers=headers,
        )
        self.assertEqual(other.status_code, 201, other.json)
        foreign_guest = other.json["guests"][0]
        self.assertEqual(self.request("GET", "/workspace").json["guests"], [own])
        foreign_id = self.request(
            "PATCH",
            f"/reservations/{own_booking['id']}",
            {"guests": [{"id": foreign_guest["id"], "name": "Intrusion"}]},
        )
        self.assertEqual(foreign_id.status_code, 404, foreign_id.json)
        for method, path, data in (
            ("GET", base + "/workspace", None),
            (
                "PATCH",
                base + f"/reservations/{other.json['id']}",
                {"guests": [{"id": foreign_guest["id"], "name": "Intrusion"}]},
            ),
        ):
            denied = self.request(method, path, data)
            self.assertEqual(denied.status_code, 403, denied.json)
        listed = self.request("GET", base + "/workspace", client=client, headers=headers)
        self.assertEqual(listed.json["guests"], [foreign_guest])
        self.assertEqual(self.request("GET", "/workspace").json["guests"], [own])

    def test_physical_room_lifecycle_survives_reload_and_updates_availability(self):
        created = self.request("POST", "/masters/rooms", {"number": " 103 ", "typeId": "rt-a"})
        self.assertEqual(created.status_code, 201, created.json)
        room = created.json
        self.assertEqual(room["id"], "103")
        self.assertNotEqual(room["uuid"], room["id"])
        self.assertEqual(room["condition"], "clean")
        availability_path = "/availability?start=2026-11-01&end=2026-11-02"
        self.assertEqual(self.request("GET", availability_path).json["availability"][0]["total"], 3)
        new_type = self.request("POST", "/masters/roomTypes", {"name": "Deluxe", "price": "150"})
        self.assertEqual(new_type.status_code, 201, new_type.json)
        changed = self.request(
            "PATCH",
            "/masters/rooms",
            {"id": "103", "typeId": new_type.json["id"], "condition": "dirty"},
        )
        self.assertEqual(changed.status_code, 200, changed.json)
        self.assertEqual(changed.json["uuid"], room["uuid"])
        disabled = self.request("POST", "/masters/rooms/103/toggle", {})
        self.assertEqual(disabled.status_code, 200, disabled.json)
        self.assertFalse(disabled.json["active"])
        snapshot = self.request("GET", "/workspace").json
        self.assertEqual(next(r for r in snapshot["rooms"] if r["id"] == "103"), disabled.json)
        totals = {
            r["roomTypeId"]: r["total"]
            for r in self.request("GET", availability_path).json["availability"]
        }
        self.assertEqual(totals, {"rt-a": 2, new_type.json["id"]: 0})
        enabled = self.request("POST", "/masters/rooms/103/toggle", {})
        self.assertEqual(enabled.status_code, 200, enabled.json)
        self.assertTrue(enabled.json["active"])
        self.assertEqual(enabled.json["uuid"], room["uuid"])
        totals = {
            r["roomTypeId"]: r["total"]
            for r in self.request("GET", availability_path).json["availability"]
        }
        self.assertEqual(totals, {"rt-a": 2, new_type.json["id"]: 1})

    def test_invalid_physical_room_inputs_do_not_change_existing_rooms(self):
        before = self.request("GET", "/workspace").json["rooms"]
        for data, status in (
            ({"typeId": "rt-a"}, 422),
            ({"number": " ", "typeId": "rt-a"}, 422),
            ({"number": "103", "typeId": "rt-b"}, 404),
            ({"number": "103", "typeId": "missing"}, 404),
            ({"number": "103", "typeId": "rt-a", "condition": "occupied"}, 422),
            ({"number": "103", "typeId": "rt-a", "active": "false"}, 422),
        ):
            with self.subTest(data=data):
                result = self.request("POST", "/masters/rooms", data)
                self.assertEqual(result.status_code, status, result.json)
        self.assertEqual(self.request("GET", "/workspace").json["rooms"], before)

    def test_physical_room_settings_are_owner_only(self):
        for email in ("frontdesk@test.local", "accountant@test.local", "hk@test.local"):
            with self.subTest(email=email):
                client, headers = self.login(email)
                for method, path, data in (
                    ("POST", "/masters/rooms", {"number": "103", "typeId": "rt-a"}),
                    ("PATCH", "/masters/rooms", {"id": "101", "condition": "dirty"}),
                    ("POST", "/masters/rooms/101/toggle", {}),
                ):
                    result = self.request(method, path, data, client=client, headers=headers)
                    self.assertEqual(result.status_code, 403, result.json)
        rooms = self.request("GET", "/workspace").json["rooms"]
        self.assertEqual(len(rooms), 2)
        self.assertTrue(all(r["active"] and r["condition"] == "clean" for r in rooms))

    def test_same_room_numbers_in_other_hotel_are_never_modified(self):
        changed = self.request("PATCH", "/masters/rooms", {"id": "101", "condition": "dirty"})
        self.assertEqual(changed.status_code, 200, changed.json)
        client, headers = self.login("owner-b@test.local")
        base = f"/api/tenants/{self.other_tenant_id}"
        foreign = self.request("GET", base + "/workspace", client=client, headers=headers)
        self.assertEqual(
            next(r for r in foreign.json["rooms"] if r["id"] == "101")["condition"], "clean"
        )
        denied = self.request("POST", base + "/masters/rooms/101/toggle", {})
        self.assertEqual(denied.status_code, 403, denied.json)
        created = self.request(
            "POST",
            base + "/masters/rooms",
            {"number": "103", "typeId": "rt-b"},
            client=client,
            headers=headers,
        )
        self.assertEqual(created.status_code, 201, created.json)
        absent = self.request("PATCH", "/masters/rooms", {"id": "103", "condition": "dirty"})
        self.assertEqual(absent.status_code, 404, absent.json)

    def test_room_condition_changes_validate_input_and_record_frontdesk_actor(self):
        client, headers = self.login("frontdesk@test.local")
        dirty = self.request(
            "POST", "/rooms/101/condition", {"condition": "dirty"}, client=client, headers=headers
        )
        self.assertEqual(dirty.status_code, 200, dirty.json)
        for value in (None, "occupied", "", False, [], {}):
            with self.subTest(condition=value):
                invalid = self.request("POST", "/rooms/101/condition", {"condition": value})
                self.assertEqual(invalid.status_code, 422, invalid.json)
        accountant, accountant_headers = self.login("accountant@test.local")
        denied = self.request(
            "POST",
            "/rooms/101/condition",
            {"condition": "clean"},
            client=accountant,
            headers=accountant_headers,
        )
        self.assertEqual(denied.status_code, 403, denied.json)
        snapshot = self.request("GET", "/workspace").json
        self.assertEqual(
            next(r for r in snapshot["rooms"] if r["id"] == "101")["condition"], "dirty"
        )
        event = next(
            r
            for r in snapshot["housekeepingLogs"]
            if r["room"] == "101" and r["action"] == "room.dirty"
        )
        self.assertEqual(event["actorId"], "frontdesk")
        self.assertEqual(event["condition"], "dirty")

    def test_housekeeping_workspace_keeps_room_metadata_but_hides_prices_and_guest_contacts(self):
        self.create_booking(
            guests=[{"name": "Guest A", "phone": "0900000000", "email": "private@example.com"}]
        )
        source = self.request(
            "PATCH", "/masters/bookingSources", {"id": "direct-a", "commission": "12"}
        )
        self.assertEqual(source.status_code, 200, source.json)
        saved = self.request(
            "PUT",
            "/rates",
            {
                "roomTypeId": "rt-a",
                "start": "2026-11-01",
                "end": "2026-11-02",
                "price": "450",
                "stopSell": True,
            },
        )
        self.assertEqual(saved.status_code, 200, saved.json)
        owner = self.request("GET", "/workspace").json
        self.assertIn("price", owner["masters"]["roomTypes"][0])
        self.assertIn("price", owner["masters"]["services"][0])
        self.assertEqual(owner["masters"]["bookingSources"][0]["commission"], "12.0000")
        self.assertEqual(owner["rates"][0]["price"], "450.0000")
        client, headers = self.login("hk@test.local")
        denied = self.request(
            "GET", "/rates?start=2026-11-01&end=2026-11-02", client=client, headers=headers
        )
        self.assertEqual(denied.status_code, 403, denied.json)
        result = self.request("GET", "/workspace", client=client, headers=headers)
        self.assertEqual(result.status_code, 200, result.json)
        snapshot = result.json
        self.assertEqual(snapshot["guests"], [])
        self.assertEqual(snapshot["ledger"], [])
        self.assertEqual(snapshot["bookings"][0]["phone"], "")
        self.assertEqual(snapshot["masters"]["roomTypes"][0]["name"], "Standard")
        self.assertEqual(snapshot["rates"][0]["roomTypeId"], "rt-a")
        self.assertTrue(snapshot["rates"][0]["stopSell"])
        self.assertNotIn("price", snapshot["masters"]["roomTypes"][0])
        for rows in snapshot["masters"].values():
            for row in rows:
                self.assertFalse({"price", "commission", "tax"}.intersection(row))
        self.assertNotIn("price", snapshot["rates"][0])
