"""Run the real worker, database and HTTP client against the local ARI simulation."""

import os
import unittest
from datetime import date
from unittest.mock import patch
from urllib.parse import urlsplit

from pms_api.catalog.models import DailyRate
from pms_api.channels.client import ChannexClient
from pms_api.extensions import db
from pms_api.security import set_context
from tests.test_channels_integration import REMOTE_RATE, REMOTE_ROOM, ChannelTestCase


@unittest.skipUnless(
    os.environ.get("CHANNEX_RATE_SIMULATION_URL"), "Start the local rate simulation."
)
class ChannelRateHttpTests(ChannelTestCase):
    def start_scenario(self, scenario):
        url = os.environ["CHANNEX_RATE_SIMULATION_URL"]
        target = urlsplit(url)
        if (
            target.scheme != "http"
            or target.hostname != "127.0.0.1"
            or target.username
            or target.password
        ):
            raise ValueError("ARI simulations must use loopback HTTP.")
        self.patch_provider.stop()
        bases = patch.dict(
            "pms_api.channels.client.BASES", {"staging": url.rstrip("/") + f"/{scenario}/api/v1"}
        )
        bases.start()
        self.addCleanup(bases.stop)
        self.http = ChannexClient("staging", "fixture-api-key")
        self.http._request("POST", "/_test/reset", {})

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
        return self.jobs()[0], self.http._request("GET", "/_test/state")["data"]

    def test_verified_variable_prices_open_only_after_readback(self):
        self.start_scenario("ok")
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            db.session.add(
                DailyRate(
                    tenant_id=self.tenant_id, room_type_id="rt-a", date=date(2030, 1, 2), price=160
                )
            )
            db.session.commit()
        job, stored = self.publish()
        self.assertEqual(job["status"], "succeeded")
        self.assertEqual(stored["availability"][REMOTE_ROOM], {"2030-01-01": 2, "2030-01-02": 2})
        self.assertEqual(stored["restrictions"][REMOTE_RATE]["2030-01-02"]["rate"], "160.0000")
        events = stored["events"]
        self.assertLess(events.index("GET restrictions"), len(events) - 1)
        self.assertEqual(events[-1], "POST availability")

    def test_rate_failure_keeps_zero_and_does_not_send_open(self):
        self.start_scenario("rate_fail")
        job, stored = self.publish()
        self.assertEqual((job["status"], job["errorCode"]), ("queued", "provider_unavailable"))
        self.assertEqual(set(stored["availability"][REMOTE_ROOM].values()), {0})
        self.assertEqual(stored["events"].count("POST availability"), 1)

    def test_stale_price_readback_cannot_open(self):
        self.start_scenario("stale_rate")
        job, stored = self.publish()
        self.assertEqual((job["status"], job["errorCode"]), ("queued", "channel_rate_unverified"))
        self.assertEqual(set(stored["availability"][REMOTE_ROOM].values()), {0})
        self.assertEqual(stored["events"].count("POST availability"), 1)

    def test_close_failure_does_not_change_prices(self):
        self.start_scenario("close_fail")
        job, stored = self.publish()
        self.assertEqual((job["status"], job["errorCode"]), ("queued", "provider_unavailable"))
        self.assertNotIn("POST restrictions", stored["events"])
