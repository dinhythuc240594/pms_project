"""Cashbook classification preserves vouchers and tenant boundaries."""

from datetime import date, timedelta
from unittest.mock import patch

from sqlalchemy import text

from pms_api.catalog.models import Master
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class CashbookCategoryTests(DomainTestCase):
    def category(self, name="Other income", kind="INCOME"):
        result = self.request("post", "/masters/cashbookCategories", {"name": name, "type": kind})
        self.assertEqual(result.status_code, 201, result.json)
        return result.json

    def cash(self, kind="receipt", category_id=None, **options):
        data = {"type": kind, "amount": "10", "fundId": "fund-a", "description": "Category test"}
        if category_id is not None:
            data["categoryId"] = category_id
        return self.request(
            "post", "/cash-documents", data, key="category-" + kind + str(category_id), **options
        )

    def test_catalog_validates_direction_and_owner_permissions(self):
        item = self.category()
        self.assertEqual(item["type"], "INCOME")
        self.assertTrue(item["active"])
        for kind in ["income", "TRANSFER", "", True]:
            result = self.request(
                "post", "/masters/cashbookCategories", {"name": "Bad", "type": kind}
            )
            self.assertEqual(result.status_code, 422, result.json)
        accountant, headers = self.login("accountant@test.local")
        result = self.request(
            "post",
            "/masters/cashbookCategories",
            {"name": "Forbidden", "type": "EXPENSE"},
            client=accountant,
            headers=headers,
        )
        self.assertEqual(result.status_code, 403)
        snapshot = self.request("get", "/workspace", client=accountant, headers=headers).json
        self.assertEqual(snapshot["masters"]["cashbookCategories"], [item])

    def test_vouchers_reject_foreign_inactive_wrong_catalog_and_wrong_direction(self):
        income, expense = self.category(), self.category("Other expense", "EXPENSE")
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            db.session.add(
                Master(
                    id="foreign-category",
                    tenant_id=self.other_tenant_id,
                    catalog="cashbookCategories",
                    name="Foreign",
                    data={"type": "INCOME"},
                )
            )
            db.session.commit()
        for category_id in ["foreign-category", "service-a", expense["id"], "missing", True]:
            result = self.cash(category_id=category_id)
            self.assertEqual(result.status_code, 422, result.json)
        self.assertEqual(self.cash("expense", income["id"]).status_code, 422)
        for kind in ["withdrawal", "transfer", "opening"]:
            self.assertEqual(self.cash(kind, income["id"]).status_code, 422)
        receipt = self.cash(category_id=income["id"])
        self.assertEqual(receipt.status_code, 201, receipt.json)
        self.assertEqual(self.cash("expense", expense["id"]).status_code, 201)
        self.request("post", f"/masters/cashbookCategories/{income['id']}/toggle", {})
        result = self.request(
            "post",
            "/cash-documents",
            {
                "type": "receipt",
                "amount": "1",
                "fundId": "fund-a",
                "description": "Inactive",
                "categoryId": income["id"],
            },
            key="inactive-category-new",
        )
        self.assertEqual(result.status_code, 422, result.json)
        desk, headers = self.login("frontdesk@test.local")
        self.assertEqual(
            self.cash(category_id=expense["id"], client=desk, headers=headers).status_code, 403
        )

    def test_category_snapshots_survive_rename_deactivation_and_reversal(self):
        item = self.category()
        created = self.cash(category_id=item["id"])
        self.assertEqual(created.status_code, 201, created.json)
        expected = {
            "categoryId": item["id"],
            "categoryName": "Other income",
            "categoryType": "INCOME",
        }
        for key, value in expected.items():
            self.assertEqual(created.json[key], value)
        changed = self.request(
            "patch",
            "/masters/cashbookCategories",
            {"id": item["id"], "name": "Changed", "type": "EXPENSE", "active": False},
        )
        self.assertEqual(changed.status_code, 200, changed.json)
        reversed_row = self.request(
            "post",
            f"/cash-documents/{created.json['id']}/reverse",
            {"reason": "Correction"},
            key="category-reversal",
        )
        self.assertEqual(reversed_row.status_code, 201, reversed_row.json)
        for key, value in expected.items():
            self.assertEqual(reversed_row.json[key], value)
        book = self.request("get", f"/cashbook?categoryId={item['id']}")
        self.assertEqual(book.status_code, 200, book.json)
        self.assertEqual(book.json["pagination"]["totalItems"], 2)
        self.assertEqual(book.json["summary"]["closing"], "0.0000")
        self.assertEqual(
            {row["categoryName"] for row in book.json["cashDocuments"]}, {"Other income"}
        )
        refused = self.app.test_cli_runner().invoke(
            args=["db", "downgrade", "0018_channel_mapping_lifecycle"]
        )
        self.assertNotEqual(refused.exit_code, 0)

    def test_uncategorized_history_and_read_filters_remain_tenant_scoped(self):
        self.assertEqual(self.cash().status_code, 201)
        item = self.category()
        self.assertEqual(self.cash(category_id=item["id"]).status_code, 201)
        book = self.request("get", "/cashbook?categoryId=uncategorized")
        self.assertEqual(book.status_code, 200, book.json)
        self.assertEqual(book.json["pagination"]["totalItems"], 1)
        self.assertIsNone(book.json["cashDocuments"][0]["categoryId"])
        self.assertEqual(self.request("get", "/cashbook?categoryId=missing").status_code, 422)
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            db.session.add(
                Master(
                    id="foreign-filter",
                    tenant_id=self.other_tenant_id,
                    catalog="cashbookCategories",
                    name="Foreign",
                    data={"type": "INCOME"},
                )
            )
            db.session.commit()
        self.assertEqual(
            self.request("get", "/cashbook?categoryId=foreign-filter").status_code, 422
        )

    def test_additive_migration_keeps_uncategorized_vouchers(self):
        created = self.cash()
        self.assertEqual(created.status_code, 201, created.json)
        runner = self.app.test_cli_runner()
        downgraded = runner.invoke(args=["db", "downgrade", "0018_channel_mapping_lifecycle"])
        self.assertEqual(downgraded.exit_code, 0, downgraded.output)
        upgraded = runner.invoke(args=["db", "upgrade"])
        self.assertEqual(upgraded.exit_code, 0, upgraded.output)
        book = self.request("get", "/cashbook").json
        self.assertEqual(book["cashDocuments"][0]["id"], created.json["id"])
        self.assertIsNone(book["cashDocuments"][0]["categoryId"])
        self.assertEqual(book["summary"]["closing"], "10.0000")
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            stored = db.session.execute(
                text(
                    "SELECT category_id, category_name, category_type FROM cash_documents WHERE id = :id"
                ),
                {"id": created.json["id"]},
            ).one()
            self.assertEqual(tuple(stored), (None, None, None))

    def test_document_link_preserves_history_after_a_timezone_date_change(self):
        today = date.today()
        with patch("pms_api.finance.routes.local_date", return_value=today + timedelta(days=1)):
            created = self.cash()
        self.assertEqual(created.status_code, 201, created.json)
        with patch("pms_api.finance.routes.local_date", return_value=today):
            self.assertEqual(self.request("get", "/cashbook").json["ledger"], [])
            linked = self.request("get", "/cashbook?documentId=" + created.json["id"]).json
            self.assertEqual(len(linked["ledger"]), 1)
            self.assertIsNone(linked["summary"]["endDate"])
            self.assertEqual(
                self.request(
                    "get",
                    "/cashbook?documentId=" + created.json["id"] + "&endDate=" + today.isoformat(),
                ).json["ledger"],
                [],
            )
