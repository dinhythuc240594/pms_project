"""SQL channel history pagination, tenant boundaries and safe job details."""

from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from uuid import UUID

from pms_api.channels.models import ChannelJob
from pms_api.core_models import Tenant, utcnow
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase
from tests.system_scope_fixture import grant_system_access

REVISION = str(UUID(int=10))
OTHER_REVISION = str(UUID(int=11))
SAFE_JOB_FIELDS = {
    "id",
    "kind",
    "channelId",
    "revisionId",
    "status",
    "attempts",
    "errorCode",
    "start",
    "end",
    "createdAt",
    "completedAt",
}


class ChannelHistoryTests(DomainTestCase):
    start = datetime(2026, 10, 1, tzinfo=timezone.utc)

    def grant_other_hotel(self, user_id):
        grant_system_access(self, user_id, tenant_id=self.other_tenant_id)

    def add_jobs(self, *jobs):
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            for values in jobs:
                row = {
                    "tenant_id": self.tenant_id,
                    "actor_id": self.owner_id,
                    "kind": "pull_bookings",
                    "status": "succeeded",
                    "payload": {"revisionId": REVISION},
                    "created_at": self.start,
                    "available_at": self.start,
                    **values,
                }
                db.session.add(ChannelJob(**row))
            db.session.commit()

    def history(self, query=None, *, client=None, tenant=None):
        return (client or self.client).get(
            f"/api/tenants/{tenant or self.tenant_id}/channels/jobs", query_string=query or {}
        )

    def detail(self, job_id, *, client=None, tenant=None):
        return (client or self.client).get(
            f"/api/tenants/{tenant or self.tenant_id}/channels/jobs/{job_id}"
        )

    def test_older_than_snapshot_jobs_remain_searchable_and_all_pages_are_complete(self):
        jobs = [
            {"id": f"history-{number:03d}", "created_at": self.start + timedelta(minutes=number)}
            for number in range(65)
        ]
        jobs[0]["payload"] = {"revisionId": OTHER_REVISION}
        self.add_jobs(*jobs)
        snapshot = self.request("GET", "/channels")
        self.assertEqual(snapshot.status_code, 200, snapshot.json)
        self.assertEqual(len(snapshot.json["jobs"]), 50)
        self.assertNotIn("history-000", [row["id"] for row in snapshot.json["jobs"]])

        old = self.history({"revisionId": OTHER_REVISION})
        self.assertEqual(old.status_code, 200, old.json)
        self.assertEqual([row["id"] for row in old.json["items"]], ["history-000"])
        self.assertEqual(old.json["pagination"]["totalItems"], 1)
        default = self.history()
        self.assertEqual(default.status_code, 200, default.json)
        self.assertEqual(len(default.json["items"]), 25)
        self.assertEqual(default.json["pagination"]["pageSize"], 25)

        seen, cursor, snapshot_at, page = [], None, None, 1
        while True:
            query = {"pageSize": 7}
            if cursor:
                query["cursor"] = cursor
            response = self.history(query)
            self.assertEqual(response.status_code, 200, response.json)
            pagination = response.json["pagination"]
            self.assertEqual(pagination["page"], page)
            self.assertEqual(pagination["totalItems"], 65)
            self.assertEqual(pagination["totalPages"], 10)
            self.assertEqual(pagination["pageSize"], 7)
            snapshot_at = snapshot_at or pagination["snapshotAt"]
            self.assertEqual(pagination["snapshotAt"], snapshot_at)
            self.assertTrue(pagination["currentCursor"])
            seen.extend(row["id"] for row in response.json["items"])
            cursor = pagination["nextCursor"]
            if not cursor:
                break
            page += 1
            self.assertLessEqual(page, 10, "History pagination must terminate")
        self.assertEqual(seen, [f"history-{number:03d}" for number in reversed(range(65))])
        self.assertEqual(len(seen), len(set(seen)))

    def test_tied_timestamps_and_new_jobs_keep_cursor_order_count_and_replay_stable(self):
        self.add_jobs(*({"id": f"tie-{number}"} for number in range(7)))
        first = self.history({"pageSize": 3})
        self.assertEqual(first.status_code, 200, first.json)
        self.assertEqual([row["id"] for row in first.json["items"]], ["tie-6", "tie-5", "tie-4"])
        self.add_jobs({"id": "arrived-later", "created_at": utcnow()})
        cursor = first.json["pagination"]["nextCursor"]
        seen = [row["id"] for row in first.json["items"]]
        for page in (2, 3):
            response = self.history({"pageSize": 3, "cursor": cursor})
            self.assertEqual(response.status_code, 200, response.json)
            self.assertEqual(response.json["pagination"]["page"], page)
            self.assertEqual(response.json["pagination"]["totalItems"], 7)
            self.assertEqual(
                response.json["pagination"]["snapshotAt"], first.json["pagination"]["snapshotAt"]
            )
            seen.extend(row["id"] for row in response.json["items"])
            cursor = response.json["pagination"]["nextCursor"]
        self.assertIsNone(cursor)
        self.assertEqual(seen, [f"tie-{number}" for number in reversed(range(7))])
        replay = self.history({"pageSize": 3, "cursor": first.json["pagination"]["currentCursor"]})
        self.assertEqual(replay.status_code, 200, replay.json)
        self.assertEqual(replay.json["items"], first.json["items"])
        for field in ("page", "pageSize", "totalItems", "totalPages", "snapshotAt"):
            self.assertEqual(replay.json["pagination"][field], first.json["pagination"][field])
        refreshed = self.history({"pageSize": 3})
        self.assertEqual(refreshed.json["items"][0]["id"], "arrived-later")
        self.assertEqual(refreshed.json["pagination"]["totalItems"], 8)
        snapshot = self.request("GET", "/channels")
        self.assertEqual(
            [row["id"] for row in snapshot.json["jobs"]],
            ["arrived-later", *[f"tie-{number}" for number in reversed(range(7))]],
        )

    def test_combined_filters_and_totals_are_scoped_to_the_selected_tenant(self):
        matching = {
            "kind": "pull_bookings",
            "status": "failed",
            "payload": {"revisionId": REVISION},
        }
        self.add_jobs(
            {"id": "matching-1", **matching},
            {"id": "matching-2", **matching, "created_at": self.start + timedelta(hours=1)},
            {"id": "other-status", **matching, "status": "succeeded"},
            {"id": "other-kind", **matching, "kind": "ack_revision"},
            {"id": "other-revision", **matching, "payload": {"revisionId": OTHER_REVISION}},
            {"id": "missing-revision", **matching, "payload": {}},
            {"id": "before-date", **matching, "created_at": self.start - timedelta(days=2)},
            {"id": "after-date", **matching, "created_at": self.start + timedelta(days=2)},
            {
                "id": "other-tenant",
                **matching,
                "tenant_id": self.other_tenant_id,
                "actor_id": "owner-b",
            },
        )
        query = {
            "dateFrom": "2026-10-01",
            "dateTo": "2026-10-01",
            "status": "failed",
            "kind": "pull_bookings",
            "revisionId": REVISION,
            "pageSize": 1,
        }
        first = self.history(query)
        self.assertEqual(first.status_code, 200, first.json)
        self.assertEqual([row["id"] for row in first.json["items"]], ["matching-2"])
        self.assertEqual(first.json["pagination"]["totalItems"], 2)
        self.assertEqual(first.json["pagination"]["totalPages"], 2)
        second = self.history({**query, "cursor": first.json["pagination"]["nextCursor"]})
        self.assertEqual([row["id"] for row in second.json["items"]], ["matching-1"])
        self.assertEqual(second.json["pagination"]["totalItems"], 2)
        self.assertIsNone(second.json["pagination"]["nextCursor"])
        admin, _ = self.login("admin@test.local")
        self.assertEqual(self.history(query, client=admin).status_code, 403)
        self.assertEqual(
            self.history(query, client=admin, tenant=self.other_tenant_id).status_code, 403
        )
        grant_system_access(self, "admin")
        self.grant_other_hotel("admin")
        scoped = self.history(query, client=admin)
        self.assertEqual(scoped.status_code, 200, scoped.json)
        self.assertEqual(scoped.json["pagination"]["totalItems"], 2)
        other = self.history(query, client=admin, tenant=self.other_tenant_id)
        self.assertEqual(other.status_code, 200, other.json)
        self.assertEqual([row["id"] for row in other.json["items"]], ["other-tenant"])
        self.assertEqual(other.json["pagination"]["totalItems"], 1)
        empty = self.history({**query, "revisionId": str(UUID(int=99))})
        self.assertEqual(empty.status_code, 200, empty.json)
        self.assertEqual(empty.json["items"], [])
        self.assertEqual(empty.json["pagination"]["totalItems"], 0)
        self.assertEqual(empty.json["pagination"]["totalPages"], 0)
        self.assertIsNone(empty.json["pagination"]["nextCursor"])

    def test_date_filters_include_whole_hotel_local_days(self):
        # Asia/Ho_Chi_Minh: local October 1 runs from Sep 30 17:00 UTC to Oct 1 17:00 UTC.
        lower = self.start - timedelta(hours=7)
        upper = lower + timedelta(days=1)
        self.add_jobs(
            {"id": "before", "created_at": lower - timedelta(microseconds=1)},
            {"id": "first-in-day", "created_at": lower},
            {"id": "last-in-day", "created_at": upper - timedelta(microseconds=1)},
            {"id": "after", "created_at": upper},
        )
        for query, ids in (
            ({"dateFrom": "2026-10-01", "dateTo": "2026-10-01"}, ["last-in-day", "first-in-day"]),
            ({"dateFrom": "2026-10-01"}, ["after", "last-in-day", "first-in-day"]),
            ({"dateTo": "2026-10-01"}, ["last-in-day", "first-in-day", "before"]),
        ):
            with self.subTest(query=query):
                response = self.history(query)
                self.assertEqual(response.status_code, 200, response.json)
                self.assertEqual([row["id"] for row in response.json["items"]], ids)
                self.assertEqual(response.json["pagination"]["totalItems"], len(ids))
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            hotel = db.session.get(Tenant, self.tenant_id)
            hotel.settings = {**hotel.settings, "timezone": "America/New_York"}
            db.session.commit()
        changed_timezone = self.history({"dateFrom": "2026-10-01", "dateTo": "2026-10-01"})
        self.assertEqual(changed_timezone.status_code, 200, changed_timezone.json)
        self.assertEqual(
            [row["id"] for row in changed_timezone.json["items"]], ["after", "last-in-day"]
        )

    def test_each_status_and_kind_can_be_filtered(self):
        statuses = ("queued", "processing", "succeeded", "failed", "needs_review")
        kinds = (
            "push_ari",
            "pull_bookings",
            "ack_revision",
            "setup_webhook",
            "pause_mapping",
            "load_bookings",
        )
        self.add_jobs(
            *({"id": "status-" + status, "status": status} for status in statuses),
            *({"id": "kind-" + kind, "kind": kind} for kind in kinds),
        )
        for field, values in (("status", statuses), ("kind", kinds)):
            for value in values:
                with self.subTest(field=field, value=value):
                    result = self.history({field: value})
                    self.assertEqual(result.status_code, 200, result.json)
                    self.assertTrue(result.json["items"])
                    self.assertTrue(all(row[field] == value for row in result.json["items"]))
                    self.assertEqual(
                        result.json["pagination"]["totalItems"], len(result.json["items"])
                    )

    def test_list_snapshot_and_detail_expose_only_safe_job_fields(self):
        self.add_jobs(
            {
                "id": "safe-job",
                "attempts": 2,
                "error_code": "provider_unavailable",
                "dedupe_key": "private-dedupe-key",
                "completed_at": self.start + timedelta(minutes=2),
                "available_at": self.start + timedelta(minutes=1),
                "payload": {
                    "revisionId": REVISION,
                    "channelId": str(UUID(int=20)),
                    "start": "2026-10-01",
                    "end": "2026-10-05",
                    "apiKey": "private-provider-token",
                    "webhookSecret": "private-webhook-secret",
                    "password": "private-password",
                    "customer": {"email": "private-guest@test.local"},
                    "guarantee": {"card_number": "private-card-number", "cvv": "private-cvv"},
                    "revision": {"customer": {"phone": "private-phone-number"}},
                },
            }
        )
        responses = [self.history(), self.request("GET", "/channels"), self.detail("safe-job")]
        for response in responses:
            self.assertEqual(response.status_code, 200, response.json)
            text = response.get_data(as_text=True)
            for secret in (
                "private-dedupe-key",
                "private-provider-token",
                "private-webhook-secret",
                "private-password",
                "private-guest@test.local",
                "private-card-number",
                "private-cvv",
                "private-phone-number",
            ):
                self.assertNotIn(secret, text)
        summary = responses[0].json["items"][0]
        snapshot_job = responses[1].json["jobs"][0]
        detail = responses[2].json
        self.assertEqual(set(summary), SAFE_JOB_FIELDS)
        self.assertEqual(snapshot_job, summary)
        self.assertEqual(set(detail), SAFE_JOB_FIELDS | {"availableAt"})
        self.assertEqual({key: detail[key] for key in SAFE_JOB_FIELDS}, summary)
        self.assertEqual(
            datetime.fromisoformat(detail["availableAt"]), self.start + timedelta(minutes=1)
        )
        self.assertEqual(detail["attempts"], 2)
        self.assertEqual(detail["errorCode"], "provider_unavailable")
        frontdesk, _ = self.login("frontdesk@test.local")
        self.assertEqual(self.history(client=frontdesk).status_code, 200)
        self.assertEqual(self.detail("safe-job", client=frontdesk).json, detail)

    def test_malformed_payload_metadata_cannot_expose_nested_sensitive_data(self):
        self.add_jobs(
            {
                "id": "nested-metadata",
                "payload": {
                    key: {"apiKey": "private-nested-token"}
                    for key in ("channelId", "revisionId", "start", "end")
                },
            },
            {"id": "non-object-payload", "payload": ["private-list-payload"]},
            {
                "id": "oversized-metadata",
                "payload": {
                    key: "private-oversized-token" * 5
                    for key in ("channelId", "revisionId", "start", "end")
                },
            },
        )
        listing = self.history()
        snapshot = self.request("GET", "/channels")
        self.assertEqual(listing.status_code, 200, listing.json)
        self.assertEqual(snapshot.status_code, 200, snapshot.json)
        for job in listing.json["items"]:
            detail = self.detail(job["id"])
            self.assertEqual(detail.status_code, 200, detail.json)
            for field in ("channelId", "revisionId", "start", "end"):
                self.assertIsNone(job[field])
                self.assertIsNone(detail.json[field])
            self.assertNotIn("private-", detail.get_data(as_text=True))
        self.assertNotIn("private-", listing.get_data(as_text=True))
        self.assertNotIn("private-", snapshot.get_data(as_text=True))

    def test_authorization_and_job_lookup_never_cross_tenants(self):
        self.add_jobs(
            {"id": "own-job"},
            {"id": "other-job", "tenant_id": self.other_tenant_id, "actor_id": "owner-b"},
        )
        self.assertEqual(self.detail("other-job").status_code, 404)
        self.assertEqual(self.detail("missing").status_code, 404)
        self.assertEqual(
            self.client.get(
                f"/api/tenants/{self.tenant_id}/channels/jobs/own-job",
                query_string={"includePayload": "true"},
            ).status_code,
            422,
        )
        self.assertEqual(self.history(tenant=self.other_tenant_id).status_code, 403)
        self.assertEqual(self.detail("other-job", tenant=self.other_tenant_id).status_code, 403)
        anonymous = self.app.test_client()
        self.assertEqual(self.history(client=anonymous).status_code, 401)
        self.assertEqual(self.detail("own-job", client=anonymous).status_code, 401)
        for email in ("hk@test.local", "accountant@test.local", "owner-b@test.local"):
            client, _ = self.login(email)
            self.assertEqual(self.history(client=client).status_code, 403)
            self.assertEqual(self.detail("own-job", client=client).status_code, 403)
        admin, _ = self.login("admin@test.local")
        self.assertEqual(self.detail("own-job", client=admin).status_code, 403)
        grant_system_access(self, "admin")
        self.assertEqual(self.detail("other-job", client=admin).status_code, 404)
        self.assertEqual(
            self.detail("other-job", client=admin, tenant=self.other_tenant_id).status_code, 403
        )
        self.grant_other_hotel("admin")
        self.assertEqual(
            self.detail("other-job", client=admin, tenant=self.other_tenant_id).status_code, 200
        )

    def test_invalid_filters_pagination_and_cursor_are_rejected(self):
        for query in (
            {"pageSize": 0},
            {"pageSize": 101},
            {"pageSize": "1.5"},
            {"pageSize": "-1"},
            {"pageSize": "bad"},
            {"pageSize": ""},
            {"pageSize": "１"},
            {"page": 2},
            {"status": "finished"},
            {"status": ""},
            {"kind": "unknown"},
            {"kind": ""},
            {"revisionId": ""},
            {"revisionId": " "},
            {"revisionId": "x" * 37},
            {"dateFrom": "bad"},
            {"dateFrom": "2026-10-01T00:00:00Z"},
            {"dateFrom": "2026-02-30"},
            {"dateFrom": "0001-01-01"},
            {"dateTo": "9999-12-31"},
            {"dateFrom": "2026-1-1"},
            {"dateFrom": ""},
            {"dateTo": ""},
            {"dateFrom": "2026-10-02", "dateTo": "2026-10-01"},
            {"cursor": "bad"},
            {"cursor": ""},
            {"tenantId": self.other_tenant_id},
            [("status", "failed"), ("status", "succeeded")],
            [("pageSize", "1"), ("pageSize", "2")],
        ):
            with self.subTest(query=query):
                response = self.history(query)
                self.assertEqual(response.status_code, 422, response.json)

    def test_cursors_are_signed_and_bound_to_tenant_filters_page_size_and_session(self):
        self.add_jobs(*({"id": f"cursor-{number}", "status": "failed"} for number in range(3)))
        query = {"status": "failed", "revisionId": REVISION, "pageSize": 1}
        first = self.history(query)
        self.assertEqual(first.status_code, 200, first.json)
        cursor = first.json["pagination"]["nextCursor"]
        self.assertTrue(cursor)
        middle = len(cursor) // 2
        tampered = cursor[:middle] + ("a" if cursor[middle] != "a" else "b") + cursor[middle + 1 :]
        for changed in (
            {**query, "cursor": tampered},
            {**query, "cursor": cursor, "status": "succeeded"},
            {**query, "cursor": cursor, "revisionId": OTHER_REVISION},
            {**query, "cursor": cursor, "pageSize": 2},
            {**query, "cursor": cursor, "dateFrom": "2026-10-01"},
            {"pageSize": 1, "cursor": cursor},
        ):
            with self.subTest(changed=changed):
                self.assertEqual(self.history(changed).status_code, 422)
        same_owner_new_session, _ = self.login()
        self.assertEqual(
            self.history({**query, "cursor": cursor}, client=same_owner_new_session).status_code,
            422,
        )
        admin, _ = self.login("admin@test.local")
        grant_system_access(self, "admin")
        self.grant_other_hotel("admin")
        admin_first = self.history(query, client=admin)
        self.assertEqual(admin_first.status_code, 200, admin_first.json)
        cross_tenant = self.history(
            {**query, "cursor": admin_first.json["pagination"]["nextCursor"]},
            client=admin,
            tenant=self.other_tenant_id,
        )
        self.assertEqual(cross_tenant.status_code, 422)
        with patch(
            "itsdangerous.timed.TimestampSigner.get_timestamp",
            return_value=int(utcnow().timestamp()) + 86402,
        ):
            self.assertEqual(self.history({**query, "cursor": cursor}).status_code, 422)
