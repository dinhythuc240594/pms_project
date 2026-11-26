"""Durable webhook provisioning uses tenant secrets after configuration commit."""

from unittest.mock import patch
from uuid import UUID

from cryptography.fernet import Fernet
from sqlalchemy import select

from pms_api.channels.client import ProviderError
from pms_api.channels.credentials import load_credentials
from pms_api.channels.models import ChannelConnection, ChannelJob
from pms_api.channels.service import process_jobs
from pms_api.core_models import utcnow
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase

PROPERTY = str(UUID(int=1))
WEBHOOK = str(UUID(int=3))


class ChannelWebhookTests(DomainTestCase):
    def setUp(self):
        super().setUp()
        config = patch.dict(
            self.app.config,
            {
                "CHANNEX_ENCRYPTION_KEY": Fernet.generate_key().decode(),
                "CHANNEX_WEBHOOK_BASE_URL": "https://api.example.test",
            },
        )
        config.start()
        self.addCleanup(config.stop)
        provider = patch(
            "pms_api.channels.client.ChannexClient._request",
            return_value={"data": {"id": PROPERTY}},
        )
        self.provider = provider.start()
        self.addCleanup(provider.stop)
        self.config = {
            "environment": "staging",
            "propertyId": PROPERTY,
            "apiKey": "fixture-api-key-a",
            "active": True,
        }

    def save(self, **changes):
        response = self.request("put", "/channels/config", json={**self.config, **changes})
        self.assertEqual(response.status_code, 200, response.json)
        return response.json

    def snapshot(self):
        response = self.request("get", "/channels")
        self.assertEqual(response.status_code, 200, response.json)
        return response.json

    def work(self, provider):
        with patch("pms_api.channels.service.ChannexClient", return_value=provider) as factory:
            with self.app.app_context():
                self.assertEqual(process_jobs(self.tenant_id, 1), 1)
            factory.assert_called_once_with("staging", self.config["apiKey"])

    def test_save_queues_empty_job_then_worker_registers_encrypted_secret(self):
        self.save()
        state = self.snapshot()
        self.assertTrue(state["webhookRegistrationAvailable"])
        self.assertFalse(state["connection"]["webhookRegistered"])
        self.assertEqual([job["kind"] for job in state["jobs"]], ["setup_webhook"])
        self.provider.assert_called_once_with("GET", f"/properties/{PROPERTY}")
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(db.session.scalar(select(ChannelJob.payload)), {})
            secret = load_credentials(db.session.scalar(select(ChannelConnection)))["webhookSecret"]
        from unittest.mock import Mock

        provider = Mock()
        provider.setup_webhook.return_value = WEBHOOK
        self.work(provider)
        provider.setup_webhook.assert_called_once_with(
            PROPERTY, f"https://api.example.test/api/channex/webhooks/{self.tenant_id}", secret
        )
        state = self.snapshot()
        self.assertTrue(state["connection"]["webhookRegistered"])
        self.assertEqual(state["jobs"][0]["status"], "succeeded")
        self.assertNotIn(secret, str(state))
        self.assertNotIn(WEBHOOK, str(state))

    def test_generated_secret_authenticates_callback_and_rejects_wrong_secret(self):
        self.save()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            secret = load_credentials(db.session.scalar(select(ChannelConnection)))["webhookSecret"]
        for header, status in (("wrong-secret", 401), (secret, 202)):
            response = self.client.post(
                f"/api/channex/webhooks/{self.tenant_id}",
                json={"event": "booking", "property_id": PROPERTY},
                headers={"X-Channex-Webhook-Secret": header},
            )
            self.assertEqual(response.status_code, status, response.json)
        jobs = self.snapshot()["jobs"]
        self.assertEqual(sum(job["kind"] == "pull_bookings" for job in jobs), 1)

    def test_malformed_headers_and_authenticated_invalid_payloads_never_queue_work(self):
        self.save()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            secret = load_credentials(db.session.scalar(select(ChannelConnection)))["webhookSecret"]
        body = {"event": "booking", "property_id": PROPERTY}
        for supplied, payload, status in (
            ("", body, 401),
            ("é" * 32, body, 401),
            ("a" * 1025, body, 401),
            (secret, {}, 422),
            (secret, {**body, "payload": {"property_id": str(UUID(int=999))}}, 422),
        ):
            with self.subTest(status=status, payload=payload):
                response = self.client.post(
                    f"/api/channex/webhooks/{self.tenant_id}",
                    json=payload,
                    headers={"X-Channex-Webhook-Secret": supplied},
                )
                self.assertEqual(response.status_code, status, response.json)
                self.assertNotIn(secret, response.get_data(as_text=True))
        self.assertEqual([job["kind"] for job in self.snapshot()["jobs"]], ["setup_webhook"])

    def test_transient_registration_failure_retains_config_and_can_retry(self):
        from unittest.mock import Mock

        self.save()
        provider = Mock()
        provider.setup_webhook.side_effect = ProviderError("provider_unavailable", True)
        self.work(provider)
        state = self.snapshot()
        self.assertTrue(state["connection"]["credentialsConfigured"])
        self.assertFalse(state["connection"]["webhookRegistered"])
        self.assertEqual(state["jobs"][0]["status"], "queued")
        self.assertEqual(state["jobs"][0]["errorCode"], "provider_unavailable")
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.scalar(select(ChannelJob)).available_at = utcnow()
            db.session.commit()
        provider.setup_webhook.side_effect = None
        provider.setup_webhook.return_value = WEBHOOK
        self.work(provider)
        state = self.snapshot()
        self.assertTrue(state["connection"]["webhookRegistered"])
        self.assertEqual(state["jobs"][0]["attempts"], 2)
        self.assertEqual(len(state["jobs"]), 1)

    def test_rotation_after_success_queues_new_setup_and_target_history_is_guarded(self):
        from unittest.mock import Mock

        self.save()
        provider = Mock()
        provider.setup_webhook.return_value = WEBHOOK
        self.work(provider)
        self.save(apiKey="fixture-rotated-key")
        jobs = self.snapshot()["jobs"]
        self.assertEqual(sum(job["status"] == "queued" for job in jobs), 1)
        self.assertEqual(sum(job["status"] == "succeeded" for job in jobs), 1)
        changed = self.request(
            "put",
            "/channels/config",
            json={
                **self.config,
                "propertyId": str(UUID(int=2)),
            },
        )
        self.assertEqual(changed.status_code, 409, changed.json)
        self.assertEqual(changed.json["error"]["code"], "channel_has_history")

    def test_optional_public_origin_leaves_polling_usable(self):
        with patch.dict(self.app.config, {"CHANNEX_WEBHOOK_BASE_URL": None}):
            self.save()
            state = self.snapshot()
            self.assertFalse(state["webhookRegistrationAvailable"])
            self.assertEqual(state["jobs"], [])
            self.assertTrue(state["connection"]["active"])
            self.assertTrue(state["connection"]["credentialsConfigured"])
            response = self.request("post", "/channels/jobs", json={"kind": "pull_bookings"})
            self.assertEqual(response.status_code, 202, response.json)

    def test_worker_uses_only_requested_tenants_encrypted_credentials(self):
        from unittest.mock import Mock

        self.save()
        other_property = str(UUID(int=2))
        self.provider.return_value = {"data": {"id": other_property}}
        other_client, headers = self.login("owner-b@test.local")
        response = self.request(
            "put",
            f"/api/tenants/{self.other_tenant_id}/channels/config",
            client=other_client,
            headers=headers,
            json={**self.config, "propertyId": other_property, "apiKey": "fixture-api-key-b"},
        )
        self.assertEqual(response.status_code, 200, response.json)
        provider = Mock()
        provider.setup_webhook.return_value = WEBHOOK
        self.work(provider)
        state = other_client.get(f"/api/tenants/{self.other_tenant_id}/channels").json
        self.assertFalse(state["connection"]["webhookRegistered"])
        self.assertEqual(state["jobs"][0]["status"], "queued")
