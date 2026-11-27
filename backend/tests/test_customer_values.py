import unittest

from pms_api.admin.customers import client_values, hotel_currency
from pms_api.auth.routes import validate_email
from pms_api.security import ApiError


class HotelCurrencyTests(unittest.TestCase):
    def test_supported_currency_normalization(self):
        for raw, expected in (
            ("VND", "VND"),
            ("USD", "USD"),
            (" vnd ", "VND"),
            ("usd", "USD"),
            (" eur ", "EUR"),
            ("JPY", "JPY"),
            ("THB", "THB"),
            ("sgd", "SGD"),
        ):
            self.assertEqual(hotel_currency(raw), expected)

    def test_unsupported_currency_and_nonstring_values_are_rejected(self):
        for value in (None, True, 1, [], {}, "", "XXX", "US", "VND/USD", "ＵＳＤ"):
            with self.subTest(value=value), self.assertRaises(ApiError) as caught:
                hotel_currency(value)
            self.assertEqual(caught.exception.code, "invalid_currency")


class CustomerPhoneTests(unittest.TestCase):
    def test_optional_phone_preserves_formatting_and_leading_zero(self):
        for phone in ("", "0982109100", "+84 900 123", "(028) 3822-1234", "0982.109.100"):
            with self.subTest(phone=phone):
                self.assertEqual(
                    client_values({"contactPhone": f"  {phone}  "}), {"contact_phone": phone}
                )
        self.assertEqual(client_values({}), {})

    def test_invalid_phone_is_rejected(self):
        for phone in (
            "098210910A",
            "invalid",
            "++84900123",
            "090+123",
            "---",
            "+",
            "１２３",
            "090\t123",
            "0" * 41,
            "123456",
            "1234567890123456",
            None,
            982109100,
        ):
            with self.subTest(phone=phone), self.assertRaises(ApiError):
                client_values({"contactPhone": phone})

    def test_phone_digit_boundaries(self):
        for phone in ("1234567", "+123 456 789 012 345"):
            self.assertEqual(client_values({"contactPhone": phone})["contact_phone"], phone)


class CustomerTaxIdTests(unittest.TestCase):
    def test_optional_numeric_tax_ids_preserve_leading_zero_and_branch(self):
        for value in ("", "01012345", "0101234567", "0101234567-001", "0" * 40):
            self.assertEqual(client_values({"taxId": f" {value} "})["tax_id"], value)

    def test_tax_id_rejects_other_number_formats_and_invalid_types(self):
        for value in (
            "123abc",
            "1e10",
            "1.23",
            "+12345",
            "１２３４５",
            "123-12",
            "1-001-002",
            None,
            12345,
            "0" * 41,
        ):
            with self.subTest(value=value), self.assertRaises(ApiError):
                client_values({"taxId": value})


class CustomerEmailTests(unittest.TestCase):
    def test_valid_email_normalization_preserves_local_domains_and_tags(self):
        for value in (
            "owner@test.local",
            "owner@local",
            "first.last+tag@hotel.example",
            "a'b@example.com",
        ):
            self.assertEqual(validate_email(f" {value.upper()} "), value)

    def test_email_rejects_bad_local_parts_domains_controls_and_length(self):
        for value in (
            None,
            123,
            "",
            "missing",
            "owner@@hotel.example",
            "@hotel.example",
            "owner@",
            ".owner@hotel.example",
            "owner.@hotel.example",
            "ow..ner@hotel.example",
            "owner name@hotel.example",
            "owner\x00@hotel.example",
            "owner\x7f@hotel.example",
            "owner@-hotel.example",
            "owner@hotel-.example",
            "owner@hotel..example",
            "owner@hotel_example",
            "owner@hotel.example/route",
            "owner@" + "a" * 64,
            "a" * 65 + "@hotel.example",
            "a@" + ".".join(["a" * 63] * 4),
        ):
            with self.subTest(value=value), self.assertRaises(ApiError):
                validate_email(value)
