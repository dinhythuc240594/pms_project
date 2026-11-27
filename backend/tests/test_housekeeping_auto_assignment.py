"""Automatic scheduling preserves work state and balances daily and cross-day loads."""

import unittest
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import patch

from pms_api.housekeeping.service import assign_day_plan, generate_day_plan


class AutomaticAssignmentTests(unittest.TestCase):
    day = date(2026, 10, 17)

    def task(self, key, **changes):
        return SimpleNamespace(
            **{
                "id": key,
                "room_id": "room",
                "room_revision": 3,
                "staff_id": None,
                "shift_id": None,
                "status": "pending",
                "revision": 1,
                **changes,
            }
        )

    def rooms(self):
        return {"room": SimpleNamespace(housekeeping_revision=3, condition="dirty")}

    @patch("pms_api.housekeeping.service.work_log")
    @patch("pms_api.housekeeping.service.db")
    def test_balances_against_existing_daily_work_and_keeps_existing_assignments(
        self, database, log
    ):
        existing = [self.task("old-1", staff_id="a"), self.task("old-2", staff_id="a")]
        new = [self.task(str(i)) for i in range(3)]
        database.session.scalars.side_effect = [
            existing + new,
            [SimpleNamespace(id="early", staff_id="b"), SimpleNamespace(id="late", staff_id="b")],
        ]
        assigned = assign_day_plan("hotel", self.day, self.rooms(), ["a", "b"], {"a": 0, "b": 0})
        self.assertEqual(assigned, 3)
        self.assertEqual([row.staff_id for row in new], ["b", "b", "a"])
        self.assertEqual([row.shift_id for row in new], ["early", "early", None])
        self.assertTrue(all(row.revision == 1 for row in existing))
        self.assertTrue(all(row.revision == 2 for row in new))
        self.assertEqual(log.call_count, 3)
        self.assertTrue(all(call.kwargs["details"]["automatic"] for call in log.call_args_list))

    @patch("pms_api.housekeeping.service.work_log")
    @patch("pms_api.housekeeping.service.db")
    def test_never_changes_started_closed_stale_or_unavailable_room_work(self, database, log):
        protected = [
            self.task("started", status="in_progress"),
            self.task("inspection", status="inspection"),
            self.task("done", status="completed"),
            self.task("cancelled", status="cancelled"),
            self.task("stale", room_revision=2),
            self.task("missing", room_id="missing"),
            self.task("maintenance", room_id="maintenance"),
            self.task("room-inspection", room_id="inspection"),
            self.task("already-assigned", staff_id="outside-selection", shift_id="keep"),
        ]
        rooms = {
            **self.rooms(),
            "maintenance": SimpleNamespace(housekeeping_revision=3, condition="maintenance"),
            "inspection": SimpleNamespace(housekeeping_revision=3, condition="inspection"),
        }
        database.session.scalars.side_effect = [protected, []]
        self.assertEqual(assign_day_plan("hotel", self.day, rooms, ["a"], {"a": 0}), 0)
        self.assertTrue(all(row.revision == 1 for row in protected))
        self.assertEqual(protected[-1].shift_id, "keep")
        log.assert_not_called()

    @patch("pms_api.housekeeping.service.work_log")
    @patch("pms_api.housekeeping.service.db")
    def test_rotates_daily_ties_across_dates_and_retry_does_not_reassign(self, database, log):
        first, second = self.task("first"), self.task("second")
        database.session.scalars.side_effect = [[first], [], [second], [], [first], []]
        totals = {"a": 0, "b": 0}
        assign_day_plan("hotel", self.day, self.rooms(), ["a", "b"], totals)
        assign_day_plan("hotel", self.day + timedelta(days=1), self.rooms(), ["a", "b"], totals)
        self.assertEqual((first.staff_id, second.staff_id), ("a", "b"))
        self.assertEqual(assign_day_plan("hotel", self.day, self.rooms(), ["b"], {"b": 0}), 0)
        self.assertEqual(first.staff_id, "a")
        self.assertEqual(log.call_count, 2)

    @patch("pms_api.housekeeping.service.db")
    def test_legacy_generation_without_staff_does_not_run_assignment_queries(self, database):
        self.assertEqual(assign_day_plan("hotel", self.day, {}, [], {}), 0)
        database.session.scalars.assert_not_called()

    @patch("pms_api.housekeeping.service.work_log")
    @patch("pms_api.housekeeping.service.db")
    def test_explicit_later_or_no_shift_is_respected_without_assigning_other_rooms(
        self, database, log
    ):
        for selection in ("late", None):
            with self.subTest(selection=selection):
                task, outside = self.task("selected"), self.task("outside", room_id="outside")
                database.session.scalars.side_effect = [
                    [task, outside],
                    [
                        SimpleNamespace(id="early", staff_id="a"),
                        SimpleNamespace(id="late", staff_id="a"),
                    ],
                ]
                self.assertEqual(
                    assign_day_plan(
                        "hotel",
                        self.day,
                        self.rooms(),
                        ["a"],
                        {"a": 0},
                        shift_choices={"a": selection},
                    ),
                    1,
                )
                self.assertEqual(task.shift_id, selection)
                self.assertIsNone(outside.staff_id)
                self.assertEqual(outside.revision, 1)

    @patch("pms_api.housekeeping.service.work_log")
    @patch("pms_api.housekeeping.service.add_task")
    @patch("pms_api.housekeeping.service.db")
    def test_selected_clean_rooms_get_work_without_bookings_and_retry_preserves_existing_tasks(
        self, database, add, log
    ):
        rooms = [
            SimpleNamespace(id=key, condition="clean", housekeeping_revision=3)
            for key in ("a", "b")
        ]
        first = SimpleNamespace(room_id="a", room_revision=3)
        second = SimpleNamespace(room_id="b", room_revision=3)
        database.session.execute.return_value.all.return_value = []
        database.session.scalars.side_effect = [
            rooms,
            [first],
            [],
            [first],
            rooms,
            [first, second],
            [],
            [first, second],
        ]
        add.return_value = (None, True)
        created, room_map = generate_day_plan("hotel", self.day, room_ids=["a", "b"])
        self.assertEqual(created, 1)
        self.assertEqual(set(room_map), {"a", "b"})
        add.assert_called_once_with(rooms[1], self.day, "dirty", f"selected:{self.day}:b:3")
        self.assertEqual(generate_day_plan("hotel", self.day, room_ids=["a", "b"])[0], 0)
        self.assertEqual(add.call_count, 1)
        statement = database.session.scalars.call_args_list[0].args[0]
        self.assertIn(["a", "b"], statement.compile().params.values())
