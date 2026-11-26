"""Commercial catalog and registered room limits on a disposable database."""

import unittest
from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace

from sqlalchemy import create_engine, delete, text

from pms_api.core_models import Plan, Subscription, utcnow
from pms_api.extensions import db
from pms_api.security import set_context
from pms_api.subscriptions import plan_code, quota_limit
from tests.domain_fixture import DomainTestCase
from tests.schema_fixture import upgrade_test_schema


class PlanRoomLimitTests(DomainTestCase):
    def setUp(self):
        super().setUp()
        self.admin, self.admin_headers = self.login("admin@test.local")

    def admin_request(self, method, path, data=None):
        return self.request(method, path, data, client=self.admin, headers=self.admin_headers)

    def create_plan(self, **overrides):
        response = self.admin_request(
            "POST",
            "/api/plans",
            {
                "code": "BUSINESS",
                "name": "Doanh nghiệp",
                "price": "1000",
                "priceYear": "10000",
                "maxRooms": 10,
                "features": {"OTA_SYNC": True, "POS_SALES": False},
                **overrides,
            },
        )
        self.assertEqual(response.status_code, 201, response.json)
        return response.json

    def assign(self, plan_id, **overrides):
        return self.admin_request(
            "PUT",
            f"/api/tenants/{self.tenant_id}/subscription",
            {
                "planId": plan_id,
                "roomCount": 3,
                "endDate": (utcnow() + timedelta(days=60)).isoformat(),
                **overrides,
            },
        )

    def test_custom_plan_public_catalog_tracks_features_without_private_data(self):
        plan = self.create_plan()
        public = self.app.test_client().get("/api/public/plans")
        self.assertEqual(public.status_code, 200, public.json)
        self.assertEqual(public.headers["Cache-Control"], "no-store")
        self.assertEqual(set(public.json), {"plans", "featureLabels"})
        advertised = next(row for row in public.json["plans"] if row["id"] == plan["id"])
        self.assertTrue(advertised["features"]["OTA_SYNC"])
        self.assertNotIn("tenants", advertised)
        self.assertNotIn("billing", advertised)
        edited = self.admin_request(
            "PATCH", "/api/plans/" + plan["id"], {"features": {"OTA_SYNC": False}}
        )
        self.assertEqual(edited.status_code, 200, edited.json)
        public = self.app.test_client().get("/api/public/plans").json
        advertised = next(row for row in public["plans"] if row["id"] == plan["id"])
        self.assertFalse(advertised["features"]["OTA_SYNC"])

    def test_duplicate_immutable_codes_and_system_role_boundary(self):
        plan = self.create_plan()
        duplicate = self.admin_request(
            "POST", "/api/plans", {"code": "BUSINESS", "name": "Duplicate", "price": "1"}
        )
        self.assertEqual(duplicate.status_code, 409, duplicate.json)
        immutable = self.admin_request("PATCH", "/api/plans/" + plan["id"], {"code": "OTHER"})
        self.assertEqual(immutable.status_code, 422, immutable.json)
        for code in ("business", "BAD CODE", "A" * 13, ""):
            invalid = self.admin_request(
                "POST", "/api/plans", {"code": code, "name": "Invalid", "price": "1"}
            )
            self.assertEqual(invalid.status_code, 422, invalid.json)
        manager, headers = self.login("manager@test.local")
        self.assertEqual(
            self.request(
                "DELETE", "/api/plans/" + plan["id"], client=manager, headers=headers
            ).status_code,
            403,
        )

    def test_legacy_plan_can_receive_a_code_once_and_keep_effective_features(self):
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            db.session.add(
                Plan(
                    id="legacy-plan", name="Legacy business", price=50, features={"POS_SALES": True}
                )
            )
            db.session.commit()
        first = self.admin_request(
            "PATCH", "/api/plans/legacy-plan", {"code": "LEGACY", "features": {"POS_SALES": False}}
        )
        self.assertEqual(first.status_code, 200, first.json)
        self.assertEqual(first.json["code"], "LEGACY")
        self.assertFalse(first.json["features"]["POS_SALES"])
        self.assertTrue(first.json["features"]["OTA_SYNC"])
        changed = self.admin_request("PATCH", "/api/plans/legacy-plan", {"code": "OTHER"})
        self.assertEqual(changed.status_code, 422, changed.json)

    def test_new_partial_feature_map_does_not_grant_advanced_access(self):
        plan = self.create_plan(features={"POS_SALES": True})
        self.assertTrue(plan["features"]["POS_SALES"])
        self.assertFalse(plan["features"]["OTA_SYNC"])
        self.assertFalse(plan["features"]["MULTI_CURRENCY"])
        self.assertEqual(self.assign(plan["id"]).status_code, 200)
        denied = self.request("GET", "/channels")
        self.assertEqual(denied.status_code, 403, denied.json)
        patched = self.admin_request(
            "PATCH", "/api/plans/" + plan["id"], {"features": {"OTA_SYNC": True}}
        )
        self.assertEqual(patched.status_code, 200, patched.json)
        self.assertTrue(patched.json["features"]["POS_SALES"])
        self.assertTrue(patched.json["features"]["OTA_SYNC"])
        self.assertFalse(patched.json["features"]["MULTI_CURRENCY"])

    def test_unassigned_hotel_retains_room_reads_but_cannot_add_or_reactivate(self):
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            db.session.execute(delete(Subscription).where(Subscription.tenant_id == self.tenant_id))
            db.session.commit()
        self.assertEqual(self.request("GET", "/workspace").status_code, 200)
        added = self.request("POST", "/masters/rooms", {"number": "103", "typeId": "rt-a"})
        self.assertEqual(added.status_code, 409, added.json)
        self.assertEqual(added.json["error"]["code"], "subscription_required")
        bulk = self.request(
            "POST",
            "/masters/roomTypes",
            {"code": "NEW", "name": "New room type", "roomNumbers": ["103"]},
        )
        self.assertEqual(bulk.status_code, 409, bulk.json)
        replacement = self.request(
            "PATCH", "/masters/roomTypes", {"id": "rt-a", "roomNumbers": ["101", "103"]}
        )
        self.assertEqual(replacement.status_code, 409, replacement.json)
        self.assertEqual(replacement.json["error"]["code"], "subscription_required")
        self.assertEqual(
            {room["id"] for room in self.request("GET", "/workspace").json["rooms"]},
            {"101", "102"},
        )
        deactivated = self.request("POST", "/masters/rooms/102/toggle")
        self.assertEqual(deactivated.status_code, 200, deactivated.json)
        reactivated = self.request("POST", "/masters/rooms/102/toggle")
        self.assertEqual(reactivated.status_code, 409, reactivated.json)

    def test_delete_hides_sale_preserves_existing_subscription_and_can_restore(self):
        plan = self.create_plan(features={"POS_SALES": True})
        assigned = self.assign(plan["id"])
        self.assertEqual(assigned.status_code, 200, assigned.json)
        deleted = self.admin_request("DELETE", "/api/plans/" + plan["id"])
        self.assertEqual(deleted.status_code, 200, deleted.json)
        self.assertTrue(deleted.json["deleted"])
        self.assertTrue(deleted.json["active"])
        public = self.app.test_client().get("/api/public/plans").json["plans"]
        self.assertNotIn(plan["id"], [row["id"] for row in public])
        workspace = self.request("GET", "/workspace").json
        self.assertTrue(workspace["subscription"]["effectiveActive"])
        self.assertTrue(workspace["features"]["POS_SALES"])
        renewal = self.assign(plan["id"])
        self.assertEqual(renewal.status_code, 200, renewal.json)
        other = self.admin_request(
            "PUT",
            f"/api/tenants/{self.other_tenant_id}/subscription",
            {"planId": plan["id"], "roomCount": 3},
        )
        self.assertEqual(other.status_code, 409, other.json)
        restored = self.admin_request("PATCH", "/api/plans/" + plan["id"], {"deleted": False})
        self.assertEqual(restored.status_code, 200, restored.json)
        public = self.app.test_client().get("/api/public/plans").json["plans"]
        self.assertIn(plan["id"], [row["id"] for row in public])

    def test_registered_quantity_enforced_and_amount_calculated_from_plan(self):
        plan = self.create_plan(maxRooms=None)
        assigned = self.assign(plan["id"], amount="777")
        self.assertEqual(assigned.status_code, 200, assigned.json)
        self.assertEqual(assigned.json["subscription"]["roomCount"], 3)
        self.assertEqual(assigned.json["history"][0]["roomCount"], 3)
        self.assertEqual(assigned.json["history"][0]["amount"], "1000.0000")
        third = self.request("POST", "/masters/rooms", {"number": "103", "typeId": "rt-a"})
        self.assertEqual(third.status_code, 201, third.json)
        fourth = self.request("POST", "/masters/rooms", {"number": "104", "typeId": "rt-a"})
        self.assertEqual(fourth.status_code, 409, fourth.json)
        self.assertEqual(fourth.json["error"]["details"]["limit"], 3)
        self.assertEqual(self.request("GET", "/workspace").json["quota"]["rooms"]["limit"], 3)
        preserved = self.assign(plan["id"], roomCount=4)
        self.assertEqual(preserved.status_code, 200, preserved.json)
        history = preserved.json["history"]
        self.assertEqual({row["roomCount"] for row in history if row["roomCount"]}, {3, 4})

    def test_quantity_validates_plan_cap_current_rooms_and_no_partial_history(self):
        plan = self.create_plan(maxRooms=10)
        before = self.admin_request("GET", f"/api/tenants/{self.tenant_id}/subscription").json
        for value in (None, True, 0, -1, "2", 1000001):
            invalid = self.assign(plan["id"], roomCount=value)
            self.assertEqual(invalid.status_code, 422, invalid.json)
        for value in (1, 11):
            invalid = self.assign(plan["id"], roomCount=value)
            self.assertEqual(invalid.status_code, 409, invalid.json)
        after = self.admin_request("GET", f"/api/tenants/{self.tenant_id}/subscription").json
        self.assertEqual(after, before)
        self.assertEqual(self.assign(plan["id"], roomCount=10).status_code, 200)
        lower_cap = self.admin_request("PATCH", "/api/plans/" + plan["id"], {"maxRooms": 9})
        self.assertEqual(lower_cap.status_code, 409, lower_cap.json)

    def test_preserved_legacy_overquota_does_not_block_unrelated_plan_edits(self):
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            db.session.get(Plan, "default-pro").max_rooms = 1
            db.session.commit()
        edited = self.admin_request(
            "PATCH",
            "/api/plans/default-pro",
            {"name": "Legacy renamed", "features": {"POS_SALES": False}},
        )
        self.assertEqual(edited.status_code, 200, edited.json)
        self.assertEqual(edited.json["maxRooms"], 1)
        self.assertFalse(edited.json["features"]["POS_SALES"])
        self.assertEqual(self.request("GET", "/workspace").json["quota"]["rooms"]["used"], 2)
        changed_cap = self.admin_request("PATCH", "/api/plans/default-pro", {"maxRooms": 2})
        self.assertEqual(changed_cap.status_code, 409, changed_cap.json)
        self.assertEqual(changed_cap.json["error"]["code"], "quota_below_subscription")

    def test_custom_plan_is_counted_in_manager_overview(self):
        plan = self.create_plan()
        self.assertEqual(self.assign(plan["id"]).status_code, 200)
        overview = self.admin_request("GET", "/api/manager/overview")
        self.assertEqual(overview.status_code, 200, overview.json)
        self.assertEqual(overview.json["plans"]["BUSINESS"], 1)
        self.assertEqual(overview.json["plans"]["unassigned"], 0)

    def test_upgrade_backfills_legacy_quantities_and_preserves_paid_history(self):
        engine = create_engine(self.app.config["DATABASE_MIGRATION_URL"], hide_parameters=True)
        runner = self.app.test_cli_runner()
        try:
            with engine.begin() as connection:
                tables = ",".join('"' + table.name + '"' for table in db.metadata.sorted_tables)
                connection.execute(text(f"TRUNCATE {tables} CASCADE"))
            downgraded = runner.invoke(args=["db", "downgrade", "0014_manager_customers"])
            self.assertEqual(downgraded.exit_code, 0, downgraded.output)
            with engine.begin() as connection:
                connection.execute(
                    text(
                        "SELECT set_config('app.is_system','true',true), set_config('app.is_service','true',true)"
                    )
                )
                for suffix, name, code, cap, count in (
                    ("finite", "Finite legacy", None, 10, 2),
                    ("uncapped", "Pro", "PRO", None, 5),
                    ("free", "Gói Miễn Phí cũ", None, None, 0),
                ):
                    connection.execute(
                        text("""INSERT INTO tenants
                        (id,name,status,settings,created_at)
                        VALUES (:id,:id,'active','{}',CURRENT_TIMESTAMP)"""),
                        {"id": suffix},
                    )
                    connection.execute(
                        text("""INSERT INTO plans
                        (id,name,code,price,currency,max_rooms,features,active,created_at)
                        VALUES (:id,:name,:code,0,'VND',:cap,'{}',true,CURRENT_TIMESTAMP)"""),
                        {"id": suffix, "name": name, "code": code, "cap": cap},
                    )
                    connection.execute(
                        text("""INSERT INTO subscriptions
                        (id,tenant_id,plan_id,status,start_date,created_at)
                        VALUES (:id,:id,:id,'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"""),
                        {"id": suffix},
                    )
                    connection.execute(
                        text("""INSERT INTO room_types
                        (id,tenant_id,name,base_price,capacity,active)
                        VALUES (:id,:id,'Room',0,2,true)"""),
                        {"id": suffix},
                    )
                    for index in range(count):
                        connection.execute(
                            text("""INSERT INTO physical_rooms
                            (id,tenant_id,room_type_id,number,condition,active,housekeeping_revision)
                            VALUES (:id,:tenant,:tenant,:number,'clean',true,0)"""),
                            {"id": f"{suffix}-{index}", "tenant": suffix, "number": str(index)},
                        )
                connection.execute(
                    text("""INSERT INTO subscription_history
                    (id,tenant_id,plan_id,action,amount,currency,effective_date,created_at)
                    VALUES ('old-paid','finite','finite','renewed',777,'VND',
                        CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)""")
                )
            upgrade_test_schema(self.app)
            with engine.begin() as connection:
                connection.execute(
                    text(
                        "SELECT set_config('app.is_system','true',true), set_config('app.is_service','true',true)"
                    )
                )
                quantities = dict(
                    connection.execute(text("SELECT id,room_count FROM subscriptions")).all()
                )
                self.assertEqual(quantities, {"finite": 10, "uncapped": 5, "free": 30})
                history = connection.execute(
                    text(
                        "SELECT amount,currency,room_count FROM subscription_history WHERE id='old-paid'"
                    )
                ).one()
                self.assertEqual(tuple(history), (Decimal("777.0000"), "VND", None))
            refused = runner.invoke(args=["db", "downgrade", "0014_manager_customers"])
            self.assertNotEqual(refused.exit_code, 0)
        finally:
            try:
                upgrade_test_schema(self.app)
            finally:
                engine.dispose()


class PlanQuotaValuesTests(unittest.TestCase):
    def test_registered_room_quantity_is_finite_even_on_uncapped_plan(self):
        plan = SimpleNamespace(
            id="custom",
            code="BUSINESS",
            name="Business",
            price=Decimal(100),
            price_year=None,
            currency="VND",
            max_rooms=None,
            max_users=None,
            features={},
            active=True,
            deleted=False,
        )
        value = {"plan": plan, "subscription": SimpleNamespace(room_count=10)}
        self.assertEqual(plan_code(plan), "BUSINESS")
        self.assertEqual(quota_limit(value, "rooms"), 10)
        plan.max_rooms = 8
        self.assertEqual(quota_limit(value, "rooms"), 8)
        plan.max_users = 3
        self.assertEqual(quota_limit(value, "users"), 3)
