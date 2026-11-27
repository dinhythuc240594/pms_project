"""Run the real Channex HTTP client and worker against the local Postman simulation."""

import os
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit
from uuid import UUID

from sqlalchemy import select

from pms_api.channels.models import ChannelBooking, ChannelBookingReview, ChannelRevision
from pms_api.extensions import db
from pms_api.security import set_context
from tests.test_channels_integration import ChannelTestCase, revision


@unittest.skipUnless(
    os.environ.get("CHANNEX_SIMULATION_URL"), "Start the local Channex simulation."
)
class ChannelHttpSimulationTests(ChannelTestCase):
    def setUp(self):
        super().setUp()
        url = os.environ["CHANNEX_SIMULATION_URL"]
        target = urlsplit(url)
        if (
            target.scheme != "http"
            or target.hostname != "127.0.0.1"
            or target.username
            or target.password
        ):
            raise ValueError("Simulation tests only connect to a local HTTP stand-in.")
        self.patch_provider.stop()
        bases = patch.dict("pms_api.channels.client.BASES", {"staging": url.rstrip("/")})
        bases.start()
        self.addCleanup(bases.stop)

    def test_verified_cancellation_commits_before_the_separate_http_ack(self):
        self.import_booking(revision(12, "cancelled"))
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            link = db.session.scalar(select(ChannelBooking))
            self.assertIsNotNone(link.cancellation_verified_at)
            self.assertEqual(link.latest_revision_id, revision(14)["id"])
            self.assertEqual(db.session.scalar(select(ChannelRevision.outcome)), "cancelled")
        self.assertEqual(
            [job["status"] for job in self.jobs() if job["kind"] == "ack_revision"], ["queued"]
        )
        self.assertEqual(self.run_jobs(), 1)
        self.assertEqual(
            [job["status"] for job in self.jobs() if job["kind"] == "ack_revision"], ["succeeded"]
        )

    def test_cross_property_latest_revision_remains_an_unacked_review(self):
        self.import_booking(revision(22, "cancelled", booking_id=str(UUID(int=404))))
        self.assertEqual(self.run_jobs(), 0)
        self.assertEqual(self.jobs()[0]["status"], "needs_review")
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(
                db.session.scalar(select(ChannelBookingReview.error_code)),
                "channel_cancellation_unverified",
            )
            self.assertIsNone(db.session.scalar(select(ChannelRevision)))
            self.assertIsNone(db.session.scalar(select(ChannelBooking.cancellation_verified_at)))

    def test_http_503_retries_without_committing_cancellation_or_ack(self):
        self.import_booking(revision(32, "cancelled", booking_id=str(UUID(int=500))))
        self.assertEqual(self.jobs()[0]["status"], "queued")
        self.assertEqual(self.jobs()[0]["errorCode"], "provider_unavailable")
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertIsNone(db.session.scalar(select(ChannelBooking)))
            self.assertIsNone(db.session.scalar(select(ChannelRevision)))
