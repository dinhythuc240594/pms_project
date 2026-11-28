"""Dependency boundaries and composition must remain valid as domains evolve."""

import ast
import unittest
from importlib import import_module
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from common import CommonMethodView
from pms_api import create_app
from pms_api.adapters.flask_runtime import FlaskRuntime
from pms_api.ports import runtime, use_runtime

ROOT = Path(__file__).resolve().parents[1] / "pms_api"


class ArchitectureTests(unittest.TestCase):
    def test_domain_rules_have_no_framework_persistence_or_application_dependencies(self):
        for source in ROOT.rglob("domain.py"):
            tree = ast.parse(source.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom):
                    module = node.module or ""
                    with self.subTest(source=source, module=module):
                        self.assertNotIn(module.split(".")[0], {"flask", "sqlalchemy"})
                        self.assertNotIn(
                            module.split(".")[-1],
                            {"routes", "application", "models", "security", "extensions"},
                        )
                elif isinstance(node, ast.Import):
                    for alias in node.names:
                        with self.subTest(source=source, module=alias.name):
                            self.assertNotIn(alias.name.split(".")[0], {"flask", "sqlalchemy"})

    def test_application_services_do_not_import_flask_or_http_handlers(self):
        for source in ROOT.rglob("*.py"):
            if "application" not in source.stem and source.name not in {"service.py", "engine.py"}:
                continue
            for node in ast.walk(ast.parse(source.read_text(encoding="utf-8"))):
                if isinstance(node, ast.ImportFrom):
                    module = node.module or ""
                    with self.subTest(source=source, module=module):
                        self.assertNotEqual(module.split(".")[-1], "routes")
                        self.assertNotEqual(module.split(".")[0], "flask")
                elif isinstance(node, ast.Import):
                    for alias in node.names:
                        with self.subTest(source=source, module=alias.name):
                            self.assertNotEqual(alias.name.split(".")[0], "flask")
                            self.assertNotIn("routes", alias.name.split("."))

    def test_business_http_views_only_delegate_after_their_security_decorators(self):
        count = 0
        for source in ROOT.rglob("*.py"):
            if source.name == "__init__.py":
                continue
            tree = ast.parse(source.read_text(encoding="utf-8"))
            for view in tree.body:
                if not isinstance(view, ast.ClassDef) or not any(
                    isinstance(base, ast.Name) and base.id == "CommonMethodView"
                    for base in view.bases
                ):
                    continue
                for method in view.body:
                    if not isinstance(method, ast.FunctionDef):
                        continue
                    with self.subTest(source=source, view=view.name):
                        self.assertEqual(len(method.body), 1)
                        self.assertIsInstance(method.body[0], ast.Return)
                        call = method.body[0].value
                        self.assertIsInstance(call, ast.Call)
                        self.assertIsInstance(call.func, ast.Attribute)
                        self.assertEqual(ast.unparse(call.func.value), "application")
                    count += 1
        self.assertGreaterEqual(count, 175)

    def test_injected_application_can_build_a_response_without_flask_context(self):
        from pms_api.health_application import handle_liveness

        adapter = SimpleNamespace(json_response=Mock(return_value={"status": "ok"}))
        with use_runtime(adapter):
            self.assertEqual(handle_liveness(), {"status": "ok"})
        adapter.json_response.assert_called_once_with(status="ok", message="Backend is running")

    def test_flask_runtime_uses_the_current_app_and_actor_without_caching(self):
        from flask import Flask, g

        adapter = FlaskRuntime()
        first, second = Flask("first"), Flask("second")
        first.config["MARKER"], second.config["MARKER"] = "first", "second"
        with first.test_request_context("/?start_date=2026-11-01&end_date=2026-12-01"):
            g.user, g.tenant = object(), object()
            user, tenant = g.user, g.tenant
            self.assertEqual(adapter.date_range(), ("2026-11-01", "2026-12-01"))
            with second.test_request_context():
                g.user, g.tenant = object(), object()
                self.assertIsNot(adapter.state.user, user)
                self.assertIsNot(adapter.state.tenant, tenant)
                self.assertEqual(adapter.config["MARKER"], "second")
            self.assertIs(adapter.state.user, user)
            self.assertIs(adapter.state.tenant, tenant)
            self.assertEqual(adapter.config["MARKER"], "first")

    def test_every_registered_http_handler_can_be_resolved(self):
        app = create_app(
            {"APP_ENV": "testing", "DATABASE_URL": "postgres://fixture:fixture@127.0.0.1:1/pms"},
            env_file=None,
        )
        for view in app.view_functions.values():
            path = getattr(view, "lazy_view_path", None)
            if path:
                with self.subTest(handler=path):
                    module, name = path.split(":")
                    self.assertTrue(
                        issubclass(getattr(import_module(module), name), CommonMethodView)
                    )
        with app.app_context():
            app.extensions["sqlalchemy"].engine.dispose()

    def test_runtime_injection_is_nested_and_restored_even_on_failure(self):
        original = runtime()
        first, second = SimpleNamespace(name="first"), SimpleNamespace(name="second")
        with use_runtime(first):
            self.assertIs(runtime(), first)
            with self.assertRaises(ValueError), use_runtime(second):
                self.assertIs(runtime(), second)
                raise ValueError("failed operation")
            self.assertIs(runtime(), first)
        self.assertIs(runtime(), original)

    def test_factories_have_independent_subscribers_and_adapters(self):
        config = {
            "APP_ENV": "testing",
            "DATABASE_URL": "postgres://fixture:fixture@127.0.0.1:1/pms",
        }
        first, second = create_app(config, env_file=None), create_app(config, env_file=None)
        one, two = first.extensions["pms_services"], second.extensions["pms_services"]
        self.assertIsNot(one.events, two.events)
        self.assertIsNot(one.channels, two.channels)
        for app in (first, second):
            with app.app_context():
                app.extensions["sqlalchemy"].engine.dispose()
