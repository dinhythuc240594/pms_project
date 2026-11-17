"""Real PostgreSQL proofs for immutable stock, stale counts and atomic POS posting."""

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from pms_api.catalog.models import Master
from pms_api.core_models import Plan
from pms_api.extensions import db
from pms_api.finance.models import PosInvoiceItem
from pms_api.inventory.models import InventoryDocument, StockMovement
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class InventoryIntegrationTests(DomainTestCase):
    def setUp(self):
        super().setUp()
        self.sequence = 0
        self.warehouse = self.master("warehouses", "Main", isDefault=True)
        self.other_warehouse = self.master("warehouses", "Backup")
        self.category = self.master("itemCategories", "Food")
        self.item = self.master(
            "items",
            "Coffee",
            sku="COFFEE",
            unit="cup",
            costPrice="3.3333",
            categoryId=self.category["id"],
            minStock="2",
        )
        self.supplier = self.master("suppliers", "Supplier", phone="0901234567")

    def key(self):
        self.sequence += 1
        return f"inventory-proof-{self.sequence:04d}"

    def master(self, catalog, name, **data):
        response = self.request("post", "/inventory/masters/" + catalog, {"name": name, **data})
        self.assertEqual(response.status_code, 201, response.json)
        return response.json

    def document(self, kind, quantity="10", *, key=None, lines=None, **data):
        body = {
            "kind": kind,
            "warehouseId": self.warehouse["id"],
            "lines": lines or [{"itemId": self.item["id"], "quantity": quantity}],
            **data,
        }
        return self.request("post", "/inventory/documents", body, key=key or self.key())

    def posted(self, kind, quantity="10", **data):
        response = self.document(kind, quantity, **data)
        self.assertEqual(response.status_code, 201, response.json)
        return response.json

    def stock(self, warehouse=None):
        response = self.request("get", "/inventory/stock")
        self.assertEqual(response.status_code, 200, response.json)
        self.assertTrue(response.json["summary"]["reconciled"])
        return next(
            row
            for row in response.json["rows"]
            if row["warehouseId"] == (warehouse or self.warehouse["id"])
            and row["itemId"] == self.item["id"]
        )

    def recipe(self, quantity="1", **changes):
        response = self.request(
            "post",
            "/inventory/service-stock-links",
            {
                "serviceId": "service-a",
                "warehouseId": self.warehouse["id"],
                "lines": [{"itemId": self.item["id"], "quantity": quantity}],
                **changes,
            },
        )
        self.assertEqual(response.status_code, 200, response.json)
        return response.json

    def invoice(self, quantity="2"):
        response = self.request(
            "post",
            "/pos/invoices",
            {
                "items": [{"serviceId": "service-a", "quantity": quantity}],
            },
            key=self.key(),
        )
        self.assertEqual(response.status_code, 201, response.json)
        return response.json

    def post_invoice(self, invoice, **data):
        return self.request("post", f"/pos/invoices/{invoice['id']}/post", data, key=self.key())

    def test_masters_scoped_categories_unique_skus_defaults_and_immutable_unit(self):
        defaults = self.master("warehouses", "Newest default", isDefault=True)
        masters = self.request("get", "/inventory/masters").json
        self.assertEqual(
            [r["id"] for r in masters["warehouses"] if r["isDefault"]], [defaults["id"]]
        )
        duplicate = self.request(
            "post", "/inventory/masters/items", {"name": "Other", "sku": "coffee"}
        )
        self.assertEqual(duplicate.status_code, 409, duplicate.json)
        child = self.master("itemCategories", "Child", parentId=self.category["id"])
        cycle = self.request(
            "patch",
            "/inventory/masters/itemCategories",
            {
                "id": self.category["id"],
                "parentId": child["id"],
            },
        )
        self.assertEqual(cycle.status_code, 409, cycle.json)
        self.posted("opening")
        changed = self.request(
            "patch",
            "/inventory/masters/items",
            {
                "id": self.item["id"],
                "unit": "box",
            },
        )
        self.assertEqual(changed.status_code, 409, changed.json)
        with self.app.app_context():
            set_context("owner-b", self.other_tenant_id)
            db.session.add(
                Master(
                    id="foreign-category",
                    tenant_id=self.other_tenant_id,
                    catalog="itemCategories",
                    name="Foreign",
                    data={},
                )
            )
            db.session.commit()
        invalid = self.request(
            "patch",
            "/inventory/masters/items",
            {
                "id": self.item["id"],
                "categoryId": "foreign-category",
            },
        )
        self.assertEqual(invalid.status_code, 422, invalid.json)

    def test_opening_multistore_once_snapshots_and_period_equation(self):
        tenant_timezone = ZoneInfo("Asia/Ho_Chi_Minh")
        today = datetime.now(tenant_timezone).date()
        yesterday = today - timedelta(days=1)
        opening = self.posted(
            "opening",
            date=str(yesterday),
            lines=[
                {"itemId": self.item["id"], "quantity": "10", "unitCost": "3"},
                {
                    "itemId": self.item["id"],
                    "warehouseId": self.other_warehouse["id"],
                    "quantity": "2",
                    "unitCost": "3",
                },
            ],
        )
        self.assertEqual(len(opening["lines"]), 2)
        self.assertFalse(opening["canReverse"])
        self.assertEqual(self.document("opening").status_code, 409)
        self.posted(
            "receipt",
            "5",
            date=str(today),
            supplierId=self.supplier["id"],
            lines=[
                {"itemId": self.item["id"], "quantity": "5", "unitCost": "6"},
            ],
        )
        issued = self.posted("issue", "3", date=str(today))
        self.assertEqual(issued["lines"][0]["costValue"], "-12.00000000")
        report = self.request("get", f"/inventory/stock?start={today}&end={today}").json
        row = next(r for r in report["rows"] if r["warehouseId"] == self.warehouse["id"])
        self.assertEqual(
            (row["openingQuantity"], row["received"], row["issued"], row["closingQuantity"]),
            ("10.0000", "5.0000", "3.0000", "12.0000"),
        )
        self.assertEqual(row["costValue"], "48.00000000")
        self.assertEqual(report["summary"]["valuation"], "54.00000000")
        renamed = self.request(
            "patch",
            "/inventory/masters/items",
            {
                "id": self.item["id"],
                "name": "New coffee name",
                "sku": "NEW-SKU",
            },
        )
        self.assertEqual(renamed.status_code, 200, renamed.json)
        detail = self.request("get", "/inventory/documents/" + issued["id"]).json
        self.assertEqual(detail["lines"][0]["item"], "Coffee")
        self.assertEqual(detail["lines"][0]["sku"], "COFFEE")
        created_day = (
            datetime.fromisoformat(opening["createdAt"]).astimezone(tenant_timezone).date()
        )
        self.assertEqual(opening["date"], yesterday.isoformat())
        self.assertNotEqual(created_day.isoformat(), opening["date"])

    def test_first_operation_locks_opening_and_failed_write_rolls_back_lock(self):
        self.assertEqual(self.document("issue", "1").status_code, 409)
        self.assertFalse(self.request("get", "/inventory/masters").json["openingLocked"])
        self.posted("receipt", "1")
        self.assertTrue(self.request("get", "/inventory/masters").json["openingLocked"])
        self.assertEqual(self.document("opening").status_code, 409)
        self.assertEqual(self.stock()["quantity"], "1.0000")

    def test_transfer_uses_exact_server_value_and_is_atomic(self):
        self.posted(
            "opening",
            "3",
            lines=[
                {
                    "itemId": self.item["id"],
                    "quantity": "3",
                    "unitCost": "0.3333",
                }
            ],
        )
        transfer = self.posted("transfer", "1", toWarehouseId=self.other_warehouse["id"])
        self.assertEqual(sum(Decimal(r["costValue"]) for r in transfer["lines"]), Decimal(0))
        self.assertEqual(self.stock()["quantity"], "2.0000")
        self.assertEqual(self.stock(self.other_warehouse["id"])["costValue"], "0.33330000")
        fail = self.document("transfer", "3", toWarehouseId=self.other_warehouse["id"])
        self.assertEqual(fail.status_code, 409, fail.json)
        self.assertEqual(self.stock()["quantity"], "2.0000")
        self.assertEqual(self.stock(self.other_warehouse["id"])["quantity"], "1.0000")
        self.assertEqual(
            self.document(
                "issue",
                lines=[
                    {
                        "itemId": self.item["id"],
                        "quantity": "1",
                        "unitCost": "1",
                    }
                ],
            ).status_code,
            422,
        )

    def test_count_absolute_zero_and_stale_version(self):
        self.posted("opening", "4")
        version = self.stock()["version"]
        self.posted("receipt", "1")
        stale = self.document(
            "count",
            lines=[
                {
                    "itemId": self.item["id"],
                    "quantity": "4",
                    "expectedVersion": version,
                }
            ],
        )
        self.assertEqual(stale.status_code, 409, stale.json)
        current = self.stock()
        counted = self.posted(
            "count",
            lines=[
                {
                    "itemId": self.item["id"],
                    "quantity": "0",
                    "expectedVersion": current["version"],
                }
            ],
        )
        self.assertEqual(counted["lines"][0]["quantity"], "-5.0000")
        self.assertEqual(self.stock()["costValue"], "0.00000000")
        self.assertEqual(self.document("count", "0").status_code, 422)
        same = self.posted(
            "count",
            lines=[
                {
                    "itemId": self.item["id"],
                    "quantity": "0",
                    "expectedVersion": self.stock()["version"],
                }
            ],
        )
        self.assertEqual(same["lines"], [])
        self.assertGreater(self.stock()["version"], current["version"])

    def test_count_increase_allocates_eight_place_value_without_rounding_average(self):
        self.posted(
            "receipt",
            lines=[
                {
                    "itemId": self.item["id"],
                    "quantity": "1",
                    "unitCost": "1",
                }
            ],
        )
        self.posted(
            "receipt",
            lines=[
                {
                    "itemId": self.item["id"],
                    "quantity": "2",
                    "unitCost": "0",
                }
            ],
        )
        counted = self.posted(
            "count",
            lines=[
                {
                    "itemId": self.item["id"],
                    "quantity": "6",
                    "expectedVersion": self.stock()["version"],
                }
            ],
        )
        self.assertEqual(self.stock()["costValue"], "2.00000000")
        reversed_row = self.request(
            "post",
            f"/inventory/documents/{counted['id']}/reverse",
            {
                "reason": "Revert count variance",
            },
            key=self.key(),
        )
        self.assertEqual(reversed_row.status_code, 201, reversed_row.json)
        self.assertEqual(self.stock()["quantity"], "3.0000")
        self.assertEqual(self.stock()["costValue"], "1.00000000")

    def test_reverse_receipt_rejects_consumed_stock_then_reverses_once(self):
        original = self.posted("receipt", "4")
        issued = self.posted("issue", "4")
        path = f"/inventory/documents/{original['id']}/reverse"
        reason = {"reason": "Wrong receipt"}
        self.assertEqual(self.request("post", path, reason, key=self.key()).status_code, 409)
        issue_reverse = self.request(
            "post", f"/inventory/documents/{issued['id']}/reverse", reason, key=self.key()
        )
        self.assertEqual(issue_reverse.status_code, 201, issue_reverse.json)
        key = self.key()
        reversed_row = self.request("post", path, reason, key=key)
        self.assertEqual(reversed_row.status_code, 201, reversed_row.json)
        self.assertEqual(reversed_row.json, self.request("post", path, reason, key=key).json)
        self.assertEqual(self.request("post", path, reason, key=self.key()).status_code, 409)
        self.assertEqual(self.stock()["quantity"], "0.0000")
        detail = self.request("get", "/inventory/documents/" + original["id"]).json
        self.assertEqual(detail["reversedById"], reversed_row.json["id"])
        self.assertFalse(detail["canReverse"])
        self.assertEqual(detail["lines"], original["lines"])

    def test_global_idempotency_replay_conflict_and_strict_decimal_inputs(self):
        key = self.key()
        created = self.document("opening", "2", key=key)
        self.assertEqual(created.status_code, 201, created.json)
        replay = self.document("opening", "2", key=key)
        self.assertEqual(replay.json, created.json)
        self.assertEqual(self.document("opening", "3", key=key).status_code, 409)
        cross_feature = self.request(
            "post",
            "/pos/invoices",
            {
                "items": [{"serviceId": "service-a", "quantity": "1"}],
            },
            key=key,
        )
        self.assertEqual(cross_feature.status_code, 409, cross_feature.json)
        for quantity in ("NaN", "Infinity", "-1", "0.00001", True, None):
            with self.subTest(quantity=quantity):
                self.assertEqual(self.document("receipt", quantity).status_code, 422)
        missing_key = self.request(
            "post",
            "/inventory/documents",
            {
                "kind": "receipt",
                "warehouseId": self.warehouse["id"],
                "lines": [{"itemId": self.item["id"], "quantity": "1"}],
            },
        )
        self.assertEqual(missing_key.status_code, 422, missing_key.json)
        self.assertEqual(self.stock()["quantity"], "2.0000")

    def test_concurrent_issue_and_count_do_not_overdraw_or_apply_stale_count(self):
        self.posted("opening", "1")
        version = self.stock()["version"]
        clients = [self.login(), self.login()]

        def issue(index):
            client, headers = clients[index]
            return self.request(
                "post",
                "/inventory/documents",
                {
                    "kind": "issue",
                    "warehouseId": self.warehouse["id"],
                    "lines": [{"itemId": self.item["id"], "quantity": "1"}],
                },
                client=client,
                headers=headers,
                key=f"concurrent-issue-{index}",
            ).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(issue, range(2))), [201, 409])
        self.assertEqual(self.stock()["quantity"], "0.0000")
        stale = self.document(
            "count",
            lines=[
                {
                    "itemId": self.item["id"],
                    "quantity": "3",
                    "expectedVersion": version,
                }
            ],
        )
        self.assertEqual(stale.status_code, 409, stale.json)

    def test_posted_records_immutable_rls_and_cross_tenant_fk(self):
        original = self.posted("opening", "2")
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            for statement in (
                "UPDATE inventory_documents SET note='edited' WHERE id=:id",
                "DELETE FROM inventory_documents WHERE id=:id",
                "UPDATE stock_movements SET quantity=0 WHERE document_id=:id",
                "UPDATE inventory_controls SET opening_locked=false WHERE tenant_id=:tenant",
            ):
                with self.subTest(statement=statement), self.assertRaises(DBAPIError):
                    db.session.execute(
                        text(statement), {"id": original["id"], "tenant": self.tenant_id}
                    )
                    db.session.flush()
                db.session.rollback()
                set_context(self.owner_id, self.tenant_id)
            db.session.rollback()
            set_context("owner-b", self.other_tenant_id)
            self.assertEqual(db.session.scalars(select(InventoryDocument)).all(), [])
            self.assertEqual(db.session.scalars(select(StockMovement)).all(), [])
            db.session.add(
                InventoryDocument(
                    tenant_id=self.other_tenant_id,
                    kind="receipt",
                    date=date.today(),
                    warehouse_id=self.warehouse["id"],
                    warehouse_name="Foreign",
                    currency="VND",
                    note="",
                    input_lines=[],
                    user_id="owner-b",
                )
            )
            with self.assertRaises(DBAPIError):
                db.session.flush()
            db.session.rollback()

    def test_permissions_csrf_tenant_and_plan_gate(self):
        for email in ("hk@test.local", "frontdesk@test.local"):
            client, headers = self.login(email)
            read = self.request("get", "/inventory/stock", client=client, headers=headers)
            self.assertEqual(read.status_code, 403, read.json)
        client, headers = self.login("accountant@test.local")
        read = self.request("get", "/inventory/masters", client=client, headers=headers)
        self.assertEqual(read.status_code, 200, read.json)
        self.assertEqual(
            self.request(
                "post", "/inventory/masters/warehouses", {"name": "Missing csrf"}, headers={}
            ).status_code,
            403,
        )
        foreign = self.request("get", f"/api/tenants/{self.other_tenant_id}/inventory/masters")
        self.assertEqual(foreign.status_code, 403, foreign.json)
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            plan = db.session.get(Plan, "default-pro")
            plan.features = {**plan.features, "INVENTORY_WAREHOUSE": False}
            db.session.commit()
        self.assertEqual(self.document("receipt", "1").status_code, 403)

    def test_pos_insufficient_stock_rolls_back_post_and_stock(self):
        self.posted("opening", "1")
        self.recipe()
        invoice = self.invoice("2")
        failed = self.post_invoice(invoice)
        self.assertEqual(failed.status_code, 409, failed.json)
        invoice_path = "/pos/invoices/" + invoice["id"]
        self.assertEqual(self.request("get", invoice_path).json["status"], "DRAFT")
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(db.session.scalars(select(PosInvoiceItem)).all(), [])
        self.assertEqual(self.stock()["quantity"], "1.0000")
        docs = self.request("get", "/inventory/documents?kind=pos_issue").json
        self.assertEqual(docs["documents"], [])
        self.posted("receipt", "1")
        posted = self.post_invoice(invoice)
        self.assertEqual(posted.status_code, 201, posted.json)
        self.assertEqual(self.stock()["quantity"], "0.0000")

    def test_pos_money_refund_explicit_return_and_cancel_original_inactive_stock(self):
        self.posted("opening", "5")
        self.recipe("1.5")
        invoice = self.invoice("2")
        posted = self.post_invoice(invoice)
        self.assertEqual(posted.status_code, 201, posted.json)
        self.assertEqual(self.stock()["quantity"], "2.0000")
        invoice_path = "/pos/invoices/" + invoice["id"]
        payment = self.request(
            "post",
            invoice_path + "/payments",
            {
                "amount": "40",
                "methodId": "cash-a",
                "fundId": "fund-a",
            },
            key=self.key(),
        )
        self.assertEqual(payment.status_code, 201, payment.json)
        payment_id = payment.json["payments"][0]["id"]
        refund = self.request(
            "post",
            f"{invoice_path}/payments/{payment_id}/refund",
            {
                "amount": "10",
                "reason": "Financial correction",
            },
            key=self.key(),
        )
        self.assertEqual(refund.status_code, 201, refund.json)
        self.assertEqual(self.stock()["quantity"], "2.0000")
        consumption = self.request("get", "/inventory/documents?kind=pos_issue").json["documents"][
            0
        ]
        movement_id = consumption["lines"][0]["id"]
        path = f"/inventory/pos/{invoice['id']}/returns"
        returned = self.request(
            "post",
            path,
            {
                "reason": "One cup physically returned",
                "lines": [{"movementId": movement_id, "quantity": "1"}],
            },
            key=self.key(),
        )
        self.assertEqual(returned.status_code, 201, returned.json)
        self.assertEqual(self.stock()["quantity"], "3.0000")
        self.assertEqual(
            self.request(
                "post",
                path,
                {
                    "reason": "Too many",
                    "lines": [{"movementId": movement_id, "quantity": "3"}],
                },
                key=self.key(),
            ).status_code,
            409,
        )
        self.recipe("9")  # Cancellation compensates frozen movements, not the current recipe.
        for catalog, record in (("items", self.item), ("warehouses", self.warehouse)):
            disabled = self.request(
                "patch",
                "/inventory/masters/" + catalog,
                {
                    "id": record["id"],
                    "active": False,
                },
            )
            self.assertEqual(disabled.status_code, 200, disabled.json)
        cancelled = self.request(
            "post", invoice_path + "/cancel", {"reason": "Cancel order"}, key=self.key()
        )
        self.assertEqual(cancelled.status_code, 201, cancelled.json)
        self.assertEqual(cancelled.json["status"], "CANCELLED")
        self.assertEqual(self.stock()["quantity"], "5.0000")
        self.assertEqual(self.stock()["costValue"], "16.66650000")
        self.assertEqual(
            self.request(
                "post",
                path,
                {
                    "reason": "Already cancelled",
                    "lines": [{"movementId": movement_id, "quantity": "1"}],
                },
                key=self.key(),
            ).status_code,
            409,
        )

    def test_pos_plan_disabled_blocks_linked_post_but_preserves_cancel_compensation(self):
        self.posted("opening", "5")
        self.recipe()
        original = self.invoice("1")
        self.assertEqual(self.post_invoice(original).status_code, 201)
        draft = self.invoice("1")
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            plan = db.session.get(Plan, "default-pro")
            plan.features = {**plan.features, "INVENTORY_WAREHOUSE": False}
            db.session.commit()
        denied = self.post_invoice(draft)
        self.assertEqual(denied.status_code, 403, denied.json)
        cancelled = self.request(
            "post",
            f"/pos/invoices/{original['id']}/cancel",
            {
                "reason": "Historic invoice compensation",
            },
            key=self.key(),
        )
        self.assertEqual(cancelled.status_code, 201, cancelled.json)
        # The workspace/report read may itself be gated; scoped projection confirms the compensation.
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            total = sum(db.session.scalars(select(StockMovement.quantity)), Decimal(0))
            self.assertEqual(total, Decimal(5))

    def test_dates_filters_pagination_and_server_cost_precision(self):
        yesterday = date.today() - timedelta(days=1)
        self.posted("opening", "3", date=str(yesterday))
        self.posted("receipt", "1")
        self.assertEqual(self.document("receipt", "1", date=str(yesterday)).status_code, 409)
        self.assertEqual(
            self.document("receipt", "1", date=str(date.today() + timedelta(days=1))).status_code,
            409,
        )
        first = self.request("get", "/inventory/documents?pageSize=1&page=1").json
        second = self.request("get", "/inventory/documents?pageSize=1&page=2").json
        self.assertEqual(first["pagination"]["totalItems"], 2)
        self.assertNotEqual(first["documents"][0]["id"], second["documents"][0]["id"])
        filtered = self.request(
            "get", f"/inventory/documents?start={date.today()}&end={date.today()}"
        ).json
        self.assertEqual(len(filtered["documents"]), 1)
        self.assertEqual(self.request("get", "/inventory/documents?kind=bad").status_code, 422)
        self.assertEqual(
            self.request(
                "get", f"/inventory/stock?start={date.today()}&end={yesterday}"
            ).status_code,
            422,
        )
        report = self.request("get", f"/inventory/stock?end={yesterday}").json
        self.assertEqual(report["rows"][0]["closingQuantity"], "3.0000")
        self.assertEqual(report["rows"][0]["quantity"], "4.0000")

    def test_large_values_preserve_eight_places_when_issued_reversed_and_returned(self):
        quantity, unit_cost = "999999999999999.9999", "999999999999999.9999"
        opening = self.posted(
            "opening",
            lines=[
                {
                    "itemId": self.item["id"],
                    "quantity": quantity,
                    "unitCost": unit_cost,
                }
            ],
        )
        expected = "999999999999999999800000000000.00000001"
        self.assertEqual(opening["lines"][0]["costValue"], expected)
        issued = self.posted("issue", quantity)
        self.assertEqual(issued["lines"][0]["costValue"], "-" + expected)
        self.assertEqual(self.stock()["costValue"], "0.00000000")
        reversed_row = self.request(
            "post",
            f"/inventory/documents/{issued['id']}/reverse",
            {
                "reason": "Restore large exact stock",
            },
            key=self.key(),
        )
        self.assertEqual(reversed_row.status_code, 201, reversed_row.json)
        self.assertEqual(self.stock()["costValue"], expected)
        transfer = self.posted("transfer", quantity, toWarehouseId=self.other_warehouse["id"])
        self.assertEqual(self.stock(self.other_warehouse["id"])["costValue"], expected)
        reversed_transfer = self.request(
            "post",
            f"/inventory/documents/{transfer['id']}/reverse",
            {
                "reason": "Restore transfer",
            },
            key=self.key(),
        )
        self.assertEqual(reversed_transfer.status_code, 201, reversed_transfer.json)
        self.recipe(quantity)
        invoice = self.invoice("1")
        posted = self.post_invoice(invoice)
        self.assertEqual(posted.status_code, 201, posted.json)
        self.assertEqual(self.stock()["costValue"], "0.00000000")
        consumption = self.request("get", "/inventory/documents?kind=pos_issue").json["documents"][
            0
        ]
        returned = self.request(
            "post",
            f"/inventory/pos/{invoice['id']}/returns",
            {
                "reason": "Partial physical return",
                "lines": [
                    {
                        "movementId": consumption["lines"][0]["id"],
                        "quantity": "1",
                    }
                ],
            },
            key=self.key(),
        )
        self.assertEqual(returned.status_code, 201, returned.json)
        cancelled = self.request(
            "post",
            f"/pos/invoices/{invoice['id']}/cancel",
            {
                "reason": "Return remaining stock",
            },
            key=self.key(),
        )
        self.assertEqual(cancelled.status_code, 201, cancelled.json)
        self.assertEqual(self.stock()["costValue"], expected)
