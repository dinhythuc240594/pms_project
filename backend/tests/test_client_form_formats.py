from tests.domain_fixture import DomainTestCase


class ClientFormFormatTests(DomainTestCase):
    def booking(self, **values):
        return {
            "guest": "Client formats",
            "room": "101",
            "sourceId": "direct-a",
            "checkIn": "2028-02-28",
            "checkOut": "2028-03-01",
            **values,
        }

    def test_client_writes_reject_malformed_contacts_before_persistence(self):
        for phone in ("098210910A", "123456", "090+1234567", "1" * 16):
            for path, body, method in (
                ("/settings", {"phone": phone}, "PATCH"),
                ("/reservations", self.booking(phone=phone), "POST"),
                ("/reservations", self.booking(guests=[{"name": "Guest", "phone": phone}]), "POST"),
                ("/housekeeping/staff", {"name": "Staff", "phone": phone}, "POST"),
                ("/inventory/masters/suppliers", {"name": "Supplier", "phone": phone}, "POST"),
            ):
                with self.subTest(path=path, phone=phone):
                    response = self.request(method, path, body)
                    self.assertEqual(response.status_code, 422, response.json)
        for email in (".guest@example.test", "a..b@example.test", "a@example..test"):
            for path, body in (
                ("/reservations", self.booking(guests=[{"name": "Guest", "email": email}])),
                ("/inventory/masters/suppliers", {"name": "Supplier", "email": email}),
                ("/masters/bookingSources", {"name": "Source", "type": "OTA", "email": email}),
            ):
                with self.subTest(path=path, email=email):
                    response = self.request("POST", path, body)
                    self.assertEqual(response.status_code, 422, response.json)
        for tax in ("ABC123", "0312345678-01"):
            self.assertEqual(self.request("PATCH", "/settings", {"taxCode": tax}).status_code, 422)
            self.assertEqual(
                self.request(
                    "POST", "/inventory/masters/suppliers", {"name": "Supplier", "taxCode": tax}
                ).status_code,
                422,
            )
        self.assertEqual(self.request("GET", "/workspace").json["bookings"], [])

    def test_client_contacts_preserve_phone_format_and_normalize_email(self):
        phone = "+84 900 123 456"
        response = self.request(
            "POST",
            "/reservations",
            self.booking(
                guests=[
                    {
                        "name": "Client formats",
                        "phone": phone,
                        "email": " Guest+Desk@Example.TEST ",
                    }
                ]
            ),
        )
        self.assertEqual(response.status_code, 201, response.json)
        self.assertEqual(response.json["phone"], phone)
        self.assertEqual(response.json["guests"][0]["email"], "guest+desk@example.test")
        supplier = self.request(
            "POST",
            "/inventory/masters/suppliers",
            {
                "name": "Supplier",
                "phone": phone,
                "email": " Sales@Example.TEST ",
                "taxCode": "0312345678-001",
            },
        )
        self.assertEqual(supplier.status_code, 201, supplier.json)
        self.assertEqual(supplier.json["email"], "sales@example.test")
        self.assertEqual(supplier.json["phone"], phone)
        self.assertEqual(self.request("PATCH", "/settings", {"taxCode": "1" * 80}).status_code, 200)
