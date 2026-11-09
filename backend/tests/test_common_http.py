"""Shared view behavior without importing the application or a database."""

import unittest
from datetime import date
from decimal import Decimal
from functools import wraps

from flask import Blueprint, Flask

from common import ApiError, CommonMethodView, CommonURL, ValueFormatter


class URL(CommonURL):
    ITEM = "/items/<item_id>"


class ItemView(CommonMethodView):
    def get(self, item_id):
        return self.json_response({"id": item_id})

    def post(self, item_id):
        return self.json_response({"id": item_id, **self.payload()}, 201)


class CommonHTTPTests(unittest.TestCase):
    def dispatch(self, app, path, **options):
        with app.test_request_context(path, **options):
            return app.full_dispatch_request()

    def test_class_view_dispatches_methods_head_and_options(self):
        app = Flask(__name__)
        URL.register(app, URL.ITEM, ItemView, endpoint="item")
        response = self.dispatch(app, "/items/42")
        self.assertEqual(response.get_json(), {"id": "42"})
        response = self.dispatch(app, "/items/42", method="POST", json={"name": "Room"})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.get_json(), {"id": "42", "name": "Room"})
        self.assertEqual(self.dispatch(app, "/items/42", method="HEAD").status_code, 200)
        response = self.dispatch(app, "/items/42", method="OPTIONS")
        self.assertIn("POST", response.headers["Allow"])
        self.assertEqual(self.dispatch(app, "/items/42", method="DELETE").status_code, 405)

    def test_repeated_endpoint_reuses_view_and_preserves_method_rules(self):
        blueprint = Blueprint("items", __name__, url_prefix="/api")
        first = URL.register(blueprint, URL.ITEM, ItemView, endpoint="item", methods=["GET"])
        second = URL.register(blueprint, URL.ITEM, ItemView, endpoint="item", methods=["POST"])
        self.assertIs(first, second)
        app = Flask(__name__)
        app.register_blueprint(blueprint)
        self.assertEqual(self.dispatch(app, "/api/items/42").status_code, 200)
        response = self.dispatch(app, "/api/items/42", method="POST", json={})
        self.assertEqual(response.status_code, 201)

    def test_registration_is_independent_between_app_instances(self):
        first_app, second_app = Flask("first"), Flask("second")
        first = URL.register(first_app, URL.ITEM, ItemView, endpoint="item")
        second = URL.register(second_app, URL.ITEM, ItemView, endpoint="item")
        self.assertIsNot(first, second)

    def test_different_classes_cannot_share_endpoint_on_same_target(self):
        class OtherView(CommonMethodView):
            def get(self, item_id):
                return item_id

        blueprint = Blueprint("items", __name__)
        URL.register(blueprint, URL.ITEM, ItemView, endpoint="item")
        with self.assertRaises(ValueError):
            URL.register(blueprint, URL.ITEM, OtherView, endpoint="item")

    def test_static_dispatch_preserves_security_decorator_arguments(self):
        seen = []

        def authorize(handler):
            @wraps(handler)
            def wrapped(tenant_id, **kwargs):
                seen.append(tenant_id)
                return handler(tenant_id, **kwargs)

            return wrapped

        class TenantView(CommonMethodView):
            @staticmethod
            @authorize
            def dispatch_request(tenant_id):
                return {"tenant": tenant_id}

        app = Flask(__name__)
        URL.register(app, "/tenants/<tenant_id>", TenantView, methods=["GET"])
        response = self.dispatch(app, "/tenants/hotel-1")
        self.assertEqual(response.get_json(), {"tenant": "hotel-1"})
        self.assertEqual(seen, ["hotel-1"])

    def test_payload_accepts_object_and_rejects_other_json_and_malformed_input(self):
        app = Flask(__name__)
        with app.test_request_context(method="POST", json={}):
            self.assertEqual(ItemView.payload(), {})
        for body in ["[]", "null", "true", '"text"', "{"]:
            with app.test_request_context(
                method="POST", data=body, content_type="application/json"
            ):
                with self.assertRaises(ApiError) as caught:
                    ItemView.payload()
                self.assertEqual(caught.exception.status, 422)
                self.assertEqual(caught.exception.code, "invalid_json")

    def test_deeply_nested_json_is_rejected_as_invalid_input(self):
        app = Flask(__name__)
        body = '{"nested":' + "[" * 100000 + "0" + "]" * 100000 + "}"
        with app.test_request_context(method="POST", data=body, content_type="application/json"):
            with self.assertRaises(ApiError) as caught:
                ItemView.payload()
            self.assertEqual(caught.exception.status, 422)
            self.assertEqual(caught.exception.code, "invalid_json")

    def test_payload_rejects_unstorable_text_in_values_and_object_keys(self):
        app = Flask(__name__)
        for body in (
            '{"name":"\\ud800"}',
            '{"nested":[{"name":"text\\udfff"}]}',
            '{"nested":{"\\ud800":"value"}}',
            '{"name":"text\\u0000value"}',
            '{"nested":[{"name":"\\u0000"}]}',
            '{"nested":{"\\u0000":"value"}}',
        ):
            with (
                self.subTest(body=body),
                app.test_request_context(method="POST", data=body, content_type="application/json"),
            ):
                with self.assertRaises(ApiError) as caught:
                    ItemView.payload()
                self.assertEqual(caught.exception.status, 422)
                self.assertEqual(caught.exception.code, "invalid_json")

    def test_payload_preserves_unicode_and_valid_surrogate_pairs(self):
        app = Flask(__name__)
        with app.test_request_context(
            method="POST",
            data='{"name":"Khách sạn \\ud83c\\udfe8","nested":[null,true,12,1.5]}',
            content_type="application/json",
        ):
            self.assertEqual(
                ItemView.payload(),
                {"name": "Khách sạn 🏨", "nested": [None, True, 12, 1.5]},
            )

    def test_shared_formatters_keep_nullable_dates_and_four_decimal_places(self):
        self.assertIsNone(ValueFormatter.iso(None))
        self.assertEqual(ValueFormatter.iso(date(2026, 10, 8)), "2026-10-08")
        self.assertEqual(ValueFormatter.decimal_text(Decimal("12.3")), "12.3000")


if __name__ == "__main__":
    unittest.main()
