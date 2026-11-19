"""Tenant-secret regression checks with real PostgreSQL and no provider network."""

import json
import os
from types import SimpleNamespace
from unittest.mock import patch
from uuid import UUID

from cryptography.fernet import Fernet
from sqlalchemy import select

from pms_api.channels.client import ProviderError
from pms_api.channels.credentials import (
    encrypt_credentials,
    load_credentials,
    storage_available,
)
from pms_api.channels.models import ChannelConnection, ChannelJob, ChannelMapping
from pms_api.channels.routes import expected_refs
from pms_api.channels.service import process_jobs
from pms_api.core_models import AuditLog
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase
from tests.system_scope_fixture import grant_system_access, linked_property

PROPERTY = str(UUID(int=1))
API_KEY = "fixture-tenant-api-key-private"
LEGACY_KEY = "fixture-legacy-api-key-private"
LEGACY_WEBHOOK = "fixture-legacy-webhook-secret-over-32-characters"


class ChannelCredentialTests(DomainTestCase):
    def setUp(self):
        super().setUp()
        self.master_key = Fernet.generate_key().decode("ascii")
        config_patch = patch.dict(
            self.app.config,
            {"CHANNEX_ENCRYPTION_KEY": self.master_key, "CHANNEX_WEBHOOK_BASE_URL": ""},
        )
        config_patch.start()
        self.addCleanup(config_patch.stop)
        self.provider_patch = patch(
            "pms_api.channels.client.ChannexClient._request",
            return_value={"data": {"id": PROPERTY, "type": "property"}},
        )
        self.provider = self.provider_patch.start()
        self.addCleanup(self.provider_patch.stop)
        self.config = {
            "environment": "staging",
            "propertyId": PROPERTY,
            "active": True,
            "apiKey": API_KEY,
        }

    def save(self, config=None):
        return self.request("put", "/channels/config", json=config or self.config)

    def saved(self, config=None):
        response = self.save(config)
        self.assertEqual(response.status_code, 200, response.json)
        return response

    def stored(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            row = db.session.scalar(
                select(ChannelConnection).where(ChannelConnection.tenant_id == self.tenant_id)
            )
            if row is None:
                return None
            return {column.name: getattr(row, column.name) for column in row.__table__.columns}

    def decoded(self):
        with self.app.app_context():
            return load_credentials(SimpleNamespace(**self.stored()))

    def legacy(self):
        api_ref, webhook_ref = expected_refs(self.tenant_id)
        environment_patch = patch.dict(
            os.environ, {api_ref: LEGACY_KEY, webhook_ref: LEGACY_WEBHOOK}
        )
        environment_patch.start()
        self.addCleanup(environment_patch.stop)
        linked_property(self, PROPERTY)
        self.saved(
            {
                "environment": "staging",
                "propertyId": PROPERTY,
                "credentialRef": api_ref,
                "webhookSecretRef": webhook_ref,
                "active": True,
            }
        )
        return api_ref, webhook_ref

    def test_legacy_payload_cannot_create_server_credential_binding(self):
        snapshot = self.request("get", "/channels").json
        api_ref = snapshot["expectedCredentialRef"]
        webhook_ref = snapshot["expectedWebhookSecretRef"]
        manager, headers = self.login("manager@test.local")
        routes = (
            ("/channels/config", self.client, self.headers),
            (f"/api/admin/channex/tenants/{self.tenant_id}/channels/config", manager, headers),
        )
        with patch.dict(os.environ, {api_ref: LEGACY_KEY, webhook_ref: LEGACY_WEBHOOK}):
            for path, client, auth_headers in routes:
                for active in (False, True):
                    with self.subTest(path=path, active=active):
                        response = self.request("put", path, {
                            "environment": "staging", "propertyId": PROPERTY,
                            "credentialRef": api_ref, "webhookSecretRef": webhook_ref,
                            "active": active,
                        }, client=client, headers=auth_headers)
                        self.assertEqual(response.status_code, 422, response.json)
                        self.assertEqual(response.json["error"]["code"], "channel_api_key_required")
                        self.assertIsNone(self.stored())
        self.provider.assert_not_called()

    def test_legacy_payload_cannot_repoint_server_credential_binding(self):
        api_ref, webhook_ref = self.legacy()
        original = self.stored()
        manager, headers = self.login("manager@test.local")
        routes = (
            ("/channels/config", self.client, self.headers),
            (f"/api/admin/channex/tenants/{self.tenant_id}/channels/config", manager, headers),
        )
        for path, client, auth_headers in routes:
            for target in (
                {"environment": "staging", "propertyId": str(UUID(int=99))},
                {"environment": "production", "propertyId": PROPERTY},
            ):
                for active in (False, True):
                    with self.subTest(path=path, target=target, active=active):
                        response = self.request("put", path, {
                            **target, "credentialRef": api_ref, "webhookSecretRef": webhook_ref,
                            "active": active,
                        }, client=client, headers=auth_headers)
                        self.assertEqual(response.status_code, 422, response.json)
                        self.assertEqual(response.json["error"]["code"], "channel_api_key_required")
                        self.assertEqual(self.stored(), original)
        self.provider.assert_not_called()

    def test_legacy_same_target_preserves_credentials_and_normalizes_uuid(self):
        api_ref, webhook_ref = self.legacy()
        property_id = str(UUID("abcdefab-cdef-abcd-efab-cdefabcdefab"))
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            row = db.session.scalar(select(ChannelConnection))
            row.property_id = property_id
            db.session.commit()
        with patch.dict(self.app.config, {"CHANNEX_ENCRYPTION_KEY": None}):
            for active in (False, True):
                with self.subTest(active=active):
                    self.saved({
                        "environment": "staging", "propertyId": property_id.upper(),
                        "credentialRef": api_ref, "webhookSecretRef": webhook_ref,
                        "active": active,
                    })
                    stored = self.stored()
                    self.assertEqual(stored["property_id"], property_id)
                    self.assertEqual(stored["environment"], "staging")
                    self.assertEqual(stored["active"], active)
                    self.assertIsNone(stored["secrets_ciphertext"])
                    self.assertEqual(self.decoded(), {
                        "apiKey": LEGACY_KEY, "webhookSecret": LEGACY_WEBHOOK,
                    })
        self.provider.assert_not_called()

    def test_verified_save_encrypts_secrets_and_only_exposes_status(self):
        response = self.saved()
        self.provider.assert_called_once_with("GET", f"/properties/{PROPERTY}")
        stored = self.stored()
        secrets = self.decoded()
        self.assertEqual(secrets["apiKey"], API_KEY)
        self.assertGreaterEqual(len(secrets["webhookSecret"]), 32)
        self.assertIsNotNone(stored["secrets_ciphertext"])
        self.assertIsNotNone(stored["verified_at"])
        snapshot = self.request("get", "/channels")
        state = snapshot.json["connection"]
        self.assertEqual(state["credentialSource"], "encrypted")
        self.assertTrue(state["credentialsConfigured"])
        self.assertTrue(state["webhookConfigured"])
        self.assertIsNone(state["credentialError"])
        self.assertTrue(snapshot.json["credentialStorageAvailable"])
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            audit_data = [
                {"event": row.event, "details": row.details}
                for row in db.session.scalars(select(AuditLog))
            ]
            job_payloads = list(db.session.scalars(select(ChannelJob.payload)))
        public_and_stored = json.dumps(
            [response.json, snapshot.json, stored, audit_data, job_payloads], default=str
        )
        for value in (API_KEY, secrets["webhookSecret"]):
            self.assertNotIn(value, public_and_stored)
        self.assertNotIn("secrets_ciphertext", snapshot.get_data(as_text=True))

    def test_manager_links_system_source_without_returning_or_forwarding_keys(self):
        manager, headers = self.login("manager@test.local")
        denied = self.request(
            "put", "/channels/config",
            json={"accountId": "system:staging", "propertyId": PROPERTY, "active": True},
            client=manager, headers=headers,
        )
        self.assertEqual(denied.status_code, 403, denied.json)
        self.assertEqual(denied.json["error"]["code"], "tenant_denied")
        self.provider.assert_not_called()
        grant_system_access(self)
        linked_property(self, PROPERTY)
        source_key = "private-manager-staging-api-key"
        with patch.dict(self.app.config, {"CHANNEX_MANAGER_API_KEY_STAGING": source_key}):
            response = self.request(
                "put",
                "/channels/config",
                json={"accountId": "system:staging", "propertyId": PROPERTY, "active": True},
                client=manager,
                headers=headers,
            )
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(self.decoded()["apiKey"], source_key)
        self.assertEqual(self.stored()["actor_id"], "manager")
        self.assertTrue(self.request("get", "/channels").json["connection"]["verifiedAt"])
        self.assertNotIn(source_key, response.get_data(as_text=True))

    def test_hotel_owner_cannot_select_manager_sources(self):
        response = self.request(
            "put",
            "/channels/config",
            json={"accountId": "system:staging", "propertyId": PROPERTY, "active": True},
        )
        self.assertEqual(response.status_code, 403, response.json)
        self.provider.assert_not_called()
        self.assertIsNone(self.stored())

    def test_manager_source_rejects_other_hotel_keys_and_ambiguous_config(self):
        grant_system_access(self)
        manager, headers = self.login("manager@test.local")
        for body in (
            {"accountId": "hotel:" + self.other_tenant_id, "propertyId": PROPERTY, "active": True},
            {"accountId": "system:staging", "propertyId": PROPERTY, "active": "true"},
            {"accountId": "system:staging", "propertyId": PROPERTY, "active": True, "apiKey": API_KEY},
        ):
            with self.subTest(body=body):
                response = self.request("put", "/channels/config", json=body, client=manager, headers=headers)
                self.assertEqual(response.status_code, 422, response.json)
        self.provider.assert_not_called()
        self.assertIsNone(self.stored())

    def test_manager_source_preserves_existing_history_protection(self):
        self.saved()
        response = self.request("post", "/channels/jobs", json={"kind": "pull_bookings"})
        self.assertEqual(response.status_code, 202, response.json)
        grant_system_access(self)
        manager, headers = self.login("manager@test.local")
        self.provider.reset_mock()
        with patch.dict(self.app.config, {"CHANNEX_MANAGER_API_KEY_STAGING": API_KEY}):
            response = self.request(
                "put",
                "/channels/config",
                json={"accountId": "system:staging", "propertyId": str(UUID(int=99)), "active": True},
                client=manager,
                headers=headers,
            )
        self.assertEqual(response.status_code, 403, response.json)
        self.assertEqual(response.json["error"]["code"], "invalid_channel_source")
        self.provider.assert_not_called()
        self.assertEqual(self.stored()["property_id"], PROPERTY)

    def test_downgrade_refuses_to_discard_encrypted_credentials(self):
        self.saved()
        original = self.stored()
        result = self.app.test_cli_runner().invoke(
            args=["db", "downgrade", "0012_manager_features"]
        )
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("downgrade refused", str(result.exception))
        self.assertEqual(self.stored(), original)
        response = self.client.get("/api/ready")
        self.assertEqual(response.status_code, 200, response.json)

    def test_system_roles_configure_explicit_hotel_without_writing_other_hotel(self):
        from tests.test_channels_integration import ChannelTestCase

        self.provider.side_effect = lambda method, path, **kwargs: (
            {"data": ChannelTestCase.catalog(self, path[1:], PROPERTY), "meta": {"total": 1}}
            if path in {"/room_types", "/rate_plans"}
            else {"data": {"id": PROPERTY, "type": "property"}}
        )
        prefix = f"/api/tenants/{self.other_tenant_id}/channels"
        for index, actor in enumerate(("manager", "admin"), start=1):
            with self.subTest(actor=actor):
                client, headers = self.login(f"{actor}@test.local")
                session = client.get("/api/auth/session")
                self.assertEqual(
                    {tenant["id"] for tenant in session.json["tenants"]},
                    set(),
                )
                denied = self.request(
                    "put", prefix + "/config", json=self.config, client=client, headers=headers
                )
                self.assertEqual(denied.status_code, 403, denied.json)
                self.assertEqual(denied.json["error"]["code"], "tenant_denied")
                grant_system_access(self, actor, tenant_id=self.other_tenant_id)
                session = client.get("/api/auth/session")
                self.assertEqual(
                    {tenant["id"] for tenant in session.json["tenants"]},
                    {self.other_tenant_id},
                )
                self.assertEqual(self.request("get", "/channels", client=client, headers=headers).status_code, 403)
                saved = self.request(
                    "put", prefix + "/config", json=self.config, client=client, headers=headers
                )
                self.assertEqual(saved.status_code, 200, saved.json)
                mapping = self.request(
                    "put",
                    prefix + "/mappings",
                    json={
                        "roomTypeId": "rt-b",
                        "channexRoomTypeId": str(UUID(int=2)),
                        "channexRatePlanId": str(UUID(int=3)),
                        "active": True,
                    },
                    client=client,
                    headers=headers,
                )
                self.assertEqual(mapping.status_code, 200, mapping.json)
                state = self.request("get", prefix, client=client, headers=headers)
                reconciled = self.request(
                    "post",
                    prefix + "/onboarding/reconcile",
                    json={"revision": state.json["onboarding"]["revision"], "confirm": True},
                    client=client,
                    headers=headers,
                )
                self.assertEqual(reconciled.status_code, 200, reconciled.json)
                self.assertIsNotNone(reconciled.json["onboarding"]["reconciledAt"])
                queued = self.request(
                    "post",
                    prefix + "/jobs",
                    json={
                        "kind": "push_ari",
                        "start": f"2030-01-0{index}",
                        "end": f"2030-01-0{index + 1}",
                    },
                    client=client,
                    headers=headers,
                )
                self.assertEqual(queued.status_code, 202, queued.json)
                snapshot = self.request("get", prefix, client=client, headers=headers)
                self.assertEqual(snapshot.status_code, 200, snapshot.json)
                self.assertTrue(snapshot.json["connection"]["credentialsConfigured"])
                self.assertEqual(snapshot.json["mappings"][0]["roomTypeId"], "rt-b")
                self.assertNotIn(API_KEY, snapshot.get_data(as_text=True))
                self.assertNotIn("secrets_ciphertext", snapshot.get_data(as_text=True))
                with self.app.app_context():
                    set_context(actor, is_system=True, is_service=True)
                    job = db.session.get(ChannelJob, queued.json["id"])
                    self.assertEqual((job.tenant_id, job.actor_id), (self.other_tenant_id, actor))
                    connection = db.session.scalar(select(ChannelConnection))
                    self.assertEqual(
                        (connection.tenant_id, connection.actor_id), (self.other_tenant_id, actor)
                    )
                    for model in (ChannelConnection, ChannelMapping, ChannelJob, AuditLog):
                        self.assertIsNone(
                            db.session.scalar(
                                select(model).where(model.tenant_id == self.tenant_id)
                            )
                        )

    def test_owner_role_csrf_and_tenant_boundary_precede_provider_verification(self):
        for email in ("frontdesk@test.local", "hk@test.local", "accountant@test.local"):
            client, headers = self.login(email)
            with self.subTest(email=email):
                result = self.request(
                    "put", "/channels/config", json=self.config, client=client, headers=headers
                )
                self.assertEqual(result.status_code, 403, result.json)
        result = self.request("put", "/channels/config", json=self.config, headers={})
        self.assertEqual(result.status_code, 403)
        client, headers = self.login("owner-b@test.local")
        result = self.request(
            "put", "/channels/config", json=self.config, client=client, headers=headers
        )
        self.assertEqual(result.status_code, 403)
        self.provider.assert_not_called()
        self.assertIsNone(self.stored())

    def test_new_configuration_validates_shape_key_and_property_before_network(self):
        invalid = [
            {},
            {**self.config, "unknown": True},
            {**self.config, "propertyId": "../../properties"},
            {**self.config, "environment": "https://attacker.invalid"},
            {**self.config, "active": "true"},
            {**self.config, "apiKey": None},
            {**self.config, "apiKey": 123},
            {**self.config, "apiKey": "x" * 1025},
            {**self.config, "apiKey": "key\r\nInjected: header"},
            {**self.config, "apiKey": "khóa"},
            {**self.config, "apiKey": "   "},
            {key: value for key, value in self.config.items() if key != "apiKey"},
        ]
        for config in invalid:
            with self.subTest(config=config):
                result = self.request("put", "/channels/config", json=config)
                self.assertEqual(result.status_code, 422, result.json)
        self.provider.assert_not_called()
        self.assertIsNone(self.stored())

    def test_provider_failure_and_wrong_property_leave_existing_config_unchanged(self):
        self.saved()
        original = self.stored()
        for error in (
            ProviderError("provider_rejected"),
            ProviderError("provider_unavailable", True),
        ):
            self.provider.side_effect = error
            result = self.save({**self.config, "apiKey": "replacement-private-key"})
            self.assertEqual(result.status_code, 503 if error.retryable else 422, result.json)
            self.assertEqual(self.stored(), original)
            self.assertNotIn("replacement-private-key", result.get_data(as_text=True))
        self.provider.side_effect = None
        self.provider.return_value = {"data": {"id": str(UUID(int=99))}}
        result = self.save({**self.config, "apiKey": "replacement-private-key"})
        self.assertEqual(result.status_code, 422, result.json)
        self.assertEqual(result.json["error"]["code"], "provider_invalid_response")
        self.assertEqual(self.stored(), original)

    def test_missing_master_key_refuses_new_storage_before_provider(self):
        for key in (None, "not-a-fernet-key"):
            with (
                self.subTest(key=key),
                patch.dict(self.app.config, {"CHANNEX_ENCRYPTION_KEY": key}),
            ):
                with self.app.app_context():
                    self.assertFalse(storage_available())
                result = self.save()
                self.assertEqual(result.status_code, 503, result.json)
                self.assertEqual(result.json["error"]["code"], "credential_storage_unavailable")
                self.assertIsNone(self.stored())
        self.provider.assert_not_called()

    def test_rotation_preserves_webhook_secret_and_blank_key_preserves_ciphertext(self):
        self.saved()
        original = self.stored()
        original_secret = self.decoded()["webhookSecret"]
        self.provider.reset_mock()
        self.saved({**self.config, "apiKey": "   "})
        self.assertEqual(self.stored(), original)
        self.provider.assert_not_called()
        self.saved({**self.config, "apiKey": "fixture-rotated-private-key"})
        self.provider.assert_called_once_with("GET", f"/properties/{PROPERTY}")
        rotated = self.decoded()
        self.assertEqual(rotated["apiKey"], "fixture-rotated-private-key")
        self.assertEqual(rotated["webhookSecret"], original_secret)

    def test_blank_key_preserves_legacy_credentials_without_migrating_storage(self):
        self.legacy()
        with patch.dict(self.app.config, {"CHANNEX_ENCRYPTION_KEY": None}):
            self.saved({**self.config, "apiKey": ""})
            self.assertIsNone(self.stored()["secrets_ciphertext"])
            self.assertEqual(
                self.decoded(), {"apiKey": LEGACY_KEY, "webhookSecret": LEGACY_WEBHOOK}
            )
            state = self.request("get", "/channels").json["connection"]
            self.assertEqual(state["credentialSource"], "environment")
            self.assertTrue(state["credentialsConfigured"])
        self.provider.assert_not_called()

    def test_pause_without_master_key_and_reenable_verifies_saved_key(self):
        self.saved()
        self.provider.reset_mock()
        original_ciphertext = self.stored()["secrets_ciphertext"]
        with patch.dict(self.app.config, {"CHANNEX_ENCRYPTION_KEY": None}):
            self.saved({**self.config, "apiKey": "", "active": False})
            self.assertFalse(self.stored()["active"])
            self.assertEqual(self.stored()["secrets_ciphertext"], original_ciphertext)
            failed = self.save({**self.config, "apiKey": ""})
            self.assertEqual(failed.status_code, 503, failed.json)
            self.assertFalse(self.stored()["active"])
            self.provider.assert_not_called()
        self.saved({**self.config, "apiKey": ""})
        self.provider.assert_called_once_with("GET", f"/properties/{PROPERTY}")
        self.assertTrue(self.stored()["active"])

    def test_wrong_master_key_and_corruption_never_fall_back_to_legacy_environment(self):
        api_ref, webhook_ref = self.legacy()
        self.saved()
        original = self.stored()
        with self.app.app_context():
            for master_key, ciphertext in (
                (Fernet.generate_key().decode("ascii"), original["secrets_ciphertext"]),
                (self.master_key, "corrupt-token"),
                (self.master_key, ""),
            ):
                with (
                    self.subTest(ciphertext=ciphertext),
                    patch.dict(self.app.config, {"CHANNEX_ENCRYPTION_KEY": master_key}),
                ):
                    row = SimpleNamespace(**{**original, "secrets_ciphertext": ciphertext})
                    with self.assertRaises(ProviderError) as caught:
                        load_credentials(row)
                    self.assertEqual(caught.exception.code, "credentials_unavailable")
            self.assertEqual(os.environ[api_ref], LEGACY_KEY)
            self.assertEqual(os.environ[webhook_ref], LEGACY_WEBHOOK)

    def test_legacy_payload_cannot_bypass_encrypted_reactivation_verification(self):
        self.saved()
        api_ref, webhook_ref = expected_refs(self.tenant_id)
        legacy = {
            "environment": "staging",
            "propertyId": PROPERTY,
            "credentialRef": api_ref,
            "webhookSecretRef": webhook_ref,
            "active": False,
        }
        self.saved(legacy)
        self.provider.reset_mock()
        with patch.dict(self.app.config, {"CHANNEX_ENCRYPTION_KEY": None}):
            result = self.save({**legacy, "active": True})
            self.assertEqual(result.status_code, 503, result.json)
            self.assertFalse(self.stored()["active"])
            self.provider.assert_not_called()
        self.saved({**legacy, "active": True})
        self.provider.assert_called_once_with("GET", f"/properties/{PROPERTY}")
        self.assertTrue(self.stored()["active"])

    def test_encrypted_payload_is_bound_to_tenant_environment_and_property(self):
        api_ref, webhook_ref = self.legacy()
        with self.app.app_context():
            token = encrypt_credentials(
                self.tenant_id, "staging", PROPERTY, API_KEY, LEGACY_WEBHOOK
            )
            for change in (
                {"tenant_id": self.other_tenant_id},
                {"environment": "production"},
                {"property_id": str(UUID(int=99))},
            ):
                row = SimpleNamespace(
                    **{
                        "tenant_id": self.tenant_id,
                        "environment": "staging",
                        "property_id": PROPERTY,
                        "credential_ref": api_ref,
                        "webhook_secret_ref": webhook_ref,
                        "secrets_ciphertext": token,
                        **change,
                    }
                )
                with self.subTest(change=change), self.assertRaises(ProviderError) as caught:
                    load_credentials(row)
                self.assertEqual(caught.exception.code, "credentials_unavailable")

    def test_corrupt_storage_blocks_webhook_and_worker_despite_valid_environment(self):
        self.legacy()
        self.saved()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            row = db.session.scalar(select(ChannelConnection))
            row.secrets_ciphertext = "corrupt-token"
            db.session.commit()
        state = self.request("get", "/channels").json["connection"]
        self.assertFalse(state["credentialsConfigured"])
        self.assertEqual(state["credentialError"], "credentials_unavailable")
        webhook = self.client.post(
            f"/api/channex/webhooks/{self.tenant_id}",
            json={"event": "booking", "property_id": PROPERTY},
            headers={"X-Channex-Webhook-Secret": LEGACY_WEBHOOK},
        )
        self.assertEqual(webhook.status_code, 401, webhook.json)
        result = self.request("post", "/channels/jobs", json={"kind": "pull_bookings"})
        self.assertEqual(result.status_code, 202, result.json)
        with patch("pms_api.channels.service.ChannexClient") as worker_provider:
            with self.app.app_context():
                self.assertEqual(process_jobs(self.tenant_id, 1), 1)
            worker_provider.assert_not_called()
        job = self.request("get", "/channels").json["jobs"][0]
        self.assertEqual(job["status"], "failed")
        self.assertEqual(job["errorCode"], "credentials_unavailable")
