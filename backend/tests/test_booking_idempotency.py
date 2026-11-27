"""Committed booking intents survive lost responses and retries across sessions."""

import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from unittest.mock import patch

from sqlalchemy import func, select

from pms_api.bookings import routes
from pms_api.bookings.models import (
    BookingNote,
    Guest,
    IdempotencyRecord,
    LedgerEntry,
    Payment,
    Reservation,
)
from pms_api.catalog.models import RoomTypeAvailability
from pms_api.core_models import AuditLog
from pms_api.extensions import db
from pms_api.security import ApiError, set_context
from tests.domain_fixture import DomainTestCase


class BookingIdempotencyTests(DomainTestCase):
    def booking_data(self, **changes):
        today = date.today()
        return {
            "guest": "Retry guest",
            "room": "101",
            "sourceId": "direct-a",
            "checkIn": str(today),
            "checkOut": str(today + timedelta(days=2)),
            **changes,
        }

    def create(self, data=None, key="create-booking-intent", **kwargs):
        return self.request("POST", "/reservations", data or self.booking_data(), key=key, **kwargs)

    def count(self, model):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            return db.session.scalar(
                select(func.count()).select_from(model).where(model.tenant_id == self.tenant_id)
            )

    def raw(self, method, path, data, key=None):
        headers = dict(self.headers)
        if key is not None:
            headers["Idempotency-Key"] = key
        return self.client.open(
            f"/api/tenants/{self.tenant_id}{path}", method=method, json=data, headers=headers
        )

    def test_create_requires_stable_valid_key_without_creating_any_data(self):
        for key in (None, "", "short", "space key", "a" * 129):
            with self.subTest(key=key):
                result = self.raw("POST", "/reservations", self.booking_data(), key)
                self.assertEqual(result.status_code, 422, result.json)
                self.assertEqual(result.json["error"]["code"], "idempotency_required")
        for model in (Reservation, Guest, IdempotencyRecord):
            self.assertEqual(self.count(model), 0)

    def test_create_retry_after_reload_replays_original_id_and_response(self):
        data = self.booking_data()
        first = self.create(data)
        self.assertEqual(first.status_code, 201, first.json)
        # The booking has moved on and still occupies the requested room. Replay
        # must precede overlap checks and return the original committed snapshot.
        changed = self.request(
            "PATCH",
            f"/reservations/{first.json['id']}",
            {"guests": [{**first.json["guests"][0], "phone": "0911111111"}]},
        )
        self.assertEqual(changed.status_code, 200, changed.json)
        client, headers = self.login()
        replay = self.create(data, client=client, headers=headers)
        self.assertEqual(replay.status_code, 201, replay.json)
        self.assertEqual(replay.json, first.json)
        self.assertEqual(self.count(Reservation), 1)
        self.assertEqual(self.count(Guest), 1)
        self.assertEqual(self.count(IdempotencyRecord), 1)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(
                db.session.scalar(select(func.sum(RoomTypeAvailability.booked_rooms))), 2
            )
            self.assertEqual(
                db.session.scalar(
                    select(func.count())
                    .select_from(AuditLog)
                    .where(
                        AuditLog.tenant_id == self.tenant_id,
                        AuditLog.event == "reservation.created",
                    )
                ),
                1,
            )

    def test_concurrent_duplicate_creates_replay_one_booking(self):
        data = self.booking_data()
        clients = [self.login(), self.login()]
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(
                pool.map(lambda pair: self.create(data, client=pair[0], headers=pair[1]), clients)
            )
        self.assertEqual([result.status_code for result in results], [201, 201])
        self.assertEqual(results[0].json, results[1].json)
        self.assertEqual(self.count(Reservation), 1)
        self.assertEqual(self.count(IdempotencyRecord), 1)

    def test_key_conflicts_for_changed_payload_actor_or_endpoint(self):
        first = self.create()
        self.assertEqual(first.status_code, 201, first.json)
        changed = self.create(self.booking_data(room="102"))
        client, headers = self.login("frontdesk@test.local")
        other_actor = self.create(client=client, headers=headers)
        other_endpoint = self.request(
            "POST",
            f"/reservations/{first.json['id']}/payments",
            {"amount": "20", "methodId": "cash-a", "fundId": "fund-a"},
            key="create-booking-intent",
        )
        for result in (changed, other_actor, other_endpoint):
            self.assertEqual(result.status_code, 409, result.json)
            self.assertEqual(result.json["error"]["code"], "idempotency_conflict")
        self.assertEqual(self.count(Reservation), 1)
        self.assertEqual(self.count(Payment), 0)

    def test_same_key_is_independent_between_tenants(self):
        first = self.create()
        client, headers = self.login("owner-b@test.local")
        second = self.request(
            "POST",
            f"/api/tenants/{self.other_tenant_id}/reservations",
            self.booking_data(sourceId="direct-b"),
            client=client,
            headers=headers,
            key="create-booking-intent",
        )
        self.assertEqual(first.status_code, 201, first.json)
        self.assertEqual(second.status_code, 201, second.json)
        self.assertNotEqual(first.json["id"], second.json["id"])
        self.assertEqual(self.count(Reservation), 1)
        replay = self.create()
        self.assertEqual(replay.json, first.json)

    def test_failed_transaction_rolls_back_booking_and_intent_together(self):
        finish_write = routes.finish_write

        def fail_after_record(*args, **kwargs):
            finish_write(*args, **kwargs)
            raise ApiError(503, "test_unavailable", "Retry this transaction")

        with patch.object(routes, "finish_write", side_effect=fail_after_record):
            failed = self.create()
        self.assertEqual(failed.status_code, 503, failed.json)
        for model in (Reservation, Guest, IdempotencyRecord):
            self.assertEqual(self.count(model), 0)
        saved = self.create()
        self.assertEqual(saved.status_code, 201, saved.json)
        self.assertEqual(self.count(Reservation), 1)
        self.assertEqual(self.count(IdempotencyRecord), 1)

    def test_keyed_edit_and_status_replay_before_stale_version_checks(self):
        row = self.create().json
        path = f"/reservations/{row['id']}"
        edit = {"phone": "0911111111", "expectedVersion": row["version"]}
        saved = self.raw("PATCH", path, edit, "edit-booking-intent")
        replay = self.raw("PATCH", path, edit, "edit-booking-intent")
        self.assertEqual(saved.status_code, 200, saved.json)
        self.assertEqual(replay.status_code, 200, replay.json)
        self.assertEqual(replay.json, saved.json)
        status = {"status": "CANCELLED", "expectedVersion": saved.json["version"]}
        cancelled = self.raw("POST", path + "/status", status, "cancel-booking-intent")
        again = self.raw("POST", path + "/status", status, "cancel-booking-intent")
        self.assertEqual(cancelled.status_code, 200, cancelled.json)
        self.assertEqual(again.status_code, 200, again.json)
        self.assertEqual(again.json, cancelled.json)
        self.assertEqual(self.request("GET", path).json, cancelled.json)

    def test_duplicate_note_and_payment_from_new_session_do_not_append_twice(self):
        row = self.create().json
        path = f"/reservations/{row['id']}"
        note = {"text": "Keep the same intent after reload"}
        payment = {"amount": "20", "methodId": "cash-a", "fundId": "fund-a"}
        saved_note = self.request("POST", path + "/notes", note, key="note-reload-intent")
        saved_payment = self.request(
            "POST", path + "/payments", payment, key="payment-reload-intent"
        )
        client, headers = self.login()
        for suffix, data, key, saved in (
            ("/notes", note, "note-reload-intent", saved_note),
            ("/payments", payment, "payment-reload-intent", saved_payment),
        ):
            replay = self.request(
                "POST", path + suffix, data, key=key, client=client, headers=headers
            )
            self.assertEqual(saved.status_code, 201, saved.json)
            self.assertEqual(replay.status_code, 201, replay.json)
            self.assertEqual(replay.json, saved.json)
        self.assertEqual(self.count(BookingNote), 1)
        self.assertEqual(self.count(Payment), 1)
        self.assertEqual(self.count(LedgerEntry), 1)

    def test_legacy_money_fingerprint_still_replays_without_another_payment(self):
        row = self.create().json
        path = f"/reservations/{row['id']}/payments"
        data = {"amount": "20", "methodId": "cash-a", "fundId": "fund-a"}
        saved = self.request("POST", path, data, key="current-money-intent")
        self.assertEqual(saved.status_code, 201, saved.json)
        identity = {
            "path": f"/api/tenants/{self.tenant_id}{path}",
            "actor": self.owner_id,
            "body": data,
        }
        fingerprint = hashlib.sha256(
            json.dumps(
                identity, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
            ).encode()
        ).hexdigest()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.add(
                IdempotencyRecord(
                    tenant_id=self.tenant_id,
                    key="legacy-money-intent",
                    fingerprint=fingerprint,
                    response=saved.json,
                )
            )
            db.session.commit()
        replay = self.request("POST", path, data, key="legacy-money-intent")
        self.assertEqual(replay.status_code, 201, replay.json)
        self.assertEqual(replay.json, saved.json)
        self.assertEqual(self.count(Payment), 1)
        self.assertEqual(self.count(LedgerEntry), 1)
