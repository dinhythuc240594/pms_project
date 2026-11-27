"""Unknown upstream bookings must close sales until local inventory is trustworthy."""

from flask import g
from sqlalchemy import event, select

from pms_api.channels import service
from pms_api.channels.models import ChannelConnection, ChannelJob
from pms_api.core_models import Tenant
from pms_api.extensions import db
from pms_api.security import set_context
from tests.test_channels_integration import ChannelTestCase, revision


class ChannelInventoryHoldTests(ChannelTestCase):
    def snapshot(self, end="2030-01-03"):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            g.tenant = db.session.get(Tenant, self.tenant_id)
            connection = db.session.scalar(select(ChannelConnection))
            statements = []

            def record(_connection, _cursor, statement, _parameters, _context, _many):
                statements.append(statement)

            event.listen(db.engine, "before_cursor_execute", record)
            try:
                result = service.ari_snapshot(
                    self.tenant_id,
                    connection,
                    self.provider,
                    {
                        "start": "2030-01-01",
                        "end": end,
                    },
                )
            finally:
                event.remove(db.engine, "before_cursor_execute", record)
            self.assertLessEqual(len(statements), 6)
            return result

    def assert_closed(self, snapshot):
        availability, restrictions = snapshot
        self.assertTrue(availability)
        self.assertTrue(all(row["availability"] == 0 for row in availability))
        self.assertTrue(all(row["stop_sell"] is True for row in restrictions))

    def publish(self):
        response = self.request(
            "post",
            "/channels/jobs",
            {
                "kind": "push_ari",
                "start": "2030-01-01",
                "end": "2030-01-03",
            },
        )
        self.assertEqual(response.status_code, 202, response.json)
        self.assertEqual(self.run_jobs(), 1)

    def test_initial_tax_review_closes_sales_without_creating_a_local_stay(self):
        entity = revision()
        entity["attributes"]["taxes"] = [{"amount": "10"}]
        self.assertEqual(self.import_booking(entity), [])
        self.assert_closed(self.snapshot("2030-02-01"))
        self.publish()
        self.assertTrue(
            all(
                row["availability"] == 0
                for call in self.provider.push_availability.call_args_list
                for row in call.args[0]
            )
        )
        self.assertTrue(
            all(row["stop_sell"] for row in self.provider.push_restrictions.call_args.args[0])
        )
        job = next(row for row in self.jobs() if row["kind"] == "push_ari")
        self.assertEqual(job["status"], "queued")
        self.assertEqual(job["errorCode"], "channel_bookings_pending")

    def test_rejected_modification_also_holds_existing_local_inventory(self):
        self.import_booking()
        self.run_jobs(5)
        modified = revision(11, "modified")
        modified["attributes"]["collected_taxes"] = [{"amount": "10"}]
        self.import_booking(modified)
        self.assert_closed(self.snapshot())

    def test_uncommitted_exact_revision_jobs_hold_but_feed_and_ack_jobs_do_not(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            pending = ChannelJob(
                tenant_id=self.tenant_id,
                actor_id=self.owner_id,
                kind="pull_bookings",
                status="queued",
                payload={"revisionId": revision()["id"]},
            )
            db.session.add(pending)
            db.session.flush()
            job_id = pending.id
            db.session.commit()
        for status in ("queued", "processing", "failed"):
            with self.subTest(status=status):
                with self.app.app_context():
                    set_context(self.owner_id, self.tenant_id)
                    db.session.get(ChannelJob, job_id).status = status
                    db.session.commit()
                self.assert_closed(self.snapshot())
        for kind, payload in (
            ("pull_bookings", {}),
            ("ack_revision", {"revisionId": revision()["id"]}),
        ):
            with self.subTest(kind=kind):
                with self.app.app_context():
                    set_context(self.owner_id, self.tenant_id)
                    job = db.session.get(ChannelJob, job_id)
                    job.kind, job.payload = kind, payload
                    db.session.commit()
                self.assertEqual({r["availability"] for r in self.snapshot()[0]}, {2})

    def test_committed_booking_releases_hold_with_reduced_stock_while_ack_is_pending(self):
        entity = revision()
        self.enqueue_revision(entity)
        self.assert_closed(self.snapshot())
        self.assertEqual(self.run_jobs(), 1)
        availability, restrictions = self.snapshot()
        self.assertEqual({row["availability"] for row in availability}, {1})
        self.assertTrue(all(row["stop_sell"] is False for row in restrictions))
        self.provider.ack.assert_not_called()

    def test_failed_duplicate_revision_job_with_committed_receipt_does_not_hold(self):
        self.import_booking()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.add(
                ChannelJob(
                    tenant_id=self.tenant_id,
                    actor_id=self.owner_id,
                    kind="pull_bookings",
                    status="failed",
                    payload={"revisionId": revision()["id"]},
                )
            )
            db.session.commit()
        self.assertEqual({row["availability"] for row in self.snapshot()[0]}, {1})

    def test_another_hotels_pending_revision_does_not_close_this_hotel(self):
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            db.session.add(
                ChannelJob(
                    tenant_id=self.other_tenant_id,
                    actor_id="owner-b",
                    kind="pull_bookings",
                    status="failed",
                    payload={"revisionId": revision()["id"]},
                )
            )
            db.session.commit()
        self.assertEqual({row["availability"] for row in self.snapshot()[0]}, {2})

    def test_corrected_review_releases_only_after_importing_the_real_booking(self):
        entity = revision()
        entity["attributes"]["taxes"] = [{"amount": "10"}]
        self.import_booking(entity)
        self.assert_closed(self.snapshot())
        job = next(row for row in self.jobs() if row["kind"] == "pull_bookings")
        self.provider.revision.return_value = revision()
        response = self.request("post", f"/channels/jobs/{job['id']}/retry", {})
        self.assertEqual(response.status_code, 202, response.json)
        self.assertEqual(self.run_jobs(), 1)
        self.assertEqual({row["availability"] for row in self.snapshot()[0]}, {1})

    def test_revision_arriving_during_staging_cannot_be_overtaken_by_final_open(self):
        def after_prices(*args):
            result = self.stored_restrictions(*args)
            self.enqueue_revision(revision())
            return result

        self.provider.restrictions.side_effect = after_prices
        self.publish()
        self.assertTrue(
            all(
                row["availability"] == 0
                for call in self.provider.push_availability.call_args_list
                for row in call.args[0]
            )
        )
        job = next(row for row in self.jobs() if row["kind"] == "push_ari")
        self.assertEqual(job["errorCode"], "channel_snapshot_changed")
