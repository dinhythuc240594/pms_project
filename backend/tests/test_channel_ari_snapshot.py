"""ARI snapshots batch database reads without changing sellable room allocation."""

from datetime import date
from decimal import Decimal
from uuid import UUID

from flask import g
from sqlalchemy import event, select

from pms_api.bookings.models import ReservationRoom
from pms_api.catalog.models import DailyRate, PhysicalRoom, RoomBlock, RoomType
from pms_api.channels import service
from pms_api.channels.models import ChannelConnection, ChannelMapping
from pms_api.core_models import Tenant
from pms_api.extensions import db
from pms_api.security import set_context
from tests.test_channels_integration import ChannelTestCase

EXTRA_ROOM, EXTRA_RATE = (str(UUID(int=value)) for value in (21, 22))


class ChannelAriSnapshotTests(ChannelTestCase):
    def test_zero_daily_rate_is_rejected_before_any_ari_write(self):
        response = self.request(
            "put",
            "/rates",
            json={
                "roomTypeId": "rt-a",
                "start": "2030-01-01",
                "end": "2030-01-03",
                "price": "0",
                "stopSell": False,
            },
        )
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(self.run_jobs(), 1)
        job = self.jobs()[0]
        self.assertEqual((job["status"], job["errorCode"]), ("failed", "channel_rate_invalid"))
        self.provider.push_availability.assert_not_called()
        self.provider.push_restrictions.assert_not_called()

    def test_zero_base_rate_is_rejected_before_any_ari_write(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.get(RoomType, "rt-a").base_price = Decimal("0")
            db.session.commit()
        response = self.request(
            "post",
            "/channels/jobs",
            json={"kind": "push_ari", "start": "2030-01-01", "end": "2030-01-02"},
        )
        self.assertEqual(response.status_code, 202, response.json)
        self.assertEqual(self.run_jobs(), 1)
        job = self.jobs()[0]
        self.assertEqual((job["status"], job["errorCode"]), ("failed", "channel_rate_invalid"))
        self.provider.push_availability.assert_not_called()
        self.provider.push_restrictions.assert_not_called()

    def test_zero_stopped_rate_closes_sales_without_publishing_zero_price(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.add(
                DailyRate(
                    tenant_id=self.tenant_id,
                    room_type_id="rt-a",
                    date=date(2030, 1, 2),
                    price=Decimal("0"),
                    stop_sell=True,
                )
            )
            db.session.commit()
        response = self.request(
            "post",
            "/channels/jobs",
            json={"kind": "push_ari", "start": "2030-01-01", "end": "2030-01-03"},
        )
        self.assertEqual(response.status_code, 202, response.json)
        self.assertEqual(self.run_jobs(), 1)
        self.assertEqual(self.jobs()[0]["status"], "succeeded")
        availability = self.provider.push_availability.call_args.args[0]
        restrictions = self.provider.push_restrictions.call_args.args[0]
        self.assertEqual([row["availability"] for row in availability], [2, 0])
        self.assertEqual(restrictions[0]["rate"], "100.0000")
        self.assertFalse(restrictions[0]["stop_sell"])
        self.assertTrue(restrictions[1]["stop_sell"])
        self.assertNotIn("rate", restrictions[1])

    def catalog(self, resource, property_id):
        values = super().catalog(resource, property_id)
        if getattr(self, "extra_type", False):
            extra = {
                **values[0],
                "id": EXTRA_ROOM if resource == "room_types" else EXTRA_RATE,
                "relationships": {
                    "property": {"data": {"id": property_id}},
                    "room_type": {"data": {"id": EXTRA_ROOM}},
                },
            }
            values.append(extra)
        return values

    def snapshot(self, end="2030-02-01"):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            g.tenant = db.session.get(Tenant, self.tenant_id)
            connection = db.session.scalar(select(ChannelConnection))
            statements = []

            def record(_connection, _cursor, statement, _parameters, _context, _many):
                statements.append(statement)

            event.listen(db.engine, "before_cursor_execute", record)
            try:
                result = service.ari_snapshot(
                    self.tenant_id,
                    connection,
                    self.provider,
                    {"start": "2030-01-01", "end": end},
                )
            finally:
                event.remove(db.engine, "before_cursor_execute", record)
            self.assertLessEqual(len(statements), 6, "ARI queries must not grow per day or type")
            return result

    def test_query_budget_is_constant_for_days_and_room_types(self):
        availability, _ = self.snapshot()
        self.assertEqual(len(availability), 31)
        self.assertEqual({row["availability"] for row in availability}, {2})
        self.assertEqual(len(self.snapshot("2030-01-02")[0]), 1)

        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.add(
                RoomType(id="rt-extra", tenant_id=self.tenant_id, name="Extra", base_price=200)
            )
            db.session.flush()
            db.session.add_all(
                [
                    PhysicalRoom(
                        tenant_id=self.tenant_id,
                        room_type_id="rt-extra",
                        number="201",
                    ),
                    ChannelMapping(
                        tenant_id=self.tenant_id,
                        room_type_id="rt-extra",
                        remote_room_type_id=EXTRA_ROOM,
                        remote_rate_plan_id=EXTRA_RATE,
                    ),
                ]
            )
            db.session.commit()
        self.extra_type = True
        availability, restrictions = self.snapshot()
        self.assertEqual(len(availability), 62)
        self.assertEqual(
            {row["availability"] for row in availability if row["room_type_id"] == EXTRA_ROOM},
            {1},
        )
        self.assertEqual(
            {row["rate"] for row in restrictions if row["rate_plan_id"] == EXTRA_RATE},
            {"200.0000"},
        )

    def test_batched_inventory_keeps_current_stays_blocks_rates_and_pauses(self):
        bookings = []
        for start, end in (("2030-01-01", "2030-01-04"), ("2030-01-05", "2030-01-06")):
            response = self.request(
                "post",
                "/reservations",
                json={
                    "guest": "Snapshot guest",
                    "rooms": ["101"],
                    "checkIn": start,
                    "checkOut": end,
                    "source": "Direct",
                },
            )
            self.assertEqual(response.status_code, 201, response.json)
            bookings.append(response.json["id"])

        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            stays = {row.reservation_id: row for row in db.session.scalars(select(ReservationRoom))}
            # A room move can leave nightly history before its current allocation.
            stays[bookings[0]].check_in = date(2030, 1, 2)
            stays[bookings[1]].active = False
            db.session.add_all(
                [
                    PhysicalRoom(
                        tenant_id=self.tenant_id,
                        room_type_id="rt-a",
                        number="103",
                        condition="maintenance",
                    ),
                    PhysicalRoom(
                        tenant_id=self.tenant_id,
                        room_type_id="rt-a",
                        number="104",
                        active=False,
                    ),
                    *[
                        RoomBlock(
                            tenant_id=self.tenant_id,
                            room_id="room-a-102",
                            start_date=date(2030, 1, 3),
                            end_date=date(2030, 1, end),
                            reason="Repair",
                        )
                        for end in (4, 5)
                    ],
                    *[
                        DailyRate(
                            tenant_id=self.tenant_id,
                            room_type_id="rt-a",
                            date=date(2030, 1, day),
                            price=Decimal(price),
                            stop_sell=stop_sell,
                        )
                        for day, price, stop_sell in ((3, "150", False), (6, "175", True))
                    ],
                ]
            )
            db.session.commit()

        availability, restrictions = self.snapshot("2030-01-08")
        self.assertEqual([row["availability"] for row in availability], [2, 1, 0, 1, 2, 0, 2])
        self.assertEqual(
            [row["rate"] for row in restrictions],
            ["100.0000", "100.0000", "150.0000", "100.0000", "100.0000", "175.0000", "100.0000"],
        )
        self.assertEqual(
            [row["stop_sell"] for row in restrictions],
            [False, False, False, False, False, True, False],
        )
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.scalar(select(ChannelMapping)).pause_requested = True
            db.session.commit()
        availability, restrictions = self.snapshot("2030-01-08")
        self.assertEqual({row["availability"] for row in availability}, {0})
        self.assertTrue(all(row["stop_sell"] for row in restrictions))
