"""Booking mutations survive OTA backpressure and retain a durable retry range."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import date, timedelta
from unittest.mock import patch
from uuid import UUID

from sqlalchemy import func, select

from pms_api.channels.models import ChannelConnection, ChannelJob, ChannelRevision
from pms_api.channels.service import schedule_jobs
from pms_api.core_models import utcnow
from pms_api.extensions import db
from pms_api.security import set_context
from tests.test_channels_integration import PROPERTY, ChannelTestCase, revision


class ChannelBackpressureTests(ChannelTestCase):
    def test_full_revision_queue_drains_with_bounded_ack_jobs_after_commit(self):
        entities = {}
        now = utcnow() + timedelta(minutes=1)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            for number in range(500):
                entity = revision()
                entity["id"] = str(UUID(int=10000 + number))
                entity["attributes"]["inserted_at"] = (now + timedelta(seconds=number)).isoformat()
                entity["attributes"]["status"] = "new" if number == 0 else "modified"
                entities[entity["id"]] = entity
                db.session.add(
                    ChannelJob(
                        id=f"revision-{number:03d}",
                        tenant_id=self.tenant_id,
                        actor_id=self.owner_id,
                        kind="pull_bookings",
                        payload={"revisionId": entity["id"]},
                        dedupe_key="revision:" + entity["id"],
                        created_at=now + timedelta(microseconds=number),
                        available_at=now,
                    )
                )
            db.session.commit()
        self.provider.revision.side_effect = lambda key: deepcopy(entities[key])

        def acknowledged(revision_id):
            # A separate session must see the receipt before the provider receives ACK.
            with self.app.app_context():
                set_context(self.owner_id, self.tenant_id)
                self.assertIsNotNone(
                    db.session.scalar(
                        select(ChannelRevision.id).where(
                            ChannelRevision.revision_id == revision_id,
                        )
                    )
                )

        self.provider.ack.side_effect = acknowledged
        with (
            patch("pms_api.channels.service.utcnow", return_value=now),
            patch("pms_api.core_models.datetime") as clock,
        ):
            # SQLAlchemy's captured timestamp defaults must use the worker's clock too.
            clock.now.return_value = now
            self.assertEqual(self.run_jobs(), 1)
            self.provider.ack.assert_not_called()
            with self.app.app_context():
                set_context(self.owner_id, self.tenant_id)
                self.assertEqual(db.session.get(ChannelJob, "revision-000").status, "succeeded")
            for _ in range(11):
                self.run_jobs(100)
                with self.app.app_context():
                    set_context(self.owner_id, self.tenant_id)
                    pending = db.session.scalar(
                        select(func.count())
                        .select_from(ChannelJob)
                        .where(
                            ChannelJob.status.in_(["queued", "processing"]),
                        )
                    )
                    self.assertLessEqual(pending, 500)
                if self.provider.ack.call_count == 500:
                    break
        self.assertCountEqual([call.args[0] for call in self.provider.ack.call_args_list], entities)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(
                db.session.scalar(select(func.count()).select_from(ChannelRevision)), 500
            )
            self.assertEqual(
                db.session.scalar(
                    select(func.count())
                    .select_from(ChannelJob)
                    .where(
                        ChannelJob.kind.in_(["pull_bookings", "ack_revision"]),
                        ChannelJob.status.in_(["queued", "processing"]),
                    )
                ),
                0,
            )

    def test_full_queue_resolves_previous_reviews_and_feed_recovers_their_acks(self):
        older = [revision(10), revision(11, "modified")]
        for entity in older:
            entity["attributes"]["services"] = [{"name": "Unsupported breakfast"}]
            self.import_booking(entity)
        now = utcnow() + timedelta(minutes=1)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            previous_ids = list(
                db.session.scalars(
                    select(ChannelJob.id).where(
                        ChannelJob.status == "needs_review",
                    )
                )
            )
            self.assertEqual(len(previous_ids), 2)
            for number in range(499):
                db.session.add(
                    ChannelJob(
                        id=f"backlog-{number}",
                        tenant_id=self.tenant_id,
                        actor_id=self.owner_id,
                        kind="pull_bookings",
                        payload={"revisionId": str(UUID(int=1000 + number))},
                        available_at=now + timedelta(days=1),
                    )
                )
            db.session.commit()
        current = revision(12, "modified")
        self.enqueue_revision(current)
        with patch("pms_api.channels.service.utcnow", return_value=now):
            self.assertEqual(self.run_jobs(), 1)
            self.provider.ack.assert_not_called()
            with self.app.app_context():
                set_context(self.owner_id, self.tenant_id)
                self.assertTrue(
                    all(
                        db.session.get(ChannelJob, key).status == "succeeded"
                        for key in previous_ids
                    )
                )
                self.assertEqual(
                    db.session.scalar(
                        select(func.count())
                        .select_from(ChannelJob)
                        .where(
                            ChannelJob.status.in_(["queued", "processing"]),
                        )
                    ),
                    500,
                )
            self.assertEqual(self.run_jobs(), 1)
            self.provider.ack.assert_called_once_with(current["id"])
            with self.app.app_context():
                set_context(self.owner_id, self.tenant_id)
                for number in range(2):
                    db.session.delete(db.session.get(ChannelJob, f"backlog-{number}"))
                db.session.commit()
            self.provider.feed.return_value = older
            response = self.request("post", "/channels/jobs", json={"kind": "pull_bookings"})
            self.assertEqual(response.status_code, 202, response.json)
            self.assertEqual(self.run_jobs(3), 3)
        self.assertCountEqual(
            [call.args[0] for call in self.provider.ack.call_args_list],
            [entity["id"] for entity in [*older, current]],
        )

    def test_full_feed_commits_partial_fanout_and_resumes_without_exhausting_retries(self):
        entities = [
            {"id": str(UUID(int=number)), "attributes": {"property_id": PROPERTY}}
            for number in (501, 502)
        ]
        self.provider.feed.return_value = entities
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            for number in range(498):
                db.session.add(
                    ChannelJob(
                        id=f"backlog-{number}",
                        tenant_id=self.tenant_id,
                        actor_id=self.owner_id,
                        kind="pull_bookings",
                        payload={"revisionId": str(UUID(int=1000 + number))},
                        available_at=utcnow() + timedelta(days=1),
                    )
                )
            db.session.commit()
        response = self.request("post", "/channels/jobs", json={"kind": "pull_bookings"})
        self.assertEqual(response.status_code, 202, response.json)
        job_id = response.json["id"]
        self.assertEqual(self.run_jobs(), 1)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            job = db.session.get(ChannelJob, job_id)
            self.assertEqual(
                (job.status, job.attempts, job.error_code), ("queued", 0, "channel_queue_full")
            )
            first = db.session.scalar(
                select(ChannelJob).where(
                    ChannelJob.payload == {"revisionId": entities[0]["id"]},
                )
            )
            self.assertIsNotNone(first)
            first.available_at = utcnow() + timedelta(days=1)
            job.available_at = utcnow() - timedelta(seconds=1)
            db.session.delete(db.session.get(ChannelJob, "backlog-0"))
            db.session.commit()
        self.assertEqual(self.run_jobs(), 1)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(db.session.get(ChannelJob, job_id).status, "succeeded")
            for entity in entities:
                self.assertIsNotNone(
                    db.session.scalar(
                        select(ChannelJob.id).where(
                            ChannelJob.payload == {"revisionId": entity["id"]},
                        )
                    )
                )

    def test_booking_commits_during_remote_publication_and_queues_fresh_snapshot(self):
        response = self.request(
            "post",
            "/channels/jobs",
            json={
                "kind": "push_ari",
                "start": "2030-01-01",
                "end": "2030-01-03",
            },
        )
        self.assertEqual(response.status_code, 202, response.json)
        client, headers = self.login("frontdesk@test.local")
        snapshots = []

        def publishing(values):
            snapshots.append(values)
            if len(snapshots) == 1:
                executor = ThreadPoolExecutor(max_workers=1)
                try:
                    future = executor.submit(
                        self.request,
                        "post",
                        "/reservations",
                        {
                            "rooms": ["101"],
                            "checkIn": "2030-01-01",
                            "checkOut": "2030-01-03",
                            "guest": "Concurrent guest",
                            "phone": "0123456789",
                        },
                        client,
                        headers,
                    )
                    saved = future.result(timeout=5)
                finally:
                    executor.shutdown(wait=False, cancel_futures=True)
                self.assertEqual(saved.status_code, 201, saved.json)

        self.provider.push_availability.side_effect = publishing
        self.assertEqual(self.run_jobs(), 1)
        self.assertEqual(len(snapshots), 1)
        self.assertEqual({row["availability"] for row in snapshots[0]}, {0})
        interrupted = next(job for job in self.jobs() if job["id"] == response.json["id"])
        self.assertEqual(
            (interrupted["status"], interrupted["errorCode"]),
            ("queued", "channel_snapshot_changed"),
        )
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertIsNotNone(
                db.session.scalar(
                    select(ChannelJob.id).where(
                        ChannelJob.kind == "push_ari",
                        ChannelJob.status == "queued",
                        ChannelJob.payload == {"start": "2030-01-01", "end": "2030-01-03"},
                    )
                )
            )
            connection = db.session.scalar(select(ChannelConnection))
            connection.ari_available_at = utcnow() - timedelta(seconds=1)
            db.session.commit()
        self.assertEqual(self.run_jobs(), 1)
        self.assertEqual([values[0]["availability"] for values in snapshots], [0, 0, 1])

    def test_abandoned_publication_is_recovered_by_next_publisher(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            job = ChannelJob(
                tenant_id=self.tenant_id,
                actor_id=self.owner_id,
                kind="push_ari",
                status="processing",
                attempts=1,
                payload={"start": "2030-01-01", "end": "2030-01-03"},
            )
            db.session.add(job)
            db.session.flush()
            job_id = job.id
            db.session.commit()
        self.assertEqual(self.run_jobs(), 1)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            job = db.session.get(ChannelJob, job_id)
            self.assertEqual((job.status, job.attempts), ("succeeded", 2))

    def test_full_queue_does_not_rollback_booking_and_dirty_range_survives(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            for number in range(500):
                db.session.add(
                    ChannelJob(
                        id=f"backlog-{number}",
                        tenant_id=self.tenant_id,
                        actor_id=self.owner_id,
                        kind="pull_bookings",
                        payload={"revisionId": f"backlog-{number}"},
                        available_at=utcnow() + timedelta(days=1),
                    )
                )
            db.session.commit()

        response = self.request(
            "post",
            "/reservations",
            json={
                "rooms": ["101"],
                "checkIn": "2030-01-01",
                "checkOut": "2030-01-03",
                "guest": "Queue full guest",
                "phone": "0123456789",
            },
        )
        self.assertEqual(response.status_code, 201, response.json)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            connection = db.session.scalar(select(ChannelConnection))
            self.assertEqual(connection.pending_ari_start, date(2030, 1, 1))
            self.assertEqual(connection.pending_ari_end, date(2030, 1, 3))
            self.assertIsNotNone(connection.pending_ari_since)
            db.session.delete(db.session.get(ChannelJob, "backlog-0"))
            db.session.delete(db.session.get(ChannelJob, "backlog-1"))
            db.session.commit()
            schedule_jobs(self.tenant_id)
            set_context(self.owner_id, self.tenant_id)
            connection = db.session.scalar(select(ChannelConnection))
            self.assertIsNone(connection.pending_ari_start)
            self.assertIsNone(connection.pending_ari_end)
            self.assertIsNone(connection.pending_ari_since)
            self.assertIsNotNone(
                db.session.scalar(
                    select(ChannelJob.id).where(
                        ChannelJob.kind == "push_ari",
                        ChannelJob.payload == {"start": "2030-01-01", "end": "2030-01-03"},
                    )
                )
            )

    def test_dirty_range_drains_in_bounded_chunks_without_losing_tail(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            connection = db.session.scalar(select(ChannelConnection))
            connection.pending_ari_start = date(2030, 1, 1)
            connection.pending_ari_end = date(2030, 4, 1)
            connection.pending_ari_since = utcnow()
            for number in range(498):
                db.session.add(
                    ChannelJob(
                        id=f"backlog-{number}",
                        tenant_id=self.tenant_id,
                        actor_id=self.owner_id,
                        kind="pull_bookings",
                        payload={"revisionId": f"backlog-{number}"},
                    )
                )
            db.session.commit()
            schedule_jobs(self.tenant_id)
            set_context(self.owner_id, self.tenant_id)
            connection = db.session.scalar(select(ChannelConnection))
            self.assertEqual(connection.pending_ari_start, date(2030, 2, 1))
            self.assertEqual(connection.pending_ari_end, date(2030, 4, 1))
            self.assertIsNotNone(connection.pending_ari_since)
