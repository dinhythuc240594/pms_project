"""Audit query contract, authorization and boundaries on disposable PostgreSQL."""

from datetime import datetime, timedelta, timezone

from pms_api.core_models import AuditLog
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class AuditFilterTests(DomainTestCase):
    def setUp(self):
        super().setUp()
        self.admin, _ = self.login("admin@test.local")
        self.start = datetime(2026, 10, 1, tzinfo=timezone.utc)
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            for key, tenant, actor, hours in (
                ("a-old", self.tenant_id, "owner-a", -1),
                ("a-start", self.tenant_id, "owner-a", 0),
                ("a-tie-1", self.tenant_id, "owner-a", 1),
                ("a-tie-2", self.tenant_id, "owner-a", 1),
                ("a-other-actor", self.tenant_id, "admin", 1),
                ("b", self.other_tenant_id, "owner-a", 1),
                ("global", None, None, 1),
                ("a-end", self.tenant_id, "owner-a", 2),
            ):
                db.session.add(
                    AuditLog(
                        id=key,
                        tenant_id=tenant,
                        user_id=actor,
                        event="tenant.updated",
                        entity_type="fixture",
                        entity_id=key,
                        created_at=self.start + timedelta(hours=hours),
                    )
                )
            db.session.commit()

    def test_combined_filters_timezone_boundaries_and_stable_pages(self):
        query = {
            "tenantId": self.tenant_id,
            "userId": "owner-a",
            "start": "2026-10-01T07:00:00+07:00",
            "end": "2026-10-01T09:00:00+07:00",
            "pageSize": 2,
        }
        first = self.admin.get("/api/audit", query_string=query)
        self.assertEqual(first.status_code, 200, first.json)
        self.assertEqual([r["id"] for r in first.json["auditLogs"]], ["a-tie-2", "a-tie-1"])
        self.assertEqual(first.json["pagination"], {"page": 1, "pageSize": 2, "totalItems": 3})
        second = self.admin.get("/api/audit", query_string={**query, "page": 2})
        self.assertEqual([r["id"] for r in second.json["auditLogs"]], ["a-start"])
        empty = self.admin.get("/api/audit", query_string={**query, "page": 3})
        self.assertEqual(empty.json["auditLogs"], [])
        self.assertEqual(empty.json["pagination"]["totalItems"], 3)

    def test_individual_filters_unknown_ids_and_legacy_response(self):
        response = self.admin.get("/api/audit")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json["auditLogs"]), 8)
        self.assertEqual(response.json["pagination"]["pageSize"], 200)
        for query, ids in (
            ({"tenantId": self.other_tenant_id}, {"b"}),
            ({"userId": "admin"}, {"a-other-actor"}),
            ({"tenantId": "unknown"}, set()),
            ({"userId": "unknown"}, set()),
            ({"start": "2026-10-01T02:00:00Z"}, {"a-end"}),
            ({"end": "2026-10-01T00:00:00Z"}, {"a-old"}),
        ):
            with self.subTest(query=query):
                result = self.admin.get("/api/audit", query_string=query)
                self.assertEqual(result.status_code, 200)
                self.assertEqual({r["id"] for r in result.json["auditLogs"]}, ids)

    def test_invalid_filters_and_unauthorized_roles(self):
        for query in (
            {"start": "2026-10-01"},
            {"end": "bad"},
            {"start": ""},
            {"start": "2026-10-02T00:00:00Z", "end": "2026-10-01T00:00:00Z"},
            {"start": "2026-10-01T00:00:00Z", "end": "2026-10-01T00:00:00Z"},
            {"page": "bad"},
            {"page": 0},
            {"page": 100001},
            {"pageSize": 0},
            {"pageSize": 201},
            {"tenantId": " "},
            {"userId": "x" * 41},
        ):
            with self.subTest(query=query):
                self.assertEqual(self.admin.get("/api/audit", query_string=query).status_code, 422)
        self.assertEqual(self.app.test_client().get("/api/audit").status_code, 401)
        for email in ("owner-a@test.local", "owner-b@test.local", "manager@test.local"):
            client, _ = self.login(email)
            self.assertEqual(
                client.get("/api/audit", query_string={"tenantId": self.tenant_id}).status_code, 403
            )
