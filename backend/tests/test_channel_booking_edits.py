"""Physical room moves must not turn an OTA contract into a local price quote."""

from copy import deepcopy

from sqlalchemy import select

from pms_api.bookings.models import Reservation
from pms_api.catalog.models import PhysicalRoom, RoomType
from pms_api.extensions import db
from pms_api.security import set_context
from tests.test_channels_integration import ChannelTestCase, revision


class ChannelBookingEditTests(ChannelTestCase):
    def detail(self, booking_id):
        return self.request("get", f"/reservations/{booking_id}").json

    def test_same_type_move_keeps_provider_nights_currency_and_snapshot(self):
        self.assertEqual(
            self.request(
                "put", "/pricing/exchange-rates", {"currency": "USD", "rate": "25000"}
            ).status_code,
            200,
        )
        entity = revision(amount="270")
        entity["attributes"]["currency"] = "USD"
        entity["attributes"]["rooms"][0]["days"] = {"2030-01-01": "110", "2030-01-02": "160"}
        booking_id = self.import_booking(entity)[0]["id"]
        before = self.detail(booking_id)
        self.request("put", "/pricing/exchange-rates", {"currency": "USD", "rate": "30000"})
        moved = self.request("patch", f"/reservations/{booking_id}", {"rooms": ["102"]})
        self.assertEqual(moved.status_code, 200, moved.json)
        after = moved.json
        for field in (
            "total",
            "currency",
            "baseAmount",
            "baseCurrency",
            "exchangeRate",
            "pricingSnapshot",
        ):
            self.assertEqual(after[field], before[field], field)
        self.assertEqual(
            sorted(
                (n["date"], n["price"], n["baseAmount"], n["exchangeRate"])
                for n in after["nightlyRates"]
            ),
            sorted(
                (n["date"], n["price"], n["baseAmount"], n["exchangeRate"])
                for n in before["nightlyRates"]
            ),
        )
        self.assertEqual({n["room"] for n in after["nightlyRates"]}, {"102"})
        self.assertEqual(after["version"], before["version"] + 1)

    def test_legacy_link_blocks_date_type_and_room_count_changes(self):
        booking_id = self.import_booking()[0]["id"]
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            row = db.session.get(Reservation, booking_id)
            row.pricing_snapshot = {k: v for k, v in row.pricing_snapshot.items() if k != "channel"}
            db.session.add(
                RoomType(
                    id="deluxe-a",
                    tenant_id=self.tenant_id,
                    name="Deluxe",
                    base_price=500,
                    capacity=2,
                )
            )
            db.session.flush()
            db.session.add(
                PhysicalRoom(
                    id="deluxe-room",
                    tenant_id=self.tenant_id,
                    room_type_id="deluxe-a",
                    number="201",
                )
            )
            db.session.commit()
        before = self.detail(booking_id)
        for changes in (
            {"checkOut": "2030-01-04"},
            {"rooms": ["201"]},
            {"rooms": ["101", "102"]},
        ):
            with self.subTest(changes=changes):
                response = self.request("patch", f"/reservations/{booking_id}", changes)
                self.assertEqual(response.status_code, 409, response.json)
                self.assertEqual(response.json["error"]["code"], "channel_booking_requires_review")
                self.assertEqual(self.detail(booking_id), before)

    def test_source_change_is_rejected_but_primary_contact_edit_keeps_ota_origin(self):
        source = self.request(
            "post",
            "/masters/bookingSources",
            {"name": "BookingCom", "type": "OTA", "commission": "15"},
        )
        self.assertEqual(source.status_code, 201, source.json)
        booking_id = self.import_booking()[0]["id"]
        before = self.detail(booking_id)
        response = self.request("patch", f"/reservations/{booking_id}", {"source": "Direct"})
        self.assertEqual(response.status_code, 409, response.json)
        self.assertEqual(response.json["error"]["code"], "channel_booking_requires_review")
        self.assertEqual(self.detail(booking_id), before)
        edited = self.request(
            "patch",
            f"/reservations/{booking_id}",
            {"guest": "Updated guest", "phone": "0901234567"},
        )
        self.assertEqual(edited.status_code, 200, edited.json)
        self.assertEqual(edited.json["pricingSnapshot"], before["pricingSnapshot"])
        self.assertEqual(edited.json["total"], before["total"])

    def test_multi_room_move_keeps_unchanged_room_own_prices(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.add(
                PhysicalRoom(
                    id="room-a-103", tenant_id=self.tenant_id, room_type_id="rt-a", number="103"
                )
            )
            db.session.commit()
        entity = revision(amount="600")
        second = deepcopy(entity["attributes"]["rooms"][0])
        entity["attributes"]["rooms"][0]["amount"] = "200"
        second["amount"] = "400"
        second["days"] = {"2030-01-01": "150", "2030-01-02": "250"}
        entity["attributes"]["rooms"].append(second)
        booking_id = self.import_booking(entity)[0]["id"]
        before = self.detail(booking_id)
        response = self.request("patch", f"/reservations/{booking_id}", {"rooms": ["102", "103"]})
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json["total"], before["total"])
        self.assertEqual(response.json["pricingSnapshot"], before["pricingSnapshot"])
        original = {(n["room"], n["date"]): n["price"] for n in before["nightlyRates"]}
        for night in response.json["nightlyRates"]:
            previous_room = "101" if night["room"] == "103" else night["room"]
            self.assertEqual(night["price"], original[(previous_room, night["date"])])

    def test_move_still_rejects_maintenance_room_without_changing_booking(self):
        booking_id = self.import_booking()[0]["id"]
        before = self.detail(booking_id)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            room = db.session.scalar(select(PhysicalRoom).where(PhysicalRoom.id == "room-a-102"))
            room.condition = "maintenance"
            db.session.commit()
        response = self.request("patch", f"/reservations/{booking_id}", {"rooms": ["102"]})
        self.assertEqual(response.status_code, 409, response.json)
        self.assertEqual(self.detail(booking_id), before)
