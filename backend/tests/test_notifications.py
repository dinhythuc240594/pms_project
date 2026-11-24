"""Notification delivery shares the business transaction and respects the recipient."""

from datetime import date, timedelta
from urllib.parse import quote

from sqlalchemy import select, text

from pms_api.extensions import db
from pms_api.notifications import Notification, emit_audit
from pms_api.security import audit, set_context
from tests.domain_fixture import DomainTestCase


class NotificationTests(DomainTestCase):
    def test_new_clean_room_does_not_emit_a_completed_cleaning_notification(self):
        result = self.request("post", "/masters/rooms", {"number": "103", "typeId": "rt-a"})
        self.assertEqual(result.status_code, 201, result.json)
        self.assertEqual(result.json["condition"], "clean")
        desk, headers = self.login("frontdesk@test.local")
        self.assertEqual(self.inbox(client=desk, headers=headers)["items"], [])

    def test_saving_same_room_condition_does_not_emit_another_notification(self):
        for _ in range(2):
            result = self.request("post", "/rooms/101/condition", {"condition": "maintenance"})
            self.assertEqual(result.status_code, 200, result.json)
        self.assertEqual(
            [item["eventCode"] for item in self.inbox()["items"]], ["ROOM_MAINTENANCE"]
        )

    def test_settings_room_condition_uses_same_notification_events(self):
        for _ in range(2):
            result = self.request(
                "patch", "/masters/rooms", {"id": "101", "condition": "maintenance"}
            )
            self.assertEqual(result.status_code, 200, result.json)
        self.assertEqual(
            [item["eventCode"] for item in self.inbox()["items"]], ["ROOM_MAINTENANCE"]
        )

    def test_downgrade_refuses_to_discard_notification_history(self):
        self.make_booking()
        result = self.app.test_cli_runner().invoke(args=["db", "downgrade", "0010_channels"])
        self.assertNotEqual(result.exit_code, 0)
        self.assertEqual(self.inbox()["unreadCount"], 1)

    def make_booking(self):
        start = date.today()
        result = self.request(
            "post",
            "/reservations",
            {
                "guest": "Notification guest",
                "room": "101",
                "sourceId": "direct-a",
                "checkIn": start.isoformat(),
                "checkOut": (start + timedelta(days=1)).isoformat(),
            },
        )
        self.assertEqual(result.status_code, 201, result.json)
        return result.json

    def inbox(self, **options):
        return self.request("get", "/notifications", **options).json

    def test_committed_booking_delivers_once_to_default_roles(self):
        booking = self.make_booking()
        owner = self.inbox()
        self.assertEqual(owner["unreadCount"], 1)
        self.assertEqual(owner["items"][0]["eventCode"], "NEW_BOOKING")
        self.assertEqual(owner["items"][0]["entityId"], booking["id"])
        self.assertEqual(owner["items"][0]["title"], "i18n:notifications.events.NEW_BOOKING")
        self.assertEqual(
            owner["items"][0]["body"],
            {
                "$i18n": "notifications.eventBodies.NEW_BOOKING",
                "values": {"entityId": booking["id"]},
            },
        )
        desk, headers = self.login("frontdesk@test.local")
        self.assertEqual(self.inbox(client=desk, headers=headers)["unreadCount"], 1)
        hk, headers = self.login("hk@test.local")
        self.assertEqual(self.inbox(client=hk, headers=headers)["unreadCount"], 0)

    def test_failed_booking_and_rolled_back_audit_leave_no_notifications(self):
        with self.app.test_request_context():
            from flask import g

            from pms_api.core_models import Tenant, User

            set_context(self.owner_id, self.tenant_id)
            g.tenant = db.session.get(Tenant, self.tenant_id)
            g.user = db.session.get(User, self.owner_id)
            audit("reservation.created", "reservation", "rolled-back")
            db.session.flush()
            db.session.rollback()
        self.assertEqual(self.inbox()["unreadCount"], 0)
        result = self.request("post", "/reservations", {"guest": "No room"})
        self.assertGreaterEqual(result.status_code, 400)
        self.assertEqual(self.inbox()["unreadCount"], 0)

    def test_role_preferences_apply_to_future_events_and_owner_controls_them(self):
        settings = {"events": [{"code": "NEW_BOOKING", "roles": ["ACCOUNTANT"]}]}
        result = self.request("patch", "/notifications/preferences", settings)
        self.assertEqual(result.status_code, 200, result.json)
        desk, headers = self.login("frontdesk@test.local")
        denied = self.request(
            "patch", "/notifications/preferences", settings, client=desk, headers=headers
        )
        self.assertEqual(denied.status_code, 403)
        self.make_booking()
        self.assertEqual(self.inbox()["unreadCount"], 0)
        accountant, headers = self.login("accountant@test.local")
        self.assertEqual(self.inbox(client=accountant, headers=headers)["unreadCount"], 1)

    def test_read_is_idempotent_and_cannot_mark_another_users_notification(self):
        self.make_booking()
        item = self.inbox()["items"][0]
        desk, headers = self.login("frontdesk@test.local")
        denied = self.request(
            "post", f"/notifications/{item['id']}/read", {}, client=desk, headers=headers
        )
        self.assertEqual(denied.status_code, 404)
        first = self.request("post", f"/notifications/{item['id']}/read", {})
        second = self.request("post", f"/notifications/{item['id']}/read", {})
        self.assertEqual(first.status_code, 200, first.json)
        self.assertEqual(first.json["readAt"], second.json["readAt"])
        self.assertEqual(self.inbox()["unreadCount"], 0)
        self.assertEqual(self.request("post", "/notifications/read-all", {}).json["updated"], 0)

    def test_tenant_and_recipient_rls_protect_inbox_even_without_route_filters(self):
        self.make_booking()
        with self.app.app_context():
            set_context("hk", self.tenant_id)
            self.assertEqual(list(db.session.scalars(select(Notification))), [])
            set_context("owner-b", self.other_tenant_id)
            self.assertEqual(list(db.session.scalars(select(Notification))), [])
            db.session.rollback()

    def test_repeated_event_delivery_and_cursor_do_not_duplicate_or_skip_rows(self):
        with self.app.test_request_context():
            from flask import g

            from pms_api.core_models import Tenant, User

            set_context(self.owner_id, self.tenant_id)
            g.tenant = db.session.get(Tenant, self.tenant_id)
            g.user = db.session.get(User, self.owner_id)
            entry = audit("reservation.created", "reservation", "one")
            emit_audit(entry)
            audit("reservation.created", "reservation", "two")
            db.session.flush()
            db.session.execute(text("UPDATE notifications SET created_at = '2026-10-07T00:00:00Z'"))
            db.session.commit()
        first = self.request("get", "/notifications?limit=1").json
        second = self.request(
            "get", f"/notifications?limit=1&before={quote(first['nextBefore'])}"
        ).json
        self.assertEqual(first["unreadCount"], 2)
        self.assertEqual(len(second["items"]), 1)
        self.assertNotEqual(first["items"][0]["id"], second["items"][0]["id"])
        self.assertIsNone(second["nextBefore"])

    def test_lifecycle_and_payment_replay_emit_actual_events_once(self):
        booking = self.make_booking()
        path = f"/reservations/{booking['id']}"
        self.assertEqual(
            self.request("post", path + "/status", {"status": "IN_HOUSE"}).status_code, 200
        )
        payment = {"amount": "100", "methodId": "cash-a", "fundId": "fund-a"}
        for _ in range(2):
            self.assertEqual(
                self.request(
                    "post", path + "/payments", payment, key="notification-payment"
                ).status_code,
                201,
            )
        self.assertEqual(
            self.request("post", path + "/status", {"status": "CHECKED_OUT"}).status_code, 200
        )
        self.assertCountEqual(
            [row["eventCode"] for row in self.inbox()["items"]],
            ["NEW_BOOKING", "CHECKIN_DONE", "PAYMENT_RECEIVED", "CHECKOUT_DONE"],
        )

    def test_invalid_roles_events_and_pagination_are_rejected(self):
        for events in (
            [{"code": "NEW_BOOKING", "roles": ["SUPER_ADMIN"]}],
            [{"code": "UNKNOWN", "roles": ["HOTEL_OWNER"]}],
            [{"code": "NEW_BOOKING", "roles": [], "email": True}],
        ):
            self.assertEqual(
                self.request("patch", "/notifications/preferences", {"events": events}).status_code,
                422,
            )
        for query in ("limit=-1", "limit=200", "limit=" + "9" * 5000, "before=bad", "unread=no"):
            self.assertEqual(self.request("get", "/notifications?" + query).status_code, 422)
