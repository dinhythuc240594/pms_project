"""Closed-stay corrections keep the reservation and shared cash ledger balanced."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from zoneinfo import ZoneInfo

from pms_api.core_models import utcnow
from tests.domain_fixture import DomainTestCase


class ClosedFinanceTests(DomainTestCase):
    def closed_stay(self):
        start = utcnow().astimezone(ZoneInfo("Asia/Ho_Chi_Minh")).date()
        result = self.request(
            "post",
            "/reservations",
            {
                "guest": "Closed stay",
                "rooms": ["101"],
                "checkIn": str(start),
                "checkOut": str(start + timedelta(days=1)),
                "source": "direct-a",
            },
        )
        self.assertEqual(result.status_code, 201, result.json)
        row = result.json
        result = self.request(
            "post",
            f"/reservations/{row['id']}/payments",
            {
                "amount": "100",
                "fundId": "fund-a",
                "methodId": "cash-a",
            },
            key="closed-stay-payment",
        )
        self.assertEqual(result.status_code, 201, result.json)
        payment_id = result.json["payments"][0]["id"]
        for status in ("IN_HOUSE", "CHECKED_OUT"):
            result = self.request("post", f"/reservations/{row['id']}/status", {"status": status})
            self.assertEqual(result.status_code, 200, result.json)
        return result.json, payment_id

    def test_credit_and_debit_are_paired_zero_balance_and_idempotent(self):
        row, payment_id = self.closed_stay()
        path = f"/reservations/{row['id']}/adjustments"
        credit = {
            "type": "credit",
            "paymentId": payment_id,
            "amount": "10.0001",
            "reason": "Correction",
        }
        result = self.request("post", path, credit, key="closed-credit-001")
        self.assertEqual(result.status_code, 201, result.json)
        self.assertEqual(result.json["balance"], "0.0000")
        self.assertEqual(result.json["paid"], "89.9999")
        self.assertEqual(
            self.request("post", path, credit, key="closed-credit-001").json, result.json
        )
        debit = {
            "type": "debit",
            "amount": "7.0001",
            "reason": "Supplement",
            "fundId": "fund-a",
            "methodId": "cash-a",
        }
        result = self.request("post", path, debit, key="closed-debit-001")
        self.assertEqual(result.status_code, 201, result.json)
        self.assertEqual(result.json["balance"], "0.0000")
        self.assertEqual(result.json["paid"], "97.0000")
        workspace = self.request("get", "/workspace").json
        self.assertEqual(len(workspace["ledger"]), 3)
        self.assertEqual(self.request("get", "/cashbook").json["summary"]["closing"], "97.0000")

    def test_credit_rolls_back_without_cash_and_role_boundary_is_enforced(self):
        row, payment_id = self.closed_stay()
        path = f"/reservations/{row['id']}/adjustments"
        credit = {"type": "credit", "paymentId": payment_id, "amount": "20", "reason": "Correction"}
        fd, headers = self.login("frontdesk@test.local")
        self.assertEqual(
            self.request(
                "post", path, credit, client=fd, headers=headers, key="closed-fd-denied"
            ).status_code,
            403,
        )
        spent = self.request(
            "post",
            "/cash-documents",
            {"type": "expense", "fundId": "fund-a", "amount": "90", "description": "Spent"},
            key="closed-spend-001",
        )
        self.assertEqual(spent.status_code, 201, spent.json)
        result = self.request("post", path, credit, key="closed-no-cash-001")
        self.assertEqual(result.status_code, 409, result.json)
        current = self.request("get", f"/reservations/{row['id']}").json
        self.assertEqual(current["charges"], [])
        self.assertEqual(current["payments"][0]["refunds"], [])
        self.assertEqual(current["balance"], "0.0000")

    def test_cash_expense_and_credit_cannot_spend_same_fund_twice(self):
        row, payment_id = self.closed_stay()

        def credit():
            client, headers = self.login("accountant@test.local")
            return self.request(
                "post",
                f"/reservations/{row['id']}/adjustments",
                {
                    "type": "credit",
                    "paymentId": payment_id,
                    "amount": "80",
                    "reason": "Race correction",
                },
                client=client,
                headers=headers,
                key="closed-race-credit",
            ).status_code

        def expense():
            client, headers = self.login("accountant@test.local")
            return self.request(
                "post",
                "/cash-documents",
                {
                    "type": "expense",
                    "fundId": "fund-a",
                    "amount": "80",
                    "description": "Race spend",
                },
                client=client,
                headers=headers,
                key="closed-race-expense",
            ).status_code

        with ThreadPoolExecutor(max_workers=2) as workers:
            results = list(workers.map(lambda fn: fn(), [credit, expense]))
        self.assertEqual(sorted(results), [201, 409])
        self.assertEqual(self.request("get", "/cashbook").json["summary"]["closing"], "20.0000")
        self.assertEqual(
            self.request("get", f"/reservations/{row['id']}").json["balance"], "0.0000"
        )
