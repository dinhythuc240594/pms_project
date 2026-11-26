"""ARI cooldowns persist across workers without delaying booking reads or ACKs."""

import subprocess
import sys
from datetime import timedelta
from unittest.mock import patch
from uuid import UUID

from sqlalchemy import select

from pms_api.channels.client import ProviderError
from pms_api.channels.models import ChannelConnection, ChannelJob, ChannelMapping, ChannelRevision
from pms_api.channels.service import process_jobs
from pms_api.core_models import AuditLog, utcnow
from pms_api.extensions import db
from pms_api.security import set_context
from tests.test_channels_integration import (
    BOOKING,
    PROPERTY,
    REMOTE_RATE,
    REMOTE_ROOM,
    ChannelTestCase,
)


class ChannelPacingTests(ChannelTestCase):
    def setUp(self):
        super().setUp()
        self.now = utcnow() + timedelta(minutes=1)
        clock = patch("pms_api.channels.service.utcnow", side_effect=lambda: self.now)
        clock.start()
        self.addCleanup(clock.stop)
        self.sequence = 0

    def queue(self, kind="push_ari", payload=None, **values):
        self.sequence += 1
        with self.app.app_context():
            tenant_id = values.pop("tenant_id", self.tenant_id)
            actor_id = "owner-b" if tenant_id == self.other_tenant_id else self.owner_id
            set_context(actor_id, tenant_id)
            job = ChannelJob(
                tenant_id=tenant_id,
                actor_id=actor_id,
                kind=kind,
                payload=payload
                if payload is not None
                else {"start": "2030-01-01", "end": "2030-01-03"},
                created_at=values.pop(
                    "created_at", self.now + timedelta(microseconds=self.sequence)
                ),
                available_at=values.pop("available_at", self.now),
                **values,
            )
            db.session.add(job)
            db.session.flush()
            job_id = job.id
            db.session.commit()
            return job_id

    def saved(self, job_id):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            job = db.session.get(ChannelJob, job_id)
            return job.status, job.attempts, job.available_at

    def cooldown(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            return db.session.scalar(select(ChannelConnection)).ari_available_at

    def test_success_paces_existing_and_newly_queued_ari(self):
        first, second = self.queue(), self.queue()
        self.assertEqual(self.run_jobs(10), 1)
        self.assertEqual(self.saved(first)[:2], ("succeeded", 1))
        self.assertEqual(self.saved(second)[:2], ("queued", 0))
        self.assertEqual(self.cooldown(), self.now + timedelta(seconds=7))
        third = self.queue()
        self.now += timedelta(seconds=6)
        self.assertEqual(self.run_jobs(10), 0)
        self.now += timedelta(seconds=1)
        self.assertEqual(self.run_jobs(10), 1)
        self.assertEqual(self.saved(second)[:2], ("succeeded", 1))
        self.assertEqual(self.saved(third)[:2], ("queued", 0))
        self.assertEqual(self.provider.push_availability.call_count, 4)
        self.assertEqual(self.provider.push_restrictions.call_count, 2)

    def test_oldest_cooling_ari_does_not_starve_feed_or_ack(self):
        first, second = self.queue(), self.queue()
        poll = self.queue("pull_bookings", {})
        revision_id = str(UUID(int=50))
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.add(
                ChannelRevision(
                    tenant_id=self.tenant_id,
                    revision_id=revision_id,
                    booking_id=BOOKING,
                    outcome="stale",
                )
            )
            db.session.commit()
        ack = self.queue("ack_revision", {"revisionId": revision_id})
        self.assertEqual(self.run_jobs(10), 3)
        for job_id in (first, poll, ack):
            self.assertEqual(self.saved(job_id)[:2], ("succeeded", 1))
        self.assertEqual(self.saved(second)[:2], ("queued", 0))
        self.provider.feed.assert_called_once_with(PROPERTY)
        self.provider.ack.assert_called_once_with(revision_id)

    def test_new_worker_process_observes_committed_cooldown(self):
        self.queue()
        second = self.queue()
        self.assertEqual(self.run_jobs(), 1)
        script = """
import os
import sys
from datetime import datetime
from unittest.mock import patch
from pms_api import create_app
from pms_api.channels.service import process_jobs
app = create_app({
    "APP_ENV": "testing",
    "DATABASE_URL": os.environ["TEST_DATABASE_URL"],
    "DATABASE_MIGRATION_URL": os.environ["TEST_DATABASE_MIGRATION_URL"],
}, env_file=None)
with app.app_context(), patch("pms_api.channels.service.utcnow", return_value=datetime.fromisoformat(sys.argv[1])), patch("pms_api.channels.service.ChannexClient", side_effect=AssertionError("ARI cooldown bypassed")):
    print(process_jobs("test-hotel-a", 10))
"""
        result = subprocess.run(
            [sys.executable, "-c", script, self.now.isoformat()],
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "0")
        self.assertEqual(self.saved(second)[:2], ("queued", 0))

    def test_retryable_ari_failure_cools_other_jobs_for_a_minute(self):
        first, second = self.queue(), self.queue()
        self.provider.push_availability.side_effect = ProviderError(
            "provider_rate_limited", retryable=True
        )
        self.assertEqual(self.run_jobs(10), 1)
        self.assertEqual(self.saved(first), ("queued", 1, self.now + timedelta(seconds=30)))
        self.assertEqual(self.saved(second)[:2], ("queued", 0))
        self.assertEqual(self.cooldown(), self.now + timedelta(seconds=60))
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            event = db.session.scalar(
                select(AuditLog).where(AuditLog.event == "channel.sync_error")
            )
            self.assertEqual(event.details["status"], "queued")
        self.now += timedelta(seconds=30)
        self.assertEqual(self.run_jobs(10), 0)
        self.provider.push_availability.side_effect = None
        self.now += timedelta(seconds=30)
        self.assertEqual(self.run_jobs(10), 1)
        self.assertEqual(self.saved(first)[:2], ("succeeded", 2))
        self.assertEqual(self.saved(second)[:2], ("queued", 0))

    def test_retryable_ari_failure_respects_longer_job_backoff(self):
        first = self.queue(attempts=2)
        second = self.queue()
        self.provider.push_restrictions.side_effect = ProviderError(
            "provider_unavailable", retryable=True
        )
        self.assertEqual(self.run_jobs(10), 1)
        self.assertEqual(self.saved(first), ("queued", 3, self.now + timedelta(seconds=120)))
        self.assertEqual(self.cooldown(), self.now + timedelta(seconds=120))
        self.now += timedelta(seconds=60)
        self.assertEqual(self.run_jobs(10), 0)
        self.assertEqual(self.saved(second)[:2], ("queued", 0))

    def test_terminal_ari_failure_still_paces_next_attempt(self):
        first, second = self.queue(), self.queue()
        self.provider.push_restrictions.side_effect = ProviderError("provider_rejected")
        self.assertEqual(self.run_jobs(10), 1)
        self.assertEqual(self.saved(first)[:2], ("failed", 1))
        self.assertEqual(self.cooldown(), self.now + timedelta(seconds=7))
        self.assertEqual(self.saved(second)[:2], ("queued", 0))
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            event = db.session.scalar(
                select(AuditLog).where(AuditLog.event == "channel.sync_error")
            )
            self.assertEqual(event.details["status"], "failed")

    def test_other_tenant_can_publish_during_cooldown(self):
        self.queue()
        self.assertEqual(self.run_jobs(), 1)
        other_property = str(UUID(int=100))
        with self.app.app_context():
            set_context("owner-b", self.other_tenant_id)
            db.session.add(
                ChannelConnection(
                    tenant_id=self.other_tenant_id,
                    actor_id="owner-b",
                    environment="staging",
                    property_id=other_property,
                    credential_ref=self.config["credentialRef"],
                    webhook_secret_ref=self.config["webhookSecretRef"],
                    active=True,
                    inventory_reconciled_at=self.now,
                )
            )
            db.session.add(
                ChannelMapping(
                    tenant_id=self.other_tenant_id,
                    room_type_id="rt-b",
                    remote_room_type_id=REMOTE_ROOM,
                    remote_rate_plan_id=REMOTE_RATE,
                )
            )
            db.session.commit()
        self.queue(tenant_id=self.other_tenant_id)

        def catalog(resource, property_id):
            entities = self.catalog(resource, PROPERTY)
            for entity in entities:
                entity["relationships"]["property"]["data"]["id"] = property_id
            return entities

        self.provider.catalog.side_effect = catalog
        with self.app.app_context():
            self.assertEqual(process_jobs(self.other_tenant_id, 10), 1)
        self.assertEqual(self.provider.push_availability.call_count, 4)

    def test_pause_mapping_shares_ari_pacing(self):
        self.queue()
        self.assertEqual(self.run_jobs(), 1)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            mapping = db.session.scalar(select(ChannelMapping))
            mapping.pause_requested = True
            mapping_id = mapping.id
            db.session.commit()
        paused = self.queue("pause_mapping", {"mappingId": mapping_id})
        self.assertEqual(self.run_jobs(10), 0)
        self.now += timedelta(seconds=7)
        self.assertEqual(self.run_jobs(10), 1)
        self.assertEqual(self.saved(paused)[:2], ("succeeded", 1))
        self.assertEqual(self.cooldown(), self.now + timedelta(seconds=7))
        values = self.provider.push_availability.call_args.args[0]
        self.assertTrue(all(value["availability"] == 0 for value in values))

    def test_publisher_cannot_be_overtaken_across_footprint_commits(self):
        first = self.queue()
        second = self.queue(
            created_at=self.now - timedelta(seconds=1), available_at=self.now + timedelta(seconds=1)
        )
        with self.app.app_context():
            commit = db.session.commit
            interleaved = False

            def commit_then_other_worker():
                nonlocal interleaved
                commit()
                if not interleaved:
                    interleaved = True
                    self.now += timedelta(seconds=1)
                    self.assertEqual(self.run_jobs(), 0)

            with patch.object(db.session, "commit", side_effect=commit_then_other_worker):
                self.assertEqual(process_jobs(self.tenant_id, 1), 1)
        self.assertEqual(self.saved(first)[:2], ("succeeded", 1))
        self.assertEqual(self.saved(second)[:2], ("queued", 0))
        self.assertEqual(self.provider.push_availability.call_count, 2)

    def test_provider_failure_keeps_tenant_locked_until_cooldown_is_saved(self):
        first, second = self.queue(), self.queue()
        self.provider.push_availability.side_effect = [
            ProviderError("provider_rate_limited", retryable=True),
            None,
        ]
        with self.app.app_context():
            rollback = db.session.rollback
            interleaved = False

            def rollback_then_other_worker():
                nonlocal interleaved
                rollback()
                if not interleaved:
                    interleaved = True
                    self.run_jobs()

            with patch.object(db.session, "rollback", side_effect=rollback_then_other_worker):
                self.assertEqual(process_jobs(self.tenant_id, 1), 1)
        self.assertEqual(self.saved(first)[:2], ("queued", 1))
        self.assertEqual(self.saved(second)[:2], ("queued", 0))
        self.assertEqual(self.cooldown(), self.now + timedelta(seconds=60))
        self.assertEqual(self.provider.push_availability.call_count, 1)
        self.assertEqual(self.run_jobs(10), 0)
