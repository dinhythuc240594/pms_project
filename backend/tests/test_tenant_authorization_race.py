"""Waiting hotel mutations use membership changes committed before their tenant lock."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event, get_ident
from unittest.mock import patch

from cryptography.fernet import Fernet
from sqlalchemy import func, select

from pms_api.channels.models import ChannelConnection, ChannelJob
from pms_api.core_models import AuditLog, TenantUser
from pms_api.extensions import db
from pms_api.security import set_context
from pms_api.subscriptions import lock_tenant
from tests.domain_fixture import DomainTestCase
from tests.system_scope_fixture import grant_system_access

PROPERTY_ID = "00000000-0000-0000-0000-000000000001"


class TenantAuthorizationRaceTests(DomainTestCase):
    def assert_waiting_mutation_denied(self, changes, error_code):
        for actor_id in ("admin", "manager"):
            with self.subTest(actor=actor_id):
                grant_system_access(self, actor_id)
                client, headers = self.login(f"{actor_id}@test.local")
                waiting, resume = Event(), Event()
                worker_thread = [None]

                def paused_tenant_lock(tenant_id):
                    if get_ident() == worker_thread[0]:
                        waiting.set()
                        if not resume.wait(5):
                            raise RuntimeError("Waiting request was not released")
                    return lock_tenant(tenant_id)

                def pending_mutation():
                    worker_thread[0] = get_ident()
                    return self.request(
                        "PUT",
                        "/channels/config",
                        {
                            "environment": "staging",
                            "propertyId": PROPERTY_ID,
                            "active": True,
                            "apiKey": "private-race-provider-key",
                        },
                        client=client,
                        headers=headers,
                    )

                with (
                    patch.dict(
                        self.app.config,
                        {
                            "CHANNEX_ENCRYPTION_KEY": Fernet.generate_key().decode(),
                            "CHANNEX_WEBHOOK_BASE_URL": "",
                        },
                    ),
                    patch(
                        "pms_api.channels.client.ChannexClient._request",
                        return_value={"data": {"id": PROPERTY_ID}},
                    ) as provider_request,
                    patch("pms_api.subscriptions.lock_tenant", side_effect=paused_tenant_lock),
                    self.app.app_context(),
                ):
                    set_context(self.owner_id, self.tenant_id)
                    lock_tenant(self.tenant_id)
                    membership = db.session.scalar(
                        select(TenantUser).where(
                            TenantUser.tenant_id == self.tenant_id,
                            TenantUser.user_id == actor_id,
                        )
                    )
                    with ThreadPoolExecutor(max_workers=1) as executor:
                        future = executor.submit(pending_mutation)
                        try:
                            self.assertTrue(
                                waiting.wait(5), "Request did not reach its tenant lock"
                            )
                            for attribute, value in changes.items():
                                setattr(membership, attribute, value)
                            db.session.commit()
                        finally:
                            resume.set()
                            db.session.rollback()
                        response = future.result(timeout=10)
                    self.assertEqual(response.status_code, 403, response.json)
                    self.assertEqual(response.json["error"]["code"], error_code)
                    provider_request.assert_not_called()
                    set_context(self.owner_id, self.tenant_id)
                    for model in (ChannelConnection, ChannelJob):
                        self.assertEqual(
                            db.session.scalar(select(func.count()).select_from(model)), 0
                        )
                    self.assertEqual(
                        db.session.scalar(
                            select(func.count())
                            .select_from(AuditLog)
                            .where(AuditLog.event == "channel.configured")
                        ),
                        0,
                    )

    def test_downgraded_system_membership_cannot_finish_a_waiting_mutation(self):
        self.assert_waiting_mutation_denied({"role": "HOUSEKEEPING"}, "forbidden")

    def test_revoked_system_membership_cannot_finish_a_waiting_mutation(self):
        self.assert_waiting_mutation_denied({"active": False}, "tenant_denied")
