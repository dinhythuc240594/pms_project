"""Mapping edits, durable publication protection and safe OTA pause transitions."""

from copy import deepcopy
from datetime import timedelta
from unittest.mock import patch
from uuid import UUID

from sqlalchemy import select

from pms_api.channels.client import ProviderError
from pms_api.channels.models import ChannelJob, ChannelMapping
from pms_api.core_models import utcnow
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase
from tests.test_channels_integration import (
    REMOTE_RATE,
    REMOTE_ROOM,
    ChannelTestCase,
    revision,
)


class ChannelMappingLifecycleTests(ChannelTestCase):
    def setUp(self):
        super().setUp()
        self.now = utcnow() + timedelta(minutes=1)
        clock = patch("pms_api.channels.service.utcnow", side_effect=lambda: self.now)
        clock.start()
        self.addCleanup(clock.stop)

    def catalog(self, resource, property_id):
        values = super().catalog(resource, property_id)
        for room_id, rate_id in (
            (REMOTE_ROOM, str(UUID(int=99))),
            (str(UUID(int=100)), str(UUID(int=101))),
            (str(UUID(int=102)), str(UUID(int=103))),
        ):
            if resource == "room_types" and room_id == REMOTE_ROOM:
                continue
            entity = deepcopy(values[0])
            entity["id"] = room_id if resource == "room_types" else rate_id
            if resource == "rate_plans":
                entity["relationships"]["room_type"]["data"]["id"] = room_id
            values.append(entity)
        return values

    def mapping(self, **changes):
        body = {
            "roomTypeId": "rt-a",
            "channexRoomTypeId": REMOTE_ROOM,
            "channexRatePlanId": REMOTE_RATE,
            "active": True,
            **changes,
        }
        return self.request("put", "/channels/mappings", json=body)

    def publish(self):
        response = self.request(
            "post",
            "/channels/jobs",
            json={"kind": "push_ari", "start": "2030-01-01", "end": "2030-01-03"},
        )
        self.assertEqual(response.status_code, 202, response.json)
        self.assertEqual(self.run_jobs(), 1)

    def saved_mapping(self):
        return self.request("get", "/channels").json["mappings"][0]

    def test_webhook_and_empty_feed_history_do_not_lock_unused_mapping(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.add(
                ChannelJob(
                    tenant_id=self.tenant_id,
                    actor_id=self.owner_id,
                    kind="setup_webhook",
                    status="succeeded",
                    completed_at=utcnow(),
                )
            )
            db.session.commit()
        self.request("post", "/channels/jobs", json={"kind": "pull_bookings"})
        self.run_jobs()
        response = self.mapping(channexRatePlanId=str(UUID(int=99)), active=False)
        self.assertEqual(response.status_code, 200, response.json)
        self.assertFalse(response.json["active"])
        self.assertFalse(response.json["targetLocked"])

    def test_preflight_rejection_allows_correcting_ids(self):
        self.provider.catalog.side_effect = lambda *args: []
        self.publish()
        self.assertEqual(self.jobs()[0]["errorCode"], "channel_mapping_invalid")
        self.assertFalse(self.saved_mapping()["targetLocked"])
        response = self.mapping(channexRatePlanId=str(UUID(int=99)))
        self.assertEqual(response.status_code, 422, response.json)
        self.assertEqual(response.json["error"]["code"], "channel_mapping_invalid")
        self.assertEqual(self.saved_mapping()["channexRatePlanId"], REMOTE_RATE)
        self.provider.catalog.side_effect = self.catalog
        response = self.mapping(channexRatePlanId=str(UUID(int=99)))
        self.assertEqual(response.status_code, 200, response.json)
        self.provider.push_availability.assert_not_called()

    def test_queued_ari_is_not_yet_a_publication_and_unrelated_mapping_stays_editable(self):
        self.request(
            "post",
            "/channels/jobs",
            json={"kind": "push_ari", "start": "2030-01-01", "end": "2030-01-03"},
        )
        response = self.mapping(channexRatePlanId=str(UUID(int=99)))
        self.assertEqual(response.status_code, 200, response.json)
        self.mapping(channexRatePlanId=REMOTE_RATE)
        self.run_jobs()
        from pms_api.catalog.models import RoomType

        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.add(
                RoomType(
                    id="rt-extra",
                    tenant_id=self.tenant_id,
                    name="Other",
                    base_price=100,
                    capacity=2,
                )
            )
            db.session.commit()
        response = self.mapping(
            roomTypeId="rt-extra",
            channexRoomTypeId=str(UUID(int=100)),
            channexRatePlanId=str(UUID(int=101)),
        )
        self.assertEqual(response.status_code, 200, response.json)
        response = self.mapping(
            roomTypeId="rt-extra",
            channexRoomTypeId=str(UUID(int=102)),
            channexRatePlanId=str(UUID(int=103)),
            active=False,
        )
        self.assertEqual(response.status_code, 200, response.json)

    def test_successful_publication_locks_ids_but_allows_unchanged_save(self):
        self.publish()
        self.assertTrue(self.saved_mapping()["targetLocked"])
        self.assertEqual(self.mapping().status_code, 200)
        response = self.mapping(channexRatePlanId=str(UUID(int=99)))
        self.assertEqual(response.status_code, 409, response.json)
        self.assertIn("channel_mapping_has_history", str(response.json))

    def test_partial_publication_failure_still_locks_target(self):
        self.provider.push_restrictions.side_effect = ProviderError("provider_rejected")
        self.publish()
        self.assertEqual(self.jobs()[0]["status"], "failed")
        self.assertTrue(self.saved_mapping()["targetLocked"])
        self.assertEqual(self.mapping(channexRatePlanId=str(UUID(int=99))).status_code, 409)

    def test_process_crash_cannot_forget_possibly_published_mapping(self):
        self.provider.push_availability.side_effect = SystemExit("simulated worker crash")
        self.request(
            "post",
            "/channels/jobs",
            json={"kind": "push_ari", "start": "2030-01-01", "end": "2030-01-03"},
        )
        with self.assertRaises(SystemExit):
            self.run_jobs()
        self.assertTrue(self.saved_mapping()["targetLocked"])
        self.assertEqual((self.jobs()[0]["status"], self.jobs()[0]["attempts"]), ("processing", 1))
        self.assertEqual(self.run_jobs(), 0, "A replacement worker preserves the crash cooldown")
        self.assertEqual(self.jobs()[0]["status"], "queued")
        self.assertEqual(self.mapping(channexRatePlanId=str(UUID(int=99))).status_code, 409)

    def test_pause_closes_recorded_dates_before_changing_active_and_can_reactivate(self):
        self.publish()
        self.provider.reset_mock()
        self.provider.catalog.side_effect = self.catalog
        response = self.mapping(active=False)
        self.assertEqual(response.status_code, 200, response.json)
        self.assertTrue(response.json["active"])
        self.assertTrue(response.json["pauseRequested"])
        again = self.mapping(active=False)
        self.assertEqual(again.status_code, 200, again.json)
        self.assertEqual(sum(j["kind"] == "pause_mapping" for j in self.jobs()), 1)
        self.assertEqual(self.mapping(active=True).status_code, 409)
        self.now += timedelta(seconds=7)
        self.run_jobs()
        saved = self.saved_mapping()
        self.assertFalse(saved["active"])
        self.assertFalse(saved["pauseRequested"])
        availability = self.provider.push_availability.call_args.args[0]
        self.assertTrue(all(v["availability"] == 0 for v in availability))
        self.assertTrue(
            any(
                v["date_from"] == "2030-01-01" and v["date_to"] == "2030-01-02"
                for v in availability
            )
        )
        restrictions = self.provider.push_restrictions.call_args.args[0]
        self.assertTrue(all(v["stop_sell"] is True and "rate" not in v for v in restrictions))
        response = self.mapping(active=True)
        self.assertEqual(response.status_code, 200, response.json)
        self.assertTrue(response.json["active"])
        self.assertTrue(response.json["targetLocked"])

    def test_failed_close_retains_pending_pause_and_retry_finishes(self):
        self.publish()
        self.mapping(active=False)
        self.provider.push_restrictions.side_effect = ProviderError("provider_rejected")
        self.now += timedelta(seconds=7)
        self.run_jobs()
        failed = next(j for j in self.jobs() if j["kind"] == "pause_mapping")
        self.assertEqual(failed["status"], "failed")
        self.assertTrue(self.saved_mapping()["active"])
        self.assertTrue(self.saved_mapping()["pauseRequested"])
        self.provider.push_restrictions.side_effect = None
        response = self.request("post", f"/channels/jobs/{failed['id']}/retry", json={})
        self.assertEqual(response.status_code, 202, response.json)
        self.now += timedelta(seconds=7)
        self.run_jobs()
        self.assertFalse(self.saved_mapping()["active"])

    def test_paused_mapping_still_imports_booking_modifications_and_cancellations(self):
        self.import_booking()
        self.assertTrue(self.saved_mapping()["targetLocked"])
        self.run_jobs()  # ACK the committed receipt.
        self.mapping(active=False)
        self.run_jobs()
        self.assertFalse(self.saved_mapping()["active"])
        changed = revision(11, "modified", amount="240")
        changed["attributes"]["rooms"][0]["days"] = {"2030-01-01": "120", "2030-01-02": "120"}
        self.enqueue_revision(changed)
        self.run_jobs()
        self.assertTrue(
            any(j["status"] == "succeeded" and j["kind"] == "pull_bookings" for j in self.jobs())
        )
        self.run_jobs()  # ACK the modification.
        self.enqueue_revision(revision(12, "cancelled"))
        self.run_jobs()
        self.assertEqual(self.local_bookings()[0]["status"], "CANCELLED")

    def test_pending_pause_never_publishes_open_inventory(self):
        self.publish()
        self.request(
            "post",
            "/channels/jobs",
            json={"kind": "push_ari", "start": "2030-01-01", "end": "2030-01-03"},
        )
        self.mapping(active=False)
        self.provider.reset_mock()
        self.provider.catalog.side_effect = self.catalog
        self.now += timedelta(seconds=7)
        self.run_jobs()
        self.assertTrue(
            all(v["availability"] == 0 for v in self.provider.push_availability.call_args.args[0])
        )
        self.now += timedelta(seconds=7)
        self.run_jobs()
        self.assertFalse(self.saved_mapping()["active"])


class ChannelMappingMigrationTests(DomainTestCase):
    def test_legacy_webhook_history_stays_editable_but_unknown_ari_history_is_protected(self):
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            for suffix, kind in (("a", "setup_webhook"), ("b", "push_ari")):
                db.session.add(
                    ChannelMapping(
                        tenant_id=f"test-hotel-{suffix}",
                        room_type_id=f"rt-{suffix}",
                        remote_room_type_id=REMOTE_ROOM,
                        remote_rate_plan_id=REMOTE_RATE,
                    )
                )
                db.session.add(
                    ChannelJob(
                        tenant_id=f"test-hotel-{suffix}",
                        actor_id=f"owner-{suffix}",
                        kind=kind,
                        status="succeeded",
                        payload={}
                        if kind == "setup_webhook"
                        else {
                            "start": "2030-01-01",
                            "end": "2030-01-03",
                        },
                    )
                )
            db.session.commit()
        for args in (("db", "downgrade", "0017_merge_catalog_channels"), ("db", "upgrade")):
            result = self.app.test_cli_runner().invoke(args=list(args))
            self.assertEqual(result.exit_code, 0, result.output)
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            rows = {m.tenant_id: m for m in db.session.scalars(select(ChannelMapping))}
            self.assertIsNone(rows[self.tenant_id].used_at)
            other = rows[self.other_tenant_id]
            self.assertIsNotNone(other.used_at)
            self.assertEqual(other.published_ranges, [{"start": "2030-01-01", "end": "2030-01-03"}])
        result = self.app.test_cli_runner().invoke(
            args=["db", "downgrade", "0017_merge_catalog_channels"]
        )
        self.assertNotEqual(result.exit_code, 0, "Downgrade must not discard mapping protection")
