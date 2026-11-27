"""Historical room nights and current inventory allocations have distinct ranges."""

import unittest
from datetime import date
from types import SimpleNamespace

from pms_api.bookings.room_stays import inventory_adjustments, room_stays


class RoomStayTests(unittest.TestCase):
    def test_nightly_history_keeps_room_moves_and_return_visits_separate(self):
        nights = [
            SimpleNamespace(room_number=room, date=date(2026, 10, day))
            for room, day in (
                ("101", 18),
                ("102", 19),
                ("101", 20),
                ("101", 21),
            )
        ]
        self.assertEqual(
            room_stays(nights),
            [
                {"room": "101", "start": "2026-10-18", "end": "2026-10-19"},
                {"room": "101", "start": "2026-10-20", "end": "2026-10-22"},
                {"room": "102", "start": "2026-10-19", "end": "2026-10-20"},
            ],
        )

    def test_checkout_releases_only_each_current_allocation(self):
        rooms = [
            SimpleNamespace(
                room_type_id="a", check_in=date(2026, 10, 18), check_out=date(2026, 10, 22)
            ),
            SimpleNamespace(
                room_type_id="b", check_in=date(2026, 10, 20), check_out=date(2026, 10, 22)
            ),
        ]
        self.assertEqual(
            inventory_adjustments(rooms, date(2026, 10, 18), date(2026, 10, 22), -1),
            [
                (date(2026, 10, 18), date(2026, 10, 22), {"a": -1}),
                (date(2026, 10, 20), date(2026, 10, 22), {"b": -1}),
            ],
        )

    def test_new_physical_rooms_use_requested_range_and_group_by_type(self):
        rooms = [SimpleNamespace(room_type_id="a"), SimpleNamespace(room_type_id="a")]
        self.assertEqual(
            inventory_adjustments(rooms, date(2026, 10, 18), date(2026, 10, 22), 1),
            [
                (date(2026, 10, 18), date(2026, 10, 22), {"a": 2}),
            ],
        )
