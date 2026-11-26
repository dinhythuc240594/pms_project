"""System administration never implies permission to a hotel's PMS data."""

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from tests.domain_fixture import DomainTestCase
from tests.system_scope_fixture import grant_system_access


class SystemTenantScopeTests(DomainTestCase):
    system_accounts = ("admin", "manager")

    def booking(self, tenant_id, *, client=None, headers=None):
        suffix = tenant_id[-1]
        response = self.request(
            "POST",
            f"/api/tenants/{tenant_id}/reservations",
            {
                "guest": f"Private guest {suffix}",
                "phone": "0900000001" if suffix == "a" else "0900000002",
                "room": "101",
                "sourceId": f"direct-{suffix}",
                "checkIn": "2026-11-01",
                "checkOut": "2026-11-03",
            },
            client=client,
            headers=headers,
        )
        self.assertEqual(response.status_code, 201, response.json)
        return response.json

    def grant(self, user_id, role="HOUSEKEEPING"):
        grant_system_access(self, user_id, role=role)

    def test_unassigned_system_accounts_cannot_read_write_or_load_export_sources(self):
        booking = self.booking(self.tenant_id)
        for account in self.system_accounts:
            client, headers = self.login(f"{account}@test.local")
            session = client.get("/api/auth/session")
            self.assertEqual(session.status_code, 200, session.json)
            self.assertEqual(session.json["tenants"], [])
            for tenant_id in (self.tenant_id, self.other_tenant_id):
                prefix = f"/api/tenants/{tenant_id}"
                # Exports use the same report/workspace/invoice/audit HTTP sources
                # as the UI; format/query changes must not skip authorization.
                reads = (
                    "/workspace",
                    "/workspace?format=csv",
                    "/reservations",
                    f"/reservations/{booking['id']}",
                    "/cashbook",
                    "/pos/invoices",
                    "/reports/dashboard",
                    "/reports/revenue?start=2026-11-01&end=2026-11-04&format=csv",
                    "/reports/financial?start=2026-11-01&end=2026-11-04",
                    "/reports/business?start=2026-11-01&end=2026-11-04",
                    "/inventory/documents",
                    "/reconciliation/history",
                    "/audit?format=csv",
                    "/notifications",
                    "/housekeeping/tasks",
                    "/channels",
                    "/channels/jobs",
                )
                for path in reads:
                    with self.subTest(account=account, tenant=tenant_id, read=path):
                        response = client.get(prefix + path)
                        self.assertEqual(response.status_code, 403, response.json)
                        self.assertEqual(response.json["error"]["code"], "tenant_denied")
                        self.assertNotIn("Private guest", response.get_data(as_text=True))
                for method, path, data in (
                    ("POST", "/reservations", {}),
                    ("PATCH", f"/reservations/{booking['id']}", {}),
                    ("POST", f"/reservations/{booking['id']}/payments", {"amount": "100"}),
                    ("POST", "/cash-documents", {}),
                    ("PATCH", "/settings", {"name": "Unauthorized hotel rename"}),
                    ("POST", "/housekeeping/tasks", {"date": "2026-11-01"}),
                ):
                    with self.subTest(account=account, tenant=tenant_id, write=path):
                        response = self.request(
                            method, prefix + path, data, client=client, headers=headers
                        )
                        self.assertEqual(response.status_code, 403, response.json)
                        self.assertEqual(response.json["error"]["code"], "tenant_denied")
            # A valid SaaS action must not leave an elevated context for the next request.
            self.assertEqual(client.get("/api/tenants").status_code, 200)
            self.assertEqual(
                client.get(f"/api/tenants/{self.tenant_id}/workspace").status_code, 403
            )

    def test_legacy_membership_is_role_and_tenant_scoped_and_revoked_for_existing_session(self):
        booking = self.booking(self.tenant_id)
        for account in self.system_accounts:
            with self.subTest(account=account):
                client, headers = self.login(f"{account}@test.local")
                self.grant(account)
                session = client.get("/api/auth/session")
                self.assertEqual([row["id"] for row in session.json["tenants"]], [self.tenant_id])
                membership = next(
                    row
                    for row in session.json["user"]["memberships"]
                    if row["tenantId"] == self.tenant_id
                )
                self.assertEqual(membership["role"], "HOUSEKEEPING")
                workspace = client.get(f"/api/tenants/{self.tenant_id}/workspace")
                self.assertEqual(workspace.status_code, 200, workspace.json)
                redacted = next(
                    row for row in workspace.json["bookings"] if row["id"] == booking["id"]
                )
                self.assertNotIn("Private guest", workspace.get_data(as_text=True))
                self.assertEqual(redacted["guests"], [])
                self.assertEqual(redacted["history"], [])
                self.assertEqual(redacted["payments"], [])
                self.assertEqual(workspace.json["users"], [])
                for path in (
                    "/reservations",
                    "/cashbook",
                    "/reports/financial",
                    "/users",
                    "/audit",
                ):
                    response = client.get(f"/api/tenants/{self.tenant_id}{path}")
                    self.assertEqual(response.status_code, 403, response.json)
                    self.assertEqual(response.json["error"]["code"], "forbidden")
                response = client.get(f"/api/tenants/{self.other_tenant_id}/workspace")
                self.assertEqual(response.status_code, 403, response.json)
                self.assertEqual(response.json["error"]["code"], "tenant_denied")
                self.assertEqual(
                    self.request("PATCH", f"/users/{account}", {"role": "FRONT_DESK"}).status_code,
                    200,
                )
                response = client.get(f"/api/tenants/{self.tenant_id}/reservations/{booking['id']}")
                self.assertEqual(response.status_code, 200, response.json)
                self.assertEqual(response.json["guest"], "Private guest a")
                self.assertEqual(
                    self.request("PATCH", f"/users/{account}", {"active": False}).status_code, 200
                )
                self.assertEqual(client.get("/api/auth/session").json["tenants"], [])
                for method, path, data in (
                    ("GET", "/workspace", None),
                    ("GET", f"/reservations/{booking['id']}", None),
                    ("GET", "/notifications", None),
                    ("POST", f"/reservations/{booking['id']}/notes", {"text": "Revoked"}),
                ):
                    response = self.request(method, path, data, client=client, headers=headers)
                    self.assertEqual(response.status_code, 403, response.json)
                    self.assertEqual(response.json["error"]["code"], "tenant_denied")

    def test_owner_and_staff_keep_existing_permissions_and_cross_hotel_ids_are_hidden(self):
        booking_a = self.booking(self.tenant_id)
        owner_b, owner_b_headers = self.login("owner-b@test.local")
        booking_b = self.booking(self.other_tenant_id, client=owner_b, headers=owner_b_headers)
        for account, role in (
            ("frontdesk", "FRONT_DESK"),
            ("hk", "HOUSEKEEPING"),
            ("accountant", "ACCOUNTANT"),
        ):
            client, _ = self.login(f"{account}@test.local")
            response = client.get(f"/api/tenants/{self.tenant_id}/workspace")
            self.assertEqual(response.status_code, 200, response.json)
            self.assertNotIn("Private guest b", response.get_data(as_text=True))
            self.assertEqual(
                client.get(f"/api/tenants/{self.other_tenant_id}/workspace").status_code, 403
            )
            detail = client.get(f"/api/tenants/{self.tenant_id}/reservations/{booking_a['id']}")
            self.assertEqual(
                detail.status_code, 403 if role == "HOUSEKEEPING" else 200, detail.json
            )
            foreign = client.get(f"/api/tenants/{self.tenant_id}/reservations/{booking_b['id']}")
            self.assertEqual(
                foreign.status_code, 403 if role == "HOUSEKEEPING" else 404, foreign.json
            )
        self.assertEqual(self.client.get(f"/api/tenants/{self.tenant_id}/users").status_code, 200)

    def test_database_system_context_cannot_read_or_mutate_private_tenant_tables(self):
        booking = self.booking(self.tenant_id)
        payment = self.request(
            "POST",
            f"/reservations/{booking['id']}/payments",
            {"amount": "100", "methodId": "cash-a", "fundId": "fund-a"},
            key="private-ledger",
        )
        self.assertEqual(payment.status_code, 201, payment.json)
        with self.app.app_context():
            from pms_api.extensions import db

            for account in self.system_accounts:
                for tenant_id in ("", self.tenant_id, self.other_tenant_id):
                    with (
                        self.subTest(account=account, tenant=tenant_id),
                        db.engine.connect() as connection,
                    ):
                        connection.execute(
                            text(
                                "SELECT set_config('app.user_id',:actor,true), set_config('app.tenant_id',:tenant,true), set_config('app.is_system','true',true), set_config('app.is_service','false',true)"
                            ),
                            {"actor": account, "tenant": tenant_id},
                        )
                        for table in ("room_types", "reservations", "guests", "ledger_entries"):
                            rows = connection.execute(text(f'SELECT * FROM "{table}"')).all()
                            self.assertEqual(rows, [], table)
                        self.assertEqual(
                            connection.execute(
                                text("UPDATE room_types SET name='Intruder'")
                            ).rowcount,
                            0,
                        )
                        with self.assertRaises(DBAPIError) as caught:
                            connection.execute(
                                text(
                                    "INSERT INTO room_types(id,tenant_id,name,base_price,capacity,active) VALUES(:id,:tenant,'Intruder',1,2,true)"
                                ),
                                {"id": f"bad-{account}", "tenant": self.tenant_id},
                            )
                        self.assertEqual(caught.exception.orig.sqlstate, "42501")
                        connection.rollback()

    def test_database_system_accounts_cannot_insert_or_upgrade_their_own_membership(self):
        self.grant("admin")
        self.grant("manager")
        with self.app.app_context():
            from pms_api.extensions import db

            for account in self.system_accounts:
                with self.subTest(account=account), db.engine.connect() as connection:
                    connection.execute(
                        text(
                            "SELECT set_config('app.user_id',:actor,true), set_config('app.tenant_id',:tenant,true), set_config('app.is_system','true',true), set_config('app.is_service','false',true)"
                        ),
                        {"actor": account, "tenant": self.tenant_id},
                    )
                    self.assertEqual(
                        connection.execute(
                            text("UPDATE tenant_users SET role='HOTEL_OWNER' WHERE user_id=:actor"),
                            {"actor": account},
                        ).rowcount,
                        0,
                    )
                    with self.assertRaises(DBAPIError) as caught:
                        connection.execute(
                            text(
                                "INSERT INTO tenant_users(id,tenant_id,user_id,role,active) VALUES(:id,:tenant,:actor,'HOTEL_OWNER',true)"
                            ),
                            {
                                "id": f"self-grant-{account}",
                                "tenant": self.other_tenant_id,
                                "actor": account,
                            },
                        )
                    self.assertEqual(caught.exception.orig.sqlstate, "42501")
                    connection.rollback()

    def test_database_grant_and_revocation_apply_to_the_same_open_connection(self):
        for account in self.system_accounts:
            self.grant(account)
            with self.app.app_context():
                from pms_api.extensions import db

                with self.subTest(account=account), db.engine.connect() as connection:
                    connection.execute(
                        text(
                            "SELECT set_config('app.user_id',:actor,true), set_config('app.tenant_id',:tenant,true), set_config('app.is_system','true',true), set_config('app.is_service','false',true)"
                        ),
                        {"actor": account, "tenant": self.tenant_id},
                    )
                    self.assertEqual(
                        connection.execute(text("SELECT tenant_id FROM room_types"))
                        .scalars()
                        .all(),
                        [self.tenant_id],
                    )
                    connection.execute(
                        text("SELECT set_config('app.tenant_id',:tenant,true)"),
                        {"tenant": self.other_tenant_id},
                    )
                    self.assertEqual(connection.execute(text("SELECT * FROM room_types")).all(), [])
                    connection.execute(
                        text("SELECT set_config('app.tenant_id',:tenant,true)"),
                        {"tenant": self.tenant_id},
                    )
                    revoked = self.request("PATCH", f"/users/{account}", {"active": False})
                    self.assertEqual(revoked.status_code, 200, revoked.json)
                    self.assertEqual(connection.execute(text("SELECT * FROM room_types")).all(), [])
                    self.assertEqual(
                        connection.execute(text("UPDATE room_types SET name='Revoked'")).rowcount, 0
                    )
                    connection.rollback()

    def test_saas_helpers_restore_context_and_cannot_provision_an_existing_hotel(self):
        with self.app.app_context():
            from pms_api.extensions import db

            for account in self.system_accounts:
                with self.subTest(account=account), db.engine.connect() as connection:
                    connection.execute(
                        text(
                            "SELECT set_config('app.user_id',:actor,true), "
                            "set_config('app.tenant_id','',true), "
                            "set_config('app.is_system','true',true), "
                            "set_config('app.is_service','false',true)"
                        ),
                        {"actor": account},
                    )
                    self.assertEqual(
                        connection.execute(
                            text("SELECT pms_room_quota_used(:tenant)"), {"tenant": self.tenant_id}
                        ).scalar_one(),
                        2,
                    )
                    new_tenant = f"provision-scope-{account}"
                    connection.execute(
                        text(
                            "INSERT INTO tenants(id,name,status,settings,created_at) "
                            "VALUES(:tenant,'Provisioning test','active','{}'::jsonb,now())"
                        ),
                        {"tenant": new_tenant},
                    )
                    connection.execute(
                        text("SELECT pms_provision_units(:tenant)"), {"tenant": new_tenant}
                    )
                    self.assertEqual(
                        connection.execute(
                            text("SELECT current_setting('app.is_service')")
                        ).scalar_one(),
                        "false",
                    )
                    for tenant_id in (self.tenant_id, "nonexistent-hotel"):
                        with self.assertRaises(DBAPIError), connection.begin_nested():
                            connection.execute(
                                text("SELECT pms_provision_units(:tenant)"), {"tenant": tenant_id}
                            )
                        self.assertEqual(
                            connection.execute(
                                text("SELECT current_setting('app.is_service')")
                            ).scalar_one(),
                            "false",
                        )
                    self.assertEqual(connection.execute(text("SELECT * FROM masters")).all(), [])
                    self.assertEqual(connection.execute(text("SELECT * FROM room_types")).all(), [])
                    connection.execute(
                        text("SELECT set_config('app.user_id',:actor,true)"),
                        {"actor": self.owner_id},
                    )
                    with self.assertRaises(DBAPIError), connection.begin_nested():
                        connection.execute(
                            text("SELECT pms_room_quota_used(:tenant)"), {"tenant": self.tenant_id}
                        )
                    self.assertEqual(
                        connection.execute(
                            text("SELECT current_setting('app.is_service')")
                        ).scalar_one(),
                        "false",
                    )
                    connection.rollback()

    def test_authorization_migration_round_trip_preserves_bookings_and_owner_grants(self):
        booking = self.booking(self.tenant_id)
        self.grant("manager", "FRONT_DESK")
        memberships = self.request("GET", "/users").json
        detail = self.request("GET", f"/reservations/{booking['id']}").json
        runner = self.app.test_cli_runner()
        self.addCleanup(lambda: runner.invoke(args=["db", "upgrade"]))
        downgraded = runner.invoke(args=["db", "downgrade", "0033_merge_room_history"])
        self.assertEqual(downgraded.exit_code, 0, downgraded.output)
        upgraded = runner.invoke(args=["db", "upgrade"])
        self.assertEqual(upgraded.exit_code, 0, upgraded.output)
        self.assertEqual(self.request("GET", "/users").json, memberships)
        self.assertEqual(self.request("GET", f"/reservations/{booking['id']}").json, detail)
        manager, _ = self.login("manager@test.local")
        response = manager.get(f"/api/tenants/{self.tenant_id}/reservations/{booking['id']}")
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json, detail)
        admin, _ = self.login("admin@test.local")
        self.assertEqual(admin.get(f"/api/tenants/{self.tenant_id}/workspace").status_code, 403)
        with self.app.app_context():
            from pms_api.extensions import db

            with db.engine.connect() as connection:
                connection.execute(
                    text(
                        "SELECT set_config('app.user_id','admin',true), "
                        "set_config('app.tenant_id',:tenant,true), "
                        "set_config('app.is_system','true',true), "
                        "set_config('app.is_service','false',true)"
                    ),
                    {"tenant": self.tenant_id},
                )
                self.assertEqual(connection.execute(text("SELECT * FROM reservations")).all(), [])
