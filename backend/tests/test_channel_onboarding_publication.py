"""Onboarding changes cannot overtake an inventory snapshot already being sent."""

from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from sqlalchemy import select

from pms_api.channels.models import ChannelConnection, ChannelJob, ChannelMapping
from pms_api.channels.service import process_jobs
from pms_api.core_models import Tenant, utcnow
from pms_api.extensions import db
from pms_api.security import set_context
from tests.test_channels_integration import ChannelTestCase
from tests.test_channex_channels import CHANNEL
from tests.test_channex_remote import RATE, ROOM
from tests.test_tenant_remote_channels import TenantRemoteChannelFixture


class OnboardingPublicationTests(TenantRemoteChannelFixture):
    def setUp(self):
        super().setUp()
        self.channel["attributes"]["actions"] = ["load_future_reservations"]
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            connection = db.session.scalar(select(ChannelConnection))
            connection.inventory_reconciled_at = utcnow()
            db.session.get(Tenant, self.tenant_id).settings = {"currency": "USD"}
            db.session.add(
                ChannelMapping(
                    tenant_id=self.tenant_id,
                    room_type_id="rt-a",
                    remote_room_type_id=ROOM,
                    remote_rate_plan_id=RATE,
                )
            )
            db.session.commit()
        worker = patch("pms_api.channels.service.ChannexClient", return_value=self.provider)
        worker.start()
        self.addCleanup(worker.stop)
        self.provider.availability.side_effect = lambda *_: ChannelTestCase.stored_availability(
            self
        )
        self.provider.restrictions.side_effect = lambda *_: ChannelTestCase.stored_restrictions(
            self
        )

    def attempt_during_publication(self, suffix, body, *, remote=True):
        client, headers = self.login()
        queued = self.request(
            "post",
            "/channels/jobs",
            json={"kind": "push_ari", "start": "2030-01-01", "end": "2030-01-03"},
        )
        self.assertEqual(queued.status_code, 202, queued.json)

        def publishing(_values):
            if any(value["availability"] > 0 for value in _values):
                return
            executor = ThreadPoolExecutor(max_workers=1)
            try:
                if remote:
                    future = executor.submit(
                        self.remote,
                        suffix,
                        method="POST",
                        body=body,
                        client=client,
                        headers=headers,
                    )
                else:
                    future = executor.submit(
                        self.request,
                        "post",
                        suffix,
                        body,
                        client,
                        headers,
                    )
                response = future.result(timeout=5)
            finally:
                executor.shutdown(wait=False, cancel_futures=True)
            self.assertEqual(response.status_code, 409, response.json)
            self.assertEqual(response.json["error"]["code"], "channel_inventory_publishing")

        self.provider.push_availability.side_effect = publishing
        with self.app.app_context():
            self.assertEqual(process_jobs(self.tenant_id, 1), 1)
        self.provider.push_restrictions.assert_called_once()
        self.assertEqual(self.writes(), [])
        self.provider.load_future_reservations.assert_not_called()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertIsNotNone(
                db.session.scalar(select(ChannelConnection)).inventory_reconciled_at
            )

    def test_activation_is_rejected_while_inventory_is_being_sent(self):
        self.attempt_during_publication(
            f"/{CHANNEL}/activate",
            {"revision": self.detail()["revision"], "confirm": True},
        )

    def test_existing_booking_load_is_not_queued_during_publication(self):
        self.channel["attributes"]["is_active"] = True
        self.attempt_during_publication(
            f"/{CHANNEL}/load_bookings",
            {"revision": self.detail()["revision"], "confirm": True},
        )
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertIsNone(
                db.session.scalar(select(ChannelJob).where(ChannelJob.kind == "load_bookings"))
            )

    def test_failed_load_retry_remains_failed_during_publication(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            load = ChannelJob(
                tenant_id=self.tenant_id,
                actor_id=self.owner_id,
                kind="load_bookings",
                status="failed",
                payload={"channelId": CHANNEL, "target": "prior-target"},
            )
            db.session.add(load)
            db.session.flush()
            identifier = load.id
            db.session.commit()
        self.attempt_during_publication(f"/channels/jobs/{identifier}/retry", {}, remote=False)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(db.session.get(ChannelJob, identifier).status, "failed")
