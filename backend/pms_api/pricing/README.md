# Pricing boundaries

- Hotel business date uses the configured timezone. All stay/date windows are
  half-open. Promotion stay windows require the entire stay inside the window.
- A daily price override takes precedence over weekend/LOS rules. Otherwise only
  the highest-priority eligible rule applies to each night; equal priorities use
  ascending immutable rule ID. ISO weekdays are Monday 1 through Sunday 7.
- No automatic discount stacking. An explicit valid voucher replaces promotions.
  Without one, choose the largest eligible promotion; equal values use ID order.
  Early bird defaults to at least 7 days before arrival, last minute to 0–2 days,
  inclusive. Stay N/pay M discounts the cheapest eligible nights per room, once
  per complete group of N nights. Partial groups receive no free night.
- Voucher validity checks the booking business date (`validFrom <= date < validTo`).
  Minimum total and fixed discounts use hotel base currency after rate rules,
  before discounts. Quotes consume no quota. Committed new bookings consume one
  use, including a zero-value discount; cancellation does not restore the quota.
- Booking creation, voucher redemption and room inventory share one transaction.
  A locked voucher row protects the last available quota. Tenant configuration
  changes serialize with reservation creation. Failed requests roll back all three.
- Contact edits retain existing pricing. Only confirmed bookings may change rooms
  or dates, explicitly repricing with current room rules and current FX in their
  original transaction currency. A previously used voucher retains its original
  policy and booking date and consumes no second use; its stay conditions still
  apply. Booking currency and voucher identity cannot be changed after creation.
- Manual FX means **1 unit of transaction currency = rate units of hotel base
  currency**. The shared hotel currency catalog in `pms_api/currencies.py`
  supports 20 common currencies verified against Channex staging. Apply migration
  `0042_hotel_currencies` before using the expanded catalog. FX has up to 8 decimals; money has 4,
  rounded half up. Discounts are allocated across nights with an exact final total.
  The quote exposes original base list prices and its conversion rounding delta.
- Every booking night, charge, payment, refund and ledger entry stores its base
  currency, rate and base amount. New booking charges/payments use its frozen FX;
  refunds use the original payment FX. A final refund reverses the exact remaining
  base amount. Later FX changes never rewrite existing records. POS/cash records
  follow the same explicit snapshot contract through `snapshot_money`.
- Legacy money rows have a rate of 1 and base currency equal to their original
  currency because no historical conversion was recorded. No guessed historical
  conversion is performed. Hotel base currency is frozen once booking, POS, cash,
  ledger or stock-document history exists.
- VOUCHER_PROMO controls explicit vouchers, promotions and their catalogs. With
  the feature disabled, ordinary quotes omit automatic promotions. MULTI_CURRENCY
  controls foreign-currency quotes and exchange-rate configuration. Permissions
  and subscription checks apply on the backend as well as in the client.
