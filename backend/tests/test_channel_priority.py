"""Inventory changes take the next paced slot ahead of the daily baseline."""

from datetime import date, timedelta
from unittest.mock import patch

from sqlalchemy import func, select

from pms_api.channels.models import ChannelJob
from pms_api.channels.service import queue_job
from pms_api.core_models import utcnow
from pms_api.extensions import db
from pms_api.security import set_context
from tests.test_channels_integration import ChannelTestCase


class ChannelPriorityTests(ChannelTestCase):
    def setUp(self):
        super().setUp()
        self.now = utcnow() + timedelta(minutes=1)
        clock = patch("pms_api.channels.service.utcnow", side_effect=lambda: self.now)
        clock.start()
        self.addCleanup(clock.stop)

    def queue_ari(self, first, *, daily=False):
        details = {"start": first.isoformat(), "end": (first + timedelta(days=31)).isoformat()}
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            job = queue_job(
                self.tenant_id,
                self.owner_id,
                "push_ari",
                details,
                f"daily:2030-01-01:{first}" if daily else None,
            )
            job.available_at = self.now
            db.session.flush()
            job_id = job.id
            db.session.commit()
        return job_id

    def status(self, job_id):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            return db.session.get(ChannelJob, job_id).status

    def test_new_change_uses_next_slot_ahead_of_eleven_future_chunks(self):
        first = date(2030, 1, 1)
        baseline = [self.queue_ari(first + timedelta(days=31 * i), daily=True) for i in range(12)]
        self.assertEqual(self.run_jobs(10), 1)
        self.assertEqual(self.status(baseline[0]), "succeeded")
        changed = self.queue_ari(first)
        self.assertEqual(self.run_jobs(10), 0)  # The provider cooldown still applies.
        self.now += timedelta(seconds=7)
        self.assertEqual(self.run_jobs(10), 1)
        self.assertEqual(self.status(changed), "succeeded")
        self.assertTrue(all(self.status(job_id) == "queued" for job_id in baseline[1:]))

    def test_change_promotes_matching_baseline_without_duplicate_or_lost_dedupe(self):
        first = date(2030, 1, 1)
        older = self.queue_ari(first, daily=True)
        target = first + timedelta(days=31)
        promoted = self.queue_ari(target, daily=True)
        self.assertEqual(self.queue_ari(target), promoted)
        self.assertEqual(self.queue_ari(target), promoted)
        self.assertEqual(self.queue_ari(target, daily=True), promoted)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(db.session.scalar(select(func.count()).select_from(ChannelJob)), 2)
        self.assertEqual(self.run_jobs(10), 1)
        self.assertEqual(self.status(promoted), "succeeded")
        self.assertEqual(self.status(older), "queued")

    def test_daily_coalescing_does_not_demote_existing_change(self):
        first = date(2030, 1, 1)
        older = self.queue_ari(first, daily=True)
        target = first + timedelta(days=31)
        changed = self.queue_ari(target)
        self.assertEqual(self.queue_ari(target, daily=True), changed)
        self.assertEqual(self.run_jobs(10), 1)
        self.assertEqual(self.status(changed), "succeeded")
        self.assertEqual(self.status(older), "queued")
