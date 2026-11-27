"""Room-type defaults and bed references must round-trip without relocating rooms implicitly."""

from tests.domain_fixture import DomainTestCase


class RoomTypeDetailsTests(DomainTestCase):
    def snapshot(self):
        response = self.request("get", "/workspace")
        self.assertEqual(response.status_code, 200, response.json)
        return response.json

    def bed(self, name="Queen"):
        response = self.request("post", "/masters/bedTypes", json={"name": name})
        self.assertEqual(response.status_code, 201, response.json)
        return response.json["id"]

    def test_floor_and_bed_round_trip_and_explicit_floor_applies_to_listed_rooms(self):
        bed_id = self.bed()
        response = self.request(
            "patch",
            "/masters/roomTypes",
            json={
                "id": "rt-a",
                "floor": " 10 ",
                "bedTypeId": bed_id,
                "roomNumbers": ["101", "102", "1001"],
            },
        )
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json["floor"], "10")
        self.assertEqual(response.json["bedTypeId"], bed_id)
        snapshot = self.snapshot()
        saved = next(row for row in snapshot["masters"]["roomTypes"] if row["id"] == "rt-a")
        self.assertEqual((saved["floor"], saved["bedTypeId"]), ("10", bed_id))
        self.assertTrue(all(room["floor"] == "10" for room in snapshot["rooms"]))

    def test_price_and_membership_edits_preserve_individual_locations_and_bed(self):
        bed_id = self.bed()
        saved = self.request(
            "patch",
            "/masters/roomTypes",
            json={"id": "rt-a", "floor": "2", "bedTypeId": bed_id},
        )
        self.assertEqual(saved.status_code, 200, saved.json)
        moved = self.request("patch", "/masters/rooms", json={"id": "101", "floor": "10"})
        self.assertEqual(moved.status_code, 200, moved.json)
        updated = self.request(
            "patch",
            "/masters/roomTypes",
            json={"id": "rt-a", "price": "200", "roomNumbers": ["101", "102", "103"]},
        )
        self.assertEqual(updated.status_code, 200, updated.json)
        self.assertEqual(updated.json["bedTypeId"], bed_id)
        rooms = {room["id"]: room for room in self.snapshot()["rooms"]}
        self.assertEqual(
            [rooms[number]["floor"] for number in ("101", "102", "103")], ["10", "2", "2"]
        )
        self.assertEqual(rooms["101"]["uuid"], moved.json["uuid"])

    def test_default_can_be_saved_without_rooms_and_inherited_or_overridden_on_create(self):
        saved = self.request(
            "post",
            "/masters/roomTypes",
            json={"name": "Penthouse", "floor": "Roof", "roomNumbers": []},
        )
        self.assertEqual(saved.status_code, 201, saved.json)
        for number, extra, expected in (("P1", {}, "Roof"), ("P2", {"floor": "Annex"}, "Annex")):
            room = self.request(
                "post",
                "/masters/rooms",
                json={"number": number, "typeId": saved.json["id"], **extra},
            )
            self.assertEqual(room.status_code, 201, room.json)
            self.assertEqual(room.json["floor"], expected)

    def test_bed_reference_rejects_other_tenants_wrong_catalog_and_inactive_choices(self):
        bed_id = self.bed()
        for value in ("missing-bed", "direct-a", "direct-b", True, [], 5):
            with self.subTest(value=value):
                result = self.request(
                    "patch",
                    "/masters/roomTypes",
                    json={"id": "rt-a", "bedTypeId": value},
                )
                self.assertEqual(result.status_code, 422, result.json)
        owner, headers = self.login("owner-b@test.local")
        other_bed = self.request(
            "post",
            f"/api/tenants/{self.other_tenant_id}/masters/bedTypes",
            json={"name": "Other Queen"},
            client=owner,
            headers=headers,
        )
        self.assertEqual(other_bed.status_code, 201, other_bed.json)
        crossed = self.request(
            "patch",
            "/masters/roomTypes",
            json={"id": "rt-a", "bedTypeId": other_bed.json["id"]},
        )
        self.assertEqual(crossed.status_code, 422, crossed.json)
        toggled = self.request("post", f"/masters/bedTypes/{bed_id}/toggle", json={})
        self.assertEqual(toggled.status_code, 200, toggled.json)
        inactive = self.request(
            "patch",
            "/masters/roomTypes",
            json={"id": "rt-a", "bedTypeId": bed_id},
        )
        self.assertEqual(inactive.status_code, 422, inactive.json)

    def test_existing_inactive_bed_can_be_retained_and_fields_can_be_cleared(self):
        bed_id = self.bed()
        saved = self.request(
            "patch",
            "/masters/roomTypes",
            json={"id": "rt-a", "bedTypeId": bed_id, "floor": "2"},
        )
        self.assertEqual(saved.status_code, 200, saved.json)
        toggled = self.request("post", f"/masters/bedTypes/{bed_id}/toggle", json={})
        self.assertEqual(toggled.status_code, 200, toggled.json)
        preserved = self.request(
            "patch",
            "/masters/roomTypes",
            json={"id": "rt-a", "bedTypeId": bed_id, "name": "Renamed"},
        )
        self.assertEqual(preserved.status_code, 200, preserved.json)
        cleared = self.request(
            "patch",
            "/masters/roomTypes",
            json={"id": "rt-a", "bedTypeId": "", "floor": None},
        )
        self.assertEqual(cleared.status_code, 200, cleared.json)
        self.assertIsNone(cleared.json["bedTypeId"])
        self.assertIsNone(cleared.json["floor"])
        self.assertTrue(all(room["floor"] is None for room in self.snapshot()["rooms"]))

    def test_invalid_floor_and_denied_writes_do_not_partially_update_type(self):
        for value in ("x" * 121, True, [], 10):
            with self.subTest(value=value):
                invalid = self.request(
                    "patch",
                    "/masters/roomTypes",
                    json={"id": "rt-a", "name": "Changed", "floor": value},
                )
                self.assertEqual(invalid.status_code, 422, invalid.json)
        frontdesk, headers = self.login("frontdesk@test.local")
        denied = self.request(
            "patch",
            "/masters/roomTypes",
            json={"id": "rt-a", "floor": "2"},
            client=frontdesk,
            headers=headers,
        )
        self.assertEqual(denied.status_code, 403, denied.json)
        saved = next(row for row in self.snapshot()["masters"]["roomTypes"] if row["id"] == "rt-a")
        self.assertEqual(saved["name"], "Standard")
        self.assertIsNone(saved["floor"])
