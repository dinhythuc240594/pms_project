"""BE09 acceptance requirements on a disposable PostgreSQL database; no production fixes."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError

from pms_api.catalog.models import PhysicalRoom
from pms_api.core_models import Plan, Subscription, SubscriptionHistory, utcnow
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class SubscriptionAcceptanceTests(DomainTestCase):
    def seed_subscriptions(
        self, *, features=None, max_rooms=None, status="active", end_date=None, plan_active=True
    ):
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            db.session.add_all(
                [
                    Plan(
                        id="acceptance-free",
                        name="Miễn Phí",
                        price=Decimal("0"),
                        currency="VND",
                        max_rooms=max_rooms if max_rooms is not None else 30,
                        features={"POS_SALES": False},
                    ),
                    Plan(
                        id="acceptance-pro",
                        name="Chuyên Nghiệp",
                        price=Decimal("2500000"),
                        currency="VND",
                        max_rooms=None,
                        active=plan_active,
                        features=features if features is not None else {"POS_SALES": True},
                    ),
                ]
            )
            db.session.flush()
            db.session.execute(text("DELETE FROM subscription_history"))
            db.session.execute(text("DELETE FROM subscriptions"))
            db.session.flush()
            for suffix, tenant_id in (("a", self.tenant_id), ("b", self.other_tenant_id)):
                db.session.add(
                    Subscription(
                        id="acceptance-sub-" + suffix,
                        tenant_id=tenant_id,
                        plan_id="acceptance-free"
                        if suffix == "a" and max_rooms is not None
                        else "acceptance-pro",
                        status=status if suffix == "a" else "active",
                        end_date=end_date if suffix == "a" else None,
                        start_date=utcnow() - timedelta(days=30),
                        room_count=max_rooms if max_rooms is not None else 30,
                    )
                )
                db.session.add(
                    SubscriptionHistory(
                        id="acceptance-history-" + suffix,
                        tenant_id=tenant_id,
                        plan_id="acceptance-pro",
                        action="seed_subscription",
                        amount=Decimal("2500000"),
                        currency="VND",
                        user_id="admin",
                    )
                )
            db.session.commit()

    def subscription_api(self, method, data=None, *, client=None, headers=None):
        if client is None:
            client, headers = self.login("admin@test.local")
        return self.request(
            method,
            f"/api/tenants/{self.tenant_id}/subscription",
            data,
            client=client,
            headers=headers,
        )

    def create_pos(self):
        return self.request(
            "POST",
            "/pos/invoices",
            {
                "customerName": "Entitlement test",
                "items": [{"serviceId": "service-a", "quantity": "1"}],
            },
            key="subscription-pos-acceptance",
        )

    def test_admin_subscription_access_and_tenant_suspension_controls(self):
        self.seed_subscriptions()
        self.assertEqual(self.request("GET", "/api/plans").status_code, 403)
        self.assertEqual(self.request("GET", "/subscription").status_code, 403)
        self.assertEqual(
            self.request("PUT", "/subscription", {"planId": "acceptance-free"}).status_code, 403
        )
        manager, manager_headers = self.login("manager@test.local")
        self.assertEqual(
            self.request(
                "POST",
                "/api/plans",
                {"name": "Not allowed"},
                client=manager,
                headers=manager_headers,
            ).status_code,
            403,
        )
        admin, headers = self.login("admin@test.local")
        plans = self.request("GET", "/api/plans", client=admin, headers=headers)
        self.assertEqual(plans.status_code, 200, plans.json)
        self.assertEqual(
            {row["name"] for row in plans.json["plans"]}, {"Miễn Phí", "Chuyên Nghiệp", "Pro"}
        )
        self.assertEqual(
            self.subscription_api("GET", client=admin, headers=headers).status_code, 200
        )
        response = self.request(
            "PATCH",
            f"/api/tenants/{self.tenant_id}",
            {"status": "suspended"},
            client=admin,
            headers=headers,
        )
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(self.create_pos().status_code, 403)
        self.assertEqual(self.request("GET", "/workspace").status_code, 200)

    def test_custom_third_plan_is_supported(self):
        self.seed_subscriptions()
        admin, headers = self.login("admin@test.local")
        response = self.request(
            "POST",
            "/api/plans",
            {
                "name": "Third plan",
                "code": "THIRD",
                "price": "1",
                "currency": "VND",
                "active": True,
            },
            client=admin,
            headers=headers,
        )
        self.assertEqual(response.status_code, 201, response.json)
        self.assertEqual(response.json["code"], "THIRD")

    def test_plan_financial_and_quota_inputs_are_validated(self):
        admin, headers = self.login("admin@test.local")
        for field, value in (
            ("price", "-1"),
            ("price", "NaN"),
            ("price", "Infinity"),
            ("maxRooms", -1),
            ("maxUsers", True),
            ("currency", "ZZZ"),
            ("features", ["untyped-feature"]),
        ):
            with self.subTest(field=field, value=value):
                response = self.request(
                    "POST",
                    "/api/plans",
                    {
                        "name": "Invalid plan",
                        "code": "PRO",
                        "price": "2500000",
                        "currency": "VND",
                        field: value,
                    },
                    client=admin,
                    headers=headers,
                )
                self.assertEqual(response.status_code, 422, response.json)

    def test_disabled_feature_is_enforced_on_direct_api_writes(self):
        self.seed_subscriptions(features={"POS_SALES": False})
        self.assertFalse(self.request("GET", "/workspace").json["features"]["POS_SALES"])
        response = self.create_pos()
        self.assertEqual(response.status_code, 403, response.json)

    def test_expired_end_date_does_not_grant_active_plan_features(self):
        self.seed_subscriptions(end_date=utcnow() - timedelta(days=1))
        workspace = self.request("GET", "/workspace")
        self.assertEqual(workspace.status_code, 200, workspace.json)
        self.assertFalse(workspace.json["features"].get("POS_SALES", False))

    def test_expired_subscription_cannot_use_direct_paid_feature_api(self):
        self.seed_subscriptions(status="expired")
        response = self.create_pos()
        self.assertEqual(response.status_code, 403, response.json)

    def test_inactive_plan_is_not_granted_to_tenant_workspace(self):
        self.seed_subscriptions(plan_active=False)
        workspace = self.request("GET", "/workspace")
        self.assertEqual(workspace.status_code, 200, workspace.json)
        self.assertFalse(workspace.json["features"].get("POS_SALES", False))

    def test_room_quota_is_checked_on_direct_catalog_api(self):
        self.seed_subscriptions(max_rooms=2)
        response = self.request("POST", "/masters/rooms", {"number": "103", "typeId": "rt-a"})
        self.assertEqual(response.status_code, 409, response.json)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(db.session.scalar(select(func.count()).select_from(PhysicalRoom)), 2)

    def test_concurrent_room_creations_cannot_exceed_subscription_quota(self):
        self.seed_subscriptions(max_rooms=3)
        clients = [self.login(), self.login()]

        def create(index):
            client, headers = clients[index]
            return self.request(
                "POST",
                "/masters/rooms",
                {"number": str(103 + index), "typeId": "rt-a"},
                client=client,
                headers=headers,
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(create, range(2)))
        self.assertEqual(sorted(response.status_code for response in responses), [201, 409])

    def test_free_plan_five_account_limit_is_enforced(self):
        # Shared pricing advertises five accounts for Free; fixture tenant already has four.
        self.seed_subscriptions(max_rooms=30)
        for index, expected_status in ((5, 201), (6, 409)):
            response = self.request(
                "POST",
                "/users",
                {
                    "name": f"Free account {index}",
                    "email": f"free-account-{index}@test.local",
                    "password": "Fixture-password-2026!",
                    "role": "FRONT_DESK",
                    "active": True,
                },
            )
            self.assertEqual(response.status_code, expected_status, response.json)

    def test_room_reactivation_and_bulk_room_type_cannot_bypass_quota(self):
        self.seed_subscriptions(max_rooms=2)
        self.assertEqual(self.request("POST", "/masters/rooms/102/toggle").status_code, 200)
        self.assertEqual(
            self.request("POST", "/masters/rooms", {"number": "103", "typeId": "rt-a"}).status_code,
            201,
        )
        response = self.request("POST", "/masters/rooms/102/toggle")
        self.assertEqual(response.status_code, 409, response.json)
        response = self.request(
            "PATCH", "/masters/roomTypes", {"id": "rt-a", "roomNumbers": ["101", "102", "103"]}
        )
        self.assertEqual(response.status_code, 409, response.json)
        # Replacing one active room with one inactive room remains within the quota.
        response = self.request(
            "PATCH", "/masters/roomTypes", {"id": "rt-a", "roomNumbers": ["101", "102"]}
        )
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(
            self.request("GET", "/workspace").json["quota"]["rooms"], {"used": 2, "limit": 2}
        )

    def test_expired_subscription_preserves_reads_but_blocks_all_writes(self):
        self.seed_subscriptions(end_date=utcnow() - timedelta(days=1))
        for path in ("/workspace", "/reports/dashboard?date=2026-10-05", "/pos/invoices"):
            response = self.request("GET", path)
            self.assertEqual(response.status_code, 200, response.json)
        response = self.request("POST", "/masters/rooms", {"number": "103", "typeId": "rt-a"})
        self.assertEqual(response.status_code, 403, response.json)
        self.assertEqual(response.json["error"]["code"], "subscription_inactive")

    def test_account_reactivation_obeys_quota_and_deactivation_frees_a_slot(self):
        self.seed_subscriptions(max_rooms=30)
        accounts = []
        for index, active in ((1, False), (2, True)):
            response = self.request(
                "POST",
                "/users",
                {
                    "name": f"Quota account {index}",
                    "email": f"quota-{index}@test.local",
                    "password": "Fixture-password-2026!",
                    "role": "FRONT_DESK",
                    "active": active,
                },
            )
            self.assertEqual(response.status_code, 201, response.json)
            accounts.append(response.json["id"])
        self.assertEqual(
            self.request("PATCH", "/users/" + accounts[0], {"active": True}).status_code, 409
        )
        self.assertEqual(
            self.request("PATCH", "/users/" + accounts[1], {"active": False}).status_code, 200
        )
        self.assertEqual(
            self.request("PATCH", "/users/" + accounts[0], {"active": True}).status_code, 200
        )
        self.assertEqual(
            self.request("GET", "/workspace").json["quota"]["users"], {"used": 5, "limit": 5}
        )

    def test_invalid_subscription_term_payment_and_cycle_roll_back_history(self):
        end = utcnow() + timedelta(days=30)
        self.seed_subscriptions(end_date=end)
        admin, headers = self.login("admin@test.local")
        for override in (
            {"endDate": "not-a-date"},
            {"endDate": "2026-02-30T00:00:00Z"},
            {"endDate": "2028-01-01T00:00:00"},
            {"endDate": None},
            {"startDate": (end + timedelta(days=1)).isoformat()},
            {"amount": "NaN"},
            {"amount": "-1"},
            {"currency": "USD"},
            {"cycle": []},
            {"cycle": {}},
            {"cycle": "daily"},
        ):
            with self.subTest(override=override):
                response = self.subscription_api(
                    "PUT",
                    {
                        "planId": "acceptance-pro",
                        "status": "active",
                        **override,
                    },
                    client=admin,
                    headers=headers,
                )
                self.assertEqual(response.status_code, 422, response.json)
        current = self.subscription_api("GET", client=admin, headers=headers).json
        self.assertEqual(datetime.fromisoformat(current["subscription"]["endDate"]), end)
        self.assertEqual(len(current["history"]), 1)

    def test_renewal_and_room_creation_use_consistent_lock_order(self):
        self.seed_subscriptions(max_rooms=3)
        admin, headers = self.login("admin@test.local")
        owner, owner_headers = self.login()
        with ThreadPoolExecutor(max_workers=2) as pool:
            renewal = pool.submit(
                self.subscription_api,
                "PUT",
                {
                    "planId": "acceptance-free",
                    "endDate": (utcnow() + timedelta(days=30)).isoformat(),
                },
                client=admin,
                headers=headers,
            )
            creation = pool.submit(
                self.request,
                "POST",
                "/masters/rooms",
                {
                    "number": "103",
                    "typeId": "rt-a",
                },
                client=owner,
                headers=owner_headers,
            )
            self.assertEqual(renewal.result(timeout=15).status_code, 200)
            self.assertEqual(creation.result(timeout=15).status_code, 201)

    def test_disabled_features_block_reads_and_dashboard_financial_data(self):
        self.seed_subscriptions(features={"POS_SALES": False, "REPORTS_BASIC": False})
        self.assertEqual(self.request("GET", "/pos/invoices").status_code, 403)
        self.assertEqual(
            self.request("GET", "/reports/financial?start=2026-10-01&end=2026-10-06").status_code,
            403,
        )
        dashboard = self.request("GET", "/reports/dashboard?date=2026-10-05")
        self.assertEqual(dashboard.status_code, 200, dashboard.json)
        self.assertIsNone(dashboard.json["financial"])
        self.assertTrue(all("roomRevenue" not in row for row in dashboard.json["chart"]))

    def test_subscription_renewal_persists_requested_end_date(self):
        old_end = utcnow() - timedelta(days=1)
        new_end = utcnow() + timedelta(days=30)
        self.seed_subscriptions(status="expired", end_date=old_end)
        response = self.subscription_api(
            "PUT",
            {
                "planId": "acceptance-pro",
                "status": "active",
                "endDate": new_end.isoformat(),
                "amount": "2500000.0000",
                "currency": "VND",
            },
        )
        self.assertEqual(response.status_code, 200, response.json)
        current = self.subscription_api("GET")
        self.assertEqual(datetime.fromisoformat(current.json["subscription"]["endDate"]), new_end)

    def test_renewal_history_preserves_amount_currency_and_term(self):
        new_end = utcnow() + timedelta(days=30)
        self.seed_subscriptions()
        response = self.subscription_api(
            "PUT",
            {
                "planId": "acceptance-pro",
                "status": "active",
                "endDate": new_end.isoformat(),
                "amount": "2500000.0000",
                "currency": "VND",
            },
        )
        self.assertEqual(response.status_code, 200, response.json)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            history = db.session.scalar(
                select(SubscriptionHistory).where(
                    SubscriptionHistory.tenant_id == self.tenant_id,
                    SubscriptionHistory.action == "renewed",
                )
            )
            self.assertIsNotNone(history)
            self.assertEqual(history.amount, Decimal("2500000.0000"))
            self.assertEqual(history.currency, "VND")
            self.assertEqual(history.end_date, new_end)

    def test_runtime_subscription_rls_hides_other_tenant(self):
        self.seed_subscriptions()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertIsNone(db.session.get(Subscription, "acceptance-sub-b"))

    def test_runtime_subscription_history_rls_hides_other_tenant(self):
        self.seed_subscriptions()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertIsNone(db.session.get(SubscriptionHistory, "acceptance-history-b"))

    def test_runtime_cannot_rewrite_another_tenant_subscription(self):
        self.seed_subscriptions()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            result = db.session.execute(
                text("UPDATE subscriptions SET status='cancelled' WHERE id='acceptance-sub-b'")
            )
            self.assertEqual(result.rowcount, 0)
            db.session.rollback()

    def test_subscription_history_is_append_only(self):
        self.seed_subscriptions()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            with self.assertRaises(DBAPIError):
                db.session.execute(
                    text("UPDATE subscription_history SET amount=1 WHERE id='acceptance-history-a'")
                )
            db.session.rollback()
