"""OTA support works independently of owner-granted PMS access."""

from unittest.mock import patch
from uuid import UUID

from cryptography.fernet import Fernet
from sqlalchemy import text

from pms_api.channels.models import ChannelConnection
from pms_api.core_models import AuditLog, Plan, Subscription, Tenant
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase
from tests.system_scope_fixture import grant_system_access, linked_property

PROPERTY = str(UUID(int=987))
OTHER_PROPERTY = str(UUID(int=988))


class AdminHotelBoundaryTests(DomainTestCase):
    def setUp(self):
        super().setUp()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            tenant = db.session.get(Tenant, self.tenant_id)
            tenant.settings = {"privateMarker": "private-hotel-setting"}
            db.session.add(
                AuditLog(
                    tenant_id=self.tenant_id,
                    user_id=self.owner_id,
                    event="reservation.created",
                    entity_type="reservation",
                    entity_id="secret-booking",
                    details={"guestName": "private-guest", "amount": "999999"},
                )
            )
            db.session.add(
                ChannelConnection(
                    tenant_id=self.tenant_id,
                    environment="staging",
                    property_id=PROPERTY,
                    credential_ref="UNUSED_KEY",
                    webhook_secret_ref="UNUSED_WEBHOOK",
                    actor_id=self.owner_id,
                )
            )
            db.session.commit()
        self.app.config["CHANNEX_MANAGER_API_KEY_STAGING"] = "fixture-system-source"

    def grant(self, user_id, role):
        grant_system_access(self, user_id, role=role)

    def test_saas_metadata_and_history_exclude_operational_data_for_both_roles(self):
        for actor in ("admin", "manager"):
            client, _ = self.login(actor + "@test.local")
            for path in (
                "/api/tenants",
                f"/api/tenants/{self.tenant_id}/customer-history",
                "/api/admin/channex",
                "/api/admin/channex/accounts",
            ):
                response = client.get(path)
                self.assertEqual(response.status_code, 200, response.json)
                for private in (
                    "private-hotel-setting",
                    "private-guest",
                    "secret-booking",
                    "999999",
                ):
                    self.assertNotIn(private, response.get_data(as_text=True))
            hotels = client.get("/api/admin/channex").json["hotels"]
            self.assertEqual(
                {row["tenantId"] for row in hotels}, {self.tenant_id, self.other_tenant_id}
            )
            self.assertEqual(hotels[0]["roomTypeCount"], 1)
            self.assertEqual(hotels[0]["roomCount"], 2)
            self.assertEqual(hotels[0]["connection"]["propertyId"], PROPERTY)
            self.assertIn(
                "hotel:" + self.tenant_id,
                [row["id"] for row in client.get("/api/admin/channex/accounts").json["accounts"]],
            )
            if actor == "admin":
                response = client.get("/api/audit")
                self.assertEqual(response.status_code, 200, response.json)
                self.assertNotIn("private-guest", response.get_data(as_text=True))

    def test_remote_operational_routes_deny_before_provider_io(self):
        for actor in ("owner-a", "frontdesk"):
            client, _ = self.login(actor + "@test.local")
            with patch("pms_api.admin.channex_remote.ChannexClient") as provider:
                for account in ("system:staging", "hotel:" + self.tenant_id):
                    for resource, extra in (
                        ("bookings", ""),
                        ("catalog", ""),
                        ("channels", ""),
                        ("inventory", "&start=2026-10-12&end=2026-10-13"),
                        ("channels/" + str(UUID(int=989)), ""),
                    ):
                        response = client.get(
                            f"/api/admin/channex/properties/{PROPERTY}/{resource}?accountId={account}{extra}"
                        )
                        self.assertEqual(response.status_code, 403, (resource, response.json))
                provider.return_value.property.assert_not_called()
                provider.return_value._request.assert_not_called()

    def test_scoped_global_owner_cannot_grant_or_reactivate_membership(self):
        for actor in ("admin", "manager"):
            self.grant(actor, "HOTEL_OWNER")
            client, headers = self.login(actor + "@test.local")
            for method, path, body in (
                ("POST", "/users", {"email": "new-support@test.local", "role": "HOTEL_OWNER"}),
                ("PATCH", "/users/frontdesk", {"role": "HOTEL_OWNER"}),
                ("PATCH", "/users/" + actor, {"active": True}),
            ):
                response = self.request(method, path, body, client=client, headers=headers)
                self.assertEqual(response.status_code, 403, response.json)
                self.assertEqual(response.json["error"]["code"], "owner_grant_required")

    def test_remote_operational_mutations_deny_before_provider_io(self):
        channel_id = str(UUID(int=989))
        for actor in ("owner-a", "frontdesk"):
            client, headers = self.login(actor + "@test.local")
            for account in ("system:staging", "hotel:" + self.tenant_id):
                for method, resource, body in (
                    (
                        "POST",
                        "room-types",
                        {
                            "name": "Blocked room",
                            "countOfRooms": 1,
                            "adults": 2,
                            "children": 0,
                            "infants": 0,
                        },
                    ),
                    (
                        "POST",
                        "channel-probe/test_connection",
                        {"code": "BookingCom", "settings": {}},
                    ),
                    ("PATCH", "channels/" + channel_id, {"revision": "stale", "name": "Blocked"}),
                    (
                        "POST",
                        "channels/" + channel_id + "/activate",
                        {
                            "revision": "stale",
                            "confirm": True,
                        },
                    ),
                    ("DELETE", "channels/" + channel_id, {"revision": "stale", "confirm": True}),
                ):
                    with (
                        self.subTest(
                            actor=actor, account=account, resource=resource, method=method
                        ),
                        patch("pms_api.admin.channex_remote.ChannexClient") as factory,
                    ):
                        response = self.request(
                            method,
                            f"/api/admin/channex/properties/{PROPERTY}/{resource}",
                            {"accountId": account, **body},
                            client=client,
                            headers=headers,
                        )
                        self.assertEqual(response.status_code, 403, response.json)
                        self.assertEqual(response.json["error"]["code"], "forbidden")
                        factory.return_value.property.assert_not_called()
                        factory.return_value._request.assert_not_called()

    def test_remote_support_survives_membership_changes_and_checks_linked_property(self):
        for actor in ("admin", "manager"):
            self.grant(actor, "HOUSEKEEPING")
            client, _ = self.login(actor + "@test.local")
            path = f"/api/admin/channex/properties/{PROPERTY}/bookings?accountId=system:staging"
            with patch("pms_api.admin.channex_remote.ChannexClient") as factory:
                provider = factory.return_value
                provider.property.return_value = {
                    "id": PROPERTY,
                    "type": "property",
                    "attributes": {"title": "Hotel", "currency": "VND"},
                }
                provider._request.return_value = {
                    "data": [],
                    "meta": {"page": 1, "limit": 25, "total": 0},
                }
                self.assertEqual(client.get(path).status_code, 200)
                role = self.request("PATCH", "/users/" + actor, {"role": "FRONT_DESK"})
                self.assertEqual(role.status_code, 200, role.json)
                provider.property.return_value = {
                    "id": PROPERTY,
                    "type": "property",
                    "attributes": {"title": "Hotel", "currency": "VND"},
                }
                provider._request.return_value = {
                    "data": [],
                    "meta": {"page": 1, "limit": 25, "total": 0},
                }
                response = client.get(path)
                self.assertEqual(response.status_code, 200, response.json)
                self.assertEqual(
                    client.get(path.replace(PROPERTY, OTHER_PROPERTY)).status_code, 403
                )
                revoke = self.request("PATCH", "/users/" + actor, {"active": False})
                self.assertEqual(revoke.status_code, 200, revoke.json)
                provider.reset_mock()
                self.assertEqual(client.get(path).status_code, 200)
                self.assertEqual(
                    client.get(f"/api/tenants/{self.tenant_id}/workspace").status_code, 403
                )

    def test_system_source_cannot_attach_a_different_property_to_an_authorized_hotel(self):
        self.grant("manager", "HOTEL_OWNER")
        client, headers = self.login("manager@test.local")
        with patch("pms_api.admin.channex_remote.ChannexClient") as factory:
            response = self.request(
                "PUT",
                "/channels/config",
                {
                    "accountId": "system:staging",
                    "propertyId": OTHER_PROPERTY,
                    "active": True,
                },
                client=client,
                headers=headers,
            )
            self.assertEqual(response.status_code, 403, response.json)
            factory.assert_not_called()

    def test_ota_summaries_and_accounts_enforce_the_granted_hotel_feature(self):
        self.grant("admin", "HOTEL_OWNER")
        self.grant("manager", "HOTEL_OWNER")
        for actor in ("admin", "manager"):
            client, _ = self.login(actor + "@test.local")
            response = client.get("/api/admin/channex")
            self.assertEqual(response.status_code, 200, response.json)
            self.assertEqual(
                {row["tenantId"] for row in response.json["hotels"]},
                {self.tenant_id, self.other_tenant_id},
            )
            accounts = client.get("/api/admin/channex/accounts").json["accounts"]
            self.assertIn("hotel:" + self.tenant_id, [row["id"] for row in accounts])
        with self.app.app_context():
            set_context("manager", is_system=True)
            plan = db.session.get(Plan, "default-pro")
            plan.features = {**plan.features, "OTA_SYNC": False}
            db.session.commit()
        for actor in ("admin", "manager"):
            client, _ = self.login(actor + "@test.local")
            self.assertEqual(client.get("/api/admin/channex").json["hotels"], [])
            accounts = client.get("/api/admin/channex/accounts").json["accounts"]
            self.assertEqual(
                [row["id"] for row in accounts], ["system:staging", "system:production"]
            )
            with patch("pms_api.admin.channex_remote.ChannexClient") as provider:
                response = client.get(
                    f"/api/admin/channex/properties/{PROPERTY}/catalog?accountId=system:staging"
                )
                self.assertEqual(response.status_code, 403, response.json)
                self.assertEqual(response.json["error"]["code"], "feature_disabled")
                provider.return_value.property.assert_not_called()

    def test_support_workspace_and_writes_do_not_grant_pms_access(self):
        linked_property(self, PROPERTY)
        for actor in ("admin", "manager"):
            client, headers = self.login(actor + "@test.local")
            prefix = f"/api/admin/channex/tenants/{self.tenant_id}"
            workspace = client.get(prefix + "/workspace")
            self.assertEqual(workspace.status_code, 200, workspace.json)
            self.assertEqual(
                set(workspace.json), {"tenant", "settings", "subscription", "features"}
            )
            self.assertEqual(set(workspace.json["settings"]), {"timezone", "currency"})
            snapshot = client.get(prefix + "/channels")
            self.assertEqual(snapshot.status_code, 200, snapshot.json)
            self.assertEqual(snapshot.json["roomTypes"], [{"id": "rt-a", "name": "Standard"}])
            response = self.request(
                "PUT",
                prefix + "/channels/config",
                {
                    "environment": "staging",
                    "propertyId": PROPERTY,
                    "active": True,
                    "credentialRef": snapshot.json["expectedCredentialRef"],
                    "webhookSecretRef": snapshot.json["expectedWebhookSecretRef"],
                },
                client=client,
                headers=headers,
            )
            self.assertEqual(response.status_code, 200, response.json)
            queued = self.request(
                "POST",
                prefix + "/channels/jobs",
                {"kind": "pull_bookings"},
                client=client,
                headers=headers,
            )
            self.assertEqual(queued.status_code, 202, queued.json)
            jobs = client.get(prefix + "/channels/jobs")
            self.assertEqual(jobs.status_code, 200, jobs.json)
            self.assertTrue(jobs.json["items"])
            self.assertEqual(client.get("/api/auth/session").json["user"]["memberships"], [])
            for path in ("/workspace", "/channels", "/channels/jobs", "/reservations"):
                self.assertEqual(
                    client.get(f"/api/tenants/{self.tenant_id}" + path).status_code, 403
                )
            for path in ("/reservations", "/settings", "/users"):
                self.assertEqual(client.get(prefix + path).status_code, 404)

    def test_support_endpoints_require_system_role_csrf_and_active_subscription(self):
        prefix = f"/api/admin/channex/tenants/{self.tenant_id}"
        for actor in ("owner-a", "frontdesk", "hk"):
            client, headers = self.login(actor + "@test.local")
            self.assertEqual(client.get(prefix + "/workspace").status_code, 403)
            self.assertEqual(client.get(prefix + "/channels").status_code, 403)
            self.assertEqual(
                self.request(
                    "POST",
                    prefix + "/channels/jobs",
                    {"kind": "pull_bookings"},
                    client=client,
                    headers=headers,
                ).status_code,
                403,
            )
        client, headers = self.login("manager@test.local")
        self.assertEqual(
            client.post(prefix + "/channels/jobs", json={"kind": "pull_bookings"}).status_code, 403
        )
        self.assertEqual(
            client.get("/api/admin/channex/tenants/missing/workspace").status_code, 404
        )
        with self.app.app_context():
            set_context("admin", self.tenant_id, is_system=True, is_service=True)
            db.session.get(Subscription, "sub-a").status = "expired"
            db.session.commit()
        self.assertEqual(client.get(prefix + "/workspace").status_code, 200)
        response = self.request(
            "POST",
            prefix + "/channels/jobs",
            {"kind": "pull_bookings"},
            client=client,
            headers=headers,
        )
        self.assertEqual(response.status_code, 403, response.json)
        self.assertEqual(response.json["error"]["code"], "subscription_inactive")

    def test_support_can_link_a_new_hotel_using_the_system_source(self):
        prefix = f"/api/admin/channex/tenants/{self.other_tenant_id}"
        encryption_key = Fernet.generate_key().decode()
        for actor in ("admin", "manager"):
            client, headers = self.login(actor + "@test.local")
            with (
                patch.dict(self.app.config, {"CHANNEX_ENCRYPTION_KEY": encryption_key}),
                patch("pms_api.admin.channex_remote.ChannexClient") as source,
                patch("pms_api.channels.routes.ChannexClient") as verify,
            ):
                source.return_value.api_key = "fixture-system-source"
                response = self.request(
                    "PUT",
                    prefix + "/channels/config",
                    {
                        "accountId": "system:staging",
                        "propertyId": OTHER_PROPERTY,
                        "active": True,
                    },
                    client=client,
                    headers=headers,
                )
                self.assertEqual(response.status_code, 200, response.json)
                verify.return_value.property.assert_called_once_with(OTHER_PROPERTY)
                self.assertNotIn("fixture-system-source", response.get_data(as_text=True))
            self.assertEqual(
                client.get(f"/api/tenants/{self.other_tenant_id}/workspace").status_code, 403
            )

    def test_support_database_scope_is_limited_to_ota_and_the_selected_hotel(self):
        booking = self.request(
            "POST",
            "/reservations",
            {
                "guest": "Private PMS guest",
                "phone": "0900000001",
                "room": "101",
                "sourceId": "direct-a",
                "checkIn": "2026-11-01",
                "checkOut": "2026-11-03",
            },
        )
        self.assertEqual(booking.status_code, 201, booking.json)
        payment = self.request(
            "POST",
            f"/reservations/{booking.json['id']}/payments",
            {
                "amount": "100",
                "methodId": "cash-a",
                "fundId": "fund-a",
            },
            key="support-scope-private-ledger",
        )
        self.assertEqual(payment.status_code, 201, payment.json)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            for table in ("reservations", "guests", "ledger_entries"):
                self.assertTrue(db.session.execute(text(f'SELECT * FROM "{table}"')).all())
            for actor in ("admin", "manager"):
                set_context(actor, self.tenant_id, is_system=True, channel_support=True)
                self.assertEqual(
                    db.session.execute(text("SELECT tenant_id FROM channel_connections"))
                    .scalars()
                    .all(),
                    [self.tenant_id],
                )
                self.assertEqual(
                    db.session.execute(text("SELECT id FROM room_types")).scalars().all(), ["rt-a"]
                )
                self.assertEqual(
                    db.session.execute(text("UPDATE room_types SET name='Blocked'")).rowcount, 0
                )
                for table in ("reservations", "guests", "ledger_entries"):
                    self.assertEqual(db.session.execute(text(f'SELECT * FROM "{table}"')).all(), [])
                set_context(actor, self.tenant_id, is_system=True)
                self.assertEqual(
                    db.session.execute(text("SELECT id FROM channel_connections")).all(), []
                )
                db.session.rollback()
