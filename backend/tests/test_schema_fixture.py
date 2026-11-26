"""Offline fixture checks: migrations precede registered optional schema installers."""

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, call

from tests.schema_fixture import remove_optional_test_schemas, upgrade_test_schema


class SchemaFixtureTests(unittest.TestCase):
    def app(self, names=()):
        tables = {name: SimpleNamespace(name=name) for name in ("users", "tenants", *names)}
        metadata = Mock(tables=tables, sorted_tables=list(tables.values()))
        runner = Mock()
        runner.invoke.return_value = SimpleNamespace(exit_code=0, exception=None)
        return SimpleNamespace(
            config={"APP_ENV": "testing", "TESTING": True},
            extensions={"sqlalchemy": SimpleNamespace(metadata=metadata)},
            test_cli_runner=Mock(return_value=runner),
        )

    def test_core_upgrade_precedes_only_registered_optional_installers(self):
        for names, expected in (
            ((), []),
            (("chatbot_requests",), ["install-chatbot-schema"]),
            (("marketing_pages",), ["install-marketing-schema"]),
            (
                ("chatbot_requests", "marketing_pages"),
                ["install-chatbot-schema", "install-marketing-schema"],
            ),
        ):
            with self.subTest(names=names):
                app = self.app(names)
                upgrade_test_schema(app)
                self.assertEqual(
                    app.test_cli_runner().invoke.call_args_list,
                    [call(args=["db", "upgrade"]), *[call(args=[name]) for name in expected]],
                )

    def test_failed_migration_or_installer_stops_fixture_setup(self):
        for failed_at in (0, 1):
            with self.subTest(failed_at=failed_at):
                app = self.app(("chatbot_requests", "marketing_pages"))
                app.test_cli_runner().invoke.side_effect = [
                    *[SimpleNamespace(exit_code=0, exception=None) for _ in range(failed_at)],
                    SimpleNamespace(exit_code=1, exception=ValueError("fixture failure")),
                ]
                with self.assertRaises(RuntimeError):
                    upgrade_test_schema(app)
                self.assertEqual(app.test_cli_runner().invoke.call_count, failed_at + 1)

    def test_helpers_refuse_non_test_applications_before_any_io(self):
        for config in (
            {"APP_ENV": "production", "TESTING": True},
            {"APP_ENV": "testing", "TESTING": False},
            {},
        ):
            app = self.app(("chatbot_requests", "marketing_pages"))
            app.config = config
            engine = Mock()
            with self.assertRaises(ValueError):
                upgrade_test_schema(app)
            with self.assertRaises(ValueError):
                remove_optional_test_schemas(app, engine)
            app.test_cli_runner.assert_not_called()
            engine.begin.assert_not_called()

    def test_core_roundtrip_removes_only_optional_tables_and_their_schema_ledger(self):
        for names in ((), ("chatbot_requests",), ("chatbot_requests", "marketing_pages")):
            with self.subTest(names=names):
                app = self.app(names)
                metadata = app.extensions["sqlalchemy"].metadata
                engine = MagicMock()
                connection = engine.begin.return_value.__enter__.return_value
                remove_optional_test_schemas(app, engine)
                if not names:
                    engine.begin.assert_not_called()
                    metadata.drop_all.assert_not_called()
                    continue
                metadata.drop_all.assert_called_once_with(
                    connection, tables=[metadata.tables[name] for name in names]
                )
                statements = [str(args[0]) for args, _kwargs in connection.execute.call_args_list]
                self.assertEqual(
                    statements,
                    [
                        "DROP TABLE IF EXISTS marketing_schema_versions",
                        "DROP FUNCTION IF EXISTS marketing_reject_mutation()",
                    ]
                    if "marketing_pages" in names
                    else [],
                )
