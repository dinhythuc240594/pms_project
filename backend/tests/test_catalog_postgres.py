from datetime import date
from decimal import Decimal

from sqlalchemy import select

from pms_api.catalog.models import (
    DEFAULT_UNITS,
    Master,
    PhysicalRoom,
    RoomTypeAvailability,
    ensure_default_units,
)
from pms_api.catalog.routes import adjust_inventory, lock_inventory
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class CatalogPostgresTests(DomainTestCase):
    def test_hotel_profile_settings_round_trip_partial_update_and_clear(self):
        profile = {
            "phone": "+84 28 1234 5678",
            "contactEmail": " Reception@Hotel.Example ",
            "website": "https://hotel.example",
            "logoUrl": "https://hotel.example/logo.png",
            "taxCode": "0312345678",
            "bankName": "Hotel Bank",
            "bankAccount": "00123456789",
            "bankAccountName": "HOTEL COMPANY",
            "timezone": "Asia/Bangkok",
            "defaultLanguage": "en",
        }
        saved = self.request("patch", "/settings", json={**profile, "policies": "Check-in policy"})
        self.assertEqual(saved.status_code, 200, saved.json)
        expected = {**profile, "contactEmail": "reception@hotel.example"}
        loaded = self.request("get", "/workspace")
        self.assertEqual(loaded.status_code, 200, loaded.json)
        for key, value in expected.items():
            self.assertEqual(saved.json[key], value)
            self.assertEqual(loaded.json["settings"][key], value)
        updated = self.request("patch", "/settings", json={"phone": "", "logoUrl": ""})
        self.assertEqual(updated.status_code, 200, updated.json)
        self.assertEqual(updated.json["phone"], "")
        self.assertEqual(updated.json["logoUrl"], "")
        self.assertEqual(updated.json["bankAccount"], profile["bankAccount"])
        self.assertEqual(updated.json["policies"], "Check-in policy")

    def test_hotel_profile_settings_enforce_tenant_and_role_permissions(self):
        saved = self.request("patch", "/settings", json={"phone": "0901234567"})
        self.assertEqual(saved.status_code, 200, saved.json)
        crossed = self.request(
            "patch", f"/api/tenants/{self.other_tenant_id}/settings", json={"phone": "Crossed"}
        )
        self.assertEqual(crossed.status_code, 403, crossed.json)
        frontdesk, headers = self.login("frontdesk@test.local")
        denied = self.request(
            "patch", "/settings", json={"bankAccount": "123"}, client=frontdesk, headers=headers
        )
        self.assertEqual(denied.status_code, 403, denied.json)
        owner_b, headers_b = self.login("owner-b@test.local")
        loaded = self.request(
            "get",
            f"/api/tenants/{self.other_tenant_id}/workspace",
            client=owner_b,
            headers=headers_b,
        )
        self.assertEqual(loaded.status_code, 200, loaded.json)
        self.assertEqual(loaded.json["settings"]["phone"], "")
        self.assertEqual(loaded.json["settings"]["bankAccount"], "")
        self.assertEqual(loaded.json["settings"]["defaultLanguage"], "vi")

    def test_room_type_codes_keep_business_text_and_internal_room_links(self):
        created = self.request(
            "post",
            "/masters/roomTypes",
            json={"code": " 2 ", "name": "Couple", "roomNumbers": ["103"]},
        )
        self.assertEqual(created.status_code, 201, created.json)
        room_type_id = created.json["id"]
        self.assertNotEqual(room_type_id, "2")
        self.assertEqual(created.json["code"], "2")
        leading_zero = self.request(
            "post",
            "/masters/roomTypes",
            json={"code": "02", "name": "Deluxe"},
        )
        self.assertEqual(leading_zero.status_code, 201, leading_zero.json)
        self.assertEqual(leading_zero.json["code"], "02")
        duplicate = self.request(
            "post",
            "/masters/roomTypes",
            json={"code": "2", "name": "Duplicate"},
        )
        self.assertEqual(duplicate.status_code, 409, duplicate.json)
        self.assertEqual(duplicate.json["error"]["code"], "ROOM_TYPE_CODE_EXISTS")
        updated = self.request(
            "patch",
            "/masters/roomTypes",
            json={"id": room_type_id, "code": "3"},
        )
        self.assertEqual(updated.status_code, 200, updated.json)
        self.assertEqual(updated.json["id"], room_type_id)
        preserved = self.request(
            "patch",
            "/masters/roomTypes",
            json={"id": room_type_id, "name": "Couple renamed"},
        )
        self.assertEqual(preserved.json["code"], "3")
        snapshot = self.request("get", "/workspace")
        self.assertEqual(snapshot.status_code, 200, snapshot.json)
        restored = next(t for t in snapshot.json["masters"]["roomTypes"] if t["id"] == room_type_id)
        room = next(r for r in snapshot.json["rooms"] if r["id"] == "103")
        self.assertEqual(restored["code"], "3")
        self.assertEqual(room["typeId"], room_type_id)

    def test_room_type_code_is_tenant_scoped_and_legacy_ids_do_not_change(self):
        booking = self.make_booking()
        legacy = self.request("patch", "/masters/roomTypes", json={"id": "rt-a", "name": "Legacy"})
        self.assertEqual(legacy.status_code, 200, legacy.json)
        self.assertIsNone(legacy.json["code"])
        assigned = self.request("patch", "/masters/roomTypes", json={"id": "rt-a", "code": "2"})
        self.assertEqual(assigned.status_code, 200, assigned.json)
        self.assertEqual(assigned.json["id"], "rt-a")
        for code in ("", " ", "x" * 41, None, 2, True):
            invalid = self.request("patch", "/masters/roomTypes", json={"id": "rt-a", "code": code})
            self.assertEqual(invalid.status_code, 422, invalid.json)
        owner_b, headers_b = self.login("owner-b@test.local")
        other = self.request(
            "patch",
            f"/api/tenants/{self.other_tenant_id}/masters/roomTypes",
            json={"id": "rt-b", "code": "2"},
            client=owner_b,
            headers=headers_b,
        )
        self.assertEqual(other.status_code, 200, other.json)
        crossed = self.request("patch", "/masters/roomTypes", json={"id": "rt-b", "code": "9"})
        self.assertEqual(crossed.status_code, 404, crossed.json)
        detail = self.request("get", f"/reservations/{booking['id']}")
        self.assertEqual(detail.status_code, 200, detail.json)
        with self.app.app_context():
            set_context(tenant_id=self.tenant_id, user_id=self.owner_id)
            room = db.session.get(PhysicalRoom, "room-a-101")
            self.assertEqual(room.room_type_id, "rt-a")
            db.session.rollback()

    def test_default_units_are_persisted_idempotently_without_reactivating_disabled_units(self):
        with self.app.app_context():
            set_context(tenant_id=self.tenant_id, user_id=self.owner_id)
            db.session.add_all(
                [
                    Master(
                        id="disabled-unit",
                        tenant_id=self.tenant_id,
                        catalog="units",
                        name=" cái ",
                        active=False,
                    ),
                    Master(
                        id="custom-unit",
                        tenant_id=self.tenant_id,
                        catalog="units",
                        name="Thùng",
                        active=True,
                    ),
                ]
            )
            db.session.flush()
            ensure_default_units(self.tenant_id)
            ensure_default_units(self.tenant_id)
            db.session.commit()
        snapshot = self.request("get", "/workspace")
        units = snapshot.json["masters"]["units"]
        self.assertEqual(len(units), len(DEFAULT_UNITS) + 1)
        disabled = next(u for u in units if u["id"] == "disabled-unit")
        self.assertFalse(disabled["active"])
        self.assertNotIn("Cái", [u["name"] for u in units])
        self.assertIn("Gói", [u["name"] for u in units])
        self.assertIn("Thùng", [u["name"] for u in units])
        service = self.request(
            "post", "/masters/services", json={"name": "Snack", "unit": "Gói", "price": "1"}
        )
        self.assertEqual(service.status_code, 201, service.json)
        self.assertEqual(service.json["unit"], "Gói")
        custom = self.request("post", "/masters/units", json={"name": "Cuộn"})
        self.assertEqual(custom.status_code, 201, custom.json)
        owner_b, headers_b = self.login("owner-b@test.local")
        other = self.request(
            "get",
            f"/api/tenants/{self.other_tenant_id}/workspace",
            client=owner_b,
            headers=headers_b,
        )
        self.assertEqual(other.json["masters"]["units"], [])

    def test_catalog_migration_adds_missing_units_and_refuses_losing_room_codes(self):
        with self.app.app_context():
            set_context(tenant_id=self.tenant_id, user_id=self.owner_id)
            db.session.add_all(
                [
                    Master(
                        id="disabled-unit",
                        tenant_id=self.tenant_id,
                        catalog="units",
                        name=" gói ",
                        active=False,
                    ),
                    Master(
                        id="custom-unit",
                        tenant_id=self.tenant_id,
                        catalog="units",
                        name="Thùng",
                        active=True,
                    ),
                ]
            )
            db.session.commit()
        runner = self.app.test_cli_runner()
        down = runner.invoke(args=["db", "downgrade", "0015_plan_room_limits"])
        self.assertEqual(down.exit_code, 0, down.output)
        upgraded = runner.invoke(args=["db", "upgrade"])
        self.assertEqual(upgraded.exit_code, 0, upgraded.output)
        snapshot = self.request("get", "/workspace")
        self.assertEqual(snapshot.status_code, 200, snapshot.json)
        units = snapshot.json["masters"]["units"]
        self.assertEqual(len(units), len(DEFAULT_UNITS) + 1)
        self.assertFalse(next(u for u in units if u["id"] == "disabled-unit")["active"])
        self.assertNotIn("Gói", [u["name"] for u in units])
        self.assertIn("Cái", [u["name"] for u in units])
        legacy = next(t for t in snapshot.json["masters"]["roomTypes"] if t["id"] == "rt-a")
        self.assertIsNone(legacy["code"])
        self.assertEqual(
            next(r for r in snapshot.json["rooms"] if r["id"] == "101")["typeId"], "rt-a"
        )
        again = runner.invoke(args=["db", "upgrade"])
        self.assertEqual(again.exit_code, 0, again.output)
        self.assertEqual(
            len(self.request("get", "/workspace").json["masters"]["units"]), len(units)
        )
        assigned = self.request("patch", "/masters/roomTypes", json={"id": "rt-a", "code": "2"})
        self.assertEqual(assigned.status_code, 200, assigned.json)
        refused = runner.invoke(args=["db", "downgrade", "0015_plan_room_limits"])
        self.assertNotEqual(refused.exit_code, 0)
        self.assertEqual(self.request("get", "/workspace").status_code, 200)

    def test_fund_type_is_validated_and_cannot_reclassify_existing_ledger(self):
        cash = self.request("post", "/masters/funds", json={"name": "Default cash"})
        self.assertEqual(cash.status_code, 201, cash.json)
        self.assertEqual(cash.json["type"], "cash")
        bank = self.request("post", "/masters/funds", json={"name": "Bank", "type": "bank"})
        self.assertEqual(bank.status_code, 201, bank.json)
        invalid = self.request("post", "/masters/funds", json={"name": "Bad", "type": "other"})
        self.assertEqual(invalid.status_code, 422, invalid.json)
        booking = self.make_booking()
        paid = self.request(
            "post",
            f"/reservations/{booking['id']}/payments",
            json={"amount": "20", "methodId": "cash-a", "fundId": "fund-a"},
            key="fund-history-proof",
        )
        self.assertEqual(paid.status_code, 201, paid.json)
        changed = self.request("patch", "/masters/funds", json={"id": "fund-a", "type": "bank"})
        self.assertEqual(changed.status_code, 409, changed.json)
        self.assertEqual(changed.json["error"]["code"], "FUND_HAS_HISTORY")
        renamed = self.request(
            "patch", "/masters/funds", json={"id": "fund-a", "name": "Renamed cash"}
        )
        self.assertEqual(renamed.status_code, 200, renamed.json)
        self.assertEqual(renamed.json["type"], "cash")

    def make_booking(self):
        result = self.request(
            "post",
            "/reservations",
            json={
                "guest": "Guest",
                "phone": "0900123456",
                "room": "101",
                "source": "Direct",
                "checkIn": "2026-11-01",
                "checkOut": "2026-11-03",
            },
        )
        self.assertEqual(result.status_code, 201, result.json)
        return result.json

    def test_occupied_rooms_cannot_be_removed_or_blocked_and_adjacent_stays_are_allowed(self):
        self.make_booking()
        blocked = self.request(
            "post",
            "/room-blocks",
            json={"room": "101", "start": "2026-11-02", "end": "2026-11-03", "reason": "Repair"},
        )
        self.assertEqual(blocked.status_code, 409, blocked.json)
        removed = self.request(
            "patch", "/masters/roomTypes", json={"id": "rt-a", "roomNumbers": ["102"]}
        )
        self.assertEqual(removed.status_code, 409, removed.json)
        occupied = self.request(
            "post",
            "/quote",
            json={"rooms": ["101"], "checkIn": "2026-11-02", "checkOut": "2026-11-03"},
        )
        self.assertEqual(occupied.status_code, 409)
        adjacent = self.request(
            "post",
            "/quote",
            json={"rooms": ["101"], "checkIn": "2026-11-03", "checkOut": "2026-11-04"},
        )
        self.assertEqual(adjacent.status_code, 200, adjacent.json)

    def test_rates_and_master_deactivation_preserve_booking_snapshot(self):
        booking = self.make_booking()
        changed = self.request(
            "put",
            "/rates",
            json={"roomTypeId": "rt-a", "start": "2026-11-01", "end": "2026-11-03", "price": "999"},
        )
        self.assertEqual(changed.status_code, 200)
        toggled = self.request("post", "/masters/bookingSources/direct-a/toggle")
        self.assertEqual(toggled.status_code, 200)
        detail = self.request("get", f"/reservations/{booking['id']}")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(Decimal(detail.json["total"]), Decimal("200"))
        self.assertEqual(detail.json["source"], "Direct")
        currency = self.request("patch", "/settings", json={"currency": "USD"})
        self.assertEqual(currency.status_code, 409)

    def test_composite_foreign_key_rejects_cross_tenant_room_type_even_for_runtime_sql(self):
        from sqlalchemy.exc import IntegrityError

        with self.app.app_context():
            set_context(tenant_id=self.tenant_id, user_id=self.owner_id)
            db.session.add(
                PhysicalRoom(
                    id="invalid-cross-reference",
                    tenant_id=self.tenant_id,
                    room_type_id="rt-b",
                    number="999",
                )
            )
            with self.assertRaises(IntegrityError) as caught:
                db.session.flush()
            self.assertEqual(caught.exception.orig.sqlstate, "23503")
            db.session.rollback()

    def test_nightly_quote_applies_overrides_and_half_open_checkout(self):
        saved = self.request(
            "put",
            "/rates",
            json={
                "roomTypeId": "rt-a",
                "start": "2026-11-01",
                "end": "2026-11-02",
                "price": "150.1250",
                "stopSell": False,
            },
        )
        self.assertEqual(saved.status_code, 200, saved.json)
        result = self.request(
            "post",
            "/quote",
            json={"rooms": ["101", "102"], "checkIn": "2026-11-01", "checkOut": "2026-11-03"},
        )
        self.assertEqual(result.status_code, 200, result.json)
        self.assertEqual(Decimal(result.json["total"]), Decimal("500.2500"))
        self.assertEqual(len(result.json["nightlyRates"]), 4)
        self.assertNotIn("2026-11-03", [row["date"] for row in result.json["nightlyRates"]])

    def test_stop_sell_and_room_block_change_real_availability(self):
        blocked = self.request(
            "post",
            "/room-blocks",
            json={"room": "101", "start": "2026-11-01", "end": "2026-11-03", "reason": "Repair"},
        )
        self.assertEqual(blocked.status_code, 201, blocked.json)
        availability = self.request("get", "/availability?start=2026-11-01&end=2026-11-03")
        self.assertEqual([row["available"] for row in availability.json["availability"]], [1, 1])
        quote = self.request(
            "post",
            "/quote",
            json={"rooms": ["101"], "checkIn": "2026-11-01", "checkOut": "2026-11-03"},
        )
        self.assertEqual(quote.status_code, 409)
        self.assertEqual(quote.json["error"]["code"], "ROOM_BLOCKED")
        self.assertEqual(
            self.request("delete", f"/room-blocks/{blocked.json['id']}").status_code, 200
        )
        saved = self.request(
            "put",
            "/rates",
            json={
                "roomTypeId": "rt-a",
                "start": "2026-11-01",
                "end": "2026-11-02",
                "stopSell": True,
            },
        )
        self.assertEqual(saved.status_code, 200)
        quote = self.request(
            "post",
            "/quote",
            json={"rooms": ["101"], "checkIn": "2026-11-01", "checkOut": "2026-11-02"},
        )
        self.assertEqual(quote.json["error"]["code"], "STOP_SELL")

    def test_removing_room_deactivates_instead_of_deleting(self):
        result = self.request(
            "patch",
            "/masters/roomTypes",
            json={"id": "rt-a", "name": "Standard", "roomNumbers": ["101"]},
        )
        self.assertEqual(result.status_code, 200, result.json)
        with self.app.app_context():
            set_context(tenant_id=self.tenant_id, user_id=self.owner_id)
            room = db.session.scalar(select(PhysicalRoom).where(PhysicalRoom.id == "room-a-102"))
            self.assertIsNotNone(room)
            self.assertFalse(room.active)
            db.session.rollback()

    def test_inventory_enforces_counts_under_transactional_locks(self):
        with self.app.app_context():
            set_context(tenant_id=self.tenant_id, user_id=self.owner_id)
            locked = lock_inventory(self.tenant_id, ["rt-a"], "2026-11-01", "2026-11-02")
            self.assertEqual(locked[("rt-a", date(2026, 11, 1))].total_rooms, 2)
            adjust_inventory(self.tenant_id, ["rt-a"], "2026-11-01", "2026-11-02", {"rt-a": 2})
            db.session.commit()
            set_context(tenant_id=self.tenant_id, user_id=self.owner_id)
            row = db.session.scalar(
                select(RoomTypeAvailability).where(RoomTypeAvailability.room_type_id == "rt-a")
            )
            self.assertEqual(row.booked_rooms, 2)
            from pms_api.security import ApiError

            with self.assertRaises(ApiError):
                adjust_inventory(self.tenant_id, ["rt-a"], "2026-11-01", "2026-11-02", 1)
            db.session.rollback()

    def test_tenant_and_role_permissions_cover_catalog_mutations(self):
        crossed = self.request(
            "put",
            "/rates",
            json={"roomTypeId": "rt-b", "start": "2026-11-01", "end": "2026-11-02", "price": "1"},
        )
        self.assertEqual(crossed.status_code, 404)
        client, headers = self.login("frontdesk@test.local")
        denied = self.request(
            "post",
            "/masters/services",
            json={"name": "X", "price": "1"},
            client=client,
            headers=headers,
        )
        self.assertEqual(denied.status_code, 403)
        with self.app.app_context():
            set_context(tenant_id=self.tenant_id, user_id=self.owner_id)
            self.assertEqual(len(list(db.session.scalars(select(PhysicalRoom)))), 2)
            db.session.rollback()
