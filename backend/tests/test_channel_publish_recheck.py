"""Publication must stay closed when staged prices or the current snapshot drift."""

from decimal import Decimal

from pms_api.catalog.models import RoomType
from pms_api.extensions import db
from pms_api.security import set_context
from tests.test_channels_integration import REMOTE_RATE, REMOTE_ROOM, ChannelTestCase


class ChannelPublishRecheckTests(ChannelTestCase):
    def queue_publication(self):
        response = self.request(
            "post",
            "/channels/jobs",
            {"kind": "push_ari", "start": "2030-01-01", "end": "2030-01-03"},
        )
        self.assertEqual(response.status_code, 202, response.json)
        return response.json["id"]

    def saved_job(self, identifier):
        return next(job for job in self.jobs() if job["id"] == identifier)

    def assert_only_close_sent(self):
        self.assertEqual(self.provider.push_availability.call_count, 1)
        self.assertEqual(
            {row["availability"] for row in self.provider.push_availability.call_args.args[0]},
            {0},
        )

    def test_unconfirmed_inventory_close_does_not_send_prices_or_reopen(self):
        identifier = self.queue_publication()
        self.provider.availability.side_effect = lambda *_: {
            REMOTE_ROOM: {"2030-01-01": 2, "2030-01-02": 2},
        }
        self.assertEqual(self.run_jobs(), 1)
        self.assert_only_close_sent()
        self.provider.push_restrictions.assert_not_called()
        job = self.saved_job(identifier)
        self.assertEqual(
            (job["status"], job["errorCode"]), ("queued", "channel_inventory_unverified")
        )

    def test_rate_readback_mismatch_does_not_reopen(self):
        identifier = self.queue_publication()
        self.provider.restrictions.side_effect = lambda *_: {
            REMOTE_RATE: {
                "2030-01-01": {"rate": "99", "stop_sell": False},
                "2030-01-02": {"rate": "100", "stop_sell": False},
            },
        }
        self.assertEqual(self.run_jobs(), 1)
        self.assert_only_close_sent()
        job = self.saved_job(identifier)
        self.assertEqual((job["status"], job["errorCode"]), ("queued", "channel_rate_unverified"))

    def test_price_changed_during_stage_stays_closed_and_keeps_new_local_price(self):
        identifier = self.queue_publication()

        def readback(*args):
            with self.app.app_context():
                set_context(self.owner_id, self.tenant_id)
                db.session.get(RoomType, "rt-a").base_price = Decimal("120")
                db.session.commit()
            return self.stored_restrictions(*args)

        self.provider.restrictions.side_effect = readback
        self.assertEqual(self.run_jobs(), 1)
        self.assert_only_close_sent()
        job = self.saved_job(identifier)
        self.assertEqual((job["status"], job["errorCode"]), ("queued", "channel_snapshot_changed"))
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(db.session.get(RoomType, "rt-a").base_price, Decimal("120"))

    def remote_change_during_stage(self, field, value):
        identifier = self.queue_publication()
        changed = False

        def catalog(resource, property_id):
            rows = self.catalog(resource, property_id)
            if changed and resource == "rate_plans":
                rows[0]["attributes"][field] = value
            return rows

        def readback(*args):
            nonlocal changed
            changed = True
            return self.stored_restrictions(*args)

        self.provider.catalog.side_effect = catalog
        self.provider.restrictions.side_effect = readback
        self.assertEqual(self.run_jobs(), 1)
        self.assert_only_close_sent()
        job = self.saved_job(identifier)
        self.assertEqual(
            (job["status"], job["errorCode"]), ("failed", "channel_rate_plan_unsupported")
        )

    def test_currency_changed_on_channex_during_stage_does_not_reopen(self):
        self.remote_change_during_stage("currency", "USD")

    def test_rate_mode_changed_on_channex_during_stage_does_not_reopen(self):
        self.remote_change_during_stage("rate_mode", "derived")

    def test_interruption_after_close_recovers_as_interrupted_without_reopening(self):
        identifier = self.queue_publication()
        self.provider.restrictions.side_effect = RuntimeError("simulated process interruption")
        with self.assertRaisesRegex(RuntimeError, "simulated process interruption"):
            self.run_jobs()
        self.assert_only_close_sent()
        self.provider.restrictions.side_effect = self.stored_restrictions
        self.assertEqual(self.run_jobs(), 0)
        job = self.saved_job(identifier)
        self.assertEqual(
            (job["status"], job["errorCode"]), ("queued", "channel_publish_interrupted")
        )
        self.assert_only_close_sent()
