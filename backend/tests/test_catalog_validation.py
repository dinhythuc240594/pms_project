import unittest

from pms_api.catalog.routes import date_range, money_value, validated_settings
from pms_api.security import ApiError


class CatalogValidationTests(unittest.TestCase):
    def test_stay_range_is_half_open(self):
        self.assertEqual(
            [day.isoformat() for day in date_range("2026-10-03", "2026-10-05")],
            ["2026-10-03", "2026-10-04"],
        )

    def test_invalid_and_unbounded_ranges_are_rejected(self):
        for start, end in [
            ("bad", "2026-10-05"),
            ("2026-10-03", "2026-10-03"),
            ("2026-10-03", "2030-10-04"),
        ]:
            with self.subTest(start=start, end=end), self.assertRaises(ApiError):
                date_range(start, end)

    def test_price_never_accepts_non_finite_negative_or_excess_precision(self):
        for value in ["NaN", "Infinity", "-1", "0.00001", "1000000000000000", True]:
            with self.subTest(value=value), self.assertRaises(ApiError):
                money_value(value)
        self.assertEqual(str(money_value("12.3400")), "12.3400")

    def test_settings_validate_timezone_and_local_clock(self):
        result = validated_settings(
            {
                "timezone": "Asia/Ho_Chi_Minh",
                "checkInTime": "14:00",
                "checkOutTime": "12:00",
                "currency": "VND",
            }
        )
        self.assertEqual(result["timezone"], "Asia/Ho_Chi_Minh")
        for value in [
            {"timezone": "Fake/Zone"},
            {"checkInTime": "25:61"},
            {"currency": "vnd"},
            {"unknown": "value"},
        ]:
            with self.subTest(value=value), self.assertRaises(ApiError):
                validated_settings(value)

    def test_hotel_profile_normalizes_optional_contact_and_bank_fields(self):
        profile = {
            "phone": " +84 28 1234 5678 ",
            "contactEmail": " Reception@Hotel.Example ",
            "website": " https://hotel.example/contact ",
            "logoUrl": " https://hotel.example/logo.png ",
            "taxCode": " 0312345678 ",
            "bankName": " Hotel Bank ",
            "bankAccount": " 00123456789 ",
            "bankAccountName": " HOTEL COMPANY ",
            "defaultLanguage": "en",
        }
        result = validated_settings(profile)
        self.assertEqual(result["phone"], "+84 28 1234 5678")
        self.assertEqual(result["contactEmail"], "reception@hotel.example")
        self.assertEqual(result["bankAccount"], "00123456789")
        self.assertEqual(result["logoUrl"], "https://hotel.example/logo.png")
        self.assertEqual(
            validated_settings({"website": "http://hotel.example"})["website"],
            "http://hotel.example",
        )
        cleared = {key: "" for key in profile if key != "defaultLanguage"}
        self.assertEqual(validated_settings(cleared), cleared)

    def test_hotel_profile_rejects_invalid_contact_urls_and_types(self):
        for value in [
            {"phone": "098210910A"},
            {"phone": "123456"},
            {"phone": "090+1234567"},
            {"taxCode": "ABC123"},
            {"taxCode": "0312345678-01"},
            {"phone": "x" * 41},
            {"contactEmail": "invalid"},
            {"contactEmail": "user name@hotel.example"},
            {"contactEmail": "x" * 255},
            {"taxCode": "x" * 81},
            {"bankName": "x" * 161},
            {"bankAccount": 123456},
            {"bankAccountName": None},
            {"defaultLanguage": "xx"},
            {"defaultLanguage": True},
            {"website": "javascript:alert(1)"},
            {"website": "//hotel.example"},
            {"website": "https://"},
            {"website": "https://hotel.example:99999"},
            {"website": "https://bad host.example"},
            {"website": "https://bad<host.example"},
            {"website": "https://hotel.example/path\nnext"},
            {"website": "https://hotel.example\\@other.example"},
            {"website": "https://user:secret@hotel.example"},
            {"website": "https://hotel.example/" + "x" * 2048},
            {"logoUrl": "http://hotel.example/logo.png"},
            {"logoUrl": "data:image/png;base64,anything"},
            {"logoUrl": "https://user@hotel.example/logo.png"},
            {"logoUrl": None},
        ]:
            with self.subTest(value=value), self.assertRaises(ApiError):
                validated_settings(value)
