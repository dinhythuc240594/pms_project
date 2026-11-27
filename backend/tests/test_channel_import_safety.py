"""Real PostgreSQL regressions for safe authoritative booking imports."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import date, datetime
from threading import Barrier
from unittest import TestCase
from uuid import UUID

from flask import g
from sqlalchemy import MetaData, Table, func, select, text, update
from sqlalchemy.exc import DBAPIError, IntegrityError

from pms_api.bookings.models import Reservation, ReservationRoom
from pms_api.catalog.models import PhysicalRoom, RoomBlock, RoomType, RoomTypeAvailability
from pms_api.channels.client import ProviderError
from pms_api.channels.importer import import_revision, normalize, revision_identity
from pms_api.channels.models import ChannelBooking, ChannelJob, ChannelMapping, ChannelRevision
from pms_api.core_models import Tenant, User, utcnow
from pms_api.extensions import db
from pms_api.security import ApiError, set_context
from tests.test_channels_integration import PROPERTY, ChannelTestCase, revision


class ChannelImportSafetyTests(ChannelTestCase):
    def test_overflowing_provider_timestamps_fail_jobs_without_importing_or_acknowledging(self):
        for number, timestamp in enumerate(
            ("0001-01-01T00:00:00+23:59", "9999-12-31T23:59:59-23:59"), start=10
        ):
            entity = revision(number)
            entity["attributes"]["inserted_at"] = timestamp
            self.assertEqual(self.import_booking(entity), [])
        self.provider.ack.assert_not_called()
        state = self.counts()
        self.assertEqual((state["reservations"], state["assigned"]), (0, 0))
        self.assertEqual(state["receipts"], {})
        self.assertEqual(state["reviews"], {})
        jobs = self.jobs()
        self.assertEqual(len(jobs), 2)
        self.assertTrue(
            all(
                job["status"] == "failed" and job["errorCode"] == "invalid_booking_revision"
                for job in jobs
            )
        )

    def test_orphan_cancellation_must_verify_current_remote_booking_before_ack(self):
        entity = revision(12, "cancelled")
        self.provider.booking.return_value = {
            "id": entity["attributes"]["booking_id"],
            "type": "booking",
            "attributes": {"status": "new", "revision_id": revision(13)["id"]},
        }
        self.import_booking(entity)
        self.run_jobs(5)
        self.provider.booking.assert_called_once_with(entity["attributes"]["booking_id"])
        self.provider.ack.assert_not_called()
        self.assertEqual(self.counts()["receipts"], {})
        self.assertEqual(
            self.counts()["reviews"], {entity["id"]: "channel_cancellation_unverified"}
        )

    def test_orphan_cancellation_verifies_latest_revision_property_and_watermark(self):
        entity, latest = revision(12, "cancelled"), revision(14, "cancelled")
        self.provider.booking.return_value = {
            "id": entity["attributes"]["booking_id"],
            "type": "booking",
            "attributes": {"status": "cancelled", "revision_id": latest["id"]},
        }
        self.provider.revision.side_effect = lambda key: deepcopy(
            latest if key == latest["id"] else entity
        )
        self.import_booking(entity)
        self.assertEqual(self.counts()["receipts"], {entity["id"]: "cancelled"})
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            link = db.session.scalar(select(ChannelBooking))
            self.assertEqual(link.latest_revision_id, latest["id"])
            self.assertEqual(
                link.latest_revision_at, datetime.fromisoformat("2026-10-07T00:00:14+00:00")
            )
        self.provider.ack.assert_not_called()
        self.run_jobs(5)
        self.provider.ack.assert_called_once_with(entity["id"])
        self.assertEqual(self.import_direct(revision(13)), "stale")
        self.assertEqual(self.counts()["assigned"], 0)

    def test_orphan_cancellation_rejects_latest_revision_from_another_property(self):
        entity, latest = revision(12, "cancelled"), revision(14, "cancelled")
        latest["attributes"]["property_id"] = str(UUID(int=900))
        self.provider.booking.return_value = {
            "id": entity["attributes"]["booking_id"],
            "type": "booking",
            "attributes": {"status": "cancelled", "revision_id": latest["id"]},
        }
        self.provider.revision.side_effect = lambda key: deepcopy(
            latest if key == latest["id"] else entity
        )
        self.import_booking(entity)
        self.run_jobs(5)
        self.provider.ack.assert_not_called()
        self.assertEqual(self.counts()["receipts"], {})
        self.assertEqual(
            self.counts()["reviews"], {entity["id"]: "channel_cancellation_unverified"}
        )

    def test_orphan_cancellation_transport_failure_retries_without_committing_a_tombstone(self):
        self.provider.booking.side_effect = ProviderError("provider_unavailable", True)
        self.import_booking(revision(12, "cancelled"))
        self.assertEqual(self.counts()["receipts"], {})
        self.assertEqual(self.counts()["reviews"], {})
        self.assertEqual(self.jobs()[0]["status"], "queued")
        self.provider.ack.assert_not_called()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertIsNone(db.session.scalar(select(ChannelBooking)))

    def test_unverified_cancellation_cannot_make_an_older_create_acknowledgeable(self):
        entity = revision(12, "cancelled")
        self.provider.booking.return_value = {
            "id": entity["attributes"]["booking_id"],
            "type": "booking",
            "attributes": {"status": "new", "revision_id": revision(13)["id"]},
        }
        self.import_booking(entity)
        self.import_booking(revision(10))
        self.run_jobs(5)
        self.provider.ack.assert_not_called()
        self.assertEqual(self.counts()["receipts"], {})
        self.assertEqual(self.counts()["assigned"], 0)

    def test_direct_orphan_cancel_without_verification_remains_pending(self):
        with self.app.test_request_context("/api/_import_regression", method="POST"):
            set_context(self.owner_id, self.tenant_id)
            receipt = import_revision(self.tenant_id, revision(12, "cancelled"), PROPERTY)
            self.assertEqual(receipt.outcome, "needs_review")
            self.assertEqual(receipt.error_code, "channel_cancellation_unverified")
            db.session.commit()
        self.assertEqual(self.counts()["receipts"], {})

    def test_legacy_orphan_tombstone_is_verified_before_acknowledging_a_late_create(self):
        self.assertEqual(self.import_direct(revision(12, "cancelled")), "cancelled")
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            link = db.session.scalar(select(ChannelBooking))
            link.cancellation_verified_at = None  # History created before migration 0025.
            db.session.commit()
        self.provider.booking.return_value = {
            "id": revision()["attributes"]["booking_id"],
            "type": "booking",
            "attributes": {"status": "cancelled", "revision_id": revision(12)["id"]},
        }
        self.provider.revision.side_effect = lambda key: deepcopy(
            revision(12, "cancelled") if key == revision(12)["id"] else revision(10)
        )
        self.import_booking(revision(10))
        self.assertEqual(self.counts()["receipts"][revision(10)["id"]], "stale")
        self.assertEqual(self.counts()["assigned"], 0)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertIsNotNone(db.session.scalar(select(ChannelBooking.cancellation_verified_at)))

    def import_direct(self, entity, tenant_id=None, *, retry_review=False):
        tenant_id = tenant_id or self.tenant_id
        owner_id = "owner-b" if tenant_id == self.other_tenant_id else self.owner_id
        with self.app.test_request_context("/api/_import_regression", method="POST"):
            set_context(owner_id, tenant_id)
            g.user = db.session.get(User, owner_id)
            g.tenant = db.session.get(Tenant, tenant_id)
            receipt = import_revision(
                tenant_id,
                deepcopy(entity),
                PROPERTY,
                retry_review=retry_review,
                # These direct importer tests supply verified provider identity explicitly.
                verify_cancellation=lambda: revision_identity(entity, PROPERTY),
            )
            outcome = receipt.outcome
            db.session.commit()
            return outcome

    def counts(self):
        from pms_api.channels.models import ChannelBookingReview

        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            return {
                "reservations": db.session.scalar(select(func.count()).select_from(Reservation)),
                "assigned": db.session.scalar(
                    select(func.count()).select_from(ReservationRoom).where(ReservationRoom.active)
                ),
                "booked": list(db.session.scalars(select(RoomTypeAvailability.booked_rooms))),
                "receipts": dict(
                    db.session.execute(
                        select(ChannelRevision.revision_id, ChannelRevision.outcome)
                    ).all()
                ),
                "reviews": dict(
                    db.session.execute(
                        select(
                            ChannelBookingReview.revision_id, ChannelBookingReview.error_code
                        ).where(ChannelBookingReview.resolved_at.is_(None))
                    ).all()
                ),
            }

    def test_cancellation_before_create_is_durable_and_late_create_cannot_revive_it(self):
        cancelled = revision(12, "cancelled")
        self.assertEqual(self.import_direct(cancelled), "cancelled")
        self.assertEqual(self.import_direct(revision(10)), "stale")
        self.assertEqual(self.import_direct(cancelled), "cancelled")
        state = self.counts()
        self.assertEqual((state["reservations"], state["assigned"]), (0, 0))
        self.assertEqual(len(state["receipts"]), 2)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            link = db.session.scalar(select(ChannelBooking))
            self.assertIsNotNone(link)
            self.assertIsNone(link.reservation_id)
            self.assertEqual(link.latest_status, "cancelled")
            self.assertEqual(
                link.latest_revision_at, datetime.fromisoformat("2026-10-07T00:00:12+00:00")
            )

    def test_repeated_cancel_releases_inventory_once_and_older_modify_is_stale(self):
        self.assertEqual(self.import_direct(revision(10)), "imported")
        self.assertEqual(self.import_direct(revision(12, "cancelled")), "cancelled")
        self.assertEqual(self.import_direct(revision(13, "cancelled")), "cancelled")
        self.assertEqual(self.import_direct(revision(11, "modified")), "stale")
        state = self.counts()
        self.assertEqual((state["reservations"], state["assigned"]), (1, 0))
        self.assertTrue(state["booked"])
        self.assertEqual(set(state["booked"]), {0})
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(db.session.scalar(select(Reservation.status)), "CANCELLED")

    def test_full_hotel_persists_review_without_assigning_any_room(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            for room in db.session.scalars(select(PhysicalRoom)):
                room.active = False
            db.session.commit()
        self.assertEqual(self.import_direct(revision()), "needs_review")
        state = self.counts()
        self.assertEqual((state["reservations"], state["assigned"]), (0, 0))
        self.assertEqual(state["receipts"], {})
        self.assertEqual(state["reviews"][revision()["id"]], "channel_room_inactive")

    def test_blocks_and_maintenance_exhaust_only_the_requested_date_range(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.get(PhysicalRoom, "room-a-101").condition = "maintenance"
            db.session.add(
                RoomBlock(
                    tenant_id=self.tenant_id,
                    room_id="room-a-102",
                    start_date=date(2030, 1, 1),
                    end_date=date(2030, 1, 3),
                    reason="Fixture block",
                )
            )
            db.session.commit()
        self.assertEqual(self.import_direct(revision()), "needs_review")
        later = revision(11, booking_id=str(UUID(int=99)), start="2030-01-03", end="2030-01-05")
        later["attributes"]["rooms"][0]["days"] = {"2030-01-03": "100", "2030-01-04": "100"}
        self.assertEqual(self.import_direct(later), "imported")
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(
                list(db.session.scalars(select(ReservationRoom.room_id))), ["room-a-102"]
            )

    def test_concurrent_new_bookings_for_last_room_never_overassign(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.get(PhysicalRoom, "room-a-102").active = False
            db.session.commit()
        gate = Barrier(2)

        def book(number):
            gate.wait(timeout=10)
            return self.import_direct(revision(number, booking_id=str(UUID(int=number + 100))))

        with ThreadPoolExecutor(max_workers=2) as workers:
            outcomes = list(workers.map(book, (10, 11)))
        self.assertCountEqual(outcomes, ["imported", "needs_review"])
        state = self.counts()
        self.assertEqual((state["reservations"], state["assigned"]), (1, 1))
        self.assertEqual(set(state["booked"]), {1})
        self.assertEqual((len(state["receipts"]), len(state["reviews"])), (1, 1))

    def test_newer_create_after_cancellation_also_cannot_revive_booking(self):
        self.assertEqual(self.import_direct(revision(11, "cancelled")), "cancelled")
        self.assertEqual(self.import_direct(revision(12)), "needs_review")
        state = self.counts()
        self.assertEqual((state["reservations"], state["assigned"]), (0, 0))
        self.assertEqual(state["reviews"][revision(12)["id"]], "booking_requires_review")

    def test_occupancy_at_capacity_imports_but_excess_requires_review(self):
        excessive = revision()
        excessive["attributes"]["rooms"][0]["occupancy"] = {
            "adults": 1,
            "children": 1,
            "infants": 1,
        }
        self.assertEqual(self.import_direct(excessive), "needs_review")
        valid = revision(11, booking_id=str(UUID(int=99)))
        valid["attributes"]["rooms"][0]["occupancy"] = {
            "adults": 1,
            "children": 0,
            "infants": 1,
        }
        self.assertEqual(self.import_direct(valid), "imported")
        state = self.counts()
        self.assertEqual((state["reservations"], state["assigned"]), (1, 1))
        self.assertEqual(state["reviews"][excessive["id"]], "invalid_booking_occupancy")

    def test_inactive_room_type_requires_review_even_when_physical_rooms_are_active(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.get(RoomType, "rt-a").active = False
            db.session.commit()
        self.assertEqual(self.import_direct(revision()), "needs_review")
        state = self.counts()
        self.assertEqual((state["reservations"], state["assigned"]), (0, 0))
        self.assertEqual(state["reviews"][revision()["id"]], "channel_room_type_inactive")

    def test_same_provider_ids_are_tenant_scoped_and_other_hotel_inventory_is_untouched(self):
        from tests.test_channels_integration import REMOTE_RATE, REMOTE_ROOM

        with self.app.app_context():
            set_context("owner-b", self.other_tenant_id)
            db.session.add(
                ChannelMapping(
                    tenant_id=self.other_tenant_id,
                    room_type_id="rt-b",
                    remote_room_type_id=REMOTE_ROOM,
                    remote_rate_plan_id=REMOTE_RATE,
                )
            )
            db.session.commit()
        self.assertEqual(self.import_direct(revision(11, "cancelled")), "cancelled")
        self.assertEqual(self.import_direct(revision(), self.other_tenant_id), "imported")
        self.assertEqual(self.counts()["reservations"], 0)
        with self.app.app_context():
            set_context("owner-b", self.other_tenant_id)
            self.assertEqual(db.session.scalar(select(func.count()).select_from(Reservation)), 1)
            self.assertEqual(
                list(db.session.scalars(select(ReservationRoom.room_id))), ["room-b-101"]
            )
            self.assertEqual(db.session.scalar(select(ChannelRevision.outcome)), "imported")
        self.assertEqual(self.import_direct(revision()), "stale")

    def test_unavailable_modification_preserves_original_stay_and_inventory(self):
        self.assertEqual(self.import_direct(revision()), "imported")
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            for room in ("room-a-101", "room-a-102"):
                db.session.add(
                    RoomBlock(
                        tenant_id=self.tenant_id,
                        room_id=room,
                        start_date=date(2030, 2, 1),
                        end_date=date(2030, 2, 3),
                        reason="Future block",
                    )
                )
            db.session.commit()
        changed = revision(11, "modified", start="2030-02-01", end="2030-02-03")
        changed["attributes"]["rooms"][0]["days"] = {"2030-02-01": "100", "2030-02-02": "100"}
        self.assertEqual(self.import_direct(changed), "needs_review")
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            booking = db.session.scalar(select(Reservation))
            self.assertEqual(
                (booking.check_in, booking.check_out), (date(2030, 1, 1), date(2030, 1, 3))
            )
            self.assertEqual(
                list(db.session.scalars(select(ReservationRoom.room_id))), ["room-a-101"]
            )
            self.assertEqual(
                list(db.session.scalars(select(RoomTypeAvailability.booked_rooms))), [1, 1]
            )

    def test_modification_before_create_imports_latest_stay_before_acknowledging_either_revision(
        self,
    ):
        changed = revision(12, "modified", amount="300")
        changed["attributes"]["rooms"][0]["days"] = {
            "2030-01-01": "150",
            "2030-01-02": "150",
        }
        self.import_booking(changed)
        state = self.counts()
        self.assertEqual((state["reservations"], state["assigned"]), (1, 1))
        self.assertEqual(state["booked"], [1, 1])
        self.assertEqual(state["receipts"], {changed["id"]: "imported"})
        self.assertEqual(state["reviews"], {})
        self.provider.ack.assert_not_called()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(
                db.session.scalar(select(ChannelBooking.latest_revision_id)), changed["id"]
            )
            self.assertEqual(db.session.scalar(select(Reservation.base_amount)), 300)
        self.assertEqual(self.run_jobs(), 1)
        self.provider.ack.assert_called_once_with(changed["id"])

        self.provider.ack.reset_mock()
        self.import_booking(revision(10))
        self.provider.ack.assert_not_called()
        state = self.counts()
        self.assertEqual((state["reservations"], state["assigned"]), (1, 1))
        self.assertEqual(state["booked"], [1, 1])
        self.assertEqual(state["reviews"], {})
        self.assertEqual(
            state["receipts"],
            {
                changed["id"]: "imported",
                revision(10)["id"]: "stale",
            },
        )
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(db.session.scalar(select(Reservation.base_amount)), 300)
        self.assertEqual(self.run_jobs(), 1)
        self.provider.ack.assert_called_once_with(revision(10)["id"])

    def test_legacy_missing_booking_recovers_by_retrying_modified_review_after_create_was_acked(
        self,
    ):
        from pms_api.channels.models import ChannelBookingReview

        original, changed = revision(10), revision(12, "modified")
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.add(
                ChannelBooking(
                    tenant_id=self.tenant_id,
                    booking_id=changed["attributes"]["booking_id"],
                    latest_revision_at=revision_identity(changed, PROPERTY)["insertedAt"],
                    latest_revision_id=changed["id"],
                    latest_status="modified",
                )
            )
            db.session.flush()
            db.session.add(
                ChannelBookingReview(
                    tenant_id=self.tenant_id,
                    revision_id=changed["id"],
                    booking_id=changed["attributes"]["booking_id"],
                    provider_status="modified",
                    revision_at=revision_identity(changed, PROPERTY)["insertedAt"],
                    error_code="channel_booking_not_found",
                    details={},
                )
            )
            db.session.add(
                ChannelRevision(
                    tenant_id=self.tenant_id,
                    revision_id=original["id"],
                    booking_id=original["attributes"]["booking_id"],
                    outcome="stale",
                )
            )
            review_job = ChannelJob(
                tenant_id=self.tenant_id,
                actor_id=self.owner_id,
                kind="pull_bookings",
                status="needs_review",
                attempts=1,
                payload={"revisionId": changed["id"]},
                error_code="channel_booking_not_found",
            )
            db.session.add(review_job)
            db.session.flush()
            job_id = review_job.id
            db.session.commit()
        self.provider.revision.return_value = deepcopy(changed)
        response = self.request("post", f"/channels/jobs/{job_id}/retry", json={})
        self.assertEqual(response.status_code, 202, response.json)
        self.assertEqual(self.run_jobs(), 1)
        self.provider.ack.assert_not_called()
        state = self.counts()
        self.assertEqual((state["reservations"], state["assigned"]), (1, 1))
        self.assertEqual(state["booked"], [1, 1])
        self.assertEqual(state["reviews"], {})
        self.assertEqual(
            state["receipts"],
            {
                original["id"]: "stale",
                changed["id"]: "imported",
            },
        )
        self.clear_push_jobs()
        self.assertEqual(self.run_jobs(), 1)
        self.provider.ack.assert_called_once_with(changed["id"])

    def test_orphan_modified_still_validates_availability_before_import_and_ack(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            for room in db.session.scalars(select(PhysicalRoom)):
                room.active = False
            db.session.commit()
        changed = revision(12, "modified")
        self.import_booking(changed)
        state = self.counts()
        self.assertEqual((state["reservations"], state["assigned"]), (0, 0))
        self.assertEqual(state["receipts"], {})
        self.assertEqual(state["reviews"], {changed["id"]: "channel_room_inactive"})
        self.run_jobs(5)
        self.provider.ack.assert_not_called()

    def test_rejected_newer_modification_cannot_make_an_unimported_create_stale(self):
        changed = revision(12, "modified")
        changed["attributes"]["currency"] = "XXX"
        self.import_booking(changed)
        self.import_booking(revision(10))
        state = self.counts()
        self.assertEqual((state["reservations"], state["assigned"]), (1, 1))
        self.assertEqual(state["booked"], [1, 1])
        self.assertEqual(state["receipts"], {revision(10)["id"]: "imported"})
        self.assertEqual(state["reviews"], {changed["id"]: "unsupported_booking_currency"})
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(
                db.session.scalar(select(ChannelBooking.latest_revision_id)), changed["id"]
            )
        self.run_jobs(5)
        self.provider.ack.assert_called_once_with(revision(10)["id"])

    def test_rejected_newer_revision_cannot_make_an_older_modify_acknowledgeable_without_booking(
        self,
    ):
        changed = revision(12, "modified")
        changed["attributes"]["currency"] = "XXX"
        self.import_booking(changed)
        self.import_booking(revision(11, "modified"))
        state = self.counts()
        self.assertEqual((state["reservations"], state["assigned"]), (0, 0))
        self.assertEqual(state["receipts"], {})
        self.assertEqual(
            state["reviews"],
            {
                changed["id"]: "unsupported_booking_currency",
                revision(11)["id"]: "channel_booking_not_found",
            },
        )
        self.run_jobs(5)
        self.provider.ack.assert_not_called()

    def test_business_review_is_terminal_and_repeated_polls_do_not_retry_or_notify_again(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            for room in db.session.scalars(select(PhysicalRoom)):
                room.active = False
            db.session.commit()
        self.import_booking()
        self.assertEqual(self.jobs()[0]["status"], "needs_review")
        self.assertEqual(self.jobs()[0]["errorCode"], "channel_room_inactive")
        inbox = self.request("get", "/notifications").json["items"]
        review_notifications = [item for item in inbox if item["eventCode"] == "OTA_SYNC_ERROR"]
        self.assertEqual(len(review_notifications), 1)
        self.provider.feed.return_value = [revision()]
        for _ in range(2):
            response = self.request("post", "/channels/jobs", json={"kind": "pull_bookings"})
            self.assertEqual(response.status_code, 202, response.json)
            self.run_jobs(5)
        self.provider.revision.assert_called_once()
        self.provider.ack.assert_not_called()
        self.assertEqual(self.request("get", "/notifications").json["items"], inbox)
        review = next(job for job in self.jobs() if job["errorCode"] == "channel_room_inactive")
        self.assertEqual((review["status"], review["attempts"]), ("needs_review", 1))
        response = self.request("post", f"/channels/jobs/{review['id']}/retry", json={})
        self.assertEqual(response.status_code, 202, response.json)
        self.assertEqual(self.run_jobs(), 1)
        self.assertEqual(self.provider.revision.call_count, 2)
        self.assertEqual(self.request("get", "/notifications").json["items"], inbox)
        self.assertEqual(
            next(job for job in self.jobs() if job["id"] == review["id"])["status"], "needs_review"
        )

    def test_review_cannot_be_acknowledged_even_by_a_queued_ack_job(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            for room in db.session.scalars(select(PhysicalRoom)):
                room.active = False
            db.session.commit()
        self.import_booking()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.add(
                ChannelJob(
                    tenant_id=self.tenant_id,
                    actor_id=self.owner_id,
                    kind="ack_revision",
                    payload={"revisionId": revision()["id"]},
                )
            )
            db.session.commit()
        self.assertEqual(self.run_jobs(), 1)
        self.provider.ack.assert_not_called()
        ack = next(job for job in self.jobs() if job["kind"] == "ack_revision")
        self.assertEqual((ack["status"], ack["errorCode"]), ("failed", "channel_commit_required"))

    def test_explicit_review_retry_resolves_case_then_acks_only_committed_receipt(self):
        from pms_api.channels.models import ChannelBookingReview

        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            for room in db.session.scalars(select(PhysicalRoom)):
                room.active = False
            db.session.commit()
        self.import_booking()
        review_job = next(job for job in self.jobs() if job["status"] == "needs_review")
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            case = db.session.scalar(select(ChannelBookingReview))
            review_id = case.id
            for sensitive in ("fixture-sensitive-card", "guest@test.local", "0123", "guarantee"):
                self.assertNotIn(sensitive, str(case.details))
            db.session.get(PhysicalRoom, "room-a-101").active = True
            db.session.commit()
        response = self.request("post", f"/channels/jobs/{review_job['id']}/retry", json={})
        self.assertEqual(response.status_code, 202, response.json)
        self.assertEqual(self.run_jobs(), 1)
        self.provider.ack.assert_not_called()
        self.clear_push_jobs()
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            case = db.session.get(ChannelBookingReview, review_id)
            self.assertIsNotNone(case.resolved_at)
            self.assertEqual(db.session.scalar(select(ChannelRevision.outcome)), "imported")
            self.assertEqual(
                db.session.scalar(select(func.count()).select_from(ReservationRoom)), 1
            )
        self.assertEqual(self.run_jobs(), 1)
        self.provider.ack.assert_called_once_with(revision()["id"])

    def test_later_cancellation_resolves_overbooking_review_without_assigning_rooms(self):
        from pms_api.channels.models import ChannelBookingReview

        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            for room in db.session.scalars(select(PhysicalRoom)):
                room.active = False
            db.session.commit()
        self.import_booking()
        review_job = next(job for job in self.jobs() if job["status"] == "needs_review")
        self.provider.booking.return_value = {
            "id": revision()["attributes"]["booking_id"],
            "type": "booking",
            "attributes": {"status": "cancelled", "revision_id": revision(12)["id"]},
        }
        self.import_booking(revision(12, "cancelled"))
        self.provider.ack.assert_not_called()
        state = self.counts()
        self.assertEqual((state["reservations"], state["assigned"]), (0, 0))
        self.assertEqual(state["reviews"], {})
        self.assertEqual(
            state["receipts"],
            {
                revision()["id"]: "stale",
                revision(12)["id"]: "cancelled",
            },
        )
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertIsNotNone(db.session.scalar(select(ChannelBookingReview.resolved_at)))
        resolved_job = next(job for job in self.jobs() if job["id"] == review_job["id"])
        self.assertEqual((resolved_job["status"], resolved_job["errorCode"]), ("succeeded", None))
        self.assertEqual(self.import_direct(revision()), "stale")
        self.run_jobs(5)
        self.assertCountEqual(
            [call.args[0] for call in self.provider.ack.call_args_list],
            [revision()["id"], revision(12)["id"]],
        )

    def test_review_history_is_paginated_safe_and_tenant_scoped_with_read_only_access(self):
        from pms_api.channels.models import ChannelBookingReview

        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            for room in db.session.scalars(select(PhysicalRoom)):
                room.active = False
            db.session.commit()
        first, second = revision(), revision(11, booking_id=str(UUID(int=99)))
        for entity in (first, second):
            entity["attributes"]["raw_message"] = "fixture-private-raw-message"
            self.import_booking(entity)
        pages = []
        for page in (1, 2):
            response = self.request("get", f"/channels/booking-reviews?page={page}&pageSize=1")
            self.assertEqual(response.status_code, 200, response.json)
            self.assertEqual(
                response.json["pagination"],
                {
                    "page": page,
                    "pageSize": 1,
                    "totalItems": 2,
                    "totalPages": 2,
                },
            )
            self.assertEqual(len(response.json["items"]), 1)
            pages.extend(response.json["items"])
            for sensitive in (
                "fixture-sensitive-card",
                "guest@test.local",
                "fixture-private-raw-message",
                "guarantee",
                "raw_message",
                "customer",
            ):
                self.assertNotIn(sensitive, response.get_data(as_text=True))
        self.assertCountEqual([item["revisionId"] for item in pages], [first["id"], second["id"]])
        jobs_by_id = {job["id"]: job for job in self.jobs()}
        for item in pages:
            self.assertEqual(item["jobStatus"], "needs_review")
            self.assertEqual(jobs_by_id[item["jobId"]]["revisionId"], item["revisionId"])
        target = pages[1]  # This pending review is absent from the unfiltered first page.
        target_path = f"/channels/booking-reviews?reviewId={target['id']}&pageSize=1"
        selected = self.request("get", target_path)
        self.assertEqual(selected.status_code, 200, selected.json)
        self.assertEqual(selected.json["items"], [target])
        self.assertEqual(
            selected.json["pagination"],
            {
                "page": 1,
                "pageSize": 1,
                "totalItems": 1,
                "totalPages": 1,
            },
        )
        normalized = self.request(
            "get",
            f"/channels/booking-reviews?reviewId={target['id'].upper()}",
        )
        self.assertEqual(normalized.status_code, 200, normalized.json)
        self.assertEqual(normalized.json["items"], [target])
        next_page = self.request("get", target_path + "&page=2")
        self.assertEqual(next_page.status_code, 200, next_page.json)
        self.assertEqual(next_page.json["items"], [])
        self.assertEqual(next_page.json["pagination"]["totalItems"], 1)
        for invalid in ("", "not-a-uuid", "00000000-0000-0000-0000-00000000000g"):
            rejected = self.request("get", f"/channels/booking-reviews?reviewId={invalid}")
            self.assertEqual(rejected.status_code, 422, rejected.json)
            self.assertEqual(rejected.json["error"]["code"], "invalid_filter")
        duplicate = self.request("get", target_path + f"&reviewId={pages[0]['id']}")
        self.assertEqual(duplicate.status_code, 422, duplicate.json)
        self.assertEqual(duplicate.json["error"]["code"], "invalid_query")
        missing = self.request("get", f"/channels/booking-reviews?reviewId={UUID(int=999999)}")
        self.assertEqual(missing.status_code, 200, missing.json)
        self.assertEqual(missing.json["items"], [])
        self.assertEqual(missing.json["pagination"]["totalItems"], 0)
        self.assertEqual(self.request("get", "/channels").json["bookingReviewCount"], 2)
        desk, desk_headers = self.login("frontdesk@test.local")
        readable = self.request(
            "get", "/channels/booking-reviews", client=desk, headers=desk_headers
        )
        self.assertEqual(readable.status_code, 200, readable.json)
        readable_target = self.request("get", target_path, client=desk, headers=desk_headers)
        self.assertEqual(readable_target.status_code, 200, readable_target.json)
        self.assertEqual(readable_target.json["items"], [target])
        denied = self.request(
            "post",
            f"/channels/jobs/{pages[0]['jobId']}/retry",
            json={},
            client=desk,
            headers=desk_headers,
        )
        self.assertEqual(denied.status_code, 403, denied.json)
        housekeeping, housekeeping_headers = self.login("hk@test.local")
        denied_read = self.request(
            "get",
            target_path,
            client=housekeeping,
            headers=housekeeping_headers,
        )
        self.assertEqual(denied_read.status_code, 403, denied_read.json)
        other, other_headers = self.login("owner-b@test.local")
        forbidden = self.request(
            "get", "/channels/booking-reviews", client=other, headers=other_headers
        )
        self.assertEqual(forbidden.status_code, 403, forbidden.json)
        isolated = self.request(
            "get",
            f"/api/tenants/{self.other_tenant_id}/channels/booking-reviews",
            client=other,
            headers=other_headers,
        )
        self.assertEqual(isolated.status_code, 200, isolated.json)
        self.assertEqual(isolated.json["items"], [])
        isolated_target = self.request(
            "get",
            f"/api/tenants/{self.other_tenant_id}/channels/booking-reviews?reviewId={target['id']}",
            client=other,
            headers=other_headers,
        )
        self.assertEqual(isolated_target.status_code, 200, isolated_target.json)
        self.assertEqual(isolated_target.json["items"], [])
        self.assertEqual(isolated_target.json["pagination"]["totalItems"], 0)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.get(ChannelBookingReview, target["id"]).resolved_at = utcnow()
            db.session.commit()
        resolved = self.request("get", target_path)
        self.assertEqual(resolved.status_code, 200, resolved.json)
        self.assertEqual(resolved.json["items"], [])
        self.assertEqual(resolved.json["pagination"]["totalItems"], 0)
        remaining = self.request("get", "/channels/booking-reviews")
        self.assertEqual([item["id"] for item in remaining.json["items"]], [pages[0]["id"]])
        self.assertEqual(self.request("get", "/channels").json["bookingReviewCount"], 1)

    def test_review_retry_cannot_change_the_provider_booking_identity(self):
        from pms_api.channels.models import ChannelBookingReview

        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            for room in db.session.scalars(select(PhysicalRoom)):
                room.active = False
            db.session.commit()
        original = revision()
        self.assertEqual(self.import_direct(original), "needs_review")
        changed = deepcopy(original)
        changed["attributes"]["booking_id"] = str(UUID(int=99))
        with self.assertRaises(ApiError) as raised:
            self.import_direct(changed, retry_review=True)
        self.assertEqual(raised.exception.code, "invalid_booking_revision")
        state = self.counts()
        self.assertEqual((state["reservations"], state["assigned"]), (0, 0))
        self.assertEqual(state["receipts"], {})
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(
                list(db.session.scalars(select(ChannelBooking.booking_id))),
                [original["attributes"]["booking_id"]],
            )
            self.assertEqual(
                list(db.session.scalars(select(ChannelBookingReview.booking_id))),
                [original["attributes"]["booking_id"]],
            )

    def test_migration_preserves_legacy_receipts_and_backfills_cancelled_watermark(self):
        runner = self.app.test_cli_runner()
        downgraded = runner.invoke(args=["db", "downgrade", "0023_channel_ari_pacing"])
        self.assertEqual(downgraded.exit_code, 0, downgraded.output)
        try:
            with self.app.app_context():
                set_context(self.owner_id, self.tenant_id)
                metadata = MetaData()
                legacy = {
                    name: Table(name, metadata, autoload_with=db.engine, resolve_fks=False)
                    for name in (
                        "reservations",
                        "reservation_nights",
                        "channel_bookings",
                        "channel_revisions",
                    )
                }
                stamp = utcnow()
                db.session.execute(
                    legacy["reservations"].insert(),
                    {
                        "id": "legacy-stay",
                        "tenant_id": self.tenant_id,
                        "status": "CANCELLED",
                        "check_in": date(2030, 1, 1),
                        "check_out": date(2030, 1, 3),
                        "source_name": "BookingCom",
                        "currency": "VND",
                        "guest_name": "Legacy guest",
                        "guest_phone": "",
                        "created_at": stamp,
                        "pricing_snapshot": {},
                        "base_currency": "VND",
                        "exchange_rate": 1,
                        "base_amount": 200,
                    },
                )
                db.session.execute(
                    legacy["reservation_nights"].insert(),
                    [
                        {
                            "id": f"legacy-night-{day}",
                            "tenant_id": self.tenant_id,
                            "reservation_id": "legacy-stay",
                            "room_id": "room-a-101",
                            "room_number": "101",
                            "date": date(2030, 1, day),
                            "price": 100,
                            "base_currency": "VND",
                            "exchange_rate": 1,
                            "base_amount": 100,
                        }
                        for day in (1, 2)
                    ],
                )
                db.session.execute(
                    legacy["channel_bookings"].insert(),
                    {
                        "id": "legacy-channel-booking",
                        "tenant_id": self.tenant_id,
                        "booking_id": revision()["attributes"]["booking_id"],
                        "reservation_id": "legacy-stay",
                        "latest_revision_at": stamp,
                    },
                )
                db.session.execute(
                    legacy["channel_revisions"].insert(),
                    {
                        "id": "legacy-receipt",
                        "tenant_id": self.tenant_id,
                        "booking_id": revision()["attributes"]["booking_id"],
                        "revision_id": revision()["id"],
                        "reservation_id": "legacy-stay",
                        "outcome": "imported",
                        "created_at": stamp,
                    },
                )
                db.session.commit()
                set_context(self.owner_id, self.tenant_id)
                before = list(db.session.execute(select(legacy["channel_revisions"])))
        finally:
            upgraded = runner.invoke(args=["db", "upgrade"])
            self.assertEqual(upgraded.exit_code, 0, upgraded.output)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(list(db.session.execute(select(legacy["channel_revisions"]))), before)
            self.assertEqual(db.session.scalar(select(ChannelRevision.money_snapshot)), {})
            self.assertEqual(db.session.scalar(select(ChannelBooking.latest_status)), "cancelled")
            self.assertEqual(
                list(
                    db.session.scalars(
                        text("SELECT room_type_id FROM reservation_nights ORDER BY date")
                    )
                ),
                ["rt-a", "rt-a"],
            )
            self.assertEqual(
                tuple(
                    db.session.execute(
                        text(
                            "SELECT relrowsecurity, relforcerowsecurity FROM pg_class "
                            "WHERE oid='channel_booking_reviews'::regclass"
                        )
                    ).one()
                ),
                (True, True),
            )
            with self.assertRaises(DBAPIError) as raised:
                with db.session.begin_nested():
                    db.session.execute(update(ChannelRevision).values(outcome="stale"))
            self.assertEqual(raised.exception.orig.sqlstate, "42501")
            self.assertEqual(db.session.scalar(select(ChannelRevision.outcome)), "imported")
        blocked = runner.invoke(args=["db", "downgrade", "0029_channel_dirty_ari"])
        self.assertNotEqual(blocked.exit_code, 0)
        self.assertIn("Nightly room-type history exists", str(blocked.exception))

    def test_downgrade_cannot_discard_cancellation_verification_history(self):
        self.assertEqual(self.import_direct(revision(12, "cancelled")), "cancelled")
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            verified_at = db.session.scalar(select(ChannelBooking.cancellation_verified_at))
            self.assertIsNotNone(verified_at)
        result = self.app.test_cli_runner().invoke(
            args=["db", "downgrade", "0024_channel_booking_reviews"]
        )
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("Cancellation verification history exists", str(result.exception))
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(
                db.session.scalar(select(ChannelBooking.cancellation_verified_at)), verified_at
            )
            self.assertEqual(db.session.scalar(select(ChannelRevision.outcome)), "cancelled")

    def test_review_foreign_key_cannot_reference_another_tenants_booking(self):
        from pms_api.channels.models import ChannelBookingReview

        self.assertEqual(self.import_direct(revision()), "imported")
        with self.app.app_context():
            set_context("owner-b", self.other_tenant_id)
            with self.assertRaises(IntegrityError) as raised:
                with db.session.begin_nested():
                    db.session.add(
                        ChannelBookingReview(
                            tenant_id=self.other_tenant_id,
                            revision_id=str(UUID(int=99)),
                            booking_id=revision()["attributes"]["booking_id"],
                            provider_status="new",
                            revision_at=utcnow(),
                            error_code="room_unavailable",
                            details={},
                        )
                    )
                    db.session.flush()
            self.assertEqual(raised.exception.orig.sqlstate, "23503")
            self.assertEqual(
                db.session.scalar(select(func.count()).select_from(ChannelBookingReview)), 0
            )

    def test_wrong_or_missing_entity_type_cannot_authorize_a_cancellation(self):
        for number, kind in ((10, "booking"), (11, None)):
            with self.subTest(kind=kind):
                entity = revision(number, "cancelled")
                if kind is None:
                    entity.pop("type")
                else:
                    entity["type"] = kind
                self.assertEqual(self.import_booking(entity), [])
        self.provider.ack.assert_not_called()
        state = self.counts()
        self.assertEqual(state["receipts"], {})
        self.assertEqual(state["reviews"], {})
        self.assertTrue(all(job["errorCode"] == "invalid_booking_revision" for job in self.jobs()))
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(db.session.scalar(select(func.count()).select_from(ChannelBooking)), 0)

    def test_different_revision_at_equal_timestamp_requires_review_without_releasing_room(self):
        original = revision()
        self.import_booking(original)
        self.run_jobs(5)
        self.provider.ack.reset_mock()
        conflicted = revision(11, "cancelled")
        conflicted["attributes"]["inserted_at"] = original["attributes"]["inserted_at"]
        self.import_booking(conflicted)
        self.run_jobs(5)
        self.provider.ack.assert_not_called()
        state = self.counts()
        self.assertEqual((state["reservations"], state["assigned"]), (1, 1))
        self.assertEqual(state["booked"], [1, 1])
        self.assertEqual(state["receipts"], {original["id"]: "imported"})
        self.assertEqual(state["reviews"], {conflicted["id"]: "revision_order_conflict"})
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            self.assertEqual(db.session.scalar(select(Reservation.status)), "CONFIRMED")
            self.assertEqual(
                db.session.scalar(select(ChannelBooking.latest_revision_id)), original["id"]
            )

    def test_full_page_of_unacked_reviews_does_not_starve_later_cancellation(self):
        from pms_api.channels.models import ChannelBookingReview

        first_page = []
        for number in range(100):
            entity = revision(10, booking_id=str(UUID(int=2000 + number)))
            entity["id"] = str(UUID(int=1000 + number))
            first_page.append(entity)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            for entity in first_page:
                db.session.add(
                    ChannelBooking(
                        tenant_id=self.tenant_id,
                        booking_id=entity["attributes"]["booking_id"],
                        latest_revision_at=utcnow(),
                        latest_revision_id=entity["id"],
                        latest_status="new",
                    )
                )
            db.session.flush()
            for entity in first_page:
                db.session.add(
                    ChannelBookingReview(
                        tenant_id=self.tenant_id,
                        revision_id=entity["id"],
                        booking_id=entity["attributes"]["booking_id"],
                        provider_status="new",
                        revision_at=utcnow(),
                        error_code="room_unavailable",
                        details={},
                    )
                )
            db.session.commit()
        cancellation = revision(12, "cancelled", booking_id=str(UUID(int=9999)))
        self.provider.booking.return_value = {
            "id": cancellation["attributes"]["booking_id"],
            "type": "booking",
            "attributes": {"status": "cancelled", "revision_id": cancellation["id"]},
        }

        def feed(property_id, page=1):
            self.assertEqual(property_id, PROPERTY)
            return first_page if page == 1 else [cancellation]

        self.provider.feed.side_effect = feed
        self.provider.revision.return_value = cancellation
        response = self.request("post", "/channels/jobs", json={"kind": "pull_bookings"})
        self.assertEqual(response.status_code, 202, response.json)
        self.assertEqual(self.run_jobs(), 1)
        self.provider.feed.assert_called_once_with(PROPERTY)
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            continuation = db.session.scalar(
                select(ChannelJob).where(
                    ChannelJob.status == "queued",
                    ChannelJob.kind == "pull_bookings",
                )
            )
            self.assertIsNotNone(continuation, "A full pending review page must continue the feed")
            self.assertEqual(continuation.payload["feedPage"], 2)
        self.assertEqual(self.run_jobs(), 1)
        self.assertEqual(self.provider.feed.call_count, 2)
        self.assertEqual(self.run_jobs(), 1)
        self.provider.revision.assert_called_once_with(cancellation["id"])
        self.provider.ack.assert_not_called()
        self.assertEqual(self.run_jobs(), 1)
        self.provider.ack.assert_called_once_with(cancellation["id"])
        state = self.counts()
        self.assertEqual((state["reservations"], state["assigned"]), (0, 0))
        self.assertEqual(len(state["reviews"]), 100)
        self.assertEqual(state["receipts"], {cancellation["id"]: "cancelled"})


class ChannelOccupancyValidationTests(TestCase):
    def test_bool_negative_and_zero_total_occupancy_are_rejected(self):
        for occupancy in (
            {"adults": True, "children": 0, "infants": 0},
            {"adults": 1, "children": -1, "infants": 0},
            {"adults": 0, "children": 0, "infants": 0},
        ):
            with self.subTest(occupancy=occupancy):
                entity = revision()
                entity["attributes"]["rooms"][0]["occupancy"] = occupancy
                with self.assertRaises(ApiError) as raised:
                    normalize(entity, PROPERTY)
                self.assertEqual(raised.exception.code, "invalid_booking_occupancy")
