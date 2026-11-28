"""Business behavior at the new ports, including failure and retry boundaries."""

import unittest
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import Mock, patch

from pms_api.channels.errors import ProviderError
from pms_api.channels.factory import ChannelAdapterFactory
from pms_api.channels.policies import AvailabilityPolicy
from pms_api.channels.workflows import BookingRevisionWorkflow
from pms_api.events import EventBus
from pms_api.ports import use_runtime
from pms_api.pricing.engine import apply_pricing
from pms_api.pricing.strategies import promotion_strategy


class EventTests(unittest.TestCase):
    def test_events_are_ordered_without_duplicate_delivery(self):
        bus, received = EventBus(), []

        def first(event):
            received.append(("notification", event))

        bus.subscribe(first)
        bus.subscribe(first)
        bus.subscribe(lambda event: received.append(("ari", event)))
        event = object()
        bus.publish(event)
        self.assertEqual(received, [("notification", event), ("ari", event)])

    def test_subscriber_failure_reaches_transaction_owner(self):
        bus, later = EventBus(), Mock()
        bus.subscribe(Mock(side_effect=RuntimeError("notification insert failed")))
        bus.subscribe(later)
        with self.assertRaises(RuntimeError):
            bus.publish(object())
        later.assert_not_called()


class ChannelPatternTests(unittest.TestCase):
    def test_worker_import_releases_queue_slot_before_ack_and_keeps_import_options(self):
        from pms_api.channels.service import _run_job

        client, repository = Mock(), Mock()
        entity = {"id": "revision"}
        client.revision.return_value = entity
        receipt = SimpleNamespace(outcome="imported", revision_id="revision", booking_id="booking")
        job = SimpleNamespace(
            kind="pull_bookings",
            payload={"revisionId": "revision", "retryReview": True},
            actor_id="actor",
            status="running",
        )
        with (
            use_runtime(SimpleNamespace(revisions=repository)),
            patch("pms_api.channels.service.db") as database,
            patch("pms_api.channels.importer.import_revision", return_value=receipt) as importer,
            patch("pms_api.channels.service.queue_job") as enqueue,
        ):
            database.session.scalar.side_effect = [None, None]
            database.session.scalars.return_value.all.return_value = []
            enqueue.side_effect = lambda *args: self.assertEqual(job.status, "succeeded")
            self.assertEqual(
                _run_job("hotel", job, SimpleNamespace(property_id="property"), client),
                (receipt, True),
            )
            self.assertEqual(importer.call_args.args, ("hotel", entity, "property"))
            self.assertTrue(importer.call_args.kwargs["retry_review"])
            self.assertTrue(callable(importer.call_args.kwargs["verify_cancellation"]))
            enqueue.assert_called_once_with(
                "hotel", "actor", "ack_revision", {"revisionId": "revision"}, "ack:revision"
            )
            client.ack.assert_not_called()
            database.session.commit.assert_not_called()

    def test_worker_review_outcome_does_not_queue_or_send_ack(self):
        from pms_api.channels.service import _run_job

        client = Mock()
        client.revision.return_value = {"id": "revision"}
        receipt = SimpleNamespace(outcome="needs_review")
        job = SimpleNamespace(kind="pull_bookings", payload={"revisionId": "revision"})
        with (
            use_runtime(SimpleNamespace(revisions=Mock())),
            patch("pms_api.channels.service.db") as database,
            patch("pms_api.channels.importer.import_revision", return_value=receipt),
            patch("pms_api.channels.service.queue_job") as enqueue,
        ):
            database.session.scalar.side_effect = [None, None]
            self.assertEqual(
                _run_job("hotel", job, SimpleNamespace(property_id="property"), client),
                (receipt, True),
            )
            enqueue.assert_not_called()
            client.ack.assert_not_called()

    def test_factory_allows_another_provider_without_modifying_workers(self):
        factory, adapter = ChannelAdapterFactory(), object()
        builder = Mock(return_value=adapter)
        factory.register("fixture", builder)
        self.assertIs(factory.create("fixture", "staging", "key"), adapter)
        builder.assert_called_once_with("staging", "key")
        with self.assertRaises(ValueError):
            factory.register("fixture", builder)
        with self.assertRaises(ProviderError) as error:
            factory.create("missing", "staging", "key")
        self.assertEqual(error.exception.code, "channel_provider_unsupported")

    def test_inventory_policy_preserves_stop_sell_and_inconsistent_stock_errors(self):
        policy = AvailabilityPolicy()
        values = dict(
            capacity=4, booked=2, pause_requested=False, room_active=True, stop_sell=False
        )
        self.assertEqual(policy.calculate(**values), (2, False))
        for change in ({"pause_requested": True}, {"room_active": False}, {"stop_sell": True}):
            self.assertEqual(policy.calculate(**{**values, **change}), (0, True))
        with self.assertRaises(ProviderError) as error:
            policy.calculate(**{**values, "booked": 5})
        self.assertEqual(error.exception.code, "channel_inventory_inconsistent")

    def test_inventory_hold_closes_sales_while_inconsistent_bookings_are_reconciled(self):
        self.assertEqual(
            AvailabilityPolicy().calculate(
                capacity=1,
                booked=2,
                pause_requested=False,
                room_active=True,
                stop_sell=False,
                inventory_hold=True,
            ),
            (0, True),
        )

    def test_revision_import_queues_ack_without_acknowledging_remotely(self):
        adapter, repository, importer = Mock(), Mock(), Mock()
        adapter.revision.return_value = {"id": "revision"}
        importer.return_value = SimpleNamespace(revision_id="revision")
        workflow = BookingRevisionWorkflow(adapter, repository, importer)
        workflow.receive("hotel", "actor", "property", "revision")
        importer.assert_called_once_with("hotel", {"id": "revision"}, "property")
        repository.enqueue_ack.assert_called_once_with("hotel", "actor", "revision")
        adapter.ack.assert_not_called()

    def test_failed_import_cannot_queue_or_send_ack(self):
        adapter, repository = Mock(), Mock()
        adapter.revision.return_value = {"id": "revision"}
        workflow = BookingRevisionWorkflow(
            adapter, repository, Mock(side_effect=ValueError("conflict"))
        )
        with self.assertRaises(ValueError):
            workflow.receive("hotel", "actor", "property", "revision")
        repository.enqueue_ack.assert_not_called()
        adapter.ack.assert_not_called()

    def test_mismatched_provider_revision_cannot_mutate_bookings(self):
        adapter, repository, importer = Mock(), Mock(), Mock()
        workflow = BookingRevisionWorkflow(adapter, repository, importer)
        for entity in (None, [], {"id": "another"}):
            adapter.revision.return_value = entity
            with self.assertRaises(ProviderError):
                workflow.receive("hotel", "actor", "property", "revision")
        importer.assert_not_called()
        repository.enqueue_ack.assert_not_called()

    def test_ack_requires_receipt_and_can_retry_after_remote_failure(self):
        adapter, repository = Mock(), Mock()
        workflow = BookingRevisionWorkflow(adapter, repository, None)
        repository.has_revision.return_value = False
        with self.assertRaises(ProviderError) as error:
            workflow.acknowledge("hotel", "revision")
        self.assertEqual(error.exception.code, "channel_commit_required")
        adapter.ack.assert_not_called()
        repository.has_revision.return_value = True
        adapter.ack.side_effect = [ProviderError("provider_unavailable", retryable=True), None]
        with self.assertRaises(ProviderError):
            workflow.acknowledge("hotel", "revision")
        workflow.acknowledge("hotel", "revision")
        self.assertEqual(adapter.ack.call_count, 2)
        repository.has_revision.assert_called_with("hotel", "revision")


class PricingStrategyTests(unittest.TestCase):
    def test_percentage_keeps_four_decimal_rounding(self):
        result = promotion_strategy("advance").discount(
            {"percent": "12.5"}, [{"price": "100.0001"}, {"price": "50.0000"}]
        )
        self.assertEqual(result, Decimal("18.7500"))

    def test_stay_pay_uses_cheapest_nights_per_room_without_combining_rooms(self):
        result = promotion_strategy("staypay").discount(
            {"stayN": 3, "payM": 2},
            [{"room": "a", "price": str(price)} for price in (30, 10, 20, 40, 60, 50)]
            + [{"room": "b", "price": "5"}, {"room": "b", "price": "5"}],
        )
        self.assertEqual(result, Decimal(30))

    def test_quote_can_run_with_an_injected_repository_without_flask_or_database(self):
        repository = Mock()
        repository.tenant.return_value = SimpleNamespace(settings={"currency": "VND"})
        repository.rules.return_value = []
        with (
            use_runtime(SimpleNamespace(pricing=repository)),
            patch(
                "pms_api.pricing.engine.utcnow",
                return_value=datetime(2026, 10, 18, tzinfo=timezone.utc),
            ),
            patch("pms_api.subscriptions.feature_enabled", return_value=False),
        ):
            quote = apply_pricing(
                "hotel",
                [
                    {
                        "room": "101",
                        "roomTypeId": "standard",
                        "date": "2026-10-19",
                        "price": "100.1234",
                    }
                ],
                date(2026, 10, 19),
                date(2026, 10, 20),
            )
        self.assertEqual(quote["total"], "100.1234")
        self.assertEqual(quote["baseAmount"], "100.1234")
        self.assertEqual(quote["pricingSnapshot"]["businessDate"], "2026-10-18")
        repository.rules.assert_called_once_with("hotel")
        repository.promotions.assert_not_called()
        repository.voucher_by_code.assert_not_called()
        repository.add_redemption.assert_not_called()
