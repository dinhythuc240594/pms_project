"""Remote manager reads use real local authorization and a mocked provider only."""

import os
import unittest
from copy import deepcopy
from unittest.mock import Mock, patch
from uuid import UUID

from cryptography.fernet import Fernet
from sqlalchemy import select

from pms_api.channels.client import ProviderError
from pms_api.channels.credentials import encrypt_credentials
from pms_api.channels.models import ChannelConnection, ChannelMapping
from pms_api.core_models import AuditLog, Tenant, User, utcnow
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase
from tests.system_scope_fixture import grant_system_access, linked_property

PROPERTY, ROOM, RATE = [str(UUID(int=i)) for i in range(1, 4)]


def property_entity(identifier=PROPERTY):
    return {
        "id": identifier,
        "type": "property",
        "attributes": {
            "title": "Remote staging hotel",
            "currency": "USD",
            "timezone": "Asia/Ho_Chi_Minh",
            "city": "Da Nang",
            "country": "VN",
            "api_key": "private-provider-field",
        },
    }


def catalog_entity(resource):
    attributes = {"title": "Standard"}
    relationships = {"property": {"data": {"id": PROPERTY}}}
    if resource == "room_types":
        identifier, kind = ROOM, "room_type"
        attributes.update(
            count_of_rooms=10, occ_adults=2, occ_children=0, occ_infants=0, default_occupancy=2
        )
    else:
        identifier, kind = RATE, "rate_plan"
        attributes.update(currency="USD", sell_mode="per_room", rate_mode="manual")
        attributes["options"] = [{"occupancy": 2, "is_primary": True, "rate": "100.00"}]
        relationships["room_type"] = {"data": {"id": ROOM}}
    return {
        "id": identifier,
        "type": kind,
        "attributes": attributes,
        "relationships": relationships,
    }


class ChannexRemoteTests(DomainTestCase):
    def setUp(self):
        super().setUp()
        grant_system_access(self)
        self.manager, self.manager_headers = self.login("manager@test.local")
        self.provider = Mock()
        self.provider.properties.return_value = {
            "data": [property_entity()],
            "meta": {"page": 1, "limit": 25, "total": 1},
        }
        self.provider.property.return_value = property_entity()
        self.provider.catalog.side_effect = lambda resource, _: [catalog_entity(resource)]
        self.provider.catalog_entity.side_effect = lambda resource, _: catalog_entity(resource)
        self.provider.write_catalog.side_effect = self.saved_catalog
        provider_patch = patch(
            "pms_api.admin.channex_remote.ChannexClient", return_value=self.provider
        )
        self.factory = provider_patch.start()
        self.addCleanup(provider_patch.stop)
        config = patch.dict(
            self.app.config,
            {
                "CHANNEX_MANAGER_API_KEY_STAGING": "fixture-staging-key",
                "CHANNEX_MANAGER_API_KEY_PRODUCTION": None,
            },
        )
        config.start()
        self.addCleanup(config.stop)

    def remote(
        self,
        path="/accounts",
        *,
        account="system:staging",
        method="GET",
        body=None,
        client=None,
        headers=None,
    ):
        if path.startswith("/properties/"):
            linked_property(self, PROPERTY)
        url = "/api/admin/channex" + path
        if method == "GET" and path != "/accounts":
            url += ("&" if "?" in url else "?") + "accountId=" + account
        return self.request(
            method,
            url,
            body,
            client=client or self.manager,
            headers=self.manager_headers if headers is None else headers,
        )

    def connection(self, *, environment="staging", encrypted=False):
        with self.app.app_context():
            set_context("manager", is_system=True, is_service=True)
            row = db.session.scalar(
                select(ChannelConnection).where(ChannelConnection.tenant_id == self.tenant_id)
            ) or ChannelConnection(
                tenant_id=self.tenant_id,
                environment=environment,
                property_id=PROPERTY,
                credential_ref="FIXTURE_REMOTE_KEY",
                webhook_secret_ref="FIXTURE_WEBHOOK_KEY",
                actor_id="manager",
                active=False,
            )
            row.environment = environment
            if encrypted:
                row.secrets_ciphertext = encrypt_credentials(
                    self.tenant_id, environment, PROPERTY, "fixture-encrypted-key", "w" * 32
                )
            db.session.add(row)
            db.session.commit()

    def saved_catalog(self, resource, values, identifier=None):
        entity = catalog_entity(resource)
        entity["id"] = identifier or str(UUID(int=100 if resource == "room_types" else 101))
        entity["attributes"].update(values)
        if "room_type_id" in values:
            entity["relationships"]["room_type"]["data"]["id"] = values["room_type_id"]
        entity["attributes"]["private_settings"] = "provider-secret-field"
        return entity

    def room_body(self):
        return {
            "accountId": "system:staging",
            "name": "New room",
            "countOfRooms": 10,
            "adults": 2,
            "children": 0,
            "infants": 0,
        }

    def rate_body(self):
        return {
            "accountId": "system:staging",
            "name": "Flexible",
            "roomTypeId": ROOM,
            "currency": "USD",
            "rate": "125.50",
        }

    def property_body(self):
        return {
            "accountId": "system:staging",
            "name": "  An Nhien Riverside  ",
            "currency": "VND",
            "timezone": "Asia/Ho_Chi_Minh",
            "country": "VN",
            "city": "Da Nang",
            "address": "123 Riverside",
            "email": " OWNER@example.test ",
            "phone": "+84900000000",
        }

    def saved_property(self, values):
        entity = property_entity(str(UUID(int=100)))
        entity["attributes"].update(values)
        return entity

    def test_property_create_uses_system_source_sanitizes_response_and_audits_identifiers(self):
        self.provider.create_property.side_effect = self.saved_property
        response = self.remote("/properties", method="POST", body=self.property_body())
        self.assertEqual(response.status_code, 201, response.json)
        self.provider.create_property.assert_called_once_with(
            {
                "title": "An Nhien Riverside",
                "currency": "VND",
                "timezone": "Asia/Ho_Chi_Minh",
                "country": "VN",
                "city": "Da Nang",
                "address": "123 Riverside",
                "email": "owner@example.test",
                "phone": "+84900000000",
                "property_type": "hotel",
            }
        )
        self.assertEqual(
            response.json,
            {
                "environment": "staging",
                "property": {
                    "id": str(UUID(int=100)),
                    "name": "An Nhien Riverside",
                    "currency": "VND",
                    "timezone": "Asia/Ho_Chi_Minh",
                    "country": "VN",
                    "city": "Da Nang",
                    "linkedHotel": None,
                },
            },
        )
        self.assertNotIn("private-provider-field", str(response.json))
        self.assertNotIn("owner@example.test", str(response.json))
        with self.app.app_context():
            set_context("manager", is_system=True, is_service=True)
            self.assertEqual(db.session.query(Tenant).count(), 2)
            self.assertEqual(db.session.query(ChannelConnection).count(), 0)
            event = db.session.query(AuditLog).filter_by(event="channex.property.created").one()
            self.assertEqual(event.entity_id, str(UUID(int=100)))
            self.assertEqual(event.details, {"environment": "staging"})
            self.assertNotIn("example.test", str(event.details))

    def test_property_create_accepts_both_system_roles_and_environments(self):
        self.provider.create_property.side_effect = self.saved_property
        for email in ("admin@test.local", "manager@test.local"):
            actor, headers = self.login(email)
            for account, environment in (
                ("system:staging", "staging"),
                ("system:production", "production"),
            ):
                with (
                    self.subTest(email=email, account=account),
                    patch.dict(
                        self.app.config, {"CHANNEX_MANAGER_API_KEY_PRODUCTION": "fixture-prod-key"}
                    ),
                ):
                    response = self.remote(
                        "/properties",
                        method="POST",
                        body={**self.property_body(), "accountId": account},
                        client=actor,
                        headers=headers,
                    )
                    self.assertEqual(response.status_code, 201, response.json)
                    self.assertEqual(response.json["environment"], environment)

    def test_property_create_forwards_common_staging_currencies_without_conversion(self):
        self.provider.create_property.side_effect = self.saved_property
        for currency in ("EUR", "GBP", "JPY", "KRW", "SGD", "THB", "AUD", "AED"):
            with self.subTest(currency=currency):
                response = self.remote(
                    "/properties",
                    method="POST",
                    body={**self.property_body(), "currency": currency},
                )
                self.assertEqual(response.status_code, 201, response.json)
                self.assertEqual(response.json["property"]["currency"], currency)
                self.assertEqual(
                    self.provider.create_property.call_args.args[0]["currency"], currency
                )

    def test_property_create_requires_session_system_role_and_csrf_before_provider_calls(self):
        for email in ("owner-a@test.local", "frontdesk@test.local", "hk@test.local"):
            actor, headers = self.login(email)
            with self.subTest(email=email):
                response = self.remote(
                    "/properties",
                    method="POST",
                    body=self.property_body(),
                    client=actor,
                    headers=headers,
                )
                self.assertEqual(response.status_code, 403, response.json)
        for actor, headers, expected in (
            (self.manager, {}, 403),
            (self.app.test_client(), {}, 401),
        ):
            response = self.remote(
                "/properties",
                method="POST",
                body=self.property_body(),
                client=actor,
                headers=headers,
            )
            self.assertEqual(response.status_code, expected, response.json)
        self.factory.assert_not_called()
        self.provider.create_property.assert_not_called()

    def test_property_create_validates_every_field_and_rejects_hotel_sources_before_writing(self):
        changes = (
            {"accountId": "hotel:" + self.tenant_id},
            {"accountId": []},
            {"accountId": "system:unknown"},
            {"accountId": ""},
            {"name": " "},
            {"name": "x" * 256},
            {"name": "test\x00hotel"},
            {"name": 12},
            {"currency": "XXX"},
            {"currency": "vnd"},
            {"currency": ["VND"]},
            {"timezone": "Mars/Olympus"},
            {"timezone": ""},
            {"timezone": None},
            {"timezone": "../UTC"},
            {"country": "VNM"},
            {"country": "vn"},
            {"city": "x" * 256},
            {"address": "test\naddress"},
            {"email": "no-at-sign"},
            {"email": "bad\x7f@example.test"},
            {"email": "a" * 250 + "@e.test"},
            {"phone": "1" * 33},
            {"phone": "098210910A"},
            {"phone": "090+123"},
            {"phone": "---"},
            {"phone": 900000000},
            {"country": None},
            {"property_type": "apartment"},
            {"group_id": str(UUID(int=4))},
            {"tenantId": self.tenant_id},
            {"apiKey": "not-accepted"},
        )
        for change in changes:
            with self.subTest(change=change):
                response = self.remote(
                    "/properties", method="POST", body={**self.property_body(), **change}
                )
                self.assertEqual(response.status_code, 422, response.json)
        for missing in ("accountId", "name", "currency", "timezone"):
            body = self.property_body()
            del body[missing]
            response = self.remote("/properties", method="POST", body=body)
            self.assertEqual(response.status_code, 422, response.json)
        response = self.remote("/properties?force=true", method="POST", body=self.property_body())
        self.assertEqual(response.status_code, 422, response.json)
        self.factory.assert_not_called()
        self.provider.create_property.assert_not_called()

    def test_property_create_omits_empty_optional_fields_and_needs_configured_source(self):
        self.provider.create_property.side_effect = self.saved_property
        body = self.property_body()
        for field in ("country", "city", "address", "email", "phone"):
            body[field] = " "
        response = self.remote("/properties", method="POST", body=body)
        self.assertEqual(response.status_code, 201, response.json)
        self.provider.create_property.assert_called_once_with(
            {
                "title": "An Nhien Riverside",
                "currency": "VND",
                "timezone": "Asia/Ho_Chi_Minh",
                "property_type": "hotel",
            }
        )
        self.provider.create_property.reset_mock()
        response = self.remote(
            "/properties", method="POST", body={**body, "accountId": "system:production"}
        )
        self.assertEqual(response.status_code, 503, response.json)
        self.provider.create_property.assert_not_called()

    def test_property_create_unknown_provider_result_is_safe_and_never_retried(self):
        for error, status in (
            (ProviderError("provider_unavailable", True), 503),
            (ProviderError("provider_rejected"), 502),
            (ProviderError("private-provider-error"), 502),
        ):
            self.provider.create_property.reset_mock()
            self.provider.create_property.side_effect = error
            response = self.remote("/properties", method="POST", body=self.property_body())
            self.assertEqual(response.status_code, status, response.json)
            self.assertIn("Tải lại", response.json["error"]["message"])
            self.assertNotIn("private-provider", str(response.json))
            self.provider.create_property.assert_called_once()
        self.provider.create_property.side_effect = None
        for field, value in (("title", "Wrong hotel"), ("currency", "USD"), ("timezone", "UTC")):
            entity = self.saved_property(
                {"title": "An Nhien Riverside", "currency": "VND", "timezone": "Asia/Ho_Chi_Minh"}
            )
            entity["attributes"][field] = value
            self.provider.create_property.return_value = entity
            response = self.remote("/properties", method="POST", body=self.property_body())
            self.assertEqual(response.status_code, 502, response.json)
            self.assertNotIn("property", response.json)
        with self.app.app_context():
            set_context("manager", is_system=True, is_service=True)
            self.assertEqual(
                db.session.query(AuditLog).filter_by(event="channex.property.created").count(), 0
            )

    def test_accounts_show_optional_sources_without_provider_calls_or_secret_fields(self):
        self.connection()
        with patch.dict(os.environ, {"FIXTURE_REMOTE_KEY": "fixture-legacy-key"}):
            response = self.remote()
            self.assertEqual(response.status_code, 200, response.json)
            accounts = {row["id"]: row for row in response.json["accounts"]}
            self.assertTrue(accounts["system:staging"]["configured"])
            self.assertFalse(accounts["system:production"]["configured"])
            self.assertTrue(accounts["hotel:" + self.tenant_id]["configured"])
            self.assertEqual(accounts["hotel:" + self.tenant_id]["environment"], "staging")
            self.assertNotIn("fixture", str(response.json))
            self.assertNotIn("credentialRef", str(response.json))
            self.assertNotIn("ciphertext", str(response.json))
        self.factory.assert_not_called()

    def test_system_roles_only_and_disabled_sessions_fail_closed(self):
        grant_system_access(self, "admin")
        for email, expected in (("admin@test.local", 200), ("owner-a@test.local", 403)):
            client, headers = self.login(email)
            for path in ("/accounts", "/properties", f"/properties/{PROPERTY}/catalog"):
                with self.subTest(email=email, path=path):
                    response = self.remote(path, client=client, headers=headers)
                    self.assertEqual(response.status_code, expected, response.json)
        self.assertEqual(self.remote(client=self.app.test_client(), headers={}).status_code, 401)
        with patch("pms_api.security.authenticate", return_value=Mock(global_role="UNKNOWN_ROLE")):
            self.assertEqual(self.remote().status_code, 403)
        with self.app.app_context():
            set_context("manager", is_system=True, is_service=True)
            db.session.get(User, "manager").active = False
            db.session.commit()
        self.assertEqual(self.remote().status_code, 401)

    def test_source_and_environment_are_explicit_without_fallback(self):
        self.connection(environment="production")
        with patch.dict(os.environ, {"FIXTURE_REMOTE_KEY": "fixture-legacy-key"}):
            response = self.remote("/properties", account="hotel:" + self.tenant_id)
            self.assertEqual(response.status_code, 200, response.json)
            self.assertEqual(response.json["environment"], "production")
            self.factory.assert_called_once_with("production", "fixture-legacy-key")
            self.assertEqual(
                response.json["properties"][0]["linkedHotel"]["tenantId"], self.tenant_id
            )
        self.factory.reset_mock()
        for source, expected in (("system:production", 503), ("hotel:missing", 404), ("", 422)):
            with self.subTest(source=source):
                self.assertEqual(self.remote("/properties", account=source).status_code, expected)
        self.factory.assert_not_called()

    def test_encrypted_hotel_source_needs_no_manager_key_and_never_falls_back(self):
        with patch.dict(
            self.app.config,
            {
                "CHANNEX_ENCRYPTION_KEY": Fernet.generate_key().decode(),
                "CHANNEX_MANAGER_API_KEY_STAGING": None,
            },
        ):
            self.connection(encrypted=True)
            response = self.remote("/properties", account="hotel:" + self.tenant_id)
            self.assertEqual(response.status_code, 200, response.json)
            self.factory.assert_called_once_with("staging", "fixture-encrypted-key")
            self.assertNotIn("fixture-encrypted-key", str(response.json))
            with self.app.app_context():
                set_context("manager", is_system=True, is_service=True)
                db.session.query(
                    ChannelConnection
                ).first().secrets_ciphertext = "private-damaged-token"
                db.session.commit()
            self.factory.reset_mock()
            with patch.dict(os.environ, {"FIXTURE_REMOTE_KEY": "fixture-legacy-key"}):
                response = self.remote("/properties", account="hotel:" + self.tenant_id)
                self.assertEqual(response.status_code, 503, response.json)
                self.assertNotIn("private-damaged", str(response.json))
                self.factory.assert_not_called()

    def test_property_list_links_only_matching_environment_and_validates_pagination(self):
        self.connection()
        response = self.remote("/properties")
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(
            response.json["pagination"],
            {
                "page": 1,
                "pageSize": 25,
                "totalItems": 1,
                "totalPages": 1,
            },
        )
        self.assertEqual(
            response.json["properties"][0]["linkedHotel"],
            {
                "tenantId": self.tenant_id,
                "name": "Hotel a",
            },
        )
        self.assertNotIn("private-provider-field", str(response.json))
        with patch.dict(self.app.config, {"CHANNEX_MANAGER_API_KEY_PRODUCTION": "fixture-key"}):
            response = self.remote("/properties", account="system:production")
            self.assertIsNone(response.json["properties"][0]["linkedHotel"])
        self.provider.properties.return_value = {
            "data": [property_entity()],
            "meta": {"page": 2, "limit": 25, "total": 26},
        }
        response = self.remote("/properties?page=2")
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json["pagination"]["totalPages"], 2)
        self.provider.properties.assert_called_with(2)

    def test_malformed_remote_properties_and_metadata_return_no_partial_data(self):
        entity = property_entity()
        cases = [
            {"data": [entity, entity], "meta": {"page": 1, "limit": 25, "total": 2}},
            {"data": [entity], "meta": {"page": True, "limit": 25, "total": 1}},
            {"data": [entity], "meta": {"page": 1, "limit": 24, "total": 1}},
            {"data": [entity], "meta": {"page": 1, "limit": 25, "total": 2}},
        ]
        for changes in (
            {"id": "invalid"},
            {"type": "booking"},
            {"attributes": {"title": "x", "currency": "usd"}},
            {"attributes": {**entity["attributes"], "city": []}},
        ):
            cases.append(
                {"data": [{**entity, **changes}], "meta": {"page": 1, "limit": 25, "total": 1}}
            )
        for result in cases:
            with self.subTest(result=result):
                self.provider.properties.return_value = result
                response = self.remote("/properties")
                self.assertEqual(response.status_code, 502, response.json)
                self.assertNotIn("properties", response.json)

    def test_remote_catalog_includes_occupancy_modes_and_unsupported_plans(self):
        rate = catalog_entity("rate_plans")
        derived = deepcopy(rate)
        derived["id"] = str(UUID(int=10))
        derived["attributes"]["rate_mode"] = "derived"
        self.provider.catalog.side_effect = lambda resource, _: (
            [catalog_entity(resource)] if resource == "room_types" else [rate, derived]
        )
        response = self.remote(f"/properties/{PROPERTY}/catalog")
        self.assertEqual(response.status_code, 200, response.json)
        room = response.json["roomTypes"][0]
        self.assertEqual(
            (room["countOfRooms"], room["adults"], room["children"], room["infants"]),
            (10, 2, 0, 0),
        )
        self.assertEqual([row["supported"] for row in response.json["ratePlans"]], [True, False])
        self.assertEqual(response.json["ratePlans"][1]["rateMode"], "derived")
        self.assertEqual(response.json["ratePlans"][0]["sellMode"], "per_room")
        self.provider.property.assert_called_once_with(PROPERTY)
        self.assertEqual(self.provider.catalog.call_count, 2)
        self.assertEqual(response.json["ratePlans"][0]["rate"], "100.0000")
        self.assertTrue(response.json["ratePlans"][0]["editable"])
        self.assertFalse(response.json["ratePlans"][1]["editable"])

    def test_malformed_catalog_counts_and_property_scope_are_rejected(self):
        for value in (True, -1, 1.5, "10", float("inf")):
            room = catalog_entity("room_types")
            room["attributes"]["count_of_rooms"] = value
            self.provider.catalog.side_effect = lambda resource, _: (
                [room] if resource == "room_types" else [catalog_entity(resource)]
            )
            with self.subTest(value=value):
                self.assertEqual(self.remote(f"/properties/{PROPERTY}/catalog").status_code, 502)
        self.provider.property.return_value = property_entity(str(UUID(int=99)))
        self.assertEqual(self.remote(f"/properties/{PROPERTY}/catalog").status_code, 502)

    def test_query_allowlists_and_provider_errors_are_safe(self):
        for query in (
            "page=0",
            "page=1.5",
            "page=99999999999",
            "page=1&page=2",
            "accountId=system:production",
            "environment=production",
        ):
            with self.subTest(query=query):
                response = self.remote("/properties?" + query)
                self.assertEqual(response.status_code, 422, response.json)
        self.factory.assert_not_called()
        for error, expected in (
            (ProviderError("provider_unavailable", True), 503),
            (ProviderError("private-unknown-code"), 502),
        ):
            self.provider.properties.side_effect = error
            response = self.remote("/properties")
            self.assertEqual(response.status_code, expected, response.json)
            self.assertNotIn("private-unknown-code", str(response.json))

    def test_native_room_create_update_and_identifier_only_audit(self):
        path = f"/properties/{PROPERTY}/room-types"
        response = self.remote(path, method="POST", body=self.room_body())
        self.assertEqual(response.status_code, 201, response.json)
        self.assertEqual(response.json["roomType"]["name"], "New room")
        self.provider.write_catalog.assert_called_with(
            "room_types",
            {
                "property_id": PROPERTY,
                "title": "New room",
                "count_of_rooms": 10,
                "occ_adults": 2,
                "occ_children": 0,
                "occ_infants": 0,
                "default_occupancy": 2,
                "room_kind": "room",
            },
        )
        self.assertNotIn("provider-secret-field", str(response.json))
        body = {**self.room_body(), "name": "Renamed", "adults": 1}
        response = self.remote(path + "/" + ROOM, method="PATCH", body=body)
        self.assertEqual(response.status_code, 200, response.json)
        values = self.provider.write_catalog.call_args.args[1]
        self.assertEqual(values["default_occupancy"], 1)
        self.assertNotIn("property_id", values)
        self.assertNotIn("capacity", values)
        self.assertNotIn("room_kind", values)
        with self.app.app_context():
            set_context("manager", is_system=True, is_service=True)
            events = db.session.query(AuditLog).filter(AuditLog.event.like("channex.%")).all()
            self.assertEqual(len(events), 2)
            self.assertTrue(
                all(row.tenant_id == self.tenant_id and row.user_id == "manager" for row in events)
            )
            self.assertTrue(
                all(set(row.details) == {"propertyId", "environment"} for row in events)
            )
            self.assertNotIn("provider-secret-field", str([row.details for row in events]))

    def test_native_rate_create_and_update_preserve_identity_and_modes(self):
        path = f"/properties/{PROPERTY}/rate-plans"
        response = self.remote(path, method="POST", body=self.rate_body())
        self.assertEqual(response.status_code, 201, response.json)
        self.assertEqual(response.json["ratePlan"]["rate"], "125.5000")
        values = self.provider.write_catalog.call_args.args[1]
        self.assertEqual(
            values["options"], [{"occupancy": 2, "is_primary": True, "rate": "125.5000"}]
        )
        self.assertEqual(
            (values["sell_mode"], values["rate_mode"], values["inherit_rate"]),
            ("per_room", "manual", False),
        )
        response = self.remote(
            path + "/" + RATE,
            method="PATCH",
            body={
                "accountId": "system:staging",
                "name": "New default",
                "rate": "150",
            },
        )
        self.assertEqual(response.status_code, 200, response.json)
        values = self.provider.write_catalog.call_args.args[1]
        self.assertEqual(set(values), {"title", "options"})
        self.assertEqual(response.json["ratePlan"]["roomTypeId"], ROOM)
        self.assertEqual(response.json["ratePlan"]["currency"], "USD")
        self.assertNotIn("provider-secret-field", str(response.json))

    def test_native_mutations_require_system_authority_csrf_and_valid_input(self):
        owner, headers = self.login()
        for path, body in (
            (f"/properties/{PROPERTY}/room-types", self.room_body()),
            (f"/properties/{PROPERTY}/rate-plans", self.rate_body()),
        ):
            for client, csrf, expected in (
                (owner, headers, 403),
                (self.manager, {}, 403),
                (self.app.test_client(), {}, 401),
            ):
                with self.subTest(path=path, expected=expected):
                    self.assertEqual(
                        self.remote(
                            path, method="POST", body=body, client=client, headers=csrf
                        ).status_code,
                        expected,
                    )
        for changes in (
            {"countOfRooms": True},
            {"adults": 0},
            {"children": -1},
            {"infants": 1.5},
            {"name": " "},
            {"force": True},
        ):
            with self.subTest(changes=changes):
                response = self.remote(
                    f"/properties/{PROPERTY}/room-types",
                    method="POST",
                    body={**self.room_body(), **changes},
                )
                self.assertEqual(response.status_code, 422, response.json)
        for value in (False, 125.5, "NaN", "-1", "1e5", "123.12345", "1" * 16):
            with self.subTest(value=value):
                response = self.remote(
                    f"/properties/{PROPERTY}/rate-plans",
                    method="POST",
                    body={**self.rate_body(), "rate": value},
                )
                self.assertEqual(response.status_code, 422, response.json)
        self.provider.write_catalog.assert_not_called()
        for changes in (
            {"currency": "EUR"},
            {"roomTypeId": str(UUID(int=99))},
            {"propertyId": str(UUID(int=99))},
        ):
            response = self.remote(
                f"/properties/{PROPERTY}/rate-plans/{RATE}",
                method="PATCH",
                body={
                    "accountId": "system:staging",
                    "name": "Updated",
                    "rate": "125",
                    **changes,
                },
            )
            self.assertEqual(response.status_code, 422, response.json)
        self.provider.write_catalog.assert_not_called()

    def test_native_writes_verify_property_and_resource_ownership_and_saved_response(self):
        path = f"/properties/{PROPERTY}/room-types/{ROOM}"
        room = catalog_entity("room_types")
        room["relationships"]["property"]["data"]["id"] = str(UUID(int=99))
        self.provider.catalog_entity.return_value = room
        self.provider.catalog_entity.side_effect = None
        response = self.remote(path, method="PATCH", body=self.room_body())
        self.assertEqual(response.status_code, 502, response.json)
        self.provider.write_catalog.assert_not_called()
        self.provider.catalog_entity.side_effect = lambda resource, _: catalog_entity(resource)
        self.provider.write_catalog.side_effect = None
        self.provider.write_catalog.return_value = {
            **catalog_entity("room_types"),
            "id": str(UUID(int=99)),
        }
        response = self.remote(path, method="PATCH", body=self.room_body())
        self.assertEqual(response.status_code, 502, response.json)
        self.assertNotIn("roomType", response.json)
        self.provider.write_catalog.side_effect = ProviderError("provider_unavailable", True)
        response = self.remote(
            f"/properties/{PROPERTY}/rate-plans", method="POST", body=self.rate_body()
        )
        self.assertEqual(response.status_code, 503, response.json)
        self.assertIn("Tải lại", response.json["error"]["message"])

    def test_linked_mapping_guards_room_capacity_rate_currency_and_pending_closeout(self):
        self.connection()
        with self.app.app_context():
            set_context("manager", is_system=True, is_service=True)
            db.session.add(
                ChannelMapping(
                    tenant_id=self.tenant_id,
                    room_type_id="rt-a",
                    remote_room_type_id=ROOM,
                    remote_rate_plan_id=RATE,
                    used_at=utcnow(),
                    active=False,
                )
            )
            db.session.commit()
        path = f"/properties/{PROPERTY}/room-types/{ROOM}"
        response = self.remote(path, method="PATCH", body={**self.room_body(), "countOfRooms": 9})
        self.assertEqual(response.status_code, 409, response.json)
        self.provider.write_catalog.assert_not_called()

        response = self.remote(path, method="PATCH", body=self.room_body())
        self.assertEqual(response.status_code, 200, response.json)
        self.assertTrue(response.json["roomType"]["mapped"])
        self.provider.write_catalog.reset_mock()
        response = self.remote(
            f"/properties/{PROPERTY}/rate-plans/{RATE}",
            method="PATCH",
            body={"accountId": "system:staging", "name": "Updated", "rate": "150"},
        )
        self.assertEqual(response.status_code, 409, response.json)
        self.provider.write_catalog.assert_not_called()
        with self.app.app_context():
            set_context("manager", is_system=True, is_service=True)
            db.session.get(Tenant, self.tenant_id).settings = {"currency": "USD"}
            db.session.query(ChannelMapping).first().pause_requested = True
            db.session.commit()
        response = self.remote(
            f"/properties/{PROPERTY}/rate-plans/{RATE}",
            method="PATCH",
            body={"accountId": "system:staging", "name": "Updated", "rate": "150"},
        )
        self.assertEqual(response.status_code, 409, response.json)
        self.assertEqual(response.json["error"]["code"], "channel_mapping_pause_pending")
        self.provider.write_catalog.assert_not_called()

        with self.app.app_context():
            set_context("manager", is_system=True, is_service=True)
            db.session.query(ChannelMapping).first().pause_requested = False
            db.session.commit()
        response = self.remote(
            f"/properties/{PROPERTY}/rate-plans/{RATE}",
            method="PATCH",
            body={"accountId": "system:staging", "name": "Updated", "rate": "150"},
        )
        self.assertEqual(response.status_code, 200, response.json)

    def test_complex_rate_options_are_readable_but_cannot_be_overwritten(self):
        rate = catalog_entity("rate_plans")
        rate["attributes"]["options"].append({"occupancy": 1, "is_primary": False, "rate": "90"})
        self.provider.catalog_entity.side_effect = lambda resource, _: (
            rate if resource == "rate_plans" else catalog_entity(resource)
        )
        response = self.remote(
            f"/properties/{PROPERTY}/rate-plans/{RATE}",
            method="PATCH",
            body={"accountId": "system:staging", "name": "Updated", "rate": "150"},
        )
        self.assertEqual(response.status_code, 409, response.json)
        self.provider.write_catalog.assert_not_called()


class ChannexPageTests(unittest.TestCase):
    def test_pages_support_provider_int32_range(self):
        from common import ApiError
        from pms_api.admin.channex_remote import page_number

        self.assertEqual(page_number("2147483647"), 2147483647)
        for value in ("0", "2147483648", "-1", "1.5"):
            with self.subTest(value=value), self.assertRaises(ApiError):
                page_number(value)

    def test_empty_page_and_invalid_provider_metadata(self):
        from pms_api.admin.channex_remote import read_page

        rows, page = read_page({"data": [], "meta": {"page": 1, "limit": 25, "total": 0}}, 1)
        self.assertEqual(rows, [])
        self.assertEqual(page["totalPages"], 0)
        for result in (
            None,
            [],
            {},
            {"data": [], "meta": []},
            {"data": [], "meta": {"page": 1, "limit": 25, "total": -1}},
            {"data": [], "meta": {"page": 1, "limit": 25, "total": True}},
            {"data": [], "meta": {"page": 1, "limit": True, "total": 0}},
        ):
            with self.subTest(result=result), self.assertRaises(ProviderError):
                read_page(result, 1)


if __name__ == "__main__":
    unittest.main()
