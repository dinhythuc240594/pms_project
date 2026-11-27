"""Onboarding keeps ARI closed while accepting booking reads and load requests."""

import io
import json
import unittest
from datetime import timedelta
from unittest.mock import Mock, patch
from uuid import UUID

from flask import g
from sqlalchemy import select

from pms_api.channels.client import ChannexClient, ProviderError
from pms_api.channels.models import ChannelConnection, ChannelJob
from pms_api.channels.service import ari_snapshot, drain_pending_ari, schedule_jobs
from pms_api.core_models import Tenant, utcnow
from pms_api.extensions import db
from pms_api.security import ApiError, set_context
from tests.test_channels_integration import PROPERTY, ChannelTestCase

CHANNEL = str(UUID(int=200))


class Response(io.BytesIO):
    status = 200


class LoadBookingsClientTests(unittest.TestCase):
    def test_load_uses_fixed_endpoint_and_accepts_background_acknowledgement(self):
        transport = Mock()
        transport.open.return_value = Response(b'{"meta":{"message":"Success"}}')
        client = ChannexClient("staging", "fixture-key", transport)
        client.load_future_reservations(CHANNEL)
        request = transport.open.call_args.args[0]
        self.assertEqual(request.method, "POST")
        self.assertEqual(
            request.full_url,
            f"https://staging.channex.io/api/v1/channels/{CHANNEL}/execute/load_future_reservations",
        )
        self.assertEqual(json.loads(request.data), {})
        transport.open.return_value = Response(b'{"async_meta":{"id":"operation"}}')
        transport.open.return_value.status = 202
        client.load_future_reservations(CHANNEL)
        with self.assertRaises(ProviderError):
            client.load_future_reservations("../availability")
        self.assertEqual(transport.open.call_count, 2)

    def test_load_rejects_unrecognizable_success_without_repeating_the_request(self):
        transport = Mock()
        transport.open.return_value = Response(b'{"data":null}')
        client = ChannexClient("staging", "fixture-key", transport)
        with self.assertRaises(ProviderError) as caught:
            client.load_future_reservations(CHANNEL)
        self.assertEqual(caught.exception.code, "provider_invalid_response")
        self.assertEqual(transport.open.call_count, 1)


class OnboardingWorkerTests(ChannelTestCase):
    def unreconcile(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            row = db.session.scalar(select(ChannelConnection))
            row.inventory_reconciled_at = None
            db.session.commit()

    def queue(self, kind, details):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            row = ChannelJob(
                tenant_id=self.tenant_id,
                actor_id=self.owner_id,
                kind=kind,
                payload=details,
            )
            db.session.add(row)
            db.session.flush()
            identifier = row.id
            db.session.commit()
            return identifier

    def saved(self, identifier):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            row = db.session.get(ChannelJob, identifier)
            return row.status, row.attempts, row.error_code

    def test_unreconciled_inventory_waits_without_spending_attempts_or_blocking_feed(self):
        self.unreconcile()
        push = self.queue("push_ari", {"start": "2030-01-01", "end": "2030-01-03"})
        feed = self.queue("pull_bookings", {})
        self.assertEqual(self.run_jobs(10), 1)
        self.assertEqual(self.saved(push), ("queued", 0, None))
        self.assertEqual(self.saved(feed), ("succeeded", 1, None))
        self.provider.feed.assert_called_once_with(PROPERTY)
        self.provider.push_availability.assert_not_called()
        self.provider.push_restrictions.assert_not_called()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertIsNone(db.session.scalar(select(ChannelConnection)).ari_available_at)

    def test_direct_snapshot_cannot_bypass_reconciliation(self):
        self.unreconcile()
        with self.app.test_request_context():
            set_context(self.owner_id, self.tenant_id)
            connection = db.session.scalar(select(ChannelConnection))
            with self.assertRaises(ApiError) as caught:
                ari_snapshot(
                    self.tenant_id,
                    connection,
                    self.provider,
                    {"start": "2030-01-01", "end": "2030-01-03"},
                )
            self.assertEqual(caught.exception.code, "channel_inventory_unreconciled")

    def test_blocked_outbox_keeps_dirty_range_until_reconciliation(self):
        self.unreconcile()
        response = self.request(
            "put",
            "/rates",
            json={
                "roomTypeId": "rt-a",
                "start": "2030-01-01",
                "end": "2030-01-03",
                "price": "200",
                "stopSell": False,
            },
        )
        self.assertEqual(response.status_code, 200, response.json)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            connection = db.session.scalar(select(ChannelConnection))
            self.assertEqual(connection.pending_ari_start.isoformat(), "2030-01-01")
            drain_pending_ari(connection)
            self.assertFalse(
                db.session.scalar(select(ChannelJob.id).where(ChannelJob.kind == "push_ari"))
            )
            connection.inventory_reconciled_at = utcnow()
            g.tenant = db.session.get(Tenant, self.tenant_id)
            drain_pending_ari(connection)
            self.assertIsNone(connection.pending_ari_start)
            self.assertTrue(
                db.session.scalar(select(ChannelJob.id).where(ChannelJob.kind == "push_ari"))
            )
            db.session.commit()

    def test_scheduler_still_polls_but_does_not_publish_unreconciled_inventory(self):
        self.unreconcile()
        with self.app.app_context():
            self.assertEqual(schedule_jobs(self.tenant_id), 1)
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(list(db.session.scalars(select(ChannelJob.kind))), ["pull_bookings"])

    def test_reconciliation_changed_during_catalog_fetch_prevents_old_publication(self):
        push = self.queue("push_ari", {"start": "2030-01-01", "end": "2030-01-03"})
        changed = False

        def catalog(resource, property_id):
            nonlocal changed
            if not changed:
                changed = True
                with self.app.app_context():
                    set_context(self.owner_id, self.tenant_id)
                    connection = db.session.scalar(select(ChannelConnection))
                    connection.inventory_revision = "changed-during-catalog-read"
                    connection.inventory_reconciled_at = utcnow()
                    db.session.commit()
            return self.catalog(resource, property_id)

        self.provider.catalog.side_effect = catalog
        self.assertEqual(self.run_jobs(1), 1)
        self.assertEqual(self.saved(push), ("queued", 1, "channel_configuration_changed"))
        self.provider.push_availability.assert_not_called()
        self.provider.push_restrictions.assert_not_called()

    def test_load_acceptance_keeps_inventory_closed_and_does_not_send_ari(self):
        self.unreconcile()
        load = self.queue("load_bookings", {"channelId": CHANNEL, "target": "fingerprint"})

        def accepted(_channel_id):
            with self.app.app_context():
                set_context(self.owner_id, self.tenant_id)
                claimed = db.session.get(ChannelJob, load)
                self.assertEqual((claimed.status, claimed.attempts), ("processing", 1))

        self.provider.load_future_reservations.side_effect = accepted
        with patch("pms_api.channels.onboarding.validate_load") as validate:
            self.assertEqual(self.run_jobs(10), 1)
        validate.assert_called_once()
        self.assertEqual(validate.call_args.args[2:], (CHANNEL, "fingerprint"))
        self.provider.load_future_reservations.assert_called_once_with(CHANNEL)
        self.assertEqual(self.saved(load), ("succeeded", 1, None))
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertIsNone(db.session.scalar(select(ChannelConnection)).inventory_reconciled_at)
        self.provider.push_availability.assert_not_called()

    def test_crashed_load_requires_manual_retry_instead_of_automatic_replay(self):
        self.unreconcile()
        load = self.queue("load_bookings", {"channelId": CHANNEL, "target": "fingerprint"})
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            row = db.session.get(ChannelJob, load)
            row.status, row.attempts = "processing", 1
            db.session.commit()
        self.assertEqual(self.run_jobs(10), 0)
        self.assertEqual(self.saved(load), ("failed", 1, "channel_load_interrupted"))
        self.provider.load_future_reservations.assert_not_called()

    def test_uncertain_load_is_terminal_until_explicit_retry(self):
        self.unreconcile()
        load = self.queue("load_bookings", {"channelId": CHANNEL, "target": "fingerprint"})
        self.provider.load_future_reservations.side_effect = ProviderError(
            "provider_unavailable", retryable=True, failure_type="timeout"
        )
        with patch("pms_api.channels.onboarding.validate_load"):
            self.assertEqual(self.run_jobs(10), 1)
            self.assertEqual(self.saved(load), ("failed", 1, "provider_unavailable"))
            with patch(
                "pms_api.channels.service.utcnow", return_value=utcnow() + timedelta(hours=1)
            ):
                self.assertEqual(self.run_jobs(10), 0)
            self.assertEqual(self.provider.load_future_reservations.call_count, 1)
            retry = self.request("post", f"/channels/jobs/{load}/retry", json={})
            self.assertEqual(retry.status_code, 202, retry.json)
            self.provider.load_future_reservations.side_effect = None
            self.assertEqual(self.run_jobs(10), 1)
        self.assertEqual(self.saved(load), ("succeeded", 1, None))
        self.assertEqual(self.provider.load_future_reservations.call_count, 2)
