"""Common Channex currencies validate before hotel or provider writes."""

from unittest import TestCase

from flask import Flask

from pms_api.admin.channex_remote import property_input
from pms_api.currencies import HOTEL_CURRENCIES, is_hotel_currency
from pms_api.security import ApiError


class HotelCurrencyCatalogTests(TestCase):
    def test_shared_catalog_includes_common_global_and_regional_currencies(self):
        self.assertEqual(len(HOTEL_CURRENCIES), 20)
        self.assertEqual(len(set(HOTEL_CURRENCIES)), len(HOTEL_CURRENCIES))
        for code in ("VND", "USD", "EUR", "GBP", "JPY", "KRW", "SGD", "THB", "AED", "TWD"):
            self.assertTrue(is_hotel_currency(code), code)
        for value in (None, True, [], {}, "", "XXX", "US", "usd", " USD ", "ＵＳＤ"):
            self.assertFalse(is_hotel_currency(value), repr(value))

    def test_channex_property_creation_accepts_every_common_currency(self):
        app = Flask(__name__)
        for currency in HOTEL_CURRENCIES:
            with (
                self.subTest(currency=currency),
                app.test_request_context(
                    json={
                        "accountId": "system:staging",
                        "name": "Hotel",
                        "currency": currency,
                        "timezone": "Asia/Ho_Chi_Minh",
                    }
                ),
            ):
                account, values = property_input()
                self.assertEqual(account, "system:staging")
                self.assertEqual(values["currency"], currency)
                self.assertEqual(values["property_type"], "hotel")

    def test_channex_property_creation_rejects_unknown_or_malformed_currency(self):
        app = Flask(__name__)
        for currency in (None, True, [], {}, "", "XXX", "US", "eur", "EURO", "EUR\n"):
            with (
                self.subTest(currency=currency),
                app.test_request_context(
                    json={
                        "accountId": "system:staging",
                        "name": "Hotel",
                        "currency": currency,
                        "timezone": "Asia/Ho_Chi_Minh",
                    }
                ),
                self.assertRaises(ApiError) as caught,
            ):
                property_input()
            self.assertEqual(caught.exception.status, 422)
