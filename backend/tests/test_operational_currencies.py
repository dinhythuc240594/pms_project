"""Expanded hotel currencies retain explicit conversion and money constraints."""

import importlib.util
import sqlite3
from contextlib import closing
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import Mock, patch

from flask import Flask, g

from pms_api.catalog.routes import validated_settings
from pms_api.channels.importer import normalize
from pms_api.currencies import HOTEL_CURRENCIES
from pms_api.pricing.engine import exchange_snapshot, snapshot_money
from pms_api.reports.routes import report_currency
from pms_api.security import ApiError
from tests.test_channels_integration import PROPERTY, revision


class OperationalCurrencyTests(TestCase):
    def test_hotel_settings_accept_catalog_and_reject_unknown_or_malformed_codes(self):
        for currency in HOTEL_CURRENCIES:
            self.assertEqual(validated_settings({"currency": currency})["currency"], currency)
        for value in ("XXX", "eur", " EURO ", None, True, [], {}):
            with self.subTest(value=value), self.assertRaises(ApiError):
                validated_settings({"currency": value})

    def test_same_base_currency_snapshots_preserve_four_decimal_money_without_fx_lookup(self):
        with patch("pms_api.pricing.engine.db") as database:
            for currency in ("USD", "EUR", "JPY", "THB"):
                database.session.get.return_value = SimpleNamespace(settings={"currency": currency})
                self.assertEqual(exchange_snapshot("hotel"), (currency, currency, Decimal(1)))
                self.assertEqual(
                    exchange_snapshot("hotel", currency), (currency, currency, Decimal(1))
                )
                self.assertEqual(
                    snapshot_money("hotel", currency, Decimal("10.1234")),
                    {
                        "base_currency": currency,
                        "exchange_rate": Decimal(1),
                        "base_amount": Decimal("10.1234"),
                    },
                )
            database.session.scalar.assert_not_called()

    def test_foreign_currency_still_requires_enabled_feature_and_configured_rate(self):
        with (
            patch("pms_api.pricing.engine.db") as database,
            patch("pms_api.pricing.engine.require_feature") as feature,
        ):
            database.session.get.return_value = SimpleNamespace(settings={"currency": "JPY"})
            database.session.scalar.return_value = None
            with self.assertRaises(ApiError) as caught:
                exchange_snapshot("hotel", "EUR")
            self.assertEqual(caught.exception.code, "exchange_rate_required")
            feature.assert_called_once_with("MULTI_CURRENCY")
            database.session.scalar.return_value = SimpleNamespace(rate=Decimal("162.12345678"))
            self.assertEqual(
                exchange_snapshot("hotel", "EUR"), ("EUR", "JPY", Decimal("162.12345678"))
            )

    def test_ota_normalization_accepts_catalog_currencies_without_altering_amounts(self):
        for currency in HOTEL_CURRENCIES:
            entity = revision()
            entity["attributes"]["currency"] = currency
            result = normalize(entity, PROPERTY)
            self.assertEqual(result["currency"], currency)
            self.assertEqual(result["amount"], Decimal("200"))
        entity["attributes"]["currency"] = "XXX"
        with self.assertRaises(ApiError) as caught:
            normalize(entity, PROPERTY)
        self.assertEqual(caught.exception.code, "unsupported_booking_currency")

    def test_reports_default_to_extended_hotel_base_and_validate_explicit_currency(self):
        app = Flask(__name__)
        for query, expected in (("", "EUR"), ("?currency=JPY", "JPY")):
            with app.test_request_context(query):
                g.tenant = SimpleNamespace(settings={"currency": "EUR"})
                self.assertEqual(report_currency(), expected)
        with app.test_request_context("?currency=XXX"), self.assertRaises(ApiError):
            g.tenant = SimpleNamespace(settings={"currency": "EUR"})
            report_currency()


def currency_migration():
    path = Path(__file__).resolve().parents[1] / "migrations/versions/0042_hotel_currencies.py"
    spec = importlib.util.spec_from_file_location("hotel_currency_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CurrencyMigrationTests(TestCase):
    def test_all_thirteen_legacy_checks_accept_extended_currencies_but_reject_unknown_and_zero_rates(
        self,
    ):
        module = currency_migration()
        operations = Mock()
        operations.f.side_effect = lambda name: name
        with patch.object(module, "op", operations):
            module.upgrade()
        self.assertEqual(operations.create_check_constraint.call_count, 13)
        self.assertEqual(module.CURRENCIES, HOTEL_CURRENCIES)
        with closing(sqlite3.connect(":memory:")) as connection:
            for index, call in enumerate(operations.create_check_constraint.call_args_list):
                _, _, condition = call.args
                table = f"money_{index}"
                connection.execute(
                    f"CREATE TABLE {table}(currency TEXT, base_currency TEXT, exchange_rate NUMERIC, CHECK({condition}))"
                )
                for currency in ("EUR", "JPY", "THB", "VND", "USD"):
                    connection.execute(
                        f"INSERT INTO {table} VALUES (?, ?, 1)", (currency, currency)
                    )
                with self.assertRaises(sqlite3.IntegrityError):
                    connection.execute(f"INSERT INTO {table} VALUES ('XXX', 'XXX', 1)")
                if "exchange_rate > 0" in condition:
                    with self.assertRaises(sqlite3.IntegrityError):
                        connection.execute(f"INSERT INTO {table} VALUES ('EUR', 'EUR', 0)")

    def test_downgrade_checks_hotel_funds_and_all_money_history_before_replacing_constraints(self):
        module = currency_migration()
        operations = Mock()
        operations.f.side_effect = lambda name: name

        def execute(statement):
            if "DO $$" in statement:
                self.assertIn("settings->>'currency'", statement)
                self.assertIn("catalog='funds'", statement)
                self.assertIn("inventory_documents", statement)
                self.assertIn("revenue_recognitions", statement)
                for table in module.MONEY_TABLES:
                    self.assertIn(f"FROM {table} ", statement)
                raise RuntimeError("Extended hotel currencies exist; downgrade refused")

        operations.execute.side_effect = execute
        with patch.object(module, "op", operations), self.assertRaises(RuntimeError):
            module.downgrade()
        operations.drop_constraint.assert_not_called()
        operations.create_check_constraint.assert_not_called()
