"""Actual PostgreSQL proofs for price priority, atomic quotas and frozen FX."""

from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from decimal import Decimal
from threading import Barrier

from sqlalchemy import select

from pms_api.bookings.models import LedgerEntry
from pms_api.core_models import Plan, Tenant
from pms_api.extensions import db
from pms_api.security import set_context
from tests.domain_fixture import DomainTestCase


class PricingIntegrationTests(DomainTestCase):
    def test_direct_booking_defaults_to_hotel_currency_without_exchange_rate(self):
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            tenant = db.session.get(Tenant, self.tenant_id)
            tenant.settings = {**(tenant.settings or {}), "currency": "USD"}
            db.session.commit()
        stay = self.stay(guests=[{"name": "Foreign walk-in", "nationality": "US"}])
        quoted = self.request("POST", "/quote", stay)
        self.assertEqual(quoted.status_code, 200, quoted.json)
        self.assertEqual(quoted.json["currency"], "USD")
        self.assertEqual(quoted.json["baseCurrency"], "USD")
        self.assertEqual(Decimal(quoted.json["exchangeRate"]), Decimal(1))
        self.assertEqual(Decimal(quoted.json["total"]), Decimal(300))
        created = self.request("POST", "/reservations", stay)
        self.assertEqual(created.status_code, 201, created.json)
        self.assertEqual(created.json["currency"], "USD")
        self.assertEqual(created.json["baseCurrency"], "USD")
        self.assertEqual(Decimal(created.json["exchangeRate"]), Decimal(1))
        self.assertEqual(Decimal(created.json["total"]), Decimal(300))
        self.assertEqual(Decimal(created.json["baseAmount"]), Decimal("300"))
        reloaded = self.request("GET", f"/reservations/{created.json['id']}")
        self.assertEqual(reloaded.status_code, 200, reloaded.json)
        self.assertEqual(reloaded.json["currency"], "USD")
        self.assertEqual(Decimal(reloaded.json["exchangeRate"]), Decimal(1))

    def stay(self, **changes):
        start = date.today() + timedelta(days=15)
        return {
            "guest": "Price guest",
            "room": "101",
            "sourceId": "direct-a",
            "checkIn": start.isoformat(),
            "checkOut": (start + timedelta(days=3)).isoformat(),
            **changes,
        }

    def config(self, kind, values):
        response = self.request("POST", f"/pricing/{kind}", values)
        self.assertEqual(response.status_code, 201, response.json)
        return response.json

    def test_daily_override_beats_rule_and_single_rule_priority(self):
        self.config(
            "rules",
            {
                "name": "Weekend",
                "kind": "weekend",
                "weekdays": list(range(1, 8)),
                "adjustmentPercent": "50",
                "priority": 10,
            },
        )
        self.config(
            "rules",
            {
                "name": "Long stay",
                "kind": "los",
                "minNights": 3,
                "adjustmentPercent": "-10",
                "priority": 20,
            },
        )
        stay = self.stay()
        response = self.request(
            "PUT",
            "/rates",
            {
                "roomTypeId": "rt-a",
                "start": stay["checkIn"],
                "end": (date.fromisoformat(stay["checkIn"]) + timedelta(days=1)).isoformat(),
                "price": "200",
                "stopSell": False,
            },
        )
        self.assertEqual(response.status_code, 200, response.json)
        quote = self.request("POST", "/quote", stay)
        self.assertEqual(quote.status_code, 200, quote.json)
        self.assertEqual(Decimal(quote.json["total"]), Decimal(380))
        self.assertEqual(quote.json["nightlyRates"][0]["priceSource"], "daily")

    def test_promotions_choose_largest_and_explicit_voucher_replaces_it(self):
        self.config(
            "promotions",
            {"name": "Advance", "kind": "earlybird", "minDaysBefore": 7, "percent": "10"},
        )
        self.config("promotions", {"name": "3 pay 2", "kind": "staypay", "stayN": 3, "payM": 2})
        quote = self.request("POST", "/quote", self.stay())
        self.assertEqual(Decimal(quote.json["total"]), Decimal(200))
        self.assertEqual(quote.json["pricingSnapshot"]["discount"]["kind"], "staypay")
        self.config(
            "vouchers",
            {
                "name": "Small voucher",
                "code": "welcome",
                "discountType": "percent",
                "value": "5",
                "usageLimit": 1,
            },
        )
        quote = self.request("POST", "/quote", self.stay(voucherCode="WELCOME"))
        self.assertEqual(Decimal(quote.json["total"]), Decimal(285))
        self.assertEqual(self.request("GET", "/pricing").json["vouchers"][0]["usedCount"], 0)

    def test_voucher_validity_conditions_and_failed_booking_do_not_consume(self):
        voucher = self.config(
            "vouchers",
            {
                "name": "Limits",
                "code": "LIMIT",
                "discountType": "fixed",
                "value": "30",
                "minNights": 3,
                "minTotal": "250",
                "usageLimit": 1,
                "validFrom": date.today().isoformat(),
                "validTo": (date.today() + timedelta(days=1)).isoformat(),
            },
        )
        bad = self.request(
            "POST",
            "/reservations",
            self.stay(voucherCode="LIMIT", guests=[{"name": "A"}, {"name": "B"}, {"name": "C"}]),
        )
        self.assertEqual(bad.status_code, 422, bad.json)
        self.assertEqual(self.request("GET", "/pricing").json["vouchers"][0]["usedCount"], 0)
        created = self.request("POST", "/reservations", self.stay(voucherCode="LIMIT"))
        self.assertEqual(created.status_code, 201, created.json)
        self.assertEqual(Decimal(created.json["total"]), Decimal(270))
        changed = self.request(
            "PATCH", "/pricing/vouchers", {"id": voucher["id"], "active": False, "value": "80"}
        )
        self.assertEqual(changed.status_code, 200, changed.json)
        edited = self.request(
            "PATCH",
            f"/reservations/{created.json['id']}",
            {
                "checkOut": (
                    date.fromisoformat(created.json["checkOut"]) + timedelta(days=1)
                ).isoformat()
            },
        )
        self.assertEqual(edited.status_code, 200, edited.json)
        self.assertEqual(Decimal(edited.json["total"]), Decimal(370))
        self.assertEqual(edited.json["pricingSnapshot"]["discount"]["value"], "30.0000")

    def test_parallel_last_voucher_has_one_booking_and_one_redemption(self):
        self.config(
            "vouchers",
            {
                "name": "Last slot",
                "code": "LAST",
                "discountType": "percent",
                "value": "10",
                "usageLimit": 1,
            },
        )
        sessions = [self.login(), self.login()]
        barrier = Barrier(2)

        def reserve(index):
            client, headers = sessions[index]
            barrier.wait(timeout=5)
            return self.request(
                "POST",
                "/reservations",
                self.stay(room="101" if index == 0 else "102", voucherCode="LAST"),
                client=client,
                headers=headers,
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(reserve, range(2)))
        self.assertEqual(
            sorted(response.status_code for response in responses),
            [201, 409],
            [response.json for response in responses],
        )
        self.assertEqual(self.request("GET", "/pricing").json["vouchers"][0]["usedCount"], 1)
        self.assertEqual(len(self.request("GET", "/reservations").json["bookings"]), 1)

    def test_fx_booking_charge_payment_refund_keep_original_rate(self):
        saved = self.request("PUT", "/pricing/exchange-rates", {"currency": "USD", "rate": "25"})
        self.assertEqual(saved.status_code, 200, saved.json)
        fund = self.request(
            "POST", "/masters/funds", {"name": "USD cash", "currency": "USD", "type": "cash"}
        )
        self.assertEqual(fund.status_code, 201, fund.json)
        created = self.request("POST", "/reservations", self.stay(currency="USD"))
        self.assertEqual(created.status_code, 201, created.json)
        row = created.json
        self.assertEqual(Decimal(row["total"]), Decimal(12))
        self.assertEqual(Decimal(row["baseAmount"]), Decimal(300))
        self.request("PUT", "/pricing/exchange-rates", {"currency": "USD", "rate": "50"})
        charge = self.request(
            "POST",
            f"/reservations/{row['id']}/charges",
            {"serviceId": "service-a"},
            key="fx-charge-key",
        )
        self.assertEqual(charge.status_code, 201, charge.json)
        self.assertEqual(Decimal(charge.json["charges"][0]["amount"]), Decimal("0.8"))
        payment = self.request(
            "POST",
            f"/reservations/{row['id']}/payments",
            {"amount": "1", "methodId": "cash-a", "fundId": fund.json["id"]},
            key="fx-payment-key",
        )
        self.assertEqual(payment.status_code, 201, payment.json)
        entry = payment.json["payments"][0]
        self.assertEqual(Decimal(entry["baseAmount"]), Decimal(25))
        self.assertEqual(Decimal(entry["exchangeRate"]), Decimal(25))
        refund = self.request(
            "POST",
            f"/reservations/{row['id']}/payments/{entry['id']}/refund",
            {"amount": "1", "reason": "FX original"},
            key="fx-refund-key",
        )
        self.assertEqual(refund.status_code, 201, refund.json)
        self.assertEqual(
            Decimal(refund.json["payments"][0]["refunds"][0]["baseAmount"]), Decimal(25)
        )
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            entries = list(
                db.session.scalars(
                    select(LedgerEntry).where(LedgerEntry.tenant_id == self.tenant_id)
                )
            )
            self.assertEqual(sum((entry.base_amount for entry in entries), Decimal(0)), 0)

    def test_config_changes_do_not_reprice_contact_edit_and_currency_frozen(self):
        self.config("rules", {"name": "LOS", "kind": "los", "adjustmentPercent": "10"})
        response = self.request("POST", "/reservations", self.stay())
        self.assertEqual(response.status_code, 201, response.json)
        row = response.json
        rule = self.request("GET", "/pricing").json["rules"][0]
        self.request("PATCH", "/pricing/rules", {"id": rule["id"], "adjustmentPercent": "50"})
        saved = self.request("PATCH", f"/reservations/{row['id']}", {"phone": "0912345678"})
        self.assertEqual(saved.status_code, 200, saved.json)
        self.assertEqual(saved.json["total"], row["total"])
        self.assertEqual(saved.json["pricingSnapshot"], row["pricingSnapshot"])
        self.assertEqual(
            self.request("PATCH", f"/reservations/{row['id']}", {"currency": "USD"}).status_code,
            409,
        )
        self.assertEqual(self.request("PATCH", "/settings", {"currency": "USD"}).status_code, 409)

    def test_partial_refunds_allocate_cumulative_base_without_over_refunding(self):
        self.request("PUT", "/pricing/exchange-rates", {"currency": "USD", "rate": "0.5"})
        fund = self.request(
            "POST", "/masters/funds", {"name": "Tiny USD", "currency": "USD", "type": "cash"}
        ).json
        booking = self.request("POST", "/reservations", self.stay(currency="USD")).json
        paid = self.request(
            "POST",
            f"/reservations/{booking['id']}/payments",
            {"amount": "0.0004", "methodId": "cash-a", "fundId": fund["id"]},
            key="tiny-fx-payment",
        )
        self.assertEqual(paid.status_code, 201, paid.json)
        payment = paid.json["payments"][0]
        for index in range(4):
            response = self.request(
                "POST",
                f"/reservations/{booking['id']}/payments/{payment['id']}/refund",
                {"amount": "0.0001", "reason": "Cumulative FX"},
                key=f"tiny-fx-refund-{index}",
            )
            self.assertEqual(response.status_code, 201, response.json)
        refunds = response.json["payments"][0]["refunds"]
        bases = [Decimal(refund["baseAmount"]) for refund in refunds]
        self.assertTrue(all(amount >= 0 for amount in bases))
        self.assertEqual(sum(bases, Decimal(0)), Decimal(payment["baseAmount"]))
        with self.app.app_context():
            set_context(self.owner_id, self.tenant_id)
            ledger = list(
                db.session.scalars(
                    select(LedgerEntry).where(LedgerEntry.tenant_id == self.tenant_id)
                )
            )
            self.assertEqual(sum((entry.base_amount for entry in ledger), Decimal(0)), 0)
            self.assertTrue(
                all(entry.base_amount <= 0 for entry in ledger if entry.kind == "refund")
            )

    def test_pricing_input_and_tenant_scope(self):
        row = self.config("vouchers", {"name": "Private", "code": "PRIVATE", "value": "10"})
        other, headers = self.login("owner-b@test.local")
        response = self.request(
            "PATCH",
            f"/api/tenants/{self.other_tenant_id}/pricing/vouchers",
            {"id": row["id"], "active": False},
            client=other,
            headers=headers,
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(
            self.request(
                "PUT", "/pricing/exchange-rates", {"currency": "USD", "rate": "0"}
            ).status_code,
            422,
        )
        self.assertEqual(
            self.request(
                "POST", "/pricing/rules", {"name": "Invalid", "weekdays": [True]}
            ).status_code,
            422,
        )
        desk, headers = self.login("frontdesk@test.local")
        self.assertEqual(
            self.request(
                "POST", "/pricing/rules", {"name": "Denied"}, client=desk, headers=headers
            ).status_code,
            403,
        )

    def test_disabled_advanced_features_block_explicit_inputs_and_skip_promotions(self):
        self.config("promotions", {"name": "Pro promo", "kind": "earlybird", "percent": "50"})
        self.config("vouchers", {"name": "Pro voucher", "code": "PRO", "value": "10"})
        with self.app.app_context():
            set_context(is_system=True, is_service=True)
            plan = db.session.get(Plan, "default-pro")
            plan.features = {**plan.features, "VOUCHER_PROMO": False, "MULTI_CURRENCY": False}
            db.session.commit()
        ordinary = self.request("POST", "/quote", self.stay())
        self.assertEqual(ordinary.status_code, 200, ordinary.json)
        self.assertEqual(Decimal(ordinary.json["total"]), Decimal(300))
        self.assertEqual(
            self.request("POST", "/quote", self.stay(voucherCode="PRO")).status_code, 403
        )
        self.assertEqual(
            self.request("POST", "/reservations", self.stay(currency="USD")).status_code, 403
        )
        self.assertEqual(
            self.request(
                "PUT", "/pricing/exchange-rates", {"currency": "USD", "rate": "25"}
            ).status_code,
            403,
        )
        snapshot = self.request("GET", "/pricing").json
        self.assertEqual(snapshot["vouchers"], [])
        self.assertEqual(snapshot["promotions"], [])

    def test_lastminute_boundaries_and_expired_voucher(self):
        self.config(
            "promotions",
            {
                "name": "Last minute",
                "kind": "lastminute",
                "minDaysBefore": 0,
                "maxDaysBefore": 2,
                "percent": "10",
            },
        )
        today = date.fromisoformat(self.request("GET", "/pricing").json["businessDate"])
        eligible = self.stay(
            checkIn=(today + timedelta(days=2)).isoformat(),
            checkOut=(today + timedelta(days=3)).isoformat(),
        )
        quote = self.request("POST", "/quote", eligible)
        self.assertEqual(Decimal(quote.json["total"]), Decimal(90))
        ineligible = self.stay(
            checkIn=(today + timedelta(days=3)).isoformat(),
            checkOut=(today + timedelta(days=4)).isoformat(),
        )
        quote = self.request("POST", "/quote", ineligible)
        self.assertEqual(Decimal(quote.json["total"]), Decimal(100))
        self.config(
            "vouchers",
            {"name": "Expired", "code": "OLD", "value": "10", "validTo": today.isoformat()},
        )
        rejected = self.request("POST", "/quote", self.stay(voucherCode="OLD"))
        self.assertEqual(rejected.status_code, 422, rejected.json)
        self.assertEqual(rejected.json["error"]["code"], "voucher_expired")
