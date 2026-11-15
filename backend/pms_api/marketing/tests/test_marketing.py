"""Focused marketing tests against a SQLite test DB and the real HTTP/security code.

The supplied checkout omits the app factory's core dependencies. Missing pricing,
IP and entitlement adapters are explicit host fixtures; set_context is replaced
only because SQLite has no PostgreSQL transaction GUCs. These tests do NOT claim
to exercise PostgreSQL RLS, row locks or the full PMS application factory.
"""

import base64
import copy
import importlib
import io
import json
import sys
import types
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from flask import Flask, g
from sqlalchemy import event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.compiler import compiles

BACKEND = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(BACKEND))
namespace = types.ModuleType("pms_api")
namespace.__path__ = [str(BACKEND / "pms_api")]
sys.modules["pms_api"] = namespace
pricing_fixture = types.ModuleType("pms_api.plan_pricing")
pricing_fixture.default_pricing_rules = lambda: {}
sys.modules["pms_api.plan_pricing"] = pricing_fixture
ip_fixture = types.ModuleType("pms_api.audit_ip")
ip_fixture.capture_request_ip = lambda: ("127.0.0.1", "direct")
sys.modules["pms_api.audit_ip"] = ip_fixture

from common import ApiError  # noqa: E402
from pms_api import core_models, security  # noqa: E402
from pms_api.extensions import db  # noqa: E402
from pms_api.marketing import application, generation  # noqa: E402
from pms_api.marketing.documents import CHECKLIST, initial_document, validate_document  # noqa: E402
from pms_api.marketing.models import (  # noqa: E402
    MarketingGeneration,
    MarketingPublication,
    MarketingRelease,
    MarketingRevision,
)
from pms_api.marketing.rendering import render_page  # noqa: E402
from pms_api.marketing.urls import marketing, marketing_public  # noqa: E402

entitlement_fixture = types.ModuleType("pms_api.subscriptions")
entitlement_fixture.lock_tenant = lambda tenant_id: db.session.get(core_models.Tenant, tenant_id)
entitlement_fixture.enforce_entitlements = lambda action: None
sys.modules["pms_api.subscriptions"] = entitlement_fixture


@compiles(JSONB, "sqlite")
def sqlite_json(_type, _compiler, **_kwargs):
    return "JSON"


class MarketingTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True,
            APP_ENV="testing",
            SQLALCHEMY_DATABASE_URI="sqlite://",
            MARKETING_ENABLED=True,
            MARKETING_PUBLIC_ORIGIN="https://hotel.example",
            MARKETING_AI_API_KEY="test-only-key",
            MARKETING_AI_MODEL="test-model",
            MARKETING_AI_DAILY_LIMIT=20,
            CORS_ORIGINS=[],
        )
        db.init_app(self.app)
        self.context = self.app.app_context()
        self.context.push()
        event.listen(
            db.engine, "connect", lambda connection, _: connection.execute("PRAGMA foreign_keys=ON")
        )
        self.scope_patch = patch.object(security, "set_context", lambda *args, **kwargs: None)
        self.scope_patch.start()
        self.clock_patch = patch.object(
            security, "utcnow", lambda: datetime.now(UTC).replace(tzinfo=None)
        )
        self.clock_patch.start()
        # Ensure route module binds the SQLite context fixture, never a production DB.
        routes = importlib.import_module("pms_api.marketing.routes")
        self.route_scope_patch = patch.object(routes, "set_context", lambda *args, **kwargs: None)
        self.route_scope_patch.start()
        security.register_security(self.app)

        @self.app.before_request
        def clear_held_app_context_identity():
            for key in ("user", "auth_session", "tenant", "role"):
                g.pop(key, None)

        self.app.register_blueprint(marketing)
        self.app.register_blueprint(marketing_public)
        db.create_all()
        db.session.add_all(
            [
                core_models.Tenant(id="hotel-a", name="Hotel A"),
                core_models.Tenant(id="hotel-b", name="Hotel B"),
                core_models.User(
                    id="owner-a", name="Owner A", email="a@example.com", password_hash="test"
                ),
                core_models.User(
                    id="owner-b", name="Owner B", email="b@example.com", password_hash="test"
                ),
                core_models.User(
                    id="desk", name="Desk", email="d@example.com", password_hash="test"
                ),
                core_models.User(
                    id="system",
                    name="System",
                    email="s@example.com",
                    password_hash="test",
                    global_role="SUPER_ADMIN",
                ),
            ]
        )
        db.session.flush()
        db.session.add_all(
            [
                core_models.TenantUser(tenant_id="hotel-a", user_id="owner-a", role="HOTEL_OWNER"),
                core_models.TenantUser(tenant_id="hotel-b", user_id="owner-b", role="HOTEL_OWNER"),
                core_models.TenantUser(tenant_id="hotel-a", user_id="desk", role="FRONT_DESK"),
            ]
        )
        for user in ("owner-a", "owner-b", "desk", "system"):
            db.session.add(
                core_models.AuthSession(
                    token_hash=security.digest(user),
                    user_id=user,
                    csrf_token="csrf",
                    expires_at=datetime.now(UTC) + timedelta(hours=1),
                )
            )
        db.session.commit()
        self.client = self.app.test_client()
        self.login("owner-a")
        self.counter = 0

    def tearDown(self):
        db.session.remove()
        db.engine.dispose()
        self.route_scope_patch.stop()
        self.clock_patch.stop()
        self.scope_patch.stop()
        self.context.pop()

    def login(self, actor):
        self.client.set_cookie("pms_session", actor)

    def post(self, path, data, *, tenant="hotel-a", key=None, csrf=True):
        self.counter += 1
        headers = {"Idempotency-Key": key or f"test-{self.counter}"}
        if csrf:
            headers["X-CSRF-Token"] = "csrf"
        return self.client.post(
            f"/api/tenants/{tenant}/marketing{path}", json=data, headers=headers
        )

    def create(self):
        response = self.post("/pages", {"name": "Hotel page", "templateId": "hotel"})
        self.assertEqual(response.status_code, 201, response.get_json())
        return response.get_json()

    def ready(self):
        page = self.create()
        document = copy.deepcopy(page["document"])
        document["seo"]["description"] = "Confirmed hotel description."
        document["cta"]["url"] = "tel:+84901234567"
        response = self.post(
            f"/pages/{page['id']}/revisions",
            {
                "expectedVersion": page["version"],
                "baseRevisionId": page["workingRevisionId"],
                "document": document,
            },
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        return response.get_json()

    def approve(self, page):
        response = self.post(
            f"/pages/{page['id']}/review-requests", {"expectedVersion": page["version"]}
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        artifact = response.get_json()
        response = self.post(
            f"/pages/{page['id']}/reviews",
            {
                "expectedVersion": page["version"],
                "artifactId": artifact["artifactId"],
                "manifestHash": artifact["manifestHash"],
                "decision": "approved",
                "checklist": dict.fromkeys(CHECKLIST, True),
                "note": "",
            },
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        return response.get_json(), artifact

    def publish(self, page, artifact, key=None):
        data = {
            "expectedVersion": page["version"],
            "expectedPublishedReleaseId": page["publishedReleaseId"],
            "approvalId": page["review"]["id"],
            "manifestHash": artifact["manifestHash"],
        }
        return self.post(f"/pages/{page['id']}/publish", data, key=key), data

    def test_full_review_publish_exact_artifact_and_draft_independence(self):
        page, artifact = self.approve(self.ready())
        response, _ = self.publish(page, artifact)
        self.assertEqual(response.status_code, 200, response.get_json())
        live = response.get_json()
        public = self.client.get(live["publishedUrl"])
        self.assertEqual(public.status_code, 200)
        self.assertEqual(public.get_data(as_text=True), artifact["html"])
        self.assertIn("no-cache", public.headers["Cache-Control"])
        document = copy.deepcopy(live["document"])
        document["sections"][0]["heading"] = "Changed, still private"
        updated = self.post(
            f"/pages/{page['id']}/revisions",
            {
                "expectedVersion": live["version"],
                "baseRevisionId": live["workingRevisionId"],
                "document": document,
            },
        ).get_json()
        self.assertIsNone(updated["review"])
        self.assertEqual(
            self.client.get(live["publishedUrl"]).get_data(as_text=True), artifact["html"]
        )

    def test_publish_requires_approval_and_stale_revision_cannot_publish(self):
        page = self.ready()
        response = self.post(
            f"/pages/{page['id']}/publish",
            {"expectedVersion": page["version"], "approvalId": "absent"},
        )
        self.assertEqual(response.status_code, 409)
        page, artifact = self.approve(page)
        updated = self.post(
            f"/pages/{page['id']}/revisions",
            {
                "expectedVersion": page["version"],
                "baseRevisionId": page["workingRevisionId"],
                "document": page["document"],
            },
        ).get_json()
        response, _ = self.publish({**page, "version": updated["version"]}, artifact)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(db.session.query(MarketingRelease).count(), 0)

    def test_idempotent_publish_and_payload_mismatch(self):
        page, artifact = self.approve(self.ready())
        first, data = self.publish(page, artifact, key="publish-stable")
        again = self.post(f"/pages/{page['id']}/publish", data, key="publish-stable")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.get_json(), again.get_json())
        self.assertEqual(db.session.query(MarketingRelease).count(), 1)
        changed = self.post(
            f"/pages/{page['id']}/publish",
            {**data, "manifestHash": "different"},
            key="publish-stable",
        )
        self.assertEqual(changed.status_code, 409)

    def test_unpublish_stops_old_etag_and_restore_uses_saved_html(self):
        page, artifact = self.approve(self.ready())
        response, _ = self.publish(page, artifact)
        page = response.get_json()
        url, release = page["publishedUrl"], page["publishedReleaseId"]
        etag = self.client.get(url).headers["ETag"]
        response = self.post(
            f"/pages/{page['id']}/unpublish",
            {
                "expectedVersion": page["version"],
                "expectedPublishedReleaseId": release,
            },
        )
        page = response.get_json()
        self.assertEqual(self.client.get(url, headers={"If-None-Match": etag}).status_code, 404)
        response = self.post(
            f"/pages/{page['id']}/restore",
            {
                "expectedVersion": page["version"],
                "expectedPublishedReleaseId": None,
                "targetReleaseId": release,
            },
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(self.client.get(url).get_data(as_text=True), artifact["html"])

    def test_csrf_owner_and_tenant_boundaries(self):
        page = self.create()
        self.assertEqual(self.post("/pages", {}, csrf=False).status_code, 403)
        self.assertEqual(
            self.client.get(f"/api/tenants/hotel-b/marketing/pages/{page['id']}").status_code, 403
        )
        self.login("owner-b")
        self.assertEqual(
            self.client.get(f"/api/tenants/hotel-b/marketing/pages/{page['id']}").status_code, 404
        )
        self.login("desk")
        self.assertEqual(self.client.get("/api/tenants/hotel-a/marketing/pages").status_code, 403)
        self.login("system")
        self.assertEqual(self.client.get("/api/tenants/hotel-a/marketing/pages").status_code, 403)
        self.client.delete_cookie("pms_session")
        self.assertEqual(self.client.get("/api/tenants/hotel-a/marketing/pages").status_code, 401)

    def test_incomplete_checklist_and_missing_cta_are_blocked(self):
        page = self.create()
        response = self.post(
            f"/pages/{page['id']}/review-requests", {"expectedVersion": page["version"]}
        )
        self.assertEqual(response.status_code, 422)
        page = self.ready()
        artifact = self.post(
            f"/pages/{page['id']}/review-requests", {"expectedVersion": page["version"]}
        ).get_json()
        response = self.post(
            f"/pages/{page['id']}/reviews",
            {
                "expectedVersion": page["version"],
                "artifactId": artifact["artifactId"],
                "manifestHash": artifact["manifestHash"],
                "decision": "approved",
                "checklist": {"facts": True},
            },
        )
        self.assertEqual(response.status_code, 422)

    def test_suspended_hotel_public_page_is_404_even_with_etag(self):
        page, artifact = self.approve(self.ready())
        response, _ = self.publish(page, artifact)
        url = response.get_json()["publishedUrl"]
        etag = self.client.get(url).headers["ETag"]
        db.session.get(core_models.Tenant, "hotel-a").status = "suspended"
        db.session.commit()
        self.assertEqual(self.client.get(url, headers={"If-None-Match": etag}).status_code, 404)

    def test_stale_manual_save_is_conflict(self):
        page = self.create()
        data = {
            "expectedVersion": page["version"],
            "baseRevisionId": page["workingRevisionId"],
            "document": page["document"],
        }
        self.assertEqual(self.post(f"/pages/{page['id']}/revisions", data).status_code, 200)
        self.assertEqual(self.post(f"/pages/{page['id']}/revisions", data).status_code, 409)

    def test_ai_job_dedup_quota_proposal_and_stale_apply(self):
        page = self.ready()
        data = {
            "expectedVersion": page["version"],
            "baseRevisionId": page["workingRevisionId"],
            "prompt": "Write concise copy",
        }
        first = self.post(f"/pages/{page['id']}/generations", data, key="ai-stable")
        again = self.post(f"/pages/{page['id']}/generations", data, key="ai-stable")
        self.assertEqual(first.status_code, 202, first.get_json())
        self.assertEqual(first.get_json()["id"], again.get_json()["id"])
        job = db.session.get(MarketingGeneration, first.get_json()["id"])
        job.status, job.result = "succeeded", page["document"]
        db.session.commit()
        saved = self.post(
            f"/pages/{page['id']}/revisions",
            {
                "expectedVersion": page["version"],
                "baseRevisionId": page["workingRevisionId"],
                "document": page["document"],
            },
        ).get_json()
        result = self.post(
            f"/generation-jobs/{job.id}/apply", {"expectedVersion": saved["version"]}
        )
        self.assertEqual(result.status_code, 409)
        self.app.config["MARKETING_AI_DAILY_LIMIT"] = 1
        data.update(expectedVersion=saved["version"], baseRevisionId=saved["workingRevisionId"])
        self.assertEqual(self.post(f"/pages/{page['id']}/generations", data).status_code, 429)

    def test_ai_unconfigured_does_not_fake_generation(self):
        page = self.create()
        self.app.config["MARKETING_AI_API_KEY"] = ""
        result = self.post(f"/pages/{page['id']}/generations", {"prompt": "Test"})
        self.assertEqual(result.status_code, 503)
        self.assertEqual(db.session.query(MarketingGeneration).count(), 0)

    def test_worker_releases_transaction_and_unknown_results_are_not_retried(self):
        page = self.ready()
        result = self.post(
            f"/pages/{page['id']}/generations",
            {
                "expectedVersion": page["version"],
                "baseRevisionId": page["workingRevisionId"],
                "prompt": "Test",
            },
        )
        calls = []

        def provider(snapshot):
            self.assertFalse(db.session().in_transaction())
            calls.append(snapshot)
            raise generation.ProviderError("provider_outcome_unknown", unknown=True)

        self.assertTrue(generation.process_one("hotel-a", provider))
        self.assertFalse(generation.process_one("hotel-a", provider))
        job = db.session.get(MarketingGeneration, result.get_json()["id"])
        self.assertEqual(job.status, "unknown")
        self.assertEqual(len(calls), 1)
        self.assertEqual(db.session.query(MarketingRevision).count(), 2)

    def test_rendering_escapes_untrusted_text_and_rejects_script_urls(self):
        document = initial_document("Hotel A")
        document["sections"][0]["heading"] = '<script>alert("x")</script>'
        html, _ = render_page(document, "https://example.com")
        self.assertNotIn('<script>alert("x")</script>', html)
        self.assertIn("&lt;script&gt;", html)
        for destination in (
            "javascript:alert(1)",
            "data:text/html,test",
            "https://user:pass@example.com",
            "//example.com",
        ):
            document["cta"]["url"] = destination
            with self.assertRaises(ApiError):
                validate_document(document)

    def test_schema_rejects_extra_fields_multiple_heroes_and_duplicate_ids(self):
        for mutate in (
            lambda d: d.update(script="bad"),
            lambda d: d["sections"].append(copy.deepcopy(d["sections"][0])),
            lambda d: d["sections"][0].update(visible=False),
        ):
            document = initial_document("Hotel A")
            mutate(document)
            with self.assertRaises(ApiError):
                validate_document(document)

    def test_private_upload_embeds_identical_image_bytes_in_review_and_publication(self):
        from PIL import Image

        output = io.BytesIO()
        Image.new("RGB", (24, 24), color="blue").save(output, "PNG")
        response = self.post(
            "/assets", {"data": base64.b64encode(output.getvalue()).decode("ascii")}
        )
        self.assertEqual(response.status_code, 201, response.get_json())
        asset = response.get_json()
        page = self.ready()
        document = copy.deepcopy(page["document"])
        document["sections"][0].update(imageUrl=asset["url"], imageAlt="Confirmed hotel lobby")
        page = self.post(
            f"/pages/{page['id']}/revisions",
            {
                "expectedVersion": page["version"],
                "baseRevisionId": page["workingRevisionId"],
                "document": document,
            },
        ).get_json()
        page, artifact = self.approve(page)
        self.assertIn("data:image/jpeg;base64,", artifact["html"])
        response, _ = self.publish(page, artifact)
        self.assertEqual(
            self.client.get(response.get_json()["publishedUrl"]).get_data(as_text=True),
            artifact["html"],
        )
        self.login("owner-b")
        self.assertEqual(self.client.get(asset["url"]).status_code, 403)
        self.assertEqual(
            self.client.get(f"/api/tenants/hotel-b/marketing/assets/{asset['id']}").status_code, 404
        )
        self.client.delete_cookie("pms_session")
        self.assertEqual(self.client.get(asset["url"]).status_code, 401)

    def test_cross_tenant_image_and_invalid_raster_are_rejected(self):
        invalid = self.post(
            "/assets", {"data": base64.b64encode(b'<svg onload="alert(1)"></svg>').decode("ascii")}
        )
        self.assertEqual(invalid.status_code, 422)
        page = self.ready()
        document = copy.deepcopy(page["document"])
        document["sections"][0]["imageUrl"] = (
            "/api/tenants/hotel-b/marketing/assets/00000000-0000-0000-0000-000000000000"
        )
        response = self.post(
            f"/pages/{page['id']}/revisions",
            {
                "expectedVersion": page["version"],
                "baseRevisionId": page["workingRevisionId"],
                "document": document,
            },
        )
        self.assertEqual(response.status_code, 422)

    def test_completed_ai_job_requires_apply_and_apply_retry_creates_one_revision(self):
        page = self.ready()
        response = self.post(
            f"/pages/{page['id']}/generations",
            {
                "expectedVersion": page["version"],
                "baseRevisionId": page["workingRevisionId"],
                "prompt": "Shorter copy",
            },
        )

        def provider(snapshot):
            document = copy.deepcopy(snapshot["document"])
            document["sections"][0]["heading"] = "New AI proposal"
            return document, {"total_tokens": 20}

        self.assertTrue(generation.process_one("hotel-a", provider))
        self.assertEqual(
            application.get_page("hotel-a", page["id"]).working_revision_id,
            page["workingRevisionId"],
        )
        job_id = response.get_json()["id"]
        data = {"expectedVersion": page["version"]}
        first = self.post(f"/generation-jobs/{job_id}/apply", data)
        again = self.post(f"/generation-jobs/{job_id}/apply", data)
        self.assertEqual(first.status_code, 200, first.get_json())
        self.assertEqual(
            first.get_json()["workingRevisionId"], again.get_json()["workingRevisionId"]
        )
        self.assertEqual(first.get_json()["document"]["sections"][0]["heading"], "New AI proposal")
        self.assertEqual(db.session.query(MarketingRevision).count(), 3)

    def test_publication_failure_rolls_back_release_and_projection(self):
        page, artifact = self.approve(self.ready())
        with patch.object(
            application,
            "set_publication",
            side_effect=ApiError(503, "fixture_failure", "Fixture failure"),
        ):
            response, _ = self.publish(page, artifact)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(db.session.query(MarketingRelease).count(), 0)
        self.assertEqual(db.session.query(MarketingPublication).count(), 0)

    def test_composite_foreign_key_rejects_a_revision_in_another_tenant(self):
        page = self.create()
        db.session.add(
            MarketingRevision(
                tenant_id="hotel-b",
                page_id=page["id"],
                number=99,
                document=page["document"],
                content_hash="x" * 64,
                created_by="owner-b",
                source="manual",
            )
        )
        with self.assertRaises(IntegrityError):
            db.session.flush()
        db.session.rollback()

    def test_page_creation_retry_is_idempotent(self):
        first = self.post("/pages", {"name": "Retry-safe page"}, key="create-stable")
        again = self.post("/pages", {"name": "Retry-safe page"}, key="create-stable")
        self.assertEqual(first.status_code, 201)
        self.assertEqual(first.get_json()["id"], again.get_json()["id"])

    def test_marketing_config_defaults_and_invalid_origins(self):
        from pms_api.config import ConfigurationError, load_config

        settings = {
            "APP_ENV": "production",
            "DATABASE_URL": "postgres://test:fixture@127.0.0.1/test",
        }
        result = load_config(settings, env_file=None)
        self.assertFalse(bool(result["MARKETING_AI_API_KEY"]))
        self.assertEqual(result["MARKETING_AI_DAILY_LIMIT"], 20)
        for origin in (
            "http://example.com",
            "https://example.com/path",
            "https://user:secret@example.com",
            "https://example.com?query=1",
        ):
            with self.assertRaises(ConfigurationError):
                load_config({**settings, "MARKETING_PUBLIC_ORIGIN": origin}, env_file=None)
        with self.assertRaises(ConfigurationError):
            load_config({**settings, "MARKETING_AI_DAILY_LIMIT": "0"}, env_file=None)

    def test_plan_feature_disabled_is_enforced_by_backend(self):
        plan = core_models.Plan(
            id="disabled-plan",
            name="Disabled",
            price=0,
            currency="VND",
            features={"AI_MARKETING_PAGES": False},
        )
        db.session.add(plan)
        db.session.flush()
        db.session.add(core_models.Subscription(tenant_id="hotel-a", plan_id=plan.id, room_count=1))
        db.session.commit()
        response = self.client.get("/api/tenants/hotel-a/marketing/pages")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()["error"]["code"], "marketing_feature_disabled")

    def test_provider_uses_strict_schema_and_preserves_destinations(self):
        original = initial_document("Confirmed Hotel")
        original["cta"]["url"] = "tel:+84901234567"
        generated = copy.deepcopy(original)
        generated["brand"]["name"] = "Changed Hotel"
        generated["locale"] = "en"
        generated["cta"]["url"] = "https://changed.example"
        generated["sections"][0]["imageUrl"] = "https://unconfirmed.example/image.jpg"
        payload = {
            "status": "completed",
            "output": [{"content": [{"type": "output_text", "text": json.dumps(generated)}]}],
            "usage": {"total_tokens": 50},
        }
        captured = []

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                pass

            def read(self, _size):
                return json.dumps(payload).encode()

        class Opener:
            def open(self, request, **_kwargs):
                captured.append(request)
                return Response()

        with patch.object(generation, "build_opener", return_value=Opener()):
            document, usage = generation.generate(
                {"document": original, "prompt": "Test", "model": "test-model", "sectionId": None}
            )
        sent = json.loads(captured[0].data)
        self.assertEqual(captured[0].full_url, "https://api.openai.com/v1/responses")
        self.assertIs(sent["text"]["format"]["strict"], True)
        self.assertIs(sent["store"], False)
        self.assertEqual(document["cta"]["url"], original["cta"]["url"])
        self.assertEqual(document["brand"], original["brand"])
        self.assertEqual(document["locale"], "vi")
        self.assertEqual(document["sections"][0]["imageUrl"], "")
        self.assertEqual(usage["total_tokens"], 50)


if __name__ == "__main__":
    unittest.main()
