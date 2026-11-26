"""Actual cashbook view with a synthetic session; no database or credentials."""

from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from flask import Flask, g

from pms_api.finance.routes import CashbookView
from pms_api.security import ApiError


def entry(index, description="Service charge", amount="1", booked=date(2026, 1, 2)):
    return SimpleNamespace(
        id=f"entry-{index:04d}",
        cash_document_id=f"voucher-{index:04d}",
        reservation_id=f"booking-{index:04d}",
        pos_invoice_id=None,
        payment_id=None,
        refund_id=None,
        pos_payment_id=None,
        pos_refund_id=None,
        reversal_of_id=None,
        description=description,
        amount=Decimal(amount),
        booked_at=booked,
        created_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
    )


def synthetic_rows():
    rows = [entry(0, "Opening", "100", date(2026, 1, 1))]
    rows += [entry(i) for i in range(1, 1001)]
    rows[1].description = "Needle-token beyond the first page"
    rows[2].description = "Literal %_ entry"
    rows[3].description = "cafe\u0301 deposit"
    rows[4].amount = Decimal("-2")
    return rows


def call_view(query="", rows=None):
    session = MagicMock()
    session.scalars.side_effect = [synthetic_rows() if rows is None else rows, [], []]
    with Flask(__name__).test_request_context("/?startDate=2026-01-02&endDate=2026-01-31&" + query):
        g.tenant = SimpleNamespace(settings={"currency": "VND", "timezone": "UTC"})
        with (
            patch("pms_api.finance.routes.db", SimpleNamespace(session=session)),
            patch(
                "pms_api.finance.routes.ledger_json",
                side_effect=lambda row: {
                    "id": row.id,
                    "description": row.description,
                    "amount": str(row.amount),
                },
            ),
        ):
            result = CashbookView.dispatch_request.__wrapped__("synthetic-hotel")
    return result, session


class CashbookSearchTests(TestCase):
    def test_searches_full_period_before_pagination_and_keeps_totals(self):
        baseline, _ = call_view()
        selected, session = call_view("q=NEEDLE-token&pageSize=20")
        self.assertNotIn("entry-0001", [row["id"] for row in baseline["ledger"]])
        self.assertEqual([row["id"] for row in selected["ledger"]], ["entry-0001"])
        self.assertEqual(selected["summary"], baseline["summary"])
        self.assertEqual(selected["fundBalances"], baseline["fundBalances"])
        self.assertEqual(selected["pagination"]["totalItems"], 1)
        self.assertEqual(selected["search"]["totalPeriodItems"], 1000)
        self.assertFalse(selected["search"]["summaryFiltered"])
        compiled = session.scalars.call_args_list[0].args[0].compile()
        self.assertIn("synthetic-hotel", compiled.params.values())
        self.assertIn("VND", compiled.params.values())

    def test_unicode_literal_and_reference_queries(self):
        for query, expected in [
            ("q=CAF%C3%89", "entry-0003"),
            ("q=%25_", "entry-0002"),
            ("q=BOOKING-0001", "entry-0001"),
            ("q=voucher-0001", "entry-0001"),
        ]:
            with self.subTest(query=query):
                result, _ = call_view(query)
                self.assertEqual([row["id"] for row in result["ledger"]], [expected])

    def test_empty_query_is_compatible_and_pagination_counts_matches(self):
        baseline, _ = call_view()
        for query in ("q=", "q=%20%20"):
            self.assertEqual(call_view(query)[0], baseline)
        result, _ = call_view("q=service&pageSize=2&page=2")
        self.assertEqual(len(result["ledger"]), 2)
        self.assertEqual(result["pagination"]["totalItems"], 997)
        absent, _ = call_view("q=not-found")
        self.assertEqual(absent["ledger"], [])
        self.assertEqual(absent["summary"], baseline["summary"])

    def test_invalid_queries_reject_before_database_reads(self):
        for query in ("q=a&q=b", "q=%0A", "q=%09abc", "q=" + "x" * 161):
            with (
                self.subTest(query=query),
                Flask(__name__).test_request_context("/?" + query),
                patch("pms_api.finance.routes.db") as database,
            ):
                with self.assertRaises(ApiError) as error:
                    CashbookView.dispatch_request.__wrapped__("synthetic-hotel")
                self.assertEqual(error.exception.status, 422)
                self.assertEqual(error.exception.code, "invalid_filter")
                database.session.scalars.assert_not_called()

    def test_search_keeps_scope_filters_and_period_boundary(self):
        rows = [entry(1, "Needle", booked=date(2026, 1, 1)), entry(2, "Needle")]
        result, session = call_view("q=needle&fundId=fund-a&actorId=user-a&fundType=cash", rows)
        self.assertEqual([row["id"] for row in result["ledger"]], ["entry-0002"])
        compiled = session.scalars.call_args_list[0].args[0].compile()
        for expected in ("synthetic-hotel", "VND", "fund-a", "user-a"):
            self.assertIn(expected, compiled.params.values())
