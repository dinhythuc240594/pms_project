"""Real PostgreSQL boundaries, with a mocked Channex transport only."""

import os
from copy import deepcopy
from datetime import timedelta
from decimal import Decimal
from unittest.mock import Mock, patch
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import create_engine, delete, func, select, text
from sqlalchemy.exc import SQLAlchemyError

from pms_api.bookings.models import Reservation, ReservationNight
from pms_api.channels.client import ProviderError
from pms_api.channels.models import ChannelConnection, ChannelJob, ChannelRevision
from pms_api.channels.routes import expected_refs
from pms_api.channels.service import process_jobs
from pms_api.core_models import Plan, Tenant, TenantUser, User, utcnow
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase
from tests.system_scope_fixture import linked_property

PROPERTY, REMOTE_ROOM, REMOTE_RATE, BOOKING = [str(UUID(int=i)) for i in range(1, 5)]


def revision(
    number=10,
    status="new",
    *,
    booking_id=BOOKING,
    amount="200",
    start="2030-01-01",
    end="2030-01-03",
):
    return {
        "id": str(UUID(int=number)),
        "type": "booking_revision",
        "attributes": {
            "booking_id": booking_id,
            "property_id": PROPERTY,
            "status": status,
            "inserted_at": f"2026-10-07T00:00:{number:02d}Z",
            "arrival_date": start,
            "departure_date": end,
            "currency": "VND",
            "amount": amount,
            "ota_name": "BookingCom",
            "payment_collect": "ota",
            "customer": {
                "name": "Fixture",
                "surname": "Guest",
                "phone": "0123",
                "mail": "guest@test.local",
            },
            "guarantee": {"card_number": "fixture-sensitive-card", "cvv": "private"},
            "services": [],
            "rooms": [
                {
                    "room_type_id": REMOTE_ROOM,
                    "rate_plan_id": REMOTE_RATE,
                    "checkin_date": start,
                    "checkout_date": end,
                    "amount": amount,
                    "occupancy": {"adults": 2, "children": 0, "infants": 0},
                    "services": [],
                    "days": {"2030-01-01": "100", "2030-01-02": "100"},
                }
            ],
        },
    }


class ChannelTestCase(DomainTestCase):
    def setUp(self):
        super().setUp()
        credential, webhook = expected_refs(self.tenant_id)
        self.env = patch.dict(
            os.environ,
            {credential: "fixture-api-key", webhook: "fixture-webhook-secret-32-characters"},
        )
        self.env.start()
        self.addCleanup(self.env.stop)
        self.provider = Mock()
        self.provider.feed.return_value = []
        self.provider.catalog.side_effect = self.catalog
        self.provider.restrictions.side_effect = self.stored_restrictions
        self.provider.availability.side_effect = self.stored_availability
        route_provider = patch("pms_api.channels.routes.ChannexClient", return_value=self.provider)
        route_provider.start()
        self.addCleanup(route_provider.stop)
        self.config = {
            "environment": "staging",
            "propertyId": PROPERTY,
            "credentialRef": credential,
            "webhookSecretRef": webhook,
            "active": False,
        }
        linked_property(self, PROPERTY)
        result = self.request("put", "/channels/config", json=self.config)
        self.assertEqual(result.status_code, 200, result.json)
        result = self.request(
            "put",
            "/channels/mappings",
            json={
                "roomTypeId": "rt-a",
                "channexRoomTypeId": REMOTE_ROOM,
                "channexRatePlanId": REMOTE_RATE,
                "active": True,
            },
        )
        self.assertEqual(result.status_code, 200, result.json)
        self.config["active"] = True
        self.assertEqual(self.request("put", "/channels/config", json=self.config).status_code, 200)
        # Existing channel tests start with an already reconciled hotel.
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            row = db.session.scalar(select(ChannelConnection))
            row.inventory_reconciled_at = utcnow()
            row.pending_ari_start = row.pending_ari_end = row.pending_ari_since = None
            db.session.commit()
        self.clear_push_jobs()
        self.patch_provider = patch(
            "pms_api.channels.service.ChannexClient", return_value=self.provider
        )
        self.patch_provider.start()
        self.addCleanup(self.patch_provider.stop)

    def stored_restrictions(self, *_args):
        result = {}
        for value in self.provider.push_restrictions.call_args.args[0]:
            result.setdefault(value["rate_plan_id"], {})[value["date"]] = {
                key: value[key] for key in ("rate", "stop_sell") if key in value
            }
        return result

    def stored_availability(self, *_args):
        result = {}
        for value in self.provider.push_availability.call_args.args[0]:
            result.setdefault(value["room_type_id"], {})[value["date"]] = value["availability"]
        return result

    def catalog(self, resource, property_id):
        self.assertEqual(property_id, PROPERTY)
        if resource == "room_types":
            return [
                {
                    "id": REMOTE_ROOM,
                    "attributes": {},
                    "relationships": {"property": {"data": {"id": PROPERTY}}},
                }
            ]
        return [
            {
                "id": REMOTE_RATE,
                "attributes": {
                    "sell_mode": "per_room",
                    "rate_mode": "manual",
                    "currency": "VND",
                    "inherit_rate": False,
                },
                "relationships": {
                    "property": {"data": {"id": PROPERTY}},
                    "room_type": {"data": {"id": REMOTE_ROOM}},
                },
            }
        ]

    def clear_push_jobs(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.execute(
                delete(ChannelJob).where(
                    ChannelJob.tenant_id == self.tenant_id, ChannelJob.kind == "push_ari"
                )
            )
            db.session.commit()

    def run_jobs(self, limit=1):
        with self.app.app_context():
            return process_jobs(self.tenant_id, limit)

    def enqueue_revision(self, entity):
        self.provider.revision.return_value = deepcopy(entity)
        body = {
            "event": "booking",
            "property_id": PROPERTY,
            "payload": {"property_id": PROPERTY, "revision_id": entity["id"]},
        }
        response = self.client.post(
            f"/api/channex/webhooks/{self.tenant_id}",
            json=body,
            headers={"X-Channex-Webhook-Secret": "fixture-webhook-secret-32-characters"},
        )
        self.assertEqual(response.status_code, 202, response.json)
        return body

    def import_booking(self, entity=None):
        entity = entity or revision()
        self.enqueue_revision(entity)
        self.assertEqual(self.run_jobs(), 1)
        self.clear_push_jobs()
        return self.local_bookings()

    def local_bookings(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            return [
                {
                    "id": r.id,
                    "status": r.status,
                    "snapshot": r.pricing_snapshot,
                    "start": r.check_in.isoformat(),
                    "end": r.check_out.isoformat(),
                }
                for r in db.session.scalars(
                    select(Reservation).where(Reservation.tenant_id == self.tenant_id)
                )
            ]

    def jobs(self):
        return self.request("get", "/channels").json["jobs"]


class ChannelIntegrationTests(ChannelTestCase):
    def test_revisions_preserve_pms_companions_when_price_or_primary_contact_changes(self):
        booking = self.import_booking()[0]
        path = f"/reservations/{booking['id']}"
        primary = self.request("get", path).json["guests"][0]
        attached = self.request(
            "patch",
            path,
            {
                "guests": [
                    {"id": primary["id"]},
                    {
                        "name": "PMS Companion",
                        "identityNumber": "COMPANION-ID",
                        "nationality": "VN",
                    },
                ]
            },
        )
        self.assertEqual(attached.status_code, 200, attached.json)
        companion = attached.json["guests"][1]

        for number, contact_changed in ((11, False), (12, True)):
            self.clear_push_jobs()
            self.assertEqual(self.run_jobs(), 1)
            changed = revision(number, "modified", amount="240")
            changed["attributes"]["rooms"][0]["days"] = {
                "2030-01-01": "120",
                "2030-01-02": "120",
            }
            if contact_changed:
                changed["attributes"]["customer"].update(name="Updated", phone="0456")
            self.import_booking(changed)
            saved = self.request("get", path).json
            self.assertEqual(saved["total"], "240.0000")
            self.assertEqual(len(saved["guests"]), 2)
            self.assertEqual(saved["guests"][1], companion)
            if contact_changed:
                self.assertEqual(saved["guest"], "Updated Guest")
                self.assertEqual(saved["phone"], "0456")
                self.assertNotEqual(saved["guests"][0]["id"], primary["id"])
            else:
                self.assertEqual(saved["guests"][0], primary)

    def test_import_snapshots_exact_active_ota_rate_and_keeps_it_on_revision(self):
        source = self.request(
            "post",
            "/masters/bookingSources",
            {"name": "BookingCom", "type": "OTA", "commission": "15"},
        )
        self.assertEqual(source.status_code, 201, source.json)
        row = self.import_booking()[0]
        frozen = {"sourceId": source.json["id"], "sourceName": "BookingCom", "percent": "15.0000"}
        self.assertEqual(row["snapshot"]["commission"], frozen)
        changed = self.request(
            "patch",
            "/masters/bookingSources",
            {"id": source.json["id"], "commission": "45", "name": "Changed source"},
        )
        self.assertEqual(changed.status_code, 200, changed.json)
        updated = self.import_booking(revision(11, "modified"))[0]
        self.assertEqual(updated["snapshot"]["commission"], frozen)

    def test_unmapped_ota_rate_ignores_near_names_and_wrong_type(self):
        for name, kind in [("BookingCom", "Travel Agency"), ("Booking.com", "OTA")]:
            source = self.request(
                "post", "/masters/bookingSources", {"name": name, "type": kind, "commission": "15"}
            )
            self.assertEqual(source.status_code, 201, source.json)
        row = self.import_booking()[0]
        self.assertNotIn("commission", row["snapshot"])
        self.assertNotIn("commission", self.import_booking(revision(11, "modified"))[0]["snapshot"])

    def test_inactive_ota_requires_legacy_rate_and_later_activation_does_not_backfill(self):
        source = self.request(
            "post",
            "/masters/bookingSources",
            {"name": "BookingCom", "type": "OTA", "commission": "15"},
        )
        self.assertEqual(source.status_code, 201, source.json)
        path = f"/masters/bookingSources/{source.json['id']}/toggle"
        self.assertEqual(self.request("post", path, {}).status_code, 200)
        self.assertNotIn("commission", self.import_booking()[0]["snapshot"])
        self.assertEqual(self.request("post", path, {}).status_code, 200)
        self.assertNotIn("commission", self.import_booking(revision(11, "modified"))[0]["snapshot"])

    def test_no_show_queues_ari_and_provider_revisions_cannot_reopen_or_cancel_it(self):
        start = utcnow().astimezone(ZoneInfo("Asia/Ho_Chi_Minh")).date()
        entity = revision(start=str(start), end=str(start + timedelta(days=2)))
        entity["attributes"]["rooms"][0]["days"] = {
            str(start): "100",
            str(start + timedelta(days=1)): "100",
        }
        imported = self.import_booking(entity)
        self.assertEqual(len(imported), 1)
        self.run_jobs(5)
        self.clear_push_jobs()
        booking_id = imported[0]["id"]
        result = self.request(
            "post", f"/reservations/{booking_id}/status", json={"status": "NO_SHOW"}
        )
        self.assertEqual(result.status_code, 200, result.json)
        self.assertTrue(
            any(job["kind"] == "push_ari" and job["status"] == "queued" for job in self.jobs())
        )
        self.clear_push_jobs()
        self.provider.ack.reset_mock()
        for number, status in ((11, "modified"), (12, "cancelled")):
            changed = deepcopy(entity)
            changed["id"] = str(UUID(int=number))
            changed["attributes"].update(
                status=status, inserted_at=f"2026-10-07T00:00:{number:02d}Z"
            )
            self.import_booking(changed)
            self.assertEqual(self.local_bookings()[0]["status"], "NO_SHOW")
        self.assertTrue(any(job["errorCode"] == "booking_requires_review" for job in self.jobs()))
        self.provider.ack.assert_not_called()

    def test_configuration_does_not_expose_credentials_and_ref_is_tenant_bound(self):
        response = self.request("get", "/channels")
        self.assertTrue(response.json["connection"]["credentialsConfigured"])
        self.assertNotIn("fixture-api-key", response.get_data(as_text=True))
        self.assertNotIn("fixture-webhook-secret", response.get_data(as_text=True))
        wrong = {**self.config, "credentialRef": expected_refs(self.other_tenant_id)[0]}
        self.assertEqual(self.request("put", "/channels/config", json=wrong).status_code, 422)
        wrong = {**self.config, "apiKey": "should-not-be-accepted"}
        self.assertEqual(self.request("put", "/channels/config", json=wrong).status_code, 422)

    def test_roles_csrf_and_cross_tenant(self):
        desk, csrf = self.login("frontdesk@test.local")
        self.assertEqual(
            self.request("get", "/channels", client=desk, headers=csrf).status_code, 200
        )
        self.assertEqual(
            self.request(
                "put", "/channels/config", json=self.config, client=desk, headers=csrf
            ).status_code,
            403,
        )
        self.assertEqual(
            self.request("put", "/channels/config", json=self.config, headers={}).status_code, 403
        )
        other, csrf = self.login("owner-b@test.local")
        self.assertEqual(
            self.request("get", "/channels", client=other, headers=csrf).status_code, 403
        )

    def test_spoofed_webhook_rejected_and_replay_is_idempotent(self):
        body = self.enqueue_revision(revision())
        path = f"/api/channex/webhooks/{self.tenant_id}"
        self.assertEqual(self.client.post(path, json=body).status_code, 401)
        replay = self.client.post(
            path,
            json=body,
            headers={"X-Channex-Webhook-Secret": "fixture-webhook-secret-32-characters"},
        )
        self.assertEqual(replay.status_code, 202)
        self.assertEqual(len(self.jobs()), 1)
        body["property_id"] = str(UUID(int=99))
        self.assertEqual(
            self.client.post(
                path,
                json=body,
                headers={"X-Channex-Webhook-Secret": "fixture-webhook-secret-32-characters"},
            ).status_code,
            422,
        )
        self.provider.revision.assert_not_called()

    def test_feed_enqueues_revisions_and_ack_observes_committed_receipt(self):
        self.provider.feed.return_value = [revision()]
        self.provider.revision.return_value = revision()
        response = self.request("post", "/channels/jobs", json={"kind": "pull_bookings"})
        self.assertEqual(response.status_code, 202)
        self.run_jobs()
        self.assertEqual(self.local_bookings(), [])
        self.provider.ack.assert_not_called()
        self.run_jobs()
        self.assertEqual(len(self.local_bookings()), 1)
        self.provider.ack.assert_not_called()
        self.clear_push_jobs()

        def ack(revision_id):
            engine = create_engine(self.app.config["SQLALCHEMY_DATABASE_URI"], hide_parameters=True)
            try:
                with engine.begin() as connection:
                    connection.execute(
                        text("SELECT set_config('app.tenant_id',:tenant,true)"),
                        {"tenant": self.tenant_id},
                    )
                    count = connection.scalar(
                        text(
                            "SELECT count(*) FROM channel_revisions WHERE tenant_id=:tenant AND revision_id=:revision"
                        ),
                        {"tenant": self.tenant_id, "revision": revision_id},
                    )
                    self.assertEqual(
                        count, 1, "ACK must observe a previously committed transaction"
                    )
            finally:
                engine.dispose()

        self.provider.ack.side_effect = ack
        self.run_jobs()
        self.provider.ack.assert_called_once_with(revision()["id"])

    def test_duplicate_revision_no_duplicate_booking_or_card_storage(self):
        self.import_booking()
        self.enqueue_revision(revision())
        self.run_jobs(5)
        self.assertEqual(len(self.local_bookings()), 1)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(
                db.session.scalar(select(func.count()).select_from(ChannelRevision)), 1
            )
            from pms_api.bookings.models import Payment

            self.assertEqual(db.session.scalar(select(func.count()).select_from(Payment)), 0)
        response = self.request("get", "/channels").get_data(as_text=True)
        self.assertNotIn("fixture-sensitive-card", response)
        self.assertNotIn("guarantee", str(self.local_bookings()))

    def test_unmapped_or_overbooked_revision_never_acknowledged(self):
        entity = revision()
        entity["attributes"]["rooms"][0]["room_type_id"] = str(UUID(int=999))
        self.import_booking(entity)
        self.assertEqual(self.local_bookings(), [])
        self.assertEqual(self.jobs()[0]["errorCode"], "booking_unmapped")
        self.provider.ack.assert_not_called()
        booking = self.request(
            "post",
            "/reservations",
            json={
                "guest": "Full hotel",
                "rooms": ["101", "102"],
                "checkIn": "2030-01-01",
                "checkOut": "2030-01-03",
                "source": "Direct",
            },
        )
        self.assertEqual(booking.status_code, 201, booking.json)
        self.clear_push_jobs()
        self.import_booking(revision(11))
        self.assertEqual(len(self.local_bookings()), 1)
        self.assertEqual(
            next(
                j
                for j in self.jobs()
                if j["kind"] == "pull_bookings" and j["errorCode"] == "room_unavailable"
            )["status"],
            "needs_review",
        )
        self.provider.ack.assert_not_called()

    def test_modify_and_cancel_release_inventory_without_invented_money(self):
        self.import_booking()
        self.run_jobs()
        modified = revision(11, "modified", amount="150")
        modified["attributes"]["rooms"][0]["days"] = {"2030-01-01": "75", "2030-01-02": "75"}
        self.import_booking(modified)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(db.session.scalar(select(func.sum(ReservationNight.price))), 150)
        self.run_jobs()
        self.import_booking(revision(12, "cancelled"))
        self.assertEqual(self.local_bookings()[0]["status"], "CANCELLED")
        replacement = self.request(
            "post",
            "/reservations",
            json={
                "guest": "Released inventory",
                "rooms": ["101", "102"],
                "checkIn": "2030-01-01",
                "checkOut": "2030-01-03",
                "source": "Direct",
            },
        )
        self.assertEqual(replacement.status_code, 201, replacement.json)

    def test_ota_currency_and_amount_are_preserved_instead_of_using_guest_nationality(self):
        rate = self.request(
            "put", "/pricing/exchange-rates", json={"currency": "USD", "rate": "25000"}
        )
        self.assertEqual(rate.status_code, 200, rate.json)
        entity = revision()
        entity["attributes"]["currency"] = "USD"
        entity["attributes"]["customer"]["country"] = "VN"
        self.import_booking(entity)
        self.run_jobs()
        row = self.request("GET", "/reservations/" + self.local_bookings()[0]["id"]).json
        self.assertEqual(row["currency"], "USD")
        self.assertEqual(Decimal(row["total"]), Decimal("200"))
        self.assertEqual(Decimal(row["baseAmount"]), Decimal("5000000"))
        self.provider.ack.assert_called_once_with(entity["id"])

    def test_stale_revision_acknowledged_without_reverting_booking(self):
        self.import_booking(revision(11))
        self.run_jobs()
        self.import_booking(revision(10, "cancelled"))
        self.assertEqual(self.local_bookings()[0]["status"], "CONFIRMED")
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(
                db.session.scalar(
                    select(ChannelRevision.outcome).where(
                        ChannelRevision.revision_id == revision()["id"]
                    )
                ),
                "stale",
            )
        self.run_jobs()
        self.assertEqual(self.provider.ack.call_count, 2)

    def test_amount_mismatch_and_in_house_edit_need_review(self):
        entity = revision(amount="250")
        self.import_booking(entity)
        self.assertEqual(self.jobs()[0]["errorCode"], "booking_amount_mismatch")
        self.assertEqual(self.local_bookings(), [])
        self.import_booking(revision(11))
        self.run_jobs(5)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            row = db.session.scalar(select(Reservation))
            row.status = "IN_HOUSE"
            db.session.commit()
        self.import_booking(revision(12, "modified"))
        self.assertEqual(self.local_bookings()[0]["status"], "IN_HOUSE")
        self.assertTrue(any(j["errorCode"] == "booking_requires_review" for j in self.jobs()))

    def test_ack_retry_does_not_reimport_booking(self):
        self.import_booking()
        self.provider.ack.side_effect = ProviderError("provider_unavailable", True)
        self.run_jobs()
        failed = next(j for j in self.jobs() if j["kind"] == "ack_revision")
        self.assertEqual((failed["status"], failed["attempts"]), ("queued", 1))
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            job = db.session.get(ChannelJob, failed["id"])
            job.available_at = utcnow() - timedelta(seconds=1)
            db.session.commit()
        self.provider.ack.side_effect = None
        self.run_jobs()
        self.assertEqual(len(self.local_bookings()), 1)
        self.assertEqual(self.provider.revision.call_count, 1)
        self.assertEqual(self.provider.ack.call_count, 2)

    def test_support_jobs_work_without_membership_and_recheck_system_role(self):
        for actor in ("admin", "manager"):
            client, headers = self.login(actor + "@test.local")
            prefix = f"/api/admin/channex/tenants/{self.tenant_id}/channels"
            saved = self.request(
                "PUT", prefix + "/config", self.config, client=client, headers=headers
            )
            self.assertEqual(saved.status_code, 200, saved.json)
            self.clear_push_jobs()
            queued = self.request(
                "POST", prefix + "/jobs", {"kind": "pull_bookings"}, client=client, headers=headers
            )
            self.assertEqual(queued.status_code, 202, queued.json)
            self.run_jobs(limit=10)
            with self.app.app_context():
                set_context(self.owner_id, self.tenant_id)
                job = db.session.get(ChannelJob, queued.json["id"])
                self.assertEqual(job.status, "succeeded", job.error_code)
            queued = self.request(
                "POST", prefix + "/jobs", {"kind": "pull_bookings"}, client=client, headers=headers
            )
            self.assertEqual(queued.status_code, 202, queued.json)
            with self.app.app_context():
                set_context("admin", is_system=True, is_service=True)
                db.session.get(User, actor).global_role = "USER"
                db.session.commit()
            self.run_jobs()
            with self.app.app_context():
                set_context(self.owner_id, self.tenant_id)
                job = db.session.get(ChannelJob, queued.json["id"])
                self.assertEqual(job.status, "failed")
                self.assertEqual(job.error_code, "channel_actor_revoked")
            self.assertEqual(
                client.get(f"/api/tenants/{self.tenant_id}/workspace").status_code, 403
            )

    def test_worker_rechecks_owner_feature_and_tenant_status(self):
        for blocked, code in (
            ("membership", "channel_actor_revoked"),
            ("feature", "feature_disabled"),
            ("tenant", "tenant_suspended"),
        ):
            with self.subTest(blocked=blocked):
                self.request("post", "/channels/jobs", json={"kind": "pull_bookings"})
                with self.app.app_context():
                    set_context(self.owner_id, self.tenant_id, is_service=True)
                    member = db.session.scalar(
                        select(TenantUser).where(
                            TenantUser.user_id == self.owner_id,
                            TenantUser.tenant_id == self.tenant_id,
                        )
                    )
                    plan, tenant = (
                        db.session.get(Plan, "default-pro"),
                        db.session.get(Tenant, self.tenant_id),
                    )
                    member.active, plan.features, tenant.status = (
                        blocked != "membership",
                        {"OTA_SYNC": blocked != "feature"},
                        "suspended" if blocked == "tenant" else "active",
                    )
                    db.session.commit()
                self.run_jobs()
                with self.app.app_context():
                    set_context(self.owner_id, self.tenant_id, is_service=True)
                    self.assertTrue(
                        db.session.scalar(
                            select(ChannelJob.id).where(ChannelJob.error_code == code)
                        )
                    )
                    member = db.session.scalar(
                        select(TenantUser).where(
                            TenantUser.user_id == self.owner_id,
                            TenantUser.tenant_id == self.tenant_id,
                        )
                    )
                    member.active = True
                    db.session.get(Plan, "default-pro").features = {}
                    db.session.get(Tenant, self.tenant_id).status = "active"
                    db.session.commit()
        self.provider.feed.assert_not_called()

    def test_ari_snapshot_uses_rates_inventory_and_cli(self):
        booking = self.request(
            "post",
            "/reservations",
            json={
                "guest": "Booked one",
                "rooms": ["101"],
                "checkIn": "2030-01-01",
                "checkOut": "2030-01-03",
                "source": "Direct",
            },
        )
        self.assertEqual(booking.status_code, 201, booking.json)
        self.clear_push_jobs()
        rates = self.request(
            "put",
            "/rates",
            json={
                "roomTypeId": "rt-a",
                "start": "2030-01-01",
                "end": "2030-01-03",
                "price": "150",
                "stopSell": False,
            },
        )
        self.assertEqual(rates.status_code, 200, rates.json)
        self.assertEqual(len(self.jobs()), 1, "rates mutation must enqueue in its transaction")
        job_id = self.jobs()[0]["id"]
        result = self.app.test_cli_runner().invoke(
            args=["process-channel-jobs", "--tenant", self.tenant_id, "--limit", "1"]
        )
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertEqual(next(j for j in self.jobs() if j["id"] == job_id)["status"], "succeeded")
        self.assertEqual(self.provider.push_availability.call_args.args[0][0]["availability"], 1)
        self.assertEqual(self.provider.push_restrictions.call_args.args[0][0]["rate"], "150.0000")

    def test_unsupported_rate_plan_and_partial_provider_failure_are_visible(self):
        def per_person(resource, property_id):
            data = self.catalog(resource, property_id)
            if resource == "rate_plans":
                data[0]["attributes"]["sell_mode"] = "per_person"
            return data

        self.provider.catalog.side_effect = per_person
        self.request(
            "post",
            "/channels/jobs",
            json={"kind": "push_ari", "start": "2030-01-01", "end": "2030-01-03"},
        )
        self.run_jobs()
        self.assertEqual(self.jobs()[0]["errorCode"], "channel_rate_plan_unsupported")
        self.provider.push_availability.assert_not_called()
        self.provider.catalog.side_effect = self.catalog
        self.provider.push_restrictions.side_effect = ProviderError("provider_rejected")
        failed_id = self.jobs()[0]["id"]
        self.assertEqual(
            self.request("post", f"/channels/jobs/{failed_id}/retry", json={}).status_code, 202
        )
        with patch("pms_api.channels.service.utcnow", return_value=utcnow() + timedelta(seconds=7)):
            self.run_jobs()
        self.assertEqual(self.jobs()[0]["errorCode"], "provider_rejected")
        self.provider.push_availability.assert_called_once()

    def test_job_date_bounds_and_unknown_fields_rejected(self):
        for body in (
            {"kind": "push_ari", "start": "2030-01-01", "end": "2030-02-02"},
            {"kind": "pull_bookings", "apiKey": "x"},
            {"kind": "ack_revision"},
        ):
            self.assertEqual(self.request("post", "/channels/jobs", json=body).status_code, 422)

    def test_untrusted_json_types_rejected_without_server_error(self):
        for value in ([], {}, True):
            self.assertEqual(
                self.request(
                    "put", "/channels/config", json={**self.config, "environment": value}
                ).status_code,
                422,
            )
            self.assertEqual(
                self.request("post", "/channels/jobs", json={"kind": value}).status_code, 422
            )
            body = {"event": value, "property_id": PROPERTY}
            self.assertEqual(
                self.client.post(
                    f"/api/channex/webhooks/{self.tenant_id}",
                    json=body,
                    headers={"X-Channex-Webhook-Secret": "fixture-webhook-secret-32-characters"},
                ).status_code,
                422,
            )
        for field in ("status", "currency", "payment_collect"):
            entity = revision(13)
            entity["attributes"][field] = {}
            from pms_api.channels.importer import normalize
            from pms_api.security import ApiError

            with self.assertRaises(ApiError):
                normalize(entity, PROPERTY)

    def test_no_data_webhooks_coalesce_pending_but_allow_later_bookings(self):
        body = {"event": "booking", "property_id": PROPERTY}
        path, headers = (
            f"/api/channex/webhooks/{self.tenant_id}",
            {"X-Channex-Webhook-Secret": "fixture-webhook-secret-32-characters"},
        )
        for _ in range(2):
            self.assertEqual(self.client.post(path, json=body, headers=headers).status_code, 202)
        self.assertEqual(len(self.jobs()), 1)
        self.run_jobs()
        self.assertEqual(self.client.post(path, json=body, headers=headers).status_code, 202)
        self.assertEqual(len(self.jobs()), 2, "A later no-data event must start a fresh feed poll")

    def test_empty_booking_poll_does_not_lock_unused_mapping(self):
        self.request("post", "/channels/jobs", json={"kind": "pull_bookings"})
        mapping = {
            "roomTypeId": "rt-a",
            "channexRoomTypeId": REMOTE_ROOM,
            "channexRatePlanId": REMOTE_RATE,
            "active": False,
        }
        result = self.request("put", "/channels/mappings", json=mapping)
        self.assertEqual(result.status_code, 200, result.json)
        self.assertFalse(result.json["active"])

    def test_scheduler_coalesces_bucket_and_recovers_missed_webhook(self):
        from pms_api.channels.service import schedule_jobs

        instant = utcnow()
        with self.app.app_context(), patch("pms_api.channels.service.utcnow", return_value=instant):
            self.assertEqual(schedule_jobs(self.tenant_id), 13)
            self.assertEqual(schedule_jobs(self.tenant_id), 0)
        self.assertEqual(len(self.jobs()), 13)
        self.provider.feed.return_value = [revision()]
        self.provider.revision.return_value = revision()
        self.run_jobs(15)
        self.assertEqual(len(self.local_bookings()), 1)
        with (
            self.app.app_context(),
            patch("pms_api.channels.service.utcnow", return_value=instant + timedelta(seconds=60)),
        ):
            self.assertEqual(schedule_jobs(self.tenant_id), 1)
            self.assertEqual(schedule_jobs(self.tenant_id), 0)

    def test_scheduler_does_not_schedule_disabled_feature(self):
        from pms_api.channels.service import schedule_jobs

        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.get(Plan, "default-pro").features = {"OTA_SYNC": False}
            db.session.commit()
            self.assertEqual(schedule_jobs(self.tenant_id), 0)
        self.provider.feed.assert_not_called()

    def test_failed_local_commit_never_acknowledges_or_leaves_booking(self):
        self.enqueue_revision(revision())
        with self.app.app_context():
            commit = db.session.commit
            attempts = []

            def first_commit_fails():
                attempts.append(1)
                if len(attempts) == 1:
                    raise SQLAlchemyError("fixture commit failure")
                return commit()

            with patch.object(db.session, "commit", side_effect=first_commit_fails):
                self.assertEqual(process_jobs(self.tenant_id, 1), 1)
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(
                db.session.scalar(select(func.count()).select_from(ChannelRevision)), 0
            )
        self.assertEqual(self.local_bookings(), [])
        self.assertEqual(self.jobs()[0]["errorCode"], "channel_database_conflict")
        self.provider.ack.assert_not_called()


class ChannelRecoveryTests(ChannelTestCase):
    def test_individual_retry_recovers_review_after_provider_data_is_corrected(self):
        self.import_booking(revision(amount="250"))
        failed_id = self.jobs()[0]["id"]
        self.assertEqual(self.jobs()[0]["errorCode"], "booking_amount_mismatch")
        self.provider.feed.return_value = [revision()]
        self.provider.revision.return_value = revision()

        response = self.request("post", f"/channels/jobs/{failed_id}/retry", json={})
        self.assertEqual(response.status_code, 202, response.json)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(
                db.session.get(ChannelJob, response.json["id"]).payload,
                {"revisionId": revision()["id"], "retryReview": True},
            )
        self.run_jobs(10)

        self.assertEqual(len(self.local_bookings()), 1)
        recovered = next(j for j in self.jobs() if j["id"] == failed_id)
        self.assertEqual((recovered["status"], recovered["attempts"]), ("succeeded", 1))
        self.provider.ack.assert_called_once_with(revision()["id"])
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(
                db.session.scalar(select(func.count()).select_from(ChannelRevision)), 1
            )

    def test_scheduled_poll_and_webhook_do_not_restart_terminal_revision_failure(self):
        from pms_api.channels.service import schedule_jobs

        self.import_booking(revision(amount="250"))
        failed_id = self.jobs()[0]["id"]
        self.provider.feed.return_value = [revision()]
        self.provider.revision.return_value = revision()
        with self.app.app_context():
            self.assertGreater(schedule_jobs(self.tenant_id), 0)
        self.run_jobs()
        self.enqueue_revision(revision())

        failed = next(j for j in self.jobs() if j["id"] == failed_id)
        self.assertEqual((failed["status"], failed["attempts"]), ("needs_review", 1))
        self.assertEqual(self.local_bookings(), [])
        self.provider.ack.assert_not_called()
        self.assertEqual(self.provider.revision.call_count, 1)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            polls = db.session.scalars(
                select(ChannelJob).where(
                    ChannelJob.kind == "pull_bookings", ChannelJob.dedupe_key.like("poll:%")
                )
            ).all()
            self.assertEqual(len(polls), 1)
            self.assertEqual(polls[0].payload, {})

    def test_manual_poll_recovers_failed_ack_without_fetching_or_importing_again(self):
        self.import_booking()
        self.provider.ack.side_effect = ProviderError("provider_rejected")
        self.run_jobs()
        failed = next(j for j in self.jobs() if j["kind"] == "ack_revision")
        self.assertEqual(failed["status"], "failed")
        self.provider.ack.side_effect = None
        self.provider.feed.return_value = [revision()]

        response = self.request("post", "/channels/jobs", json={"kind": "pull_bookings"})
        self.assertEqual(response.status_code, 202, response.json)
        self.run_jobs(5)

        recovered = next(j for j in self.jobs() if j["id"] == failed["id"])
        self.assertEqual((recovered["status"], recovered["attempts"]), ("succeeded", 1))
        self.assertEqual(len(self.local_bookings()), 1)
        self.assertEqual(self.provider.revision.call_count, 1)
        self.assertEqual(self.provider.ack.call_count, 2)

    def test_manual_recovery_does_not_bypass_currency_change_review(self):
        response = self.request(
            "put", "/pricing/exchange-rates", json={"currency": "USD", "rate": "25000"}
        )
        self.assertEqual(response.status_code, 200, response.json)
        original = revision()
        original["attributes"]["currency"] = "USD"
        self.import_booking(original)
        self.run_jobs()
        self.provider.ack.reset_mock()
        changed = revision(11, "modified")
        self.import_booking(changed)
        failed = next(j for j in self.jobs() if j["errorCode"] == "booking_requires_review")
        self.provider.feed.return_value = [changed]

        response = self.request("post", "/channels/jobs", json={"kind": "pull_bookings"})
        self.assertEqual(response.status_code, 202, response.json)
        self.run_jobs(5)

        repeated = next(j for j in self.jobs() if j["id"] == failed["id"])
        self.assertEqual(
            (repeated["status"], repeated["errorCode"]), ("needs_review", "booking_requires_review")
        )
        self.provider.ack.assert_not_called()
        self.assertEqual(self.provider.revision.call_count, 2)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(db.session.scalar(select(Reservation.currency)), "USD")
            self.assertIsNone(
                db.session.scalar(
                    select(ChannelRevision.id).where(ChannelRevision.revision_id == changed["id"])
                )
            )

    def test_failed_dedupe_retry_is_explicit_bounded_and_uses_current_actor(self):
        from flask import g

        from pms_api.channels.service import queue_job
        from pms_api.core_models import User
        from pms_api.security import ApiError

        self.enqueue_revision(revision())
        self.provider.revision.side_effect = ProviderError("provider_rejected")
        self.run_jobs()
        failed_id = self.jobs()[0]["id"]
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            failed = db.session.get(ChannelJob, failed_id)
            failed.actor_id = "frontdesk"
            for number in range(500):
                db.session.add(
                    ChannelJob(
                        id=f"recovery-pending-{number}",
                        tenant_id=self.tenant_id,
                        actor_id=self.owner_id,
                        kind="pull_bookings",
                        payload={},
                    )
                )
            db.session.commit()
            set_context(self.owner_id, self.tenant_id)
            g.tenant = db.session.get(Tenant, self.tenant_id)
            g.user = db.session.get(User, self.owner_id)
            details, key = {"revisionId": revision()["id"]}, "revision:" + revision()["id"]
            existing = queue_job(self.tenant_id, self.owner_id, "pull_bookings", details, key)
            self.assertEqual(
                (existing.id, existing.status, existing.actor_id),
                (failed_id, "failed", "frontdesk"),
            )
            with self.assertRaises(ApiError) as raised:
                queue_job(
                    self.tenant_id, self.owner_id, "pull_bookings", details, key, retry_failed=True
                )
            self.assertEqual(raised.exception.code, "channel_queue_full")
            self.assertEqual(failed.status, "failed")

            db.session.delete(db.session.get(ChannelJob, "recovery-pending-0"))
            db.session.flush()
            recovered = queue_job(
                self.tenant_id, self.owner_id, "pull_bookings", details, key, retry_failed=True
            )
            self.assertEqual(
                (recovered.id, recovered.status, recovered.attempts, recovered.actor_id),
                (failed_id, "queued", 0, self.owner_id),
            )
            self.assertIsNone(recovered.error_code)
            self.assertIsNone(recovered.completed_at)
            self.assertLessEqual(recovered.available_at, utcnow())
            self.assertEqual(
                db.session.scalar(
                    select(func.count())
                    .select_from(ChannelJob)
                    .where(ChannelJob.status.in_(["queued", "processing"]))
                ),
                500,
            )

            recovered.attempts, recovered.actor_id = 2, "frontdesk"
            recovered.available_at = utcnow() + timedelta(minutes=5)
            queued_at = recovered.available_at
            for status in ("queued", "processing", "succeeded"):
                with self.subTest(status=status):
                    recovered.status = status
                    again = queue_job(
                        self.tenant_id,
                        self.owner_id,
                        "pull_bookings",
                        details,
                        key,
                        retry_failed=True,
                    )
                    self.assertEqual(
                        (again.status, again.attempts, again.actor_id, again.available_at),
                        (status, 2, "frontdesk", queued_at),
                    )

    def test_manual_polls_coalesce_without_sharing_or_downgrading_scheduled_poll(self):
        from pms_api.channels.service import schedule_jobs

        first = self.request("post", "/channels/jobs", json={"kind": "pull_bookings"})
        second = self.request("post", "/channels/jobs", json={"kind": "pull_bookings"})
        self.assertEqual((first.status_code, second.status_code), (202, 202))
        self.assertEqual(first.json["id"], second.json["id"])
        with self.app.app_context():
            schedule_jobs(self.tenant_id)
            set_context(self.owner_id, self.tenant_id)
            polls = db.session.scalars(
                select(ChannelJob).where(ChannelJob.kind == "pull_bookings")
            ).all()
            self.assertEqual(len(polls), 2)
            self.assertEqual(
                db.session.get(ChannelJob, first.json["id"]).payload, {"retryFailed": True}
            )
            self.assertEqual(next(j for j in polls if j.id != first.json["id"]).payload, {})
        third = self.request("post", "/channels/jobs", json={"kind": "pull_bookings"})
        self.assertEqual(third.status_code, 202, third.json)
        self.assertEqual(third.json["id"], first.json["id"])

    def test_worker_cli_logs_job_results_and_revision_without_credentials_or_payload(self):
        import io
        import logging

        self.assertFalse(self.app.debug)
        self.enqueue_revision(revision(amount="250"))
        stream = io.StringIO()
        handler = logging.StreamHandler(stream)
        logger, previous_level = self.app.logger, self.app.logger.level
        logger.setLevel(logging.WARNING)
        logger.addHandler(handler)
        try:
            result = self.app.test_cli_runner().invoke(
                args=["process-channel-jobs", "--tenant", self.tenant_id, "--limit", "2"]
            )
            self.assertEqual(result.exit_code, 0, result.output)
            self.assertEqual(logger.level, logging.INFO)
            output = stream.getvalue()
            for expected in (
                "kind=pull_bookings",
                "revision=" + revision()["id"],
                "status=needs_review",
                "error=booking_amount_mismatch",
                "status=succeeded",
            ):
                self.assertIn(expected, output)
            for secret in (
                "fixture-sensitive-card",
                "fixture-api-key",
                "fixture-webhook-secret-32-characters",
                "guest@test.local",
            ):
                self.assertNotIn(secret, output)
        finally:
            logger.removeHandler(handler)
            logger.setLevel(previous_level)
