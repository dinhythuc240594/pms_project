"""Lazy dispatch behavior without application or database dependencies."""

import unittest
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event
from types import SimpleNamespace
from unittest.mock import patch

from flask import Blueprint, Flask, url_for

from common import CommonMethodView, CommonURL


class FirstView(CommonMethodView):
    @staticmethod
    def dispatch_request(item_id):
        return {"id": item_id}


class LazyHTTPTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)

    def dispatch(self, path, **options):
        with self.app.test_request_context(path, **options):
            return self.app.full_dispatch_request()

    def test_only_selected_handler_is_imported_and_cached(self):
        with patch("common.http.import_module") as importer:
            importer.side_effect = lambda name: (
                SimpleNamespace(FirstView=FirstView)
                if name == "first.handlers"
                else (_ for _ in ()).throw(ImportError("Unrelated handler is broken"))
            )
            CommonURL.register(
                self.app,
                "/first/<item_id>",
                "first.handlers:FirstView",
                endpoint="first",
                methods=["GET"],
            )
            CommonURL.register(
                self.app,
                "/unrelated",
                "broken.handlers:OtherView",
                endpoint="unrelated",
                methods=["GET"],
            )
            importer.assert_not_called()
            for item_id in ["one", "two"]:
                response = self.dispatch(f"/first/{item_id}")
                self.assertEqual(response.get_json(), {"id": item_id})
            importer.assert_called_once_with("first.handlers")
            self.app.testing = True
            with self.assertRaises(ImportError):
                self.dispatch("/unrelated")
            self.assertEqual(self.dispatch("/first/three").status_code, 200)
            self.assertEqual(importer.call_count, 2)

    def test_url_building_options_and_routing_errors_do_not_load_handlers(self):
        blueprint = Blueprint("items", __name__, url_prefix="/api")
        with patch("common.http.import_module") as importer:
            CommonURL.register(
                blueprint,
                "/<item_id>",
                "missing.handlers:FirstView",
                endpoint="first",
                methods=["GET"],
            )
            self.app.register_blueprint(blueprint)
            with self.app.test_request_context():
                self.assertEqual(url_for("items.first", item_id="one"), "/api/one")
            self.assertEqual(self.dispatch("/api/one", method="OPTIONS").status_code, 200)
            self.assertEqual(self.dispatch("/api/one", method="POST").status_code, 405)
            self.assertEqual(self.dispatch("/missing").status_code, 404)
            importer.assert_not_called()

    def test_shared_endpoint_reuses_lazy_view_across_method_rules(self):
        blueprint = Blueprint("items", __name__)
        first = CommonURL.register(
            blueprint, "/<item_id>", "first.handlers:FirstView", endpoint="first", methods=["GET"]
        )
        second = CommonURL.register(
            blueprint, "/<item_id>", "first.handlers:FirstView", endpoint="first", methods=["PATCH"]
        )
        self.assertIs(first, second)
        self.app.register_blueprint(blueprint)
        with patch(
            "common.http.import_module", return_value=SimpleNamespace(FirstView=FirstView)
        ) as importer:
            self.assertEqual(self.dispatch("/one").status_code, 200)
            self.assertEqual(self.dispatch("/two", method="PATCH").status_code, 200)
            importer.assert_called_once()

    def test_failed_import_is_not_cached_and_can_be_retried(self):
        CommonURL.register(self.app, "/<item_id>", "first.handlers:FirstView", methods=["GET"])
        self.app.testing = True
        with patch(
            "common.http.import_module",
            side_effect=[
                ImportError("temporarily unavailable"),
                SimpleNamespace(FirstView=FirstView),
            ],
        ) as importer:
            with self.assertRaises(ImportError):
                self.dispatch("/one")
            self.assertEqual(self.dispatch("/two").status_code, 200)
            self.assertEqual(importer.call_count, 2)

    def test_concurrent_first_requests_initialize_view_once(self):
        CommonURL.register(self.app, "/<item_id>", "first.handlers:FirstView", methods=["GET"])
        barrier, entered, release = Barrier(5), Event(), Event()

        def import_handler(name):
            entered.set()
            self.assertTrue(release.wait(5))
            return SimpleNamespace(FirstView=FirstView)

        def request_handler(item_id):
            with self.app.test_request_context(f"/{item_id}"):
                barrier.wait(timeout=5)
                return self.app.full_dispatch_request().get_json()

        with patch("common.http.import_module", side_effect=import_handler) as importer:
            with ThreadPoolExecutor(max_workers=4) as executor:
                futures = [executor.submit(request_handler, str(i)) for i in range(4)]
                barrier.wait(timeout=5)
                try:
                    self.assertTrue(entered.wait(5))
                finally:
                    release.set()
                self.assertEqual(
                    [f.result(timeout=5) for f in futures], [{"id": str(i)} for i in range(4)]
                )
            importer.assert_called_once()

    def test_lazy_registration_rejects_missing_methods_and_endpoint_conflicts(self):
        with self.assertRaises(ValueError):
            CommonURL.register(self.app, "/first", "first.handlers:FirstView")
        with self.assertRaises(ValueError):
            CommonURL.register(self.app, "/first", "invalid_path", methods=["GET"])
        CommonURL.register(
            self.app, "/first", "first.handlers:FirstView", endpoint="first", methods=["GET"]
        )
        with self.assertRaises(ValueError):
            CommonURL.register(
                self.app, "/second", "second.handlers:OtherView", endpoint="first", methods=["GET"]
            )


if __name__ == "__main__":
    unittest.main()
