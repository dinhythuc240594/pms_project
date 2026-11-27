"""Existing OTA bookings must be reconciled before the PMS publishes inventory."""

from unittest.mock import patch

from sqlalchemy import func, select

from pms_api.channels.client import ProviderError
from pms_api.channels.models import ChannelConnection, ChannelJob
from pms_api.core_models import utcnow
from pms_api.extensions import db
from pms_api.security import set_context
from tests.test_channels_integration import ChannelTestCase, revision
from tests.test_channex_channels import CHANNEL
from tests.test_tenant_remote_channels import TenantRemoteChannelFixture


class InventoryReconciliationTests(ChannelTestCase):
    def setUp(self):
        super().setUp()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            row = db.session.scalar(select(ChannelConnection))
            row.inventory_reconciled_at = None
            db.session.commit()

    def test_unreconciled_connection_blocks_publication_but_keeps_booking_pull_available(self):
        response = self.request(
            "post",
            "/channels/jobs",
            json={"kind": "push_ari", "start": "2030-01-01", "end": "2030-01-03"},
        )
        self.assertEqual(response.status_code, 409, response.json)
        self.assertEqual(response.json["error"]["code"], "channel_inventory_unreconciled")
        response = self.request("post", "/channels/jobs", json={"kind": "pull_bookings"})
        self.assertEqual(response.status_code, 202, response.json)

    def test_confirmation_requires_explicit_current_revision_and_unblocks_publication(self):
        state = self.request("get", "/channels").json["onboarding"]
        for body in ({}, {"revision": state["revision"], "confirm": False}):
            response = self.request("post", "/channels/onboarding/reconcile", json=body)
            self.assertEqual(response.status_code, 422, response.json)
        response = self.request(
            "post", "/channels/onboarding/reconcile", json={"revision": "stale", "confirm": True}
        )
        self.assertEqual(response.status_code, 409, response.json)
        response = self.request(
            "post",
            "/channels/onboarding/reconcile",
            json={"revision": state["revision"], "confirm": True},
        )
        self.assertEqual(response.status_code, 200, response.json)
        self.assertIsNotNone(response.json["onboarding"]["reconciledAt"])
        response = self.request(
            "post",
            "/channels/jobs",
            json={"kind": "push_ari", "start": "2030-01-01", "end": "2030-01-03"},
        )
        self.assertEqual(response.status_code, 202, response.json)

    def test_confirmation_waits_for_imports_and_requires_owner_permission(self):
        state = self.request("get", "/channels").json["onboarding"]
        self.enqueue_revision(revision())
        response = self.request(
            "post",
            "/channels/onboarding/reconcile",
            json={"revision": state["revision"], "confirm": True},
        )
        self.assertEqual(response.status_code, 409, response.json)
        self.assertEqual(response.json["error"]["code"], "channel_onboarding_busy")
        client, headers = self.login("frontdesk@test.local")
        response = self.request(
            "post",
            "/channels/onboarding/reconcile",
            json={"revision": state["revision"], "confirm": True},
            client=client,
            headers=headers,
        )
        self.assertEqual(response.status_code, 403, response.json)

    def test_full_held_queue_does_not_prevent_explicit_manual_reconciliation(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            for number in range(499):
                db.session.add(
                    ChannelJob(
                        tenant_id=self.tenant_id,
                        actor_id=self.owner_id,
                        kind="push_ari",
                        payload={"start": "2030-01-01", "end": "2030-01-03"},
                        dedupe_key=f"held-publication:{number}",
                    )
                )
            db.session.add(
                ChannelJob(
                    tenant_id=self.tenant_id,
                    actor_id=self.owner_id,
                    kind="pull_bookings",
                    payload={},
                )
            )
            db.session.commit()
        state = self.request("get", "/channels").json["onboarding"]
        self.assertEqual(state["pendingBookings"], 0)
        response = self.request(
            "post",
            "/channels/onboarding/reconcile",
            json={
                "revision": state["revision"],
                "confirm": True,
            },
        )
        self.assertEqual(response.status_code, 200, response.json)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(db.session.scalar(select(func.count()).select_from(ChannelJob)), 500)

    def test_booking_reviews_prevent_inventory_confirmation(self):
        entity = revision()
        entity["attributes"]["services"] = [{"name": "Unmapped extra"}]
        self.import_booking(entity)
        state = self.request("get", "/channels").json["onboarding"]
        self.assertEqual(state["reviewCount"], 1)
        response = self.request(
            "post",
            "/channels/onboarding/reconcile",
            json={
                "revision": state["revision"],
                "confirm": True,
            },
        )
        self.assertEqual(response.status_code, 409, response.json)
        self.assertEqual(response.json["error"]["code"], "channel_onboarding_busy")


class ExistingBookingRequestTests(TenantRemoteChannelFixture):
    def prepare_load(self):
        self.channel["attributes"]["actions"] = ["load_future_reservations"]
        self.channel["attributes"]["is_active"] = True
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            connection = db.session.scalar(select(ChannelConnection))
            connection.active = True
            db.session.commit()
        return self.detail()

    def test_supported_request_queues_once_and_keeps_inventory_blocked(self):
        detail = self.prepare_load()
        prior = self.request("get", "/channels").json["onboarding"]
        self.assertTrue(detail["supportsLoadFutureReservations"])
        body = {"revision": detail["revision"], "confirm": True}
        first = self.remote(f"/{CHANNEL}/load_bookings", method="POST", body=body)
        self.assertEqual(first.status_code, 202, first.json)
        second = self.remote(f"/{CHANNEL}/load_bookings", method="POST", body=body)
        self.assertEqual(second.status_code, 202, second.json)
        self.assertEqual(first.json["job"]["id"], second.json["job"]["id"])
        self.assertEqual(first.json["job"]["kind"], "load_bookings")
        self.assertEqual(self.writes(), [])
        state = self.request("get", "/channels").json["onboarding"]
        self.assertIsNone(state["reconciledAt"])
        self.assertEqual(state["loads"][0]["channelId"], CHANNEL)
        self.assertEqual(state["pendingBookings"], 1)
        response = self.request(
            "post",
            "/channels/onboarding/reconcile",
            json={
                "revision": prior["revision"],
                "confirm": True,
            },
        )
        self.assertEqual(response.status_code, 409, response.json)
        self.assertEqual(response.json["error"]["code"], "channel_onboarding_changed")

    def test_load_retry_invalidates_confirmation_and_requires_owner(self):
        detail = self.prepare_load()
        response = self.remote(
            f"/{CHANNEL}/load_bookings",
            method="POST",
            body={
                "revision": detail["revision"],
                "confirm": True,
            },
        )
        job_id = response.json["job"]["id"]
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.get(ChannelJob, job_id).status = "failed"
            db.session.scalar(select(ChannelConnection)).inventory_reconciled_at = utcnow()
            db.session.commit()
        response = self.request("post", f"/channels/jobs/{job_id}/retry", json={})
        self.assertEqual(response.status_code, 202, response.json)
        self.assertIsNone(self.request("get", "/channels").json["onboarding"]["reconciledAt"])
        client, headers = self.login("frontdesk@test.local")
        denied = self.remote(
            f"/{CHANNEL}/load_bookings",
            method="POST",
            body={
                "revision": detail["revision"],
                "confirm": True,
            },
            client=client,
            headers=headers,
        )
        self.assertEqual(denied.status_code, 403, denied.json)

    def test_uncertain_activation_keeps_inventory_blocked_after_rollback(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            row = db.session.scalar(select(ChannelConnection))
            row.inventory_reconciled_at = utcnow()
            db.session.commit()
        prior = self.request("get", "/channels").json["onboarding"]
        detail = self.detail()
        transport = self.provider._request.side_effect

        def uncertain(method, path, *args, **kwargs):
            if method == "POST" and path == f"/channels/{CHANNEL}/activate":
                raise ProviderError("provider_unavailable", True)
            return transport(method, path, *args, **kwargs)

        with patch.object(self.provider, "_request", side_effect=uncertain):
            response = self.remote(
                f"/{CHANNEL}/activate",
                method="POST",
                body={
                    "revision": detail["revision"],
                    "confirm": True,
                },
            )
        self.assertEqual(response.status_code, 503, response.json)
        state = self.request("get", "/channels").json["onboarding"]
        self.assertIsNone(state["reconciledAt"])
        self.assertNotEqual(state["revision"], prior["revision"])

    def test_unsupported_request_has_no_job_or_provider_write(self):
        detail = self.detail()
        response = self.remote(
            f"/{CHANNEL}/load_bookings",
            method="POST",
            body={"revision": detail["revision"], "confirm": True},
        )
        self.assertEqual(response.status_code, 409, response.json)
        self.assertEqual(response.json["error"]["code"], "channel_load_unsupported")
        self.assertEqual(self.writes(), [])
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertIsNone(
                db.session.scalar(select(ChannelJob).where(ChannelJob.kind == "load_bookings"))
            )
