"""Worker health is operational data; it cannot make liveness or tenant writes fail."""

from datetime import datetime, timedelta
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import select

from pms_api.core_models import Tenant, utcnow
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class WorkerHealthTests(DomainTestCase):
    def test_operations_requires_a_system_role_and_exposes_no_credentials(self):
        response = self.app.test_client().get("/api/admin/operations")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.client.get("/api/admin/operations").status_code, 403)
        self.client, self.headers = self.login("manager@test.local")
        response = self.client.get("/api/admin/operations")
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json["workers"]["channels"]["status"], "missing")
        self.assertNotIn("password", response.get_data(as_text=True).lower())
        self.assertEqual(self.client.get("/api/ready").status_code, 200)

    def test_heartbeat_is_durable_without_committing_the_callers_mutation(self):
        from pms_api.worker_health import WorkerHeartbeat, record_worker_heartbeat

        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            tenant = db.session.get(Tenant, self.tenant_id)
            original = tenant.name
            tenant.name = "must roll back"
            record_worker_heartbeat("channels", interval=15, succeeded=True)
            db.session.rollback()
            set_context(is_system=True, is_service=True)
            self.assertEqual(db.session.get(Tenant, self.tenant_id).name, original)
            heartbeat = db.session.scalar(select(WorkerHeartbeat))
            self.assertIsNotNone(heartbeat.last_success_at)
            db.session.rollback()
            set_context(self.owner_id, self.tenant_id)
            self.assertIsNone(db.session.scalar(select(WorkerHeartbeat)))

    def test_success_survives_start_heartbeat_and_staleness_uses_worker_interval(self):
        from pms_api.worker_health import record_worker_heartbeat

        now = utcnow()
        with self.app.app_context(), patch("pms_api.worker_health.utcnow", return_value=now):
            record_worker_heartbeat("housekeeping", interval=900, succeeded=True)
        later = now + timedelta(seconds=100)
        with self.app.app_context(), patch("pms_api.worker_health.utcnow", return_value=later):
            record_worker_heartbeat("housekeeping", interval=900)
        self.client, self.headers = self.login("manager@test.local")
        with patch("pms_api.worker_health.utcnow", return_value=later + timedelta(seconds=200)):
            state = self.client.get("/api/admin/operations").json
        worker = state["workers"]["housekeeping"]
        self.assertEqual(worker["status"], "ok")
        self.assertEqual(datetime.fromisoformat(worker["instances"][0]["lastSuccessAt"]), now)
        with patch("pms_api.worker_health.utcnow", return_value=later + timedelta(seconds=2701)):
            state = self.client.get("/api/admin/operations").json
        self.assertEqual(state["workers"]["housekeeping"]["status"], "stale")

    def test_saas_operations_omits_private_channel_queue_and_booking_review_data(self):
        from pms_api.channels.models import (
            ChannelBooking,
            ChannelBookingReview,
            ChannelConnection,
            ChannelJob,
        )

        now = utcnow()
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            booking_id = str(uuid4())
            db.session.add(
                ChannelBooking(
                    tenant_id=self.tenant_id,
                    booking_id=booking_id,
                    latest_revision_at=now,
                )
            )
            db.session.flush()
            db.session.add(
                ChannelBookingReview(
                    tenant_id=self.tenant_id,
                    booking_id=booking_id,
                    revision_id=str(uuid4()),
                    provider_status="new",
                    revision_at=now,
                    error_code="booking_overbooked",
                    created_at=now - timedelta(seconds=240),
                )
            )
            db.session.add(
                ChannelConnection(
                    tenant_id=self.tenant_id,
                    actor_id=self.owner_id,
                    environment="staging",
                    property_id=str(uuid4()),
                    credential_ref="fixture",
                    webhook_secret_ref="fixture",
                    pending_ari_start=now.date(),
                    pending_ari_end=(now + timedelta(days=1)).date(),
                    pending_ari_since=now - timedelta(seconds=90),
                )
            )
            for index, status in enumerate(("queued", "queued", "failed", "needs_review")):
                db.session.add(
                    ChannelJob(
                        tenant_id=self.tenant_id,
                        actor_id=self.owner_id,
                        kind="pull_bookings",
                        status=status,
                        created_at=now - timedelta(seconds=60 * (index + 1)),
                    )
                )
            db.session.commit()
        self.client, self.headers = self.login("manager@test.local")
        with patch("pms_api.worker_health.utcnow", return_value=now):
            response = self.client.get("/api/admin/operations")
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(set(response.json), {"checkedAt", "workers"})
        self.assertNotIn("channels", response.json)
        self.assertNotIn(booking_id, response.get_data(as_text=True))

    def test_scoped_worker_does_not_claim_coverage_for_another_hotel(self):
        from pms_api.worker_health import record_worker_heartbeat

        with self.app.app_context():
            record_worker_heartbeat("housekeeping", tenant_id=self.tenant_id, interval=900)
        self.client, self.headers = self.login("manager@test.local")
        state = self.client.get("/api/admin/operations").json["workers"]["housekeeping"]
        self.assertEqual((state["status"], state["uncoveredTenantCount"]), ("partial", 1))
        with self.app.app_context():
            record_worker_heartbeat("housekeeping", interval=900)
        state = self.client.get("/api/admin/operations").json["workers"]["housekeeping"]
        self.assertEqual((state["status"], state["uncoveredTenantCount"]), ("ok", 0))
