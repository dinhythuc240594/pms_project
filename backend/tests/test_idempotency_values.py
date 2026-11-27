"""Booking and SaaS completions must persist retries in their own record tables."""

import unittest
from unittest.mock import patch

from pms_api.bookings import routes
from pms_api.bookings.models import IdempotencyRecord
from pms_api.saas_billing.models import SaaSIdempotencyRecord


class IdempotencyCompletionTests(unittest.TestCase):
    def test_completion_preserves_response_and_record_namespace(self):
        response = {"id": "result", "amount": "100.1250"}
        for options, model, status in (
            ({}, IdempotencyRecord, 200),
            ({"record_model": SaaSIdempotencyRecord, "status": 201}, SaaSIdempotencyRecord, 201),
        ):
            with self.subTest(model=model.__name__), patch.object(routes.db, "session") as session:
                result, actual_status = routes.finish_write(
                    "tenant", "intent-key", "fingerprint", response, **options
                )
                self.assertIs(result, response)
                self.assertEqual(actual_status, status)
                session.add.assert_called_once()
                record = session.add.call_args.args[0]
                self.assertIs(type(record), model)
                self.assertEqual(record.tenant_id, "tenant")
                self.assertEqual(record.key, "intent-key")
                self.assertEqual(record.fingerprint, "fingerprint")
                self.assertEqual(record.response, response)
                session.flush.assert_called_once_with()

    def test_optional_intent_does_not_store_a_record(self):
        response = {"id": "result"}
        with patch.object(routes.db, "session") as session:
            result, status = routes.finish_write("tenant", None, None, response)
            self.assertIs(result, response)
            self.assertEqual(status, 200)
            session.add.assert_not_called()
            session.flush.assert_not_called()

    def test_failed_persistence_does_not_return_success(self):
        with patch.object(routes.db, "session") as session:
            session.flush.side_effect = RuntimeError("Persistence failed")
            with self.assertRaises(RuntimeError):
                routes.finish_write(
                    "tenant",
                    "intent-key",
                    "fingerprint",
                    {"id": "result"},
                    record_model=SaaSIdempotencyRecord,
                    status=201,
                )
