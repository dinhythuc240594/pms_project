"""A failed pending write must stop a scope change and preserve its original cause."""

import unittest
from unittest.mock import patch

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from pms_api.catalog.models import RoomType
from pms_api.core_models import User
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class ContextFailureTests(unittest.TestCase):
    def test_failed_flush_preserves_original_error_and_never_executes_scope_sql(self):
        failure = RuntimeError("Pending write failed")
        with patch("pms_api.security.db") as database:
            database.session.info = {}
            database.session.flush.side_effect = failure
            with self.assertRaises(RuntimeError) as caught:
                set_context("actor", "hotel", is_system=True, is_service=True, channel_support=True)
            self.assertIs(caught.exception, failure)
            database.session.execute.assert_not_called()


class ContextDatabaseTests(DomainTestCase):
    def test_failed_write_requires_rollback_before_scope_can_change(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.add(
                User(
                    id="failed-context-user",
                    name="Duplicate identity",
                    email="owner-a@test.local",
                    password_hash="unused-fixture-hash",
                )
            )
            with self.assertRaises(IntegrityError) as caught:
                set_context(
                    "owner-b",
                    self.other_tenant_id,
                    is_system=True,
                    is_service=True,
                    channel_support=True,
                )
            self.assertEqual(caught.exception.orig.sqlstate, "23505")
            self.assertFalse(db.session.is_active)
            db.session.rollback()
            flags = db.session.execute(
                text(
                    "SELECT current_setting('app.is_system',true), "
                    "current_setting('app.is_service',true), "
                    "current_setting('app.channel_support',true)"
                )
            ).one()
            self.assertTrue(all(flag != "true" for flag in flags))
            self.assertIsNone(db.session.get(User, "failed-context-user"))
            set_context("owner-b", self.other_tenant_id)
            self.assertEqual(
                db.session.scalars(select(RoomType.tenant_id)).all(), [self.other_tenant_id]
            )
