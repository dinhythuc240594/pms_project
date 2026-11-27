"""Stale booking forms cannot overwrite a newer local, OTA or shared-guest edit."""

from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

from sqlalchemy import text

from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class BookingVersionTests(DomainTestCase):
    def booking(self, room="101", guests=None):
        today = date.today()
        result = self.request(
            "POST",
            "/reservations",
            {
                "rooms": [room],
                "sourceId": "direct-a",
                "checkIn": str(today),
                "checkOut": str(today + timedelta(days=2)),
                "guests": guests or [{"name": "Original", "phone": "0900000000"}],
            },
        )
        self.assertEqual(result.status_code, 201, result.json)
        return result.json

    def raw(self, method, booking_id, body, *, status=False, client=None, headers=None):
        return (client or self.client).open(
            f"/api/tenants/{self.tenant_id}/reservations/{booking_id}"
            + ("/status" if status else ""),
            method=method,
            json=body,
            headers=headers or self.headers,
        )

    def detail(self, row):
        return self.request("GET", f"/reservations/{row['id']}").json

    def test_missing_and_invalid_versions_are_rejected_without_writes(self):
        row = self.booking()
        for value in (None, True, 0, -1, "1", 1.5):
            for status in (False, True):
                body = {"status": "CANCELLED"} if status else {"phone": "must not save"}
                if value is not None:
                    body["expectedVersion"] = value
                with self.subTest(value=value, status=status):
                    response = self.raw(
                        "POST" if status else "PATCH", row["id"], body, status=status
                    )
                    self.assertEqual(response.status_code, 422, response.json)
                    self.assertEqual(response.json["error"]["code"], "version_required")
        self.assertEqual(self.detail(row)["phone"], row["phone"])
        self.assertEqual(self.detail(row)["status"], "CONFIRMED")

    def test_stale_form_and_status_preserve_newer_booking(self):
        row = self.booking()
        saved = self.raw(
            "PATCH",
            row["id"],
            {
                "expectedVersion": row["version"],
                "phone": "0911111111",
                "rooms": ["102"],
            },
        )
        self.assertEqual(saved.status_code, 200, saved.json)
        self.assertGreater(saved.json["version"], row["version"])
        saved_snapshot = self.detail(row)
        stale = self.raw(
            "PATCH",
            row["id"],
            {
                "expectedVersion": row["version"],
                "rooms": ["101"],
                "guests": row["guests"],
            },
        )
        self.assertEqual(stale.status_code, 409, stale.json)
        self.assertEqual(stale.json["error"]["code"], "stale_booking")
        status = self.raw(
            "POST",
            row["id"],
            {
                "expectedVersion": row["version"],
                "status": "CANCELLED",
            },
            status=True,
        )
        self.assertEqual(status.status_code, 409, status.json)
        current = self.detail(row)
        self.assertEqual(current, saved_snapshot)
        closed = self.raw(
            "POST",
            row["id"],
            {
                "expectedVersion": current["version"],
                "status": "CANCELLED",
            },
            status=True,
        )
        self.assertEqual(closed.status_code, 200, closed.json)
        self.assertGreater(closed.json["version"], current["version"])

    def test_two_editors_with_same_version_have_one_winner(self):
        row = self.booking()
        clients = [self.login(), self.login()]

        def save(index):
            client, headers = clients[index]
            return self.raw(
                "PATCH",
                row["id"],
                {
                    "expectedVersion": row["version"],
                    "phone": f"090000000{index}",
                },
                client=client,
                headers=headers,
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(save, range(2)))
        self.assertEqual(sorted(result.status_code for result in responses), [200, 409])
        winner = next(result.json for result in responses if result.status_code == 200)
        self.assertEqual(self.detail(row), winner)

    def test_external_reservation_update_invalidates_an_open_form(self):
        row = self.booking()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.execute(
                text("UPDATE reservations SET source_name='OTA refreshed' WHERE id=:id"),
                {"id": row["id"]},
            )
            db.session.commit()
        response = self.raw(
            "PATCH",
            row["id"],
            {
                "expectedVersion": row["version"],
                "source": "Direct",
            },
        )
        self.assertEqual(response.status_code, 409, response.json)
        self.assertEqual(self.detail(row)["source"], "OTA refreshed")

    def test_shared_guest_change_invalidates_other_booking_without_changing_its_stay(self):
        first = self.booking()
        second = self.booking("102", [{"id": first["guests"][0]["id"]}])
        updated = self.raw(
            "PATCH",
            first["id"],
            {
                "expectedVersion": first["version"],
                "guests": [{**first["guests"][0], "phone": "0911111111"}],
            },
        )
        self.assertEqual(updated.status_code, 200, updated.json)
        other = self.detail(second)
        self.assertGreater(other["version"], second["version"])
        self.assertEqual(other["guests"][0]["phone"], "0911111111")
        self.assertEqual(other["nightlyRates"], second["nightlyRates"])
        stale = self.raw(
            "PATCH",
            second["id"],
            {
                "expectedVersion": second["version"],
                "guests": second["guests"],
            },
        )
        self.assertEqual(stale.status_code, 409, stale.json)
        unchanged = self.raw(
            "PATCH",
            second["id"],
            {
                "expectedVersion": other["version"],
                "guests": other["guests"],
            },
        )
        self.assertEqual(unchanged.status_code, 200, unchanged.json)
        self.assertEqual(self.detail(first)["version"], updated.json["version"])

    def test_attaching_guest_cannot_overwrite_a_profile_read_elsewhere(self):
        first = self.booking()
        second = self.booking("102")
        second_snapshot = self.detail(second)
        updated = self.raw(
            "PATCH",
            first["id"],
            {
                "expectedVersion": first["version"],
                "guests": [{**first["guests"][0], "phone": "0911111111"}],
            },
        )
        self.assertEqual(updated.status_code, 200, updated.json)
        stale = self.raw(
            "PATCH",
            second["id"],
            {
                "expectedVersion": second["version"],
                "guests": first["guests"],
            },
        )
        self.assertEqual(stale.status_code, 409, stale.json)
        self.assertEqual(stale.json["error"]["code"], "stale_guest")
        self.assertEqual(self.detail(first)["guests"][0]["phone"], "0911111111")
        self.assertEqual(self.detail(second), second_snapshot)
