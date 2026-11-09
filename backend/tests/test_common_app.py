"""Existing HTTP contract and lazy startup must survive API standardization."""

import json
import subprocess
import sys
import unittest
from pathlib import Path


class CommonAppTests(unittest.TestCase):
    def probe(self, script):
        result = subprocess.run(
            [sys.executable, "-c", script],
            cwd=Path(__file__).resolve().parents[1],
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_route_contract_matches_before_refactoring(self):
        actual = self.probe("""
import json
from pms_api import create_app
app = create_app({"APP_ENV": "testing", "DATABASE_URL": "postgres://pms_app:fixture@127.0.0.1:1/pms"}, env_file=None)
print(json.dumps(sorted([r.rule, r.endpoint, sorted(r.methods)] for r in app.url_map.iter_rules())))
with app.app_context():
    app.extensions["sqlalchemy"].engine.dispose()
""")
        expected = json.loads(
            (Path(__file__).with_name("fixtures") / "api_routes.json").read_text()
        )
        self.assertEqual(actual, expected)

    def test_startup_metadata_and_liveness_do_not_load_business_handlers(self):
        result = self.probe("""
import json, sys
from pms_api import create_app
app = create_app({"APP_ENV": "testing", "DATABASE_URL": "postgres://pms_app:fixture@127.0.0.1:1/pms"}, env_file=None)
handlers = {
    "pms_api.auth.routes", "pms_api.admin.routes", "pms_api.admin.features",
    "pms_api.bookings.routes", "pms_api.catalog.routes", "pms_api.channels.routes",
    "pms_api.finance.routes", "pms_api.housekeeping.routes", "pms_api.inventory.routes",
    "pms_api.pricing.routes", "pms_api.reports.routes", "pms_api.saas_billing.routes",
    "pms_api.notifications", "pms_api.workspace", "pms_api.health",
}
assert not handlers.intersection(sys.modules), sorted(handlers.intersection(sys.modules))
assert {"reservations", "pos_invoices", "notifications", "room_types", "tenant_client_profiles", "saas_invoices", "saas_payments", "saas_idempotency_records", "tenant_feature_overrides"} <= set(app.extensions["sqlalchemy"].metadata.tables)
with app.test_request_context("/api/health"):
    response = app.full_dispatch_request()
    assert response.status_code == 200
assert "pms_api.health" in sys.modules
assert not (handlers - {"pms_api.health"}).intersection(sys.modules)
with app.test_request_context("/"):
    response = app.full_dispatch_request()
    assert response.get_json() == {"service": "LOHA PMS Backend API", "status": "running"}
with app.app_context():
    app.extensions["sqlalchemy"].engine.dispose()
print(json.dumps({"ok": True}))
""")
        self.assertEqual(result, {"ok": True})

    def test_factory_still_works_after_health_and_notification_modules_are_loaded(self):
        result = self.probe("""
import json
from pms_api import create_app
config = {"APP_ENV": "testing", "DATABASE_URL": "postgres://pms_app:fixture@127.0.0.1:1/pms"}
first = create_app(config, env_file=None)
from pms_api.notifications import Notification
with first.test_request_context("/api/health"):
    assert first.full_dispatch_request().status_code == 200
second = create_app(config, env_file=None)
with second.test_request_context("/api/health"):
    assert second.full_dispatch_request().status_code == 200
assert len(list(first.url_map.iter_rules())) == len(list(second.url_map.iter_rules()))
for app in (first, second):
    with app.app_context():
        app.extensions["sqlalchemy"].engine.dispose()
print(json.dumps({"ok": True}))
""")
        self.assertEqual(result, {"ok": True})


if __name__ == "__main__":
    unittest.main()
