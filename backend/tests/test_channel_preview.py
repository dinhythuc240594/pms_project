"""The read-only preview uses the same validated ARI values as publication."""

from datetime import date
from decimal import Decimal
from unittest.mock import patch
from uuid import UUID

from sqlalchemy import func, select

from pms_api.catalog.models import DailyRate
from pms_api.channels.models import ChannelConnection, ChannelJob, ChannelMapping
from pms_api.channels.service import ari_snapshot
from pms_api.extensions import db
from pms_api.security import set_context
from tests.test_channels_integration import REMOTE_RATE, REMOTE_ROOM, ChannelTestCase


class ChannelPreviewTests(ChannelTestCase):
    def test_mapping_change_during_preview_returns_retryable_conflict(self):
        def change_mapping(*args):
            result = ari_snapshot(*args)
            db.session.scalar(select(ChannelMapping)).remote_rate_plan_id = str(UUID(int=99))
            db.session.flush()
            return result

        with patch("pms_api.channels.preview.service.ari_snapshot", side_effect=change_mapping):
            response = self.request("get", "/channels/ari-preview?start=2030-01-01&end=2030-01-03")
        self.assertEqual(response.status_code, 409, response.json)
        self.assertEqual(response.json["error"]["code"], "channel_snapshot_changed")
        self.provider.push_availability.assert_not_called()
        self.provider.push_restrictions.assert_not_called()

    def test_preview_keeps_two_nightly_prices_and_does_not_publish_or_lock_mapping(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.add(
                DailyRate(
                    tenant_id=self.tenant_id,
                    room_type_id="rt-a",
                    date=date(2030, 1, 2),
                    price=Decimal("175.5000"),
                )
            )
            db.session.commit()
            jobs_before = db.session.scalar(select(func.count()).select_from(ChannelJob))
        response = self.request("get", "/channels/ari-preview?start=2030-01-01&end=2030-01-03")
        self.assertEqual(response.status_code, 200, response.json)
        rows = response.json["rows"]
        self.assertEqual(
            [(r["date"], r["rate"], r["priceSource"]) for r in rows],
            [
                ("2030-01-01", "100.0000", "base"),
                ("2030-01-02", "175.5000", "daily"),
            ],
        )
        self.assertEqual({r["currency"] for r in rows}, {"VND"})
        self.assertEqual({r["channexRoomTypeId"] for r in rows}, {REMOTE_ROOM})
        self.assertEqual({r["channexRatePlanId"] for r in rows}, {REMOTE_RATE})
        self.assertEqual({r["availability"] for r in rows}, {2})
        self.assertTrue(all(not r["stopSell"] for r in rows))
        self.provider.push_availability.assert_not_called()
        self.provider.push_restrictions.assert_not_called()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertIsNone(db.session.scalar(select(ChannelMapping)).used_at)
            self.assertEqual(
                db.session.scalar(select(func.count()).select_from(ChannelJob)), jobs_before
            )

    def test_preview_rejects_invalid_window_and_requires_reconciliation(self):
        for query in (
            "start=2030-01-01&end=2030-02-02",
            "start=2030-01-01&end=2030-01-03&extra=1",
            "start=2030-01-01&start=2030-01-02&end=2030-01-03",
        ):
            with self.subTest(query=query):
                self.assertEqual(
                    self.request("get", "/channels/ari-preview?" + query).status_code, 422
                )
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.scalar(select(ChannelConnection)).inventory_reconciled_at = None
            db.session.commit()
        response = self.request("get", "/channels/ari-preview?start=2030-01-01&end=2030-01-03")
        self.assertEqual(response.status_code, 409, response.json)
        self.provider.push_availability.assert_not_called()
        self.provider.push_restrictions.assert_not_called()
