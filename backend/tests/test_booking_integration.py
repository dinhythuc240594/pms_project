"""Real PostgreSQL proofs for inventory races, immutable prices and accounting."""

from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from decimal import Decimal
from threading import Event, get_ident

from sqlalchemy import event, func, select, text
from sqlalchemy.exc import DBAPIError

from pms_api.bookings.models import LedgerEntry, ReservationNight, ReservationRoom
from pms_api.catalog.models import RoomTypeAvailability
from pms_api.core_models import Tenant
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class BookingIntegrationTests(DomainTestCase):
    def test_first_booking_refreshes_currency_after_concurrent_settings_commit(self):
        # Pause after authentication read the old settings; creation must acquire
        # its shared tenant lock and refresh before snapshotting the booking.
        client, headers = self.login()
        read_old, release_read = Event(), Event()
        worker_thread = [None]

        def pause_initial_tenant_read(conn, cursor, statement, parameters, context, many):
            if (
                get_ident() == worker_thread[0]
                and "FROM tenants" in statement
                and statement.lstrip().startswith("SELECT")
                and not read_old.is_set()
            ):
                read_old.set()
                if not release_read.wait(5):
                    raise RuntimeError("Test did not release the tenant read")

        def create_first_booking():
            worker_thread[0] = get_ident()
            start = date.today()
            return self.request(
                "post",
                "/reservations",
                {
                    "guest": "Currency race",
                    "currency": "USD",
                    "room": "101",
                    "sourceId": "direct-a",
                    "checkIn": start.isoformat(),
                    "checkOut": (start + timedelta(days=1)).isoformat(),
                },
                client=client,
                headers=headers,
            )

        with self.app.app_context():
            engine = db.engine
            set_context(self.owner_id, self.tenant_id)
            tenant = db.session.scalar(
                select(Tenant).where(Tenant.id == self.tenant_id).with_for_update()
            )
            event.listen(engine, "after_cursor_execute", pause_initial_tenant_read)
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(create_first_booking)
                try:
                    self.assertTrue(
                        read_old.wait(5), "Booking did not read initial tenant settings"
                    )
                    tenant.settings = {**(tenant.settings or {}), "currency": "USD"}
                    db.session.commit()
                finally:
                    release_read.set()
                    db.session.rollback()
                response = future.result(timeout=10)
            event.remove(engine, "after_cursor_execute", pause_initial_tenant_read)
        self.assertEqual(response.status_code, 201, response.json)
        self.assertEqual(response.json["currency"], "USD")
        self.assertEqual(response.json["baseCurrency"], "USD")
        self.assertEqual(Decimal(response.json["exchangeRate"]), Decimal("1"))

    def make_booking(self, **changes):
        start = date.today()
        data = {
            "guest": "Guest A",
            "phone": "0900000000",
            "room": "101",
            "sourceId": "direct-a",
            "checkIn": start.isoformat(),
            "checkOut": (start + timedelta(days=2)).isoformat(),
        }
        data.update(changes)
        response = self.request("POST", "/reservations", data)
        self.assertEqual(response.status_code, 201, response.json)
        return response.json

    def payment(self, booking_id, amount, key, **changes):
        data = {"amount": amount, "methodId": "cash-a", "fundId": "fund-a"}
        data.update(changes)
        return self.request("POST", f"/reservations/{booking_id}/payments", data, key=key)

    def test_multiroom_guests_and_daily_inventory_are_persisted(self):
        row = self.make_booking(rooms=["101", "102"], guests=[{"name": "Alice"}, {"name": "Bob"}])
        self.assertEqual(row["rooms"], ["101", "102"])
        self.assertEqual(len(row["guests"]), 2)
        self.assertEqual(row["total"], "400.0000")
        self.assertEqual(len(row["nightlyRates"]), 4)
        updated = self.request("PATCH", f"/reservations/{row['id']}", {"phone": "0911111111"})
        self.assertEqual(updated.status_code, 200, updated.json)
        self.assertEqual(len(updated.json["guests"]), 2)
        self.assertEqual(updated.json["guests"][1]["name"], "Bob")
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            inventory = (
                db.session.execute(
                    select(RoomTypeAvailability).where(
                        RoomTypeAvailability.tenant_id == self.tenant_id
                    )
                )
                .scalars()
                .all()
            )
            self.assertEqual([row.booked_rooms for row in inventory], [2, 2])

    def test_simultaneous_same_room_requests_only_one_wins(self):
        clients = [self.login(), self.login()]
        start = date.today()
        data = {
            "guest": "Race",
            "rooms": ["101"],
            "sourceId": "direct-a",
            "checkIn": start.isoformat(),
            "checkOut": (start + timedelta(days=1)).isoformat(),
        }
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(
                pool.map(
                    lambda pair: self.request(
                        "POST", "/reservations", data, client=pair[0], headers=pair[1]
                    ),
                    clients,
                )
            )
        self.assertEqual(sorted(response.status_code for response in responses), [201, 409])
        rows = self.request("GET", "/reservations").json["bookings"]
        self.assertEqual(len(rows), 1)

    def test_half_open_checkout_allows_adjacent_booking(self):
        row = self.make_booking()
        start = date.fromisoformat(row["checkOut"])
        next_row = self.make_booking(
            checkIn=start.isoformat(), checkOut=(start + timedelta(days=1)).isoformat()
        )
        self.assertNotEqual(row["id"], next_row["id"])

    def test_postgres_exclusion_rejects_overlap_even_without_route_check(self):
        self.make_booking()
        row = self.make_booking(room="102")
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.add(
                ReservationRoom(
                    tenant_id=self.tenant_id,
                    reservation_id=row["id"],
                    room_id="room-a-101",
                    room_number="101",
                    room_type_id="rt-a",
                    check_in=date.today(),
                    check_out=date.today() + timedelta(days=1),
                    active=True,
                )
            )
            with self.assertRaises(DBAPIError) as caught:
                db.session.flush()
            self.assertEqual(caught.exception.orig.sqlstate, "23P01")
            db.session.rollback()

    def test_rate_change_does_not_change_snapshot_or_contact_edit_price(self):
        row = self.make_booking()
        response = self.request(
            "PUT",
            "/rates",
            {
                "roomTypeId": "rt-a",
                "start": row["checkIn"],
                "end": row["checkOut"],
                "price": "999",
                "stopSell": False,
            },
        )
        self.assertEqual(response.status_code, 200, response.json)
        edited = self.request("PATCH", f"/reservations/{row['id']}", {"phone": "0911111111"})
        self.assertEqual(edited.status_code, 200, edited.json)
        self.assertEqual(edited.json["total"], row["total"])
        self.assertEqual(edited.json["nightlyRates"], row["nightlyRates"])

    def test_unpaid_checkout_blocks_then_paid_checkout_marks_dirty_and_keeps_nights(self):
        row = self.make_booking()
        booking_id = row["id"]
        response = self.request(
            "POST", f"/reservations/{booking_id}/status", {"status": "IN_HOUSE"}
        )
        self.assertEqual(response.status_code, 200, response.json)
        blocked = self.request(
            "POST", f"/reservations/{booking_id}/status", {"status": "CHECKED_OUT"}
        )
        self.assertEqual(blocked.status_code, 409)
        self.assertEqual(blocked.json["error"]["code"], "unpaid_balance")
        paid = self.payment(booking_id, "200", "pay-checkout-1")
        self.assertEqual(paid.status_code, 201, paid.json)
        checked = self.request(
            "POST", f"/reservations/{booking_id}/status", {"status": "CHECKED_OUT"}
        )
        self.assertEqual(checked.status_code, 200, checked.json)
        self.assertEqual(checked.json["nightlyRates"], row["nightlyRates"])
        again = self.request(
            "POST", f"/reservations/{booking_id}/status", {"status": "CHECKED_OUT"}
        )
        self.assertEqual(again.status_code, 409)
        workspace = self.request("GET", "/workspace").json
        self.assertEqual(workspace["housekeepingLogs"][0]["actor"], "owner-a")
        self.assertEqual(
            next(room for room in workspace["rooms"] if room["id"] == "101")["condition"], "dirty"
        )
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(
                db.session.scalar(
                    select(func.count())
                    .select_from(ReservationNight)
                    .where(ReservationNight.reservation_id == booking_id)
                ),
                2,
            )
            self.assertEqual(
                db.session.scalar(select(func.sum(RoomTypeAvailability.booked_rooms))), 0
            )

    def test_checkin_requires_clean_room_and_current_stay(self):
        row = self.make_booking()
        self.assertEqual(
            self.request("POST", "/rooms/101/condition", {"condition": "dirty"}).status_code, 200
        )
        dirty = self.request("POST", f"/reservations/{row['id']}/status", {"status": "IN_HOUSE"})
        self.assertEqual(dirty.status_code, 409)
        self.assertEqual(dirty.json["error"]["code"], "room_not_ready")
        self.request("POST", "/rooms/101/condition", {"condition": "clean"})
        self.assertEqual(
            self.request(
                "POST", f"/reservations/{row['id']}/status", {"status": "IN_HOUSE"}
            ).status_code,
            200,
        )
        future = date.today() + timedelta(days=10)
        other = self.make_booking(
            room="102",
            checkIn=future.isoformat(),
            checkOut=(future + timedelta(days=1)).isoformat(),
        )
        self.assertEqual(
            self.request(
                "POST", f"/reservations/{other['id']}/status", {"status": "IN_HOUSE"}
            ).json["error"]["code"],
            "outside_stay",
        )

    def test_cancel_releases_availability_and_preserves_financial_history(self):
        row = self.make_booking()
        self.assertEqual(self.payment(row["id"], "50", "deposit-cancel-1").status_code, 201)
        cancelled = self.request(
            "POST", f"/reservations/{row['id']}/status", {"status": "CANCELLED"}
        )
        self.assertEqual(cancelled.status_code, 200, cancelled.json)
        self.assertEqual(cancelled.json["paid"], "50.0000")
        self.make_booking()
        self.assertEqual(
            self.request("PATCH", f"/reservations/{row['id']}", {"phone": "new"}).status_code, 409
        )
        refunded = self.request(
            "POST",
            f"/reservations/{row['id']}/payments/{cancelled.json['payments'][0]['id']}/refund",
            {"amount": "50", "reason": "Cancellation"},
            key="refund-cancel-1",
        )
        self.assertEqual(refunded.status_code, 201, refunded.json)
        self.assertEqual(refunded.json["paid"], "0.0000")

    def test_charge_payment_refund_and_ledger_balance_exactly(self):
        row = self.make_booking()
        charge = self.request(
            "POST",
            f"/reservations/{row['id']}/charges",
            {"serviceId": "service-a", "quantity": "2", "type": "service"},
            key="charge-breakfast-1",
        )
        self.assertEqual(charge.status_code, 201, charge.json)
        self.assertEqual(charge.json["total"], "240.0000")
        paid = self.payment(row["id"], "100.0001", "pay-deposit-1")
        self.assertEqual(paid.status_code, 201, paid.json)
        payment_id = paid.json["payments"][0]["id"]
        refund = self.request(
            "POST",
            f"/reservations/{row['id']}/payments/{payment_id}/refund",
            {"amount": "10.0001", "reason": "Correction"},
            key="refund-correction-1",
        )
        self.assertEqual(refund.status_code, 201, refund.json)
        self.assertEqual(refund.json["paid"], "90.0000")
        self.assertEqual(refund.json["balance"], "150.0000")
        ledger = self.request("GET", "/workspace").json["ledger"]
        self.assertEqual(sum(Decimal(entry["amount"]) for entry in ledger), Decimal("90"))
        self.assertEqual(len(ledger), 2)
        over = self.request(
            "POST",
            f"/reservations/{row['id']}/payments/{payment_id}/refund",
            {"amount": "100", "reason": "Invalid"},
            key="refund-excess-1",
        )
        self.assertEqual(over.status_code, 409)

    def test_idempotent_replay_fingerprint_and_concurrent_duplicate_money(self):
        row = self.make_booking()
        first = self.payment(row["id"], "25", "payment-intent-1")
        second = self.payment(row["id"], "25", "payment-intent-1")
        self.assertEqual(first.status_code, 201, first.json)
        self.assertEqual(second.json, first.json)
        changed = self.payment(row["id"], "30", "payment-intent-1")
        self.assertEqual(changed.status_code, 409)
        clients = [self.login(), self.login()]
        data = {"amount": "25", "methodId": "cash-a", "fundId": "fund-a"}
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(
                pool.map(
                    lambda pair: self.request(
                        "POST",
                        f"/reservations/{row['id']}/payments",
                        data,
                        client=pair[0],
                        headers=pair[1],
                        key="payment-intent-2",
                    ),
                    clients,
                )
            )
        self.assertEqual([response.status_code for response in responses], [201, 201])
        self.assertEqual(responses[0].json, responses[1].json)
        detail = self.request("GET", f"/reservations/{row['id']}").json
        self.assertEqual(detail["paid"], "50.0000")
        self.assertEqual(len(detail["payments"]), 2)

    def test_overpayment_and_money_without_intent_are_rejected(self):
        row = self.make_booking()
        self.assertEqual(self.payment(row["id"], "201", "excess-payment-1").status_code, 409)
        no_key = self.request(
            "POST",
            f"/reservations/{row['id']}/payments",
            {"amount": "20", "methodId": "cash-a", "fundId": "fund-a"},
        )
        self.assertEqual(no_key.status_code, 422)
        self.assertEqual(self.request("GET", f"/reservations/{row['id']}").json["paid"], "0.0000")

    def test_frontdesk_payment_accountant_payment_and_hk_denial(self):
        row = self.make_booking()
        client, headers = self.login("accountant@test.local")
        result = self.request(
            "POST",
            f"/reservations/{row['id']}/payments",
            {"amount": "20", "methodId": "cash-a", "fundId": "fund-a"},
            client=client,
            headers=headers,
            key="accountant-pay-1",
        )
        self.assertEqual(result.status_code, 201, result.json)
        client, headers = self.login("hk@test.local")
        denied = self.request(
            "POST",
            f"/reservations/{row['id']}/payments",
            {"amount": "20", "methodId": "cash-a", "fundId": "fund-a"},
            client=client,
            headers=headers,
            key="hk-payment-denied",
        )
        self.assertEqual(denied.status_code, 403)
        workspace = self.request("GET", "/workspace", client=client, headers=headers).json
        self.assertEqual(workspace["ledger"], [])
        self.assertEqual(workspace["guests"], [])
        self.assertEqual(workspace["bookings"][0]["phone"], "")

    def test_guest_reference_cannot_cross_tenant(self):
        other_client, other_headers = self.login("owner-b@test.local")
        start = date.today()
        other = self.request(
            "POST",
            f"/api/tenants/{self.other_tenant_id}/reservations",
            {
                "guest": "Other hotel",
                "room": "101",
                "sourceId": "direct-b",
                "checkIn": start.isoformat(),
                "checkOut": (start + timedelta(days=1)).isoformat(),
            },
            client=other_client,
            headers=other_headers,
        )
        self.assertEqual(other.status_code, 201, other.json)
        result = self.request(
            "POST",
            "/reservations",
            {
                "rooms": ["101"],
                "guests": [{"id": other.json["guests"][0]["id"]}],
                "sourceId": "direct-a",
                "checkIn": start.isoformat(),
                "checkOut": (start + timedelta(days=1)).isoformat(),
            },
        )
        self.assertEqual(result.status_code, 404)
        self.assertEqual(self.request("GET", "/reservations").json["bookings"], [])

    def test_existing_guest_profile_and_booking_save_atomically(self):
        row = self.make_booking()
        guest_id = row["guests"][0]["id"]
        guest = {
            "id": guest_id,
            "name": "Changed guest",
            "phone": "0911111111",
            "email": "guest@test.local",
            "identityNumber": "ABC123",
            "nationality": "VN",
        }
        saved = self.request("PATCH", f"/reservations/{row['id']}", {"guests": [guest]})
        self.assertEqual(saved.status_code, 200, saved.json)
        self.assertEqual(saved.json["guest"], "Changed guest")
        self.assertEqual(saved.json["phone"], "0911111111")
        self.assertEqual(saved.json["guests"][0]["id"], guest_id)
        self.assertEqual(saved.json["guests"][0]["identityNumber"], "ABC123")
        profile = self.request("GET", "/workspace").json["guests"]
        self.assertEqual(len(profile), 1)
        self.assertEqual(profile[0]["email"], "guest@test.local")

    def test_failed_booking_edit_rolls_back_existing_guest_profile_updates(self):
        row = self.make_booking()
        guest_id = row["guests"][0]["id"]
        changed = {"id": guest_id, "name": "Must roll back", "phone": "0912345678"}
        over_capacity = self.request(
            "PATCH",
            f"/reservations/{row['id']}",
            {"guests": [changed, {"name": "Extra1"}, {"name": "Extra2"}]},
        )
        self.assertEqual(over_capacity.status_code, 422, over_capacity.json)
        guests = self.request("GET", "/workspace").json["guests"]
        self.assertEqual(len(guests), 1)
        self.assertEqual(guests[0]["name"], "Guest A")
        self.make_booking(room="102")
        overlap = self.request(
            "PATCH", f"/reservations/{row['id']}", {"rooms": ["102"], "guests": [changed]}
        )
        self.assertEqual(overlap.status_code, 409, overlap.json)
        guest = next(
            value
            for value in self.request("GET", "/workspace").json["guests"]
            if value["id"] == guest_id
        )
        self.assertEqual(guest["name"], "Guest A")
        self.assertEqual(guest["phone"], "0900000000")
        self.assertEqual(self.request("GET", f"/reservations/{row['id']}").json["rooms"], ["101"])

    def test_disabled_renamed_source_snapshot_allows_contact_edit(self):
        row = self.make_booking()
        changed = self.request(
            "PATCH",
            "/masters/bookingSources",
            {"id": "direct-a", "name": "Renamed Direct", "active": False},
        )
        self.assertEqual(changed.status_code, 200, changed.json)
        saved = self.request(
            "PATCH", f"/reservations/{row['id']}", {"phone": "0911111111", "source": "Direct"}
        )
        self.assertEqual(saved.status_code, 200, saved.json)
        self.assertEqual(saved.json["source"], "Direct")
        self.assertEqual(saved.json["sourceId"], "direct-a")

    def test_notes_and_audit_are_real_and_financial_records_append_only(self):
        row = self.make_booking()
        noted = self.request("POST", f"/reservations/{row['id']}/notes", {"text": "Late arrival"})
        self.assertEqual(noted.status_code, 201, noted.json)
        self.assertEqual(noted.json["notes"][0]["text"], "Late arrival")
        self.assertTrue(
            any(event["event"] == "reservation.created" for event in noted.json["history"])
        )
        self.assertEqual(self.payment(row["id"], "20", "immutable-ledger-1").status_code, 201)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            with self.assertRaises(DBAPIError) as caught:
                db.session.execute(
                    text("UPDATE ledger_entries SET amount=0 WHERE tenant_id=:tenant"),
                    {"tenant": self.tenant_id},
                )
            self.assertEqual(caught.exception.orig.sqlstate, "55000")
            db.session.rollback()
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(
                db.session.scalar(select(func.sum(LedgerEntry.amount))), Decimal("20.0000")
            )
