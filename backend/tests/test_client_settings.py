from pms_api.catalog.models import Master
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class ClientSettingsTests(DomainTestCase):
    def create_type(self, name="Referral"):
        result = self.request("post", "/masters/commissionTypes", json={"name": name})
        self.assertEqual(result.status_code, 201, result.json)
        return result.json

    def test_cashbook_categories_persist_edit_and_toggle(self):
        created = self.request(
            "post", "/masters/cashbookCategories", json={"name": "Utilities", "type": "EXPENSE"}
        )
        self.assertEqual(created.status_code, 201, created.json)
        item_id = created.json["id"]
        updated = self.request(
            "patch", "/masters/cashbookCategories", json={"id": item_id, "name": "Electricity"}
        )
        self.assertEqual(updated.status_code, 200, updated.json)
        self.assertEqual(updated.json["type"], "EXPENSE")
        toggled = self.request("post", f"/masters/cashbookCategories/{item_id}/toggle")
        self.assertEqual(toggled.status_code, 200, toggled.json)
        self.assertFalse(toggled.json["active"])
        snapshot = self.request("get", "/workspace")
        self.assertEqual(snapshot.status_code, 200, snapshot.json)
        restored = snapshot.json["masters"]["cashbookCategories"]
        self.assertEqual(
            [(row["name"], row["type"], row["active"]) for row in restored],
            [("Electricity", "EXPENSE", False)],
        )

    def test_cashbook_category_rejects_invalid_shapes(self):
        for value in (
            {},
            {"type": "refund"},
            {"type": "income"},
            {"type": "expense"},
            {"type": True},
            {"type": "INCOME", "unknown": "x"},
        ):
            with self.subTest(value=value):
                result = self.request(
                    "post", "/masters/cashbookCategories", json={"name": "Bad", **value}
                )
                self.assertEqual(result.status_code, 422, result.json)
        self.assertEqual(
            self.request("get", "/workspace").json["masters"]["cashbookCategories"], []
        )

    def test_commission_recipient_keeps_type_id_after_type_rename(self):
        commission_type = self.create_type()
        created = self.request(
            "post",
            "/masters/commissionRules",
            json={
                "name": "Taxi partner",
                "typeId": commission_type["id"],
            },
        )
        self.assertEqual(created.status_code, 201, created.json)
        renamed = self.request(
            "patch",
            "/masters/commissionTypes",
            json={
                "id": commission_type["id"],
                "name": "Introductions",
            },
        )
        self.assertEqual(renamed.status_code, 200, renamed.json)
        snapshot = self.request("get", "/workspace").json["masters"]
        self.assertEqual(snapshot["commissionRules"][0]["typeId"], commission_type["id"])
        self.assertEqual(snapshot["commissionTypes"][0]["name"], "Introductions")

    def test_commission_recipient_rejects_missing_cross_tenant_and_inactive_types(self):
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            db.session.add(
                Master(
                    id="commission-other",
                    tenant_id=self.other_tenant_id,
                    catalog="commissionTypes",
                    name="Other",
                    data={},
                    active=True,
                )
            )
            db.session.commit()
        own_type = self.create_type()
        self.assertEqual(
            self.request("post", f"/masters/commissionTypes/{own_type['id']}/toggle").status_code,
            200,
        )
        for type_id in (None, "missing", "commission-other", "direct-a", own_type["id"]):
            with self.subTest(type_id=type_id):
                result = self.request(
                    "post", "/masters/commissionRules", json={"name": "Bad", "typeId": type_id}
                )
                self.assertEqual(result.status_code, 422, result.json)

    def test_existing_recipient_can_be_edited_after_type_deactivated(self):
        type_id = self.create_type()["id"]
        created = self.request(
            "post", "/masters/commissionRules", json={"name": "Taxi", "typeId": type_id}
        )
        self.assertEqual(created.status_code, 201, created.json)
        item_id = created.json["id"]
        self.request("post", f"/masters/commissionTypes/{type_id}/toggle")
        edited = self.request(
            "patch",
            "/masters/commissionRules",
            json={
                "id": item_id,
                "name": "Taxi renamed",
                "typeId": type_id,
            },
        )
        self.assertEqual(edited.status_code, 200, edited.json)
        toggled = self.request("post", f"/masters/commissionRules/{item_id}/toggle")
        self.assertEqual(toggled.status_code, 200, toggled.json)
        self.assertFalse(toggled.json["active"])

    def test_catalog_settings_require_owner_and_isolate_tenants(self):
        category = self.request(
            "post", "/masters/cashbookCategories", json={"name": "Income", "type": "INCOME"}
        )
        self.assertEqual(category.status_code, 201, category.json)
        for email in ("frontdesk@test.local", "accountant@test.local", "hk@test.local"):
            client, headers = self.login(email)
            for catalog in ("cashbookCategories", "commissionTypes", "commissionRules"):
                with self.subTest(email=email, catalog=catalog):
                    denied = self.request(
                        "post",
                        f"/masters/{catalog}",
                        json={"name": "Denied"},
                        client=client,
                        headers=headers,
                    )
                    self.assertEqual(denied.status_code, 403, denied.json)
        other, headers = self.login("owner-b@test.local")
        crossed = self.request(
            "patch",
            f"/api/tenants/{self.other_tenant_id}/masters/cashbookCategories",
            json={"id": category.json["id"], "name": "Crossed"},
            client=other,
            headers=headers,
        )
        self.assertEqual(crossed.status_code, 404, crossed.json)
        denied = self.request(
            "post",
            f"/api/tenants/{self.other_tenant_id}/masters/commissionTypes",
            json={"name": "Denied"},
        )
        self.assertEqual(denied.status_code, 403, denied.json)
