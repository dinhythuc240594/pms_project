"""Local request/SQL contract checks; no database or provider connections."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from flask import Flask

from pms_api.channels.routes import BookingReviewsView
from pms_api.security import ApiError


class BookingReviewLookupTests(TestCase):
    review_id = "00000000-0000-0000-0000-000000abcdef"

    def test_lookup_normalizes_uuid_and_applies_tenant_and_pending_to_count_and_rows(self):
        now = datetime(2026, 1, 1, tzinfo=timezone.utc)
        row = SimpleNamespace(
            id=self.review_id,
            revision_id="revision-test",
            booking_id="provider-test",
            error_code="overbooked",
            provider_status="new",
            revision_at=now,
            created_at=now,
            details={},
        )
        session = MagicMock()
        session.scalar.return_value = 1
        session.scalars.side_effect = [[row], []]
        with (
            Flask(__name__).test_request_context("/?reviewId=" + self.review_id.upper()),
            patch("pms_api.channels.routes.db", SimpleNamespace(session=session)),
        ):
            result = BookingReviewsView.dispatch_request.__wrapped__("synthetic-hotel")
        self.assertEqual([item["id"] for item in result["items"]], [self.review_id])
        self.assertEqual(
            result["pagination"], {"page": 1, "pageSize": 25, "totalItems": 1, "totalPages": 1}
        )
        statements = [session.scalar.call_args.args[0], session.scalars.call_args_list[0].args[0]]
        for statement in statements:
            compiled = statement.compile()
            self.assertIn("resolved_at IS NULL", str(compiled))
            self.assertIn(self.review_id, compiled.params.values())
            self.assertIn("synthetic-hotel", compiled.params.values())

    def test_invalid_empty_and_duplicate_ids_reject_before_database_access(self):
        for query in (
            "reviewId=",
            "reviewId=not-a-uuid",
            "reviewId=" + self.review_id + "&reviewId=" + self.review_id,
        ):
            with (
                self.subTest(query=query),
                Flask(__name__).test_request_context("/?" + query),
                patch("pms_api.channels.routes.db") as database,
            ):
                with self.assertRaises(ApiError) as raised:
                    BookingReviewsView.dispatch_request.__wrapped__("synthetic-hotel")
                self.assertEqual(raised.exception.status, 422)
                database.session.scalar.assert_not_called()
                database.session.scalars.assert_not_called()

    def test_unfiltered_pagination_still_lists_pending_tenant_reviews(self):
        session = MagicMock()
        session.scalar.return_value = 0
        session.scalars.return_value = []
        with (
            Flask(__name__).test_request_context("/?page=2&pageSize=1"),
            patch("pms_api.channels.routes.db", SimpleNamespace(session=session)),
        ):
            result = BookingReviewsView.dispatch_request.__wrapped__("synthetic-hotel")
        self.assertEqual(result["items"], [])
        self.assertEqual(result["pagination"]["page"], 2)
        compiled = session.scalars.call_args.args[0].compile()
        self.assertIn("synthetic-hotel", compiled.params.values())
        self.assertIn("resolved_at IS NULL", str(compiled))
