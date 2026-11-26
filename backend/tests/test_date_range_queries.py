"""Query spelling must not change date bounds, business calendars or signed cursors."""

import unittest
from datetime import UTC, date, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import UUID

from flask import Flask, g
from sqlalchemy.sql import operators, visitors
from sqlalchemy.sql.elements import BinaryExpression

from common import ApiError, RequestData
from pms_api.admin import channex_insights
from pms_api.admin import routes as admin
from pms_api.catalog import routes as catalog
from pms_api.channels import history, preview
from pms_api.finance import commissions
from pms_api.finance import routes as finance
from pms_api.housekeeping.routes import calendar_range
from pms_api.inventory import routes as inventory
from pms_api.reports.routes import report_period
from pms_api.saas_billing import routes as billing

START, END = "2026-11-01", "2026-12-01"
START_DAY, END_DAY = date(2026, 11, 1), date(2026, 12, 1)


def queries(aliases=("start", "end")):
    return (
        {"start_date": START, "end_date": END},
        {aliases[0]: START, aliases[1]: END},
        {"start_date": START, "end_date": END, aliases[0]: START, aliases[1]: END},
    )


class DateRangeQueryTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)

    def assert_sql_bounds(self, statement, start, end, end_operator):
        comparisons = [
            node for node in visitors.iterate(statement) if isinstance(node, BinaryExpression)
        ]
        self.assertTrue(
            any(
                node.operator is operators.ge and getattr(node.right, "value", None) == start
                for node in comparisons
            )
        )
        self.assertTrue(
            any(
                node.operator is end_operator and getattr(node.right, "value", None) == end
                for node in comparisons
            )
        )

    def test_raw_bounds_support_canonical_and_each_existing_alias_family(self):
        for aliases in (("start", "end"), ("startDate", "endDate"), ("dateFrom", "dateTo")):
            for query in queries(aliases):
                with self.subTest(query=query), self.app.test_request_context(query_string=query):
                    self.assertEqual(RequestData.date_range(aliases=aliases), (START, END))
        with self.app.test_request_context():
            self.assertEqual(RequestData.date_range(), (None, None))
        with self.app.test_request_context("/?start_date=&end_date="):
            self.assertEqual(RequestData.date_range(), ("", ""))
        with self.app.test_request_context(
            query_string={"start_date": "2026-11-01T07:00:00+07:00"}
        ):
            self.assertEqual(RequestData.date_range(), ("2026-11-01T07:00:00+07:00", None))

    def test_repeated_keys_and_conflicting_aliases_reject_ambiguous_ranges(self):
        for aliases in (("start", "end"), ("startDate", "endDate"), ("dateFrom", "dateTo")):
            for key in ("start_date", "end_date", *aliases):
                for values in ((START, START), (START, END)):
                    with (
                        self.subTest(key=key, values=values),
                        self.app.test_request_context(
                            query_string=[(key, value) for value in values]
                        ),
                        self.assertRaises(ApiError) as caught,
                    ):
                        RequestData.date_range(aliases=aliases)
                    self.assertEqual(
                        (caught.exception.status, caught.exception.code), (422, "invalid_dates")
                    )
            for query in (
                {"start_date": START, aliases[0]: END},
                {"end_date": END, aliases[1]: START},
                {"start_date": "", aliases[0]: START},
            ):
                with (
                    self.subTest(query=query),
                    self.app.test_request_context(query_string=query),
                    self.assertRaises(ApiError) as caught,
                ):
                    RequestData.date_range(aliases=aliases)
                self.assertEqual(caught.exception.code, "invalid_dates")

    def test_saas_window_keeps_utc_month_and_optional_defaults(self):
        expected = (datetime(2026, 11, 1, tzinfo=UTC), datetime(2026, 12, 1, tzinfo=UTC))
        for query in queries():
            with self.subTest(query=query), self.app.test_request_context(query_string=query):
                self.assertEqual(billing.window(), expected)
        with (
            self.app.test_request_context(),
            patch.object(billing, "utcnow", return_value=datetime(2026, 11, 15, tzinfo=UTC)),
        ):
            self.assertEqual(billing.window(default_month=True), expected)
            self.assertEqual(billing.window(), (None, None))
        with self.app.test_request_context("/?start_date="), self.assertRaises(ApiError):
            billing.window(default_month=True)

    def test_report_and_housekeeping_parsers_receive_the_selected_month(self):
        for query in queries():
            with self.subTest(query=query), self.app.test_request_context(query_string=query):
                self.assertEqual(report_period(), (START_DAY, END_DAY))
                self.assertEqual(calendar_range(), (START_DAY, END_DAY))
        with self.app.test_request_context(query_string={**queries()[0], "date": START}):
            with self.assertRaises(ApiError) as caught:
                calendar_range()
            self.assertEqual(caught.exception.code, "invalid_range")

    def test_rates_and_availability_keep_the_end_date_exclusive(self):
        room = SimpleNamespace(id="room-type", base_price=Decimal(100))
        for view, key in (
            (catalog.RatesRouteView, "rates"),
            (catalog.AvailabilityRouteView, "availability"),
        ):
            for query in queries():
                with (
                    self.subTest(view=view.__name__, query=query),
                    self.app.test_request_context(query_string=query),
                    patch.object(catalog, "db") as database,
                    patch.object(catalog, "capacity_for", return_value=2),
                ):
                    database.session.scalars.side_effect = [[room], [], []]
                    result = view.dispatch_request.__wrapped__("hotel")[key]
                self.assertEqual(len(result), 30)
                self.assertEqual((result[0]["date"], result[-1]["date"]), (START, "2026-11-30"))

    def test_inventory_document_and_stock_bounds_remain_inclusive(self):
        for query in queries():
            with (
                self.subTest(query=query),
                self.app.test_request_context(query_string=query),
                patch.object(inventory, "db") as database,
            ):
                database.session.scalar.return_value = 0
                database.session.scalars.return_value = []
                inventory.ListDocumentsView.dispatch_request.__wrapped__("hotel")
                self.assert_sql_bounds(
                    database.session.scalar.call_args.args[0], START_DAY, END_DAY, operators.le
                )
            with (
                self.app.test_request_context(query_string=query),
                patch.object(inventory, "stock_report", return_value={"rows": []}) as stock_report,
            ):
                inventory.GetStockView.dispatch_request.__wrapped__("hotel")
                stock_report.assert_called_once_with("hotel", None, START_DAY, END_DAY)

    def test_cashbook_uses_inclusive_canonical_bounds_and_keeps_opening_balance(self):
        rows = [
            SimpleNamespace(booked_at=day, amount=Decimal(10), cash_document_id=None)
            for day in (
                date(2026, 10, 31),
                START_DAY,
                END_DAY,
                date(2026, 12, 2),
            )
        ]
        for query in queries(("startDate", "endDate")):
            with (
                self.subTest(query=query),
                self.app.test_request_context(query_string=query),
                patch.object(finance, "db") as database,
                patch.object(
                    finance, "ledger_json", side_effect=lambda row: {"date": str(row.booked_at)}
                ),
            ):
                g.tenant = SimpleNamespace(settings={"currency": "VND"})
                database.session.scalars.side_effect = [rows, [], []]
                result = finance.CashbookView.dispatch_request.__wrapped__("hotel")
            self.assertEqual(result["ledger"], [{"date": END}, {"date": START}])
            self.assertEqual(
                result["summary"],
                {
                    "opening": "10.0000",
                    "income": "20.0000",
                    "outflow": "0.0000",
                    "closing": "30.0000",
                    "currency": "VND",
                    "startDate": START,
                    "endDate": END,
                },
            )

    def test_commission_sql_keeps_inclusive_business_dates(self):
        for query in queries(("startDate", "endDate")):
            with (
                self.subTest(query=query),
                self.app.test_request_context(query_string=query),
                patch.object(commissions, "db") as database,
                patch.object(commissions, "review_booking_ids", return_value=set()),
                patch.object(commissions, "commission_json", return_value=[]),
            ):
                g.tenant = SimpleNamespace(settings={"currency": "VND"})
                # SQLAlchemy expressions still use the real Date type; only the session is mocked.
                database.Date = finance.db.Date
                database.session.execute.side_effect = [
                    SimpleNamespace(one=lambda: (0, Decimal(0), Decimal(0))),
                    [],
                ]
                commissions.ListCommissionsView.dispatch_request.__wrapped__("hotel")
                self.assert_sql_bounds(
                    database.session.execute.call_args_list[0].args[0],
                    START_DAY,
                    END_DAY,
                    operators.le,
                )

    def test_audit_allows_canonical_timestamp_bounds_without_changing_timezone(self):
        start, end = "2026-11-01T07:00:00+07:00", "2026-12-01T07:00:00+07:00"
        for query in ({"start_date": start, "end_date": end}, {"start": start, "end": end}):
            with (
                self.subTest(query=query),
                self.app.test_request_context(query_string=query),
                patch.object(admin, "db") as database,
            ):
                database.session.scalar.return_value = 0
                database.session.scalars.return_value.all.return_value = []
                database.session.execute.return_value.all.return_value = []
                admin.audit_response()
                self.assert_sql_bounds(
                    database.session.scalar.call_args.args[0],
                    datetime.fromisoformat(start),
                    datetime.fromisoformat(end),
                    operators.lt,
                )
        with self.app.test_request_context(query_string=queries()[0]), self.assertRaises(ApiError):
            admin.audit_response()

    def test_remote_inventory_preserves_inclusive_provider_filters(self):
        property_id = str(UUID(int=1))
        for query in queries():
            client = Mock()
            client._request.return_value = {"data": {}}
            with (
                self.subTest(query=query),
                self.app.test_request_context(query_string=query),
                patch.object(channex_insights, "account_client", return_value=("staging", client)),
                patch.object(
                    channex_insights,
                    "verify_property",
                    return_value={
                        "id": property_id,
                        "attributes": {"currency": "VND"},
                    },
                ),
                patch.object(
                    channex_insights,
                    "catalog_options",
                    return_value={"roomTypes": [], "ratePlans": []},
                ),
            ):
                result = channex_insights.RemoteInventoryView.dispatch_request.__wrapped__(
                    property_id
                )
            self.assertEqual(len(result["dates"]), 31)
            self.assertEqual((result["dates"][0], result["dates"][-1]), (START, END))
            self.assertEqual(
                client._request.call_args_list[0].kwargs["query"],
                {
                    "filter[property_id]": property_id,
                    "filter[date][gte]": START,
                    "filter[date][lte]": END,
                },
            )

    def test_ari_preview_normalizes_query_names_for_the_existing_snapshot_service(self):
        saved = SimpleNamespace(environment="staging")
        for query in queries():
            with (
                self.subTest(query=query),
                self.app.test_request_context(query_string=query),
                patch.object(preview, "connection", return_value=saved),
                patch.object(preview, "load_credentials", return_value={"apiKey": "fixture"}),
                patch.object(preview, "valid_secret", return_value=True),
                patch.object(preview.service, "ChannexClient") as client,
                patch.object(preview.service, "ari_snapshot", return_value=([], [])) as snapshot,
                patch.object(preview, "db") as database,
            ):
                g.tenant = SimpleNamespace(settings={"currency": "VND"})
                database.session.scalars.return_value = []
                database.session.execute.return_value.all.return_value = []
                database.session.scalar.return_value = False
                result = preview.AriPreviewView.dispatch_request.__wrapped__("hotel")
                snapshot.assert_called_once_with(
                    "hotel", saved, client.return_value, {"start": START, "end": END}
                )
            self.assertEqual((result["start"], result["end"]), (START, END))

    def test_job_history_keeps_legacy_filter_names_and_cursor_binding(self):
        token = None
        for query in queries(("dateFrom", "dateTo")):
            with self.subTest(query=query), self.app.test_request_context(query_string=query):
                g.auth_session = SimpleNamespace(token_hash="fixture-session-signing-source")
                _, size, filters, start, end = history.history_query()
                self.assertEqual((start, end), (START_DAY, END_DAY))
                self.assertEqual(filters, {"dateFrom": START, "dateTo": END})
                signer, state = history.cursor_state(
                    "hotel", size, filters, "Asia/Ho_Chi_Minh", token
                )
                token = signer.dumps(state)
                self.assertEqual(state["filters"], {"dateFrom": START, "dateTo": END})
