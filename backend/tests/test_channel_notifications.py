"""Temporary channel retries stay in history without alarming the hotel inbox."""

from sqlalchemy import select

from pms_api.channels.client import ProviderError
from pms_api.channels.models import ChannelJob
from pms_api.core_models import utcnow
from pms_api.extensions import db
from pms_api.security import set_context
from tests.test_channels_integration import ChannelTestCase


class ChannelNotificationTests(ChannelTestCase):
    def test_retrying_job_notifies_only_after_the_last_attempt(self):
        self.provider.feed.side_effect = ProviderError("provider_unavailable", True)
        response = self.request("post", "/channels/jobs", json={"kind": "pull_bookings"})
        self.assertEqual(response.status_code, 202, response.json)
        self.run_jobs()
        self.assertEqual(self.jobs()[0]["status"], "queued")
        inbox = self.request("get", "/notifications").json
        self.assertEqual(inbox["items"], [])

        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            job = db.session.scalar(select(ChannelJob).where(ChannelJob.id == response.json["id"]))
            job.attempts, job.available_at = 4, utcnow()
            db.session.commit()
        self.run_jobs()
        self.assertEqual(self.jobs()[0]["status"], "failed")
        inbox = self.request("get", "/notifications").json
        self.assertEqual([item["eventCode"] for item in inbox["items"]], ["OTA_SYNC_ERROR"])
        self.assertEqual(inbox["items"][0]["entityId"], response.json["id"])

    def test_terminal_provider_error_still_notifies_immediately(self):
        self.provider.feed.side_effect = ProviderError("provider_rejected")
        response = self.request("post", "/channels/jobs", json={"kind": "pull_bookings"})
        self.assertEqual(response.status_code, 202, response.json)
        self.run_jobs()
        self.assertEqual(self.jobs()[0]["status"], "failed")
        inbox = self.request("get", "/notifications").json
        self.assertEqual([item["eventCode"] for item in inbox["items"]], ["OTA_SYNC_ERROR"])

    def test_worker_logs_safe_http_and_transport_diagnostics(self):
        for error, expected in (
            (ProviderError("provider_rejected", http_status=401), "http_status=401 cause=-"),
            (
                ProviderError("provider_unavailable", True, failure_type="timeout"),
                "http_status=- cause=timeout",
            ),
        ):
            with self.subTest(expected=expected):
                self.provider.feed.side_effect = error
                self.request("post", "/channels/jobs", json={"kind": "pull_bookings"})
                with self.assertLogs(self.app.logger, level="WARNING") as logs:
                    self.run_jobs()
                self.assertIn(expected, logs.output[0])
