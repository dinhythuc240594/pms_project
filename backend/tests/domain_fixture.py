"""Disposable real PostgreSQL fixture. Never operates on the user's local database."""

import os
import unittest
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import text
from werkzeug.security import generate_password_hash

from pms_api import create_app
from pms_api.config import postgres_url
from pms_api.core_models import Tenant, TenantUser, User
from pms_api.extensions import db
from pms_api.security import set_context
from tests.schema_fixture import upgrade_test_schema

TEST_PASSWORD = "Fixture-password-2026!"


class DomainTestCase(unittest.TestCase):
    tenant_id = "test-hotel-a"
    other_tenant_id = "test-hotel-b"
    owner_id = "owner-a"

    @classmethod
    def setUpClass(cls):
        runtime, migration = (
            os.environ.get("TEST_DATABASE_URL"),
            os.environ.get("TEST_DATABASE_MIGRATION_URL"),
        )
        if not runtime or not migration:
            raise unittest.SkipTest("Set both dedicated PostgreSQL test URLs.")
        urls = [postgres_url(v) for v in (runtime, migration)]
        targets = [(u.host, u.port or 5432, u.database) for u in urls]
        overrides = {"host", "hostaddr", "port", "dbname", "database", "service", "servicefile"}
        if (
            targets[0] != targets[1]
            or not urls[0].database.startswith("pms_test_")
            or any(overrides.intersection(u.query) for u in urls)
        ):
            raise ValueError("Domain tests require one dedicated pms_test_ database.")
        cls.app = create_app(
            {"APP_ENV": "testing", "DATABASE_URL": runtime, "DATABASE_MIGRATION_URL": migration},
            env_file=None,
        )
        upgrade_test_schema(cls.app)

    @classmethod
    def tearDownClass(cls):
        with cls.app.app_context():
            db.session.remove()
            db.engine.dispose()
        super().tearDownClass()

    def setUp(self):
        from sqlalchemy import create_engine

        from pms_api.catalog.models import Master, PhysicalRoom, RoomType

        engine = create_engine(self.app.config["DATABASE_MIGRATION_URL"], hide_parameters=True)
        try:
            with engine.begin() as connection:
                tables = ",".join('"' + t.name + '"' for t in db.metadata.sorted_tables)
                connection.execute(text(f"TRUNCATE {tables} CASCADE"))
        finally:
            engine.dispose()
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            hashed = generate_password_hash(TEST_PASSWORD)
            for key, role in [
                ("owner-a", "USER"),
                ("owner-b", "USER"),
                ("frontdesk", "USER"),
                ("hk", "USER"),
                ("accountant", "USER"),
                ("admin", "SUPER_ADMIN"),
                ("manager", "SYSTEM_MANAGER"),
            ]:
                db.session.add(
                    User(
                        id=key,
                        name=key,
                        email=f"{key}@test.local",
                        password_hash=hashed,
                        global_role=role,
                    )
                )
            for suffix in ("a", "b"):
                db.session.add(Tenant(id=f"test-hotel-{suffix}", name=f"Hotel {suffix}"))
            db.session.flush()
            for user_id, tenant, role in [
                ("owner-a", self.tenant_id, "HOTEL_OWNER"),
                ("owner-b", self.other_tenant_id, "HOTEL_OWNER"),
                ("frontdesk", self.tenant_id, "FRONT_DESK"),
                ("hk", self.tenant_id, "HOUSEKEEPING"),
                ("accountant", self.tenant_id, "ACCOUNTANT"),
            ]:
                db.session.add(TenantUser(tenant_id=tenant, user_id=user_id, role=role))
            for suffix in ("a", "b"):
                tenant = f"test-hotel-{suffix}"
                db.session.add(
                    RoomType(
                        id=f"rt-{suffix}",
                        tenant_id=tenant,
                        name="Standard",
                        base_price=Decimal("100.0000"),
                        capacity=2,
                    )
                )
                for catalog, key, name in [
                    ("bookingSources", "direct", "Direct"),
                    ("paymentMethods", "cash", "Cash"),
                    ("funds", "fund", "Cash fund"),
                    ("services", "service", "Breakfast"),
                ]:
                    db.session.add(
                        Master(
                            id=f"{key}-{suffix}",
                            tenant_id=tenant,
                            catalog=catalog,
                            name=name,
                            data={"type": "cash"}
                            if catalog == "funds"
                            else {"price": "20"}
                            if catalog == "services"
                            else {},
                        )
                    )
            db.session.flush()

            import datetime

            from pms_api.core_models import Plan, Subscription, utcnow

            db.session.add(
                Plan(
                    id="default-pro",
                    name="Pro",
                    code="PRO",
                    price=100,
                    currency="VND",
                    max_rooms=100,
                    active=True,
                    features={"POS_SALES": True},
                )
            )
            db.session.flush()
            for suffix in ("a", "b"):
                db.session.add(
                    Subscription(
                        id=f"sub-{suffix}",
                        tenant_id=f"test-hotel-{suffix}",
                        plan_id="default-pro",
                        status="active",
                        start_date=utcnow(),
                        end_date=utcnow() + datetime.timedelta(days=365),
                        room_count=100,
                    )
                )
            db.session.flush()
            for suffix in ("a", "b"):
                for number in ("101", "102"):
                    db.session.add(
                        PhysicalRoom(
                            id=f"room-{suffix}-{number}",
                            tenant_id=f"test-hotel-{suffix}",
                            room_type_id=f"rt-{suffix}",
                            number=number,
                        )
                    )
            db.session.commit()
        self.client, self.headers = self.login()

    def login(self, email="owner-a@test.local", password=TEST_PASSWORD):
        client = self.app.test_client()
        result = client.post("/api/auth/login", json={"email": email, "password": password})
        self.assertEqual(result.status_code, 200, result.json)
        return client, {"X-CSRF-Token": result.json["csrfToken"]}

    def request(self, method, path, json=None, client=None, headers=None, key=None):
        if not path.startswith("/api/"):
            path = f"/api/tenants/{self.tenant_id}{path}"
        extra = dict(self.headers if headers is None else headers)
        if key:
            extra["Idempotency-Key"] = key
        if method.upper() == "POST" and path.endswith("/reservations"):
            # Each legacy fixture call represents a distinct booking intent.
            extra.setdefault("Idempotency-Key", str(uuid4()))
        # Legacy workflow fixtures act on the latest form. Version-contract tests use raw HTTP.
        parts = path.split("/")
        booking_mutation = (
            len(parts) >= 6
            and parts[4] == "reservations"
            and (
                method.upper() == "PATCH"
                and len(parts) == 6
                or method.upper() == "POST"
                and len(parts) == 7
                and parts[6] == "status"
            )
        )
        if booking_mutation and isinstance(json, dict) and "expectedVersion" not in json:
            detail_path = "/".join(parts[:6])
            detail = (client or self.client).get(detail_path, headers=extra)
            if detail.status_code == 200:
                json = {**json, "expectedVersion": detail.json["version"]}
        return (client or self.client).open(path, method=method.upper(), json=json, headers=extra)
