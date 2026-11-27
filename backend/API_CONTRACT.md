# PMS API contract

Hotel business routes and owner SaaS billing reads live under `/api/tenants/<tenant_id>`;
system SaaS billing management uses `/api/billing` and `/api/manager`. Cookie authentication;
mutations require `X-CSRF-Token` from `/api/auth/session` or login. JSON camelCase.
Errors `{error:{code,message,details?}}`. No automatic localStorage fallback.

GET date-range query parameters use `start_date` and `end_date`. Each endpoint
keeps its existing date/timestamp format, timezone, default bounds and inclusive
or exclusive end; the parameter names do not change these rules. Legacy aliases
remain accepted on the routes that previously used them: `start`/`end`,
`startDate`/`endDate` for cashbook and commissions, and `dateFrom`/`dateTo` for
channel job history. Repeating a range query key, even with identical values,
returns 422. A canonical key and its legacy alias may appear together only when
their values match exactly; conflicting values return 422. Clients send the
canonical names. This applies to GET query parameters; mutation JSON fields,
response fields such as `start`/`end`, and single-day `date` filters keep their
existing names.

Shared backend modules: `core_models.py`, `security.py`, `auth/routes.py`,
`admin/routes.py`, `__init__.py`, `0002_identity.py`. Shared `security` exports:
`require_tenant(action)` decorator (sets `g.tenant`, `g.user`, `g.role`),
`require_system(super_only=False)`, `ApiError(status,code,message)`,
`audit(event,entity_type,entity_id,details=None)`, `payload()` JSON-object validation.
Successful mutations commit in after_request; routes MUST NOT commit independently.
Flush when IDs/constraint checks needed. API uses transaction-local RLS context.

System roles never imply PMS access. Every hotel business route requires an
active membership and uses its hotel role, including for system accounts.
Only an ordinary HOTEL_OWNER may grant, change or revoke memberships; system
accounts cannot delegate access even with an owner membership. Existing sessions
are checked against current grants on each request. Migration
`0034_pms_tenant_authorization` applies the same boundary to PostgreSQL RLS.

HTTP implementation uses `common.CommonMethodView` handlers and `CommonURL`
registration in each module's `urls.py` (lazy `module:ViewClass`, explicit methods).
`ApiError` and JSON-object validation live in `common`; the `security` imports
remain compatible. All existing paths, endpoint names, response shapes, CSRF,
authorization, locking and idempotency contracts remain unchanged. Register new
ORM models in `pms_api/model_registry.py` independently of handler imports.

Core models: User(id String(40),name,email,password_hash,global_role,active);
Tenant(id String(40),name,status,settings JSONB); TenantUser(id,tenant_id,user_id,role,active);
AuditLog(id,tenant_id nullable,user_id,event,entity_type,entity_id,details,created_at).

S03 operational health: `GET /api/admin/operations` requires a session with
`SYSTEM_MANAGER` or `SUPER_ADMIN`; unauthenticated callers receive 401 and hotel
roles receive 403. Response contains `checkedAt`, `workers.channels` and
`workers.housekeeping` (`status: ok|missing|stale|partial`, `required`,
`uncoveredTenantCount`, `instances`). Instances report tenant scope (null means
all hotels), last heartbeat/success, age and stale threshold
`max(120 seconds, 3 × polling interval)`. A successful polling pass does not
imply all queued jobs succeeded. Channel enablement, job queue counts, booking
review counts and pending inventory/rate publication are hotel operational data
and are excluded from this SaaS response. Channel coverage describes only the
tenant scopes reported by workers; housekeeping coverage uses active hotel
metadata. Missing time values are null, not zero. No credentials, guest details
or provider payloads are returned. This read-only snapshot remains separate from `/api/ready` so
initial deploys can be database-ready before workers start. Migration
`0027_worker_health` protects heartbeat rows with forced system-only RLS.
All authenticated account roles may update their own display name through
`PATCH /api/auth/profile` with `{name}` (1–160 trimmed characters). Email, roles,
and another user's ID cannot be changed here. Migration `0019_self_service_audit`
permits INSERT-only global audit records for the actor's own profile/session events;
it grants no additional audit read, update, or delete access. Migration
`0022_merge_client_settings` joins this history with `0021_booking_commissions`;
`db upgrade` applies both branches without rewriting existing revisions.

GET `/api/audit` requires SUPER_ADMIN. Optional exact-match `tenantId`/`userId`
filters are IDs (1–40 characters); `event` is an exact-match code (1–80 characters).
Unknown IDs/events return an empty list. Optional
`start_date`/`end_date` are ISO timestamps with timezone; start is inclusive and end exclusive.
With both supplied, end must follow start. Encode `+` offsets in query strings.
`page` defaults to 1 (1–100000); `pageSize` defaults to 200 (1–200). Invalid filters
return 422. Response keeps `auditLogs` and adds
`pagination:{page,pageSize,totalItems}` (count after filtering). Results sort by
createdAt descending, then id descending for ties. Omitted filters preserve the
latest 200 records, including system events with null tenant/user IDs. Filtering
and paging happen in SQL; offset pages may shift when new events arrive.
GET `/api/tenants/<id>/audit` has the same response and filters except `tenantId`:
the URL fixes the tenant and supplying `tenantId` returns 422. Owner and system
roles may read it; other hotel roles receive 403. Each log includes
`{id,tenantId,userId,userName,event,entityType,entityId,details,ipAddress,ipInfo,createdAt}`;
`userName` is the current actor name or an empty string when unavailable.

New audit records store `ipAddress` as a canonical IPv4/IPv6 literal separately
from `details`; IPv4-mapped IPv6 is normalized to IPv4. Capture uses only
`request.remote_addr` after configured `ProxyFix` processing. With
`TRUSTED_PROXY_COUNT=0` (default), forwarded IP headers are ignored. Behind a
reverse proxy, set the count to the exact number of trusted hops and prevent
clients from reaching the API directly. `ipInfo` contains
`{version:4|6|null,scope,source}`. Scope is one of `public`, `private` (RFC1918/ULA),
`loopback`, `link_local`, `multicast`, `unspecified`, `reserved`, `shared` (CGNAT),
`unknown`, or `invalid`. Source is `direct`, `trusted_proxy`, or `unknown`.
Documentation and other non-global special-purpose ranges classify as reserved.
Legacy records and background events have `ipAddress:null` and unknown IP info;
no historical address is inferred. IP classification does not perform DNS,
geolocation, ISP, or reputation lookups and does not imply an event was blocked.
Migration `0044_audit_ip` adds two nullable columns without updating old audit
records or changing audit permissions and append-only protection.

`uid()` UUID string, `utcnow()` aware datetime. db from extensions.
Each domain model has tenant_id FK tenants.id and unique(tenant_id,id), with
composite tenant FKs for references. Domain migrations
0003_catalog -> 0004_booking -> 0005_finance -> 0006_housekeeping.
Migration helpers in `rls.py`: `protect_table(table)` creates FORCE RLS tenant
policy, `unprotect_table(table)` disables; root migration owns identity RLS.

Catalog: `catalog/models.py`, `catalog/routes.py`, `0003_catalog.py`.
Models exports RoomType(id,tenant_id,name,floor,bed_type_id,base_price,capacity,active),
PhysicalRoom(id,tenant_id,room_type_id,number,floor,area,condition,active),
Master(id,tenant_id,catalog,name,data JSONB,active),
DailyRate(id,tenant_id,room_type_id,date,price,stop_sell),
RoomBlock(id,tenant_id,room_id,start_date,end_date,reason),
RoomTypeAvailability(id,tenant_id,room_type_id,date,total_rooms,booked_rooms).
PhysicalRoom is serialized as `{id:number,uuid:id,typeId:room_type_id,floor,area,condition,active}`.
`floor` and `area` are independent, optional location labels (null or trimmed strings,
maximum 120 characters). POST/PATCH `/masters/rooms` accepts both fields; omitted
fields preserve existing values, while null or blank strings clear them to null.
Locations come from configuration rather than room-number prefixes: room `1001`
can use `floor:"10"`, and room `A101` can use `area:"Villa-A"`. Missing labels belong
in an unassigned group. New rooms default to null; migration 0032 leaves legacy
rooms unassigned and preserves their IDs, room types, bookings and other references.
Updating a room type's `roomNumbers` preserves location metadata on existing rooms
unless `floor` is explicitly supplied. New rooms inherit their room type's default floor.
Owners can change floor/area while a room has a booking; the physical room and
reservation links remain the same. Migration downgrade refuses to discard saved locations.
RoomType `{id,code,name,floor,bedTypeId,price:decimal-string,capacity,active}`.
Optional `floor` (null or a trimmed string, max 120 characters) is the default for
new rooms. Supplying it on POST/PATCH also applies it to the resulting active rooms
of that type, including the supplied `roomNumbers`; omitting it preserves existing
room locations. Null or blank clears the default and those rooms' floors.
Optional `bedTypeId` refers to a `bedTypes` master in the same tenant. New or changed
references require an active bed type; an existing inactive reference can be retained.
Null or blank clears the reference; omission preserves it. Bed types can be created
through POST `/masters/bedTypes` with `{name}` and selected immediately in the form.
Migration 0045 leaves existing defaults and bed type references null; its downgrade
refuses to discard populated room-type details.
`id` is the immutable
internal UUID; `code` is a tenant-unique business string (1–40 trimmed characters)
and preserves values such as `2` and `02`. Legacy rows may have null code; omitted
code on PATCH preserves it. Existing room, reservation and OTA references keep the UUID.
masters include roomTypes, bookingSources, services, paymentMethods, funds,
cashbookCategories.
Client accounting settings also use `cashbookCategories` with
`{name,type:"INCOME"|"EXPENSE",active}`, `commissionTypes` with `{name,active}`,
and `commissionRules` with `{name,typeId,active}`. Commission `typeId` must refer to
a type in the same tenant; new or changed references require an active type.
Existing recipients can retain a disabled type when edited. These are configuration
catalogs; they do not calculate commissions or create cash documents automatically.
Funds have `type:cash|bank` (default cash); type changes are rejected after ledger history.
Other existing settings catalog names may use Master but do not fake advanced inventory.
Unit masters are persisted per tenant. New tenants and migration 0016 receive
missing Cái, Gói, Chai, Lon, Hộp, Bộ, Kg, Lít, Lần and Đêm; custom or disabled units
are preserved. Settings saves directly to the database through the existing API.
POST/PATCH `/masters/<catalog>` (input id optional); POST `/masters/<catalog>/<id>/toggle`;
PATCH `/settings`; GET `/rates?start_date=&end_date=`; PUT `/rates` with
`{roomTypeId,start,end,price,stopSell}`; POST/DELETE `/room-blocks[/<id>]`;
GET `/availability?start_date=&end_date=&typeId=`; POST `/quote` accepts
`{checkIn,checkOut,rooms:[number,...]}` returns nightly rows and total decimal string.
Exports `catalog_snapshot(tenant_id)` => `{rooms,masters,settings}`,
`quote_stay(tenant_id,room_numbers,start_date,end_date)` returns JSON-ready quote,
`lock_inventory(tenant_id,room_type_ids,start,end)` materializes/locks availability
rows in deterministic order; `adjust_inventory(...,delta)` updates locked booked counts.
Quote rejects inactive/maintenance, block, stop sell and overlapping active stays.
Booking creation repeats these checks under inventory and room locks.

PATCH `/settings` also accepts optional hotel profile fields `phone` (40),
`contactEmail` (254), `website`/`logoUrl` (2048), `taxCode` (80), `bankName` (160),
`bankAccount` (80), `bankAccountName` (160), and `defaultLanguage:vi|en`.
Lengths are maximum trimmed string lengths; empty strings clear optional values.
Email is normalized/validated. Website permits HTTP/HTTPS; logo requires HTTPS.
Client contact writes use the same phone format as Manager: 7–15 ASCII digits,
optional leading `+`, spaces, dots, hyphens and parentheses. This applies to hotel
settings, guest profiles, housekeeping staff and suppliers; malformed values
return 422 `invalid_phone`. Tax codes remain optional numeric strings with an
optional three-digit branch suffix; existing per-field length limits apply.
Guest/supplier/source emails are validated and normalized on manual writes;
OTA provider payload ingestion keeps its existing import contract.
URLs reject embedded credentials, whitespace/control characters, backslashes,
invalid hosts and invalid ports. The server stores URLs without fetching them;
this is not an upload endpoint. `defaultLanguage` records profile metadata rather
than translating the application. Existing timezone/currency/history guards apply.
The hotel contact profile is separate from Manager's private customer/CRM profile.

Booking: `bookings/models.py`, `bookings/routes.py`, `0004_booking.py`.
Imports catalog/core exports above. Implements guest information within reservations,
reservations CRUD and cancel/checkin/checkout, clean/dirty/maintenance, charges/services, payments/refunds,
notes/history and immutable nightly prices; multiple rooms/guests; money Decimal.
Booking JSON existing aliases `{id,guest,phone,room,source,checkIn,checkOut,total,status}`
plus `{rooms:[number],guests:[{id,name,phone,email}],nightlyRates,charges,payments,
notes,history,paid,balance,currency}`. POST/PATCH `/reservations` (PATCH /<id>) accepts
old single room/guest and multiroom `rooms`/`guests`. Source accepts master ID or name.
POST `/reservations` requires a stable `Idempotency-Key` (8–128 printable ASCII
characters without spaces). Reuse it after a lost response or failed workspace
reload: replay returns the original 201 booking body and ID before checking room
availability or redeeming a voucher again. Missing/invalid keys return 422
`idempotency_required`. PATCH `/reservations/<id>`, POST
`/reservations/<id>/status` and POST `/reservations/<id>/notes` also support keyed
replay (200 for edit/status, 201 for notes); clients retrying these writes must
preserve the key and original body, including `expectedVersion`. Replay precedes
version/transition validation. Keys are unique per tenant; a changed HTTP method,
path, actor or body returns 409 `idempotency_conflict`. The booking and accepted
response commit atomically with inventory, voucher usage and audit changes.
Guest objects with existing `id` and supplied profile fields update within the same
reservation transaction. Failure rolls back both the profile and booking edit.
Unchanged historical sources remain editable after source rename/deactivation.
Booking JSON includes a positive integer `version`. PATCH `/reservations/<id>` and
POST `/reservations/<id>/status` require `expectedVersion` captured with the form;
missing/invalid values return 422 `version_required`, an outdated version returns
409 `stale_booking` without applying any change. Reload explicitly before retrying;
never obtain a new version silently to resubmit the old form. Local/OTA booking
updates and changes to linked guest profiles invalidate open booking forms.
When creating a booking or attaching an existing guest, profile fields must match
the selected current guest (409 `stale_guest` otherwise); editing a profile is done
through a booking already linked to that guest.
POST `/reservations/<id>/status` `{status,expectedVersion}`; POST `/rooms/<number>/condition` `{condition}`.
`CONFIRMED -> NO_SHOW` is permitted only on or after check-in in the hotel's
timezone. Booking JSON adds nullable `noShowAt`. NO_SHOW is terminal for stay
edits/check-in; it releases room inventory and cancels this reservation's open
housekeeping tasks without changing the room's physical condition. It preserves
night prices, charges, deposits, payments and refunds. No automatic fee, refund
or deposit conversion is posted. Staff may still add charges/payments/refunds
through the existing financial endpoints. OTA modifications/cancellations cannot
replace a locally recorded NO_SHOW; an incompatible revision stays unprocessed.
Forecast/occupancy exclude NO_SHOW. Current realized-revenue and debt reports do
not classify manually entered no-show fees; cash movements remain in the ledger.
Booking status must be a string (422 `invalid_status` otherwise); a string that
does not match an allowed transition returns 409 `invalid_transition`.
Guest information is created and edited through `/reservations`; there is no
standalone guest management endpoint. POST `/reservations/<id>/charges`,
POST `/reservations/<id>/payments`, POST `/reservations/<id>/payments/<payment_id>/refund`,
POST `/reservations/<id>/notes`; GET `/reservations/<id>` detail.
Optional guest emails must contain one `@`, nonempty local/domain parts, and no
whitespace; invalid values return 422 `invalid_guest` and roll back the mutation.
Money mutations use required Idempotency-Key (stable client intent, fingerprint,
unique tenant/key, replay same response, 409 mismatch), reservation locked first.
Existing money receipts from before method-aware fingerprints remain replayable.
Payment `{amount,methodId,fundId,note}`; charge `{serviceId?,description,quantity,
unitPrice,type:service|fee|tax|discount}`; refund `{amount,reason}`. No overpayment or
over-refund; ledger same transaction and append-only. Checkout ONLY fully paid.
Exports `booking_snapshot(tenant_id)` => `{bookings,guests,housekeepingLogs,ledger}`.
Housekeeping logs include `{createdAt,actor,actorId,room,condition}`.
New bookings acquire a shared tenant lock with refreshed settings before room locks;
payments acquire a shared fund lock before writing ledger. Configuration edits take
exclusive locks, so history guards serialize with first booking/payment creation.
Booking lock order room numbers sorted then daily inventory. Edits retain original
nightly snapshots if rooms/dates unchanged. RLS all tables, row exclusion/lock prevents races.

Root GET `/workspace` merges snapshots and `{users,tenant}`.
For HOUSEKEEPING it omits catalog `price`/`commission`/`tax` and daily-rate `price`
while retaining room identities, names, dates, and stop-sell flags. Existing guest
contact and booking financial redaction still applies; other roles retain prices.
Auth GET `/api/auth/session` returns `{user,tenants,csrfToken,expiresAt}` or401;
POST `/api/auth/login` `{email,password,remember}` same response;
POST logout, POST change-password `{currentPassword,newPassword}`.
User JSON `{id,name,email,globalRole,active,memberships:[{tenantId,role,active}]}`.
Tenant JSON `{id,name,status,...settings,rooms:number}`.
Root staff GET/POST/PATCH `/users[/<id>]` `{name,email,password?,role,active}`.
Root system GET/POST/PATCH `/api/tenants[/<id>]` creates hotel + owner
`{name,ownerName,ownerEmail,ownerPassword,status?}` or `{name,ownerUserId,status?}`
for an existing active customer account. GET `/api/audit` super admin.

## System user administration

All `/api/users` endpoints require SUPER_ADMIN; SYSTEM_MANAGER and tenant users
receive 403. This is separate from tenant staff `/api/tenants/<id>/users`.

- GET `/api/users` returns `{users:[...]}` containing only internal accounts with
  globalRole SUPER_ADMIN or SYSTEM_MANAGER, including inactive accounts, ordered
  by name/id. Each entry is the existing User JSON plus `createdAt`; passwords and
  password hashes are never serialized.
- POST `/api/users` accepts `{name,email,password,globalRole?,active?}` and returns
  the created entry with 201. Defaults: SYSTEM_MANAGER and active=true. Name is
  1–160 characters after trimming; email uses the existing normalized unique
  login identity; password is 12–128 characters. Only the two system roles and
  boolean active are valid. Unknown fields return 422; duplicate email returns 409.
- PATCH `/api/users/<id>` accepts a nonempty subset of `{name,globalRole,active}`
  and returns the accepted entry. Email/password are not editable here. A tenant
  account target returns 404. Deactivation or a role change revokes the account's
  sessions; reactivation requires a fresh login. Self-deactivation/self-demotion
  and removal of the last active Super Admin return 409. There is no DELETE route.

Changes are serialized and audited as `system_user.created`/`system_user.updated`
without credentials. Staff membership updates remain scoped to their tenant and
cannot grant global roles or remove its last active Owner.

Frontend preserves the original PMS layout and styles.
Default real API, credentials include; dev proxy `/api` ->127.0.0.1:5000.
Provider async methods retain existing names, fetch workspace after mutations.
No auth tokens stored in browser storage; selected tenant ID may persist in localStorage.
Pending financial intents retain only hashed fingerprints/opaque keys in sessionStorage
until the accepted write and workspace refresh are confirmed, allowing safe retry after reload.
Return API 401/403/errors visibly; loading prevents guard premature redirects.
Booking modal multiroom/guest and server quote; complete detail tabs via endpoints;
Settings, Users, Rates, admin tenants real API. Multiroom occupancy affects
RoomDiagram/TapeChart/helpers. Sales, Cashflow and housekeeping screens use the
domain APIs below. Future features must not show fake successful writes.
Supported role actions: owner all tenant actions; frontdesk reservations.view/write,
rooms.view,housekeeping.view/write,rates.view,guests.view/write,payments.write,
cashbook.view,dashboard.view,pos.view/write,housekeeping.manage;
HK rooms.view,housekeeping.view/write (own assigned work only);
accountant dashboard.view,reservations.view,guests.view,cashbook.view/write,reports.view,
rates.view,payments.write,pos.view/write/cancel,cashbook.reverse,finance.adjust.
All tenant roles also have workspace.view/profile.view.

## BE-06: POS and shared cash ledger

`finance/{models,routes}.py` exports `finance_snapshot`, `ledger_json`,
`lock_funds`, `fund_balance`, `ensure_available` and `local_date` for booking writes.
Every POS/cash-document/closed-booking financial mutation requires
`Idempotency-Key`. Replays return the original accepted result; a changed payload,
actor or endpoint under the same tenant/key returns 409. Money is Decimal(19,4),
serialized as decimal strings with four fractional digits. Documents retain their
original and base-currency snapshots; new rates do not rewrite posted history.

- GET `/pos/invoices?q=&status=&page=&pageSize=` returns `{posInvoices,pagination}`;
  GET `/pos/invoices/<id>` returns invoice detail.
- POST `/pos/invoices` with `{items:[{serviceId,quantity,unitPrice?}],customerName?,note?,currency?}`
  creates a DRAFT. PATCH `/pos/invoices/<id>` edits only items/customerName/note.
  Item descriptions and prices are snapshots; posted items cannot be edited.
- POST `/pos/invoices/<id>/post` with `{}` posts retail; `{bookingId}` appends
  charges to an open booking in the same transaction. Booking payments then use
  booking endpoints; posting does not create a second cash receipt.
- POST `/pos/invoices/<id>/payments` with `{amount,methodId,fundId,note?}`;
  POST `/pos/invoices/<id>/payments/<paymentId>/refund` with `{amount,reason}`.
  Refunds use the original fund and cannot exceed the unrefunded payment.
- POST `/pos/invoices/<id>/cancel` with `{reason}` appends refund/charge
  compensation. No deletion of posted items or monetary history. Closed bookings
  require the adjustment endpoint rather than cancelling historical charges.
- POST `/cash-documents` with `{type,amount,fundId,description,currency?,toFundId?,date?,categoryId?}`.
  Types: receipt, expense, withdrawal, transfer, opening. Transfer requires two
  different funds and posts equal opposite ledger entries. Only opening accepts
  a date; it must be no later than today and before existing fund history.
  One opening document per fund/currency, including after reversal.
- POST `/cash-documents/<id>/reverse` with `{reason}` appends one linked reversal.
  Original documents/ledger remain immutable. Insufficient current funds returns
  409 and rolls back the entire operation.
- GET `/cashbook?start_date=&end_date=&fundId=&fundType=&actorId=&currency=&categoryId=&documentId=&page=&pageSize=`
  returns `{ledger,cashDocuments,summary,fundBalances,pagination}`. Fund type is
  cash or bank. Summary follows `opening + income - outflow = closing` across the
  entire filtered period, independent of pagination. Both date bounds are
  inclusive business dates. `fundBalances` are actual
  current balances, independent of the period and actor filters.
- POST `/reservations/<id>/adjustments` for a CHECKED_OUT, fully paid booking:
  `{type:'credit',amount,reason,paymentId}` appends a discount plus refund;
  `{type:'debit',amount,reason,methodId,fundId}` appends a fee plus payment.
  The closed booking stays fully settled; the original payment/charge is retained.
  Only owner/accountant can adjust.

All monetary writes lock funds in sorted order using tenant/fund advisory locks,
shared with booking payments/refunds. Debits cannot make a fund negative. An
inactive historical fund remains usable only for its refund/reversal.
Workspace includes `{posInvoices,cashDocuments,ledger,cashbookActors}` for roles
that may see finance. Invoices/documents/ledger are limited to the most recent 100;
Sales uses paginated search and detail endpoints to retrieve older invoices.
Cashbook documents cover the returned ledger page and any linked reversals,
including reversals outside the requested period. Actor options contain only
`{id,name}`. Batch invoice serialization avoids queries per invoice.

Cashbook categories use the existing master endpoints with catalog
`cashbookCategories` and `{name,type:INCOME|EXPENSE,active?}`. Category assignment
is optional and only allowed on receipt/expense documents. The selected master
must be active, belong to the same tenant, and match the document direction.
Documents add nullable `{categoryId,categoryName,categoryType}` snapshots;
renaming/deactivating a category does not rewrite history. Reversal copies the
original category snapshot. `categoryId=<id>` includes historical use of an
inactive category; `categoryId=uncategorized` includes rows without classification.
Summary follows the category filter; actual fund balances remain unfiltered.
`documentId=<id>` narrows rows to that tenant's original document and linked
reversals, subject to the remaining filters. Unknown IDs return an empty page;
the parameter does not grant access to another tenant's document.

### Booking-source commissions

Migration `0021_booking_commissions` adds tenant-protected, append-only
`commission_settlements` and `commission_payouts`. Reads require `cashbook.view`;
settlement/payment require `cashbook.write`, the CASHBOOK entitlement and CSRF.

- GET `/commissions?start_date=&end_date=&currency=&sourceId=&status=&page=&pageSize=` returns
  `{items,candidates,summary:{accrued,paid,balance,currency},pagination:{page,pageSize,totalItems}}`.
  Currency uses the common hotel-currency catalog (default hotel currency).
  SQL pagination covers the combined
  list of settled and pending bookings; summary covers the full filtered result.
  Dates use the frozen settlement business date, or actual checkout in hotel
  timezone for pending bookings, with scheduled checkout as a fallback; both date endpoints are inclusive. Omitted
  start includes older history, omitted end uses today. Status is empty, UNPAID,
  PARTIAL, PAID or NEEDS_REVIEW; status filtering applies to settled items.
  Candidates are checked-out bookings not yet reconciled.
  A specific cashbook `documentId` link includes its original and reversal entries
  without the default today cutoff; explicit date filters still apply. Ordinary
  cashbook reads retain the default cutoff. This keeps saved voucher dates visible
  after changing hotel timezone.
- POST `/commissions/settle` with `{bookingId}` freezes one settlement per
  CHECKED_OUT booking. A repeat returns the existing record. New bookings retain
  source ID/name/percentage in `pricingSnapshot.commission`; later master changes
  do not change that rate. A legacy booking without a snapshot requires explicit
  `{bookingId,legacyPercent,confirmLegacyRate:true}`, with percentage 0–100.
  The API never silently substitutes today's source rate for old bookings.
- POST `/commissions/<id>/payments` with
  `{amount,fundId,categoryId?,note?}` requires `Idempotency-Key`. It records a
  positive partial/full payment up to the remaining balance, using an active
  same-currency fund with sufficient funds. Optional category must be EXPENSE.
  Settlement/payment/ledger writes are atomic. Other-currency writes also require
  MULTI_CURRENCY. This records a cash expense; it does not call a bank or OTA.

Settlement items contain `{id,bookingId,guestName,sourceId,sourceName,percent,
roomNet,baseRoomNet,amount,baseAmount,currency,baseCurrency,exchangeRate,paid,
balance,status,needsReview,date,payments}`; monetary values are decimal strings.
Payments contain `{id,cashDocumentId,fundId,amount,date,note,reversed}`. Reversing
the linked cash document restores the amount due while retaining payout history.
Candidates contain `{bookingId,guestName,sourceId,sourceName,percent,missingRate,
needsReview,currency,checkOut}`.

The basis is the sum of saved nightly room prices after room-price discounts,
excluding services, tax and fees; commission = roomNet × percent / 100. The base
amount uses the saved booking FX snapshot. Whole-bill discount charges lack room
allocation and mark the booking NEEDS_REVIEW. Post-checkout charge/refund changes
also require review. A frozen settlement is retained, but further payment is
blocked with 409 `commission_needs_review`; no automatic allocation or accounting
override is available. Locks serialize payment with booking adjustments and fund
writes; overpayment returns 409 `commission_overpayment`.

## BE-07: Housekeeping assignments and inspection

The plan calendar reads `GET /housekeeping/tasks?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`
and `/housekeeping/shifts` with the same range (end exclusive, 1–31 days).
The existing `date` query remains supported; it cannot be combined with a range.
Range responses include all matching work and preserve the housekeeper's own-work scope.
`POST /housekeeping/tasks/manual` accepts `{date,room,note?,staffId?,shiftId?}`,
where `room` is the physical room number. Owner/front desk can create and optionally
assign a task atomically. Staff must be active; an optional shift must belong to
that staff member on the same date. A room with an open task that day, a maintenance
room, or an inspection room is rejected. Creating work does not change room condition.
Tasks expose `source: manual|automatic`; manual work uses the existing `dirty` kind,
room revision, assignment/status workflow and audit logs. No schema migration is needed.

`housekeeping/{models,routes}.py` exports `housekeeping_snapshot`,
`guard_room_condition`, `invalidate_room_tasks` and `checkout_task`.
All routes below are relative to `/housekeeping` within the tenant prefix.

- GET/POST `/staff`; PATCH `/staff/<id>` with `{name,phone?,userId?,active?}`.
  A linked account must be an active HOUSEKEEPING member of the same tenant.
- GET `/shifts?date=&staffId=`; POST `/shifts`; PATCH `/shifts/<id>` with
  `{staffId,date,startTime,endTime,note?,active?}`. Times are HH:mm, same day,
  start before end. Active shifts for one staff member cannot overlap.
  POST additionally accepts `period: day|week|month` (default `day`). Repeat the
  same staff member, hours, notes and active state on consecutive dates from
  `date`: one day, seven days, or one calendar month. A month ends immediately
  before the same date in the next month, clamped to its last valid day, e.g.
  October 17–November 16 or January 31–February 27 in a non-leap year.
  The tenant mutation lock and request transaction cover the whole batch. Any
  invalid shift or overlap rolls back all created rows and logs. Batch overlap
  returns 409 `shift_overlap` with the date in `error.details.date` and a
  translatable message. Day creation keeps the single-shift response; week/month
  return `{date,throughDate,created,shifts:[...]}`. PATCH still edits only the
  selected shift and rejects `period`. No schema migration is required.
- GET `/tasks?date=` returns scoped work; POST `/tasks` with
  `{date}` generates arrival/departure/stayover/dirty tasks without duplicates.
  Checkout creates its task atomically without requiring plan generation.
- POST `/tasks` also accepts `{dates:[YYYY-MM-DD,...],staffIds?:[id,...]}` for
  one atomic batch. Select 1–31 unique dates within a 31-day inclusive span and
  up to 100 unique active staff members belonging to this hotel. Do not combine
  `date` and `dates`. Staff with linked accounts require active HOUSEKEEPING
  memberships. All participants are validated before generating any tasks.
  Omitted/empty `staffIds` generates work without assignment, as before.
  New and existing unassigned **pending** work with a current room revision is
  distributed among selected staff by their open workload on that day; ties
  rotate using cumulative workload over the selected days. Attach the earliest
  active shift belonging to the chosen staff member on the task date, or leave
  `shiftId` null when no shift exists. Existing assignments, started/inspection/
  closed tasks and maintenance/inspection rooms are preserved. Generation still
  follows the existing booking/dirty-room intents; it does not invent a daily
  task for rooms without applicable work.
  Response: `{date,dates,created,assigned,days:[{date,created,assigned}]}`;
  `date` is the first selected day. The legacy `{date}` request additionally
  retains its `tasks` response. Batch responses omit task payloads; reload the
  relevant calendar range once. A retry preserves tasks and assignments and
  reports zero new creations/assignments when there is no new pending work.
- Optional `dayPlans` adds choices for individual dates:
  `[{date,roomIds?:[physicalRoomUuid,...]|null,shifts?:[{staffId,shiftId:null|id}]}]`.
  Dates must be distinct members of `dates` (or match legacy `date`). Omitted
  dates/roomIds or null roomIds retain demand-based generation. An explicit
  room list contains 1–500 distinct active rooms of this tenant, excluding
  maintenance and inspection rooms. It restricts **both** generation and
  assignment to those rooms and creates daily cleaning work for selected rooms
  even when clean or without bookings. Existing current-revision work for a
  selected room/date, including closed work, is preserved rather than recreated.
  The additional daily intent is unique by date, room and room revision.
  Each shift override must belong to a selected employee and be active on that
  exact date. Omitted employees keep earliest-shift selection; explicit null
  means no linked shift even when active shifts exist. Validate every room and
  shift across all dates before generation, with the same atomic rollback and
  tenant mutation lock as the batch. Already assigned work retains its shift.
- POST `/tasks/<id>/assign` with `{staffId,shiftId?,revision}`.
  POST `/tasks/<id>/status` with `{status,note?,revision}`. A stale revision
  returns 409. Reassignment restarts work in pending state.

Task flow: pending -> in_progress -> inspection -> completed. An assigned
housekeeper can start and submit inspection; owner/front desk confirm clean,
send back for rework or cancel. Staff may see and update only their linked
assignments. They cannot confirm their own room as clean. Room condition is
clean/dirty/inspection/maintenance. Direct room/catalog writes cannot bypass an
assigned task or create inspection state. Inspection blocks check-in until clean.

Check-in, checkout and room configuration changes invalidate old tasks using
`housekeeping_revision`; an old occupant's task cannot clean a new stay. Planner
locks reservation references before rooms to match lifecycle writes. Staff and
shift changes cannot orphan open assignments. History is append-only and audited.
Workspace adds `{housekeepingStaff,housekeepingShifts,housekeepingTasks,
housekeepingWorkLogs,housekeepingAccounts}`. Housekeepers get only their own work;
accountants receive no housekeeping snapshot. Account options contain `{id,name}`
and are exposed only to managers of housekeeping.

`python manage.py process-housekeeping-plans --actor-email <existing-system-email>`
runs one pass; add `--watch --interval 900` for a separate polling worker, or
`--tenant <id>` to scope a pass. Actor must be an existing active SYSTEM_MANAGER
or SUPER_ADMIN and is rechecked on each pass/tenant. The worker creates no account.
This trusted CLI uses an explicit service context; that context is never granted
to an authenticated HTTP user based on their system role.
It uses each active hotel's local business date, checks current entitlements,
takes the same tenant/reservation/room locks and reuses the manual planner's
immutable task intents. Repeated passes do not duplicate tasks and can pick up
bookings created later that day. Empty background passes do not create work logs.
The HTTP API does not start or schedule this process automatically.

## BE-08: Operational and financial reports

All report paths use the tenant prefix. Dates follow the hotel's timezone; periods
include `start_date` and exclude `end_date`, with 1–366 days. Invalid dates return 422.
Money is a four-place decimal string; currencies are never combined or converted.
Omitting currency uses the tenant setting.

- GET `/reports/dashboard?date=YYYY-MM-DD` requires `dashboard.view`. Returns
  arrival/departure bookings, current distinct IN_HOUSE rooms (including rooms due
  or overdue for checkout), housekeeping alerts and a seven-day chart. Financial
  fields and booking balances are omitted for front desk. `financial` is null
  without financial permission or when REPORTS_BASIC is disabled.
- GET `/reports/revenue?start_date=&end_date=&currency=` requires `reports.view`. Each row
  contains `{date,amount,nights,reserved,reservedRooms}`. Amount/nights/reserved
  follow the selected currency; `reservedRooms` counts distinct booked rooms across
  all currencies so occupancy does not change when the monetary filter changes.
- GET `/reports/financial?start_date=&end_date=&currency=` requires `reports.view`. Returns
  `{summary,rows,snapshot,asOf,timezone,currency,definitions}`. Summary contains
  forecastRoomRevenue, roomRevenue, servedNights, adr, realizedRevenue,
  cashReceived, cashRefunded, netReceipts, income, outflow, netCash, opening, closing.
  `opening + income - outflow = closing` reconciles the cash ledger. Snapshot
  deposits/debt are current balances at asOf, independent of the selected period.

ADR uses completed room nights before the current business day, excluding services
and taxes. Realized revenue recognizes closed booking bills on actual checkout,
later adjustments on their own posting day and retail POS on posting/cancellation.
Booking-linked POS is counted once through booking charges. This is closed-bill
reporting; nightly accrual/Night Audit remains separate future work. Historical
occupancy uses the current active-room capacity, whose historical changes are not
yet snapshotted. Reports exposes these definitions to users.

### Advanced business reports

GET `/reports/business?report=&start_date=&end_date=&currency=&basis=` requires
`reports.advanced.view` and REPORTS_ADVANCED. Supported reports are source
(default), room, roomType, cancellations, nationality and discounts. Date period
is `[start_date,end_date)`, 1–366 days in hotel timezone. `basis=original|base` chooses
original currency or saved base-currency amounts; no current FX revaluation.
Response is `{report,start,end,currency,basis,timezone,asOf,rows,summary,definitions}`.

| Report | Row fields | Meaning |
| --- | --- | --- |
| source / room / roomType | `id,label,bookings,nights,servedNights,forecastRoomRevenue,roomRevenue` | Saved nightly amounts within the period; served nights ended before today for IN_HOUSE/CHECKED_OUT. Excludes CANCELLED/NO_SHOW. Room type uses the saved booking type ID and its current display name. |
| cancellations | `date,source,bookings,nights,cancelledRoomValue` | Actual local cancellation day; value is the saved full room quote, not a fee or measured lost revenue. |
| nationality | `nationality,guests,bookings,guestNights` | Current guest profile; IN_HOUSE/CHECKED_OUT stays overlapping the period, across all currencies. Unique guests per nationality; guest nights use the stay's overlap. Guest arrival/departure within a group and nationality history are not separately recorded. |
| discounts | `kind,label,code,bookings,discountAmount` | Booking created within the period, excluding CANCELLED/NO_SHOW; saved pricing-policy discount, not today's master configuration. Repricing the booking can change its snapshot. |

Money fields are four-place decimal strings; counts are integers. Summary sums
the relevant row measures. Grouped booking totals can count a multi-room or
multi-nationality booking in more than one group. The response explains these
limits; nationality does not use the monetary currency filter.

## BE-09: Plans, subscriptions and quotas

GET `/api/plans` is for system roles. POST `/api/plans`, PATCH and DELETE
`/api/plans/<id>` are Super Admin only. FREE/PRO remain defaults; additional codes
match `[A-Z][A-Z0-9_]{0,11}` and are unique and immutable once assigned. Plan fields
are `{code,name,price,priceYear,currency,maxRooms,maxUsers,features,active,deleted,pricingRules}`;
features is a boolean object, nullable plan ceilings are positive integers.
FREE has zero monthly/yearly price and at most 30 rooms/five active accounts.
`pricingRules` is `{baseRooms:15,extraRoomPrice:"0",extraRoomPriceYear:"0",
adjustments:[{aboveRooms:30,percent:"0"},{aboveRooms:50,percent:"0"},
{aboveRooms:100,percent:"0"}]}` by default. It is persisted per plan and returned
in public/admin catalogs. `baseRooms` is an integer from 1 to 1,000,000; extra
room prices are nonnegative decimals with at most 15 integer/four fractional
digits. FREE requires zero extra room prices. Each signed percentage is between
-100 and 1000, with at most four fractional digits. All three thresholds must
be present in that order. Omitted rules on PATCH preserve the current rules.
DELETE archives the plan (`deleted=true`), removes it from sale and blocks new
assignments without breaking existing subscriptions or immutable history.
PATCH `{deleted:false}` restores it. `active=false` also disables existing access.

GET `/api/public/plans` is anonymous and returns `{plans,featureLabels}` from the
same plan catalog, with only active, nonarchived plans and `Cache-Control:no-store`.
It exposes no tenant or billing records. Marketing reads this API on mount/focus;
only enabled plan features appear and unavailable API data shows an error/retry.

POST `/api/public/contact` is anonymous and accepts JSON
`{name,email,phone?,hotel?,message}`. Name/email/message are nonempty strings with
maximum lengths 120/254/4000; optional phone/hotel are strings up to 40/180.
Phone uses the existing 7–15 ASCII digit/separator format; email is normalized
and validated. Other fields, control characters in single-line fields, and
bodies over 64 KiB are rejected. Same-origin/configured-origin checks apply.
The server sends a plain-text email only to `info@lohapms.com`, using a configured
verified From address and the visitor's email as Reply-To. There is no arbitrary
recipient, HTML rendering or visitor-selected email header.

Success is HTTP 200 `{sent:true}` only after the SMTP server accepts the message;
this does not confirm inbox delivery. Missing/invalid server mail configuration
returns 503 `contact_unavailable`, provider refusal/network failure returns 502
`contact_send_failed`; validation uses `invalid_contact`, `invalid_email` or
`invalid_phone`. Mail failures do not include provider text or submitted data in
responses/logs. The form keeps visitor input when sending fails.

The existing shared PostgreSQL attempt limiter uses separate `contact:ip:` and
`contact:global` keys: at most five valid send attempts per IP and 100 total per
15 minutes across workers. Attempts are committed before SMTP is contacted;
429 `contact_rate_limited` or a database error sends no email. The route creates
no tenant record and does not store contact message bodies. SMTP credentials are
server-only `CONTACT_SMTP_HOST`, `CONTACT_SMTP_PORT`, `CONTACT_SMTP_SECURITY`,
`CONTACT_SMTP_USERNAME`, `CONTACT_SMTP_PASSWORD`, `CONTACT_SMTP_FROM`; security is
`starttls` (default port 587) or `ssl` (default 465), always verified TLS, timeout
10 seconds. See README for runtime setup. No plaintext transport is supported.

System roles may GET/PUT `/api/tenants/<id>/subscription` and GET its `/history`.
PUT accepts `{planId,roomCount,status,startDate?,endDate?,amount?,currency?,cycle?}`.
`roomCount` is a positive integer; omission on a new subscription defaults to
the plan's `baseRooms` (15 by default), capped by `maxRooms` when present. Omission
on an existing subscription preserves the registered quantity. It cannot exceed the
plan ceiling or fall below currently active rooms. Each assigned hotel has a
finite allowance `min(roomCount,maxRooms)` (or roomCount when maxRooms is null).
Registering 10 rooms permits at most 10 active rooms. Dates must include a timezone;
end must follow start; an active plan other than FREE needs a future end.
Cycle is monthly/yearly and defaults to monthly. The server calculates the amount
as `(cycle base price + max(0, roomCount - baseRooms) * cycle extra room price)`
times `(1 + percentage / 100)`. Only the highest strictly exceeded room threshold
applies to the full subtotal; percentages do not accumulate. The result rounds
half up to four decimal places and must fit the monetary limit. A legacy supplied
`amount` is validated but cannot override the calculated value; currency must
match the plan. The UI shows this calculated amount for renewals. This history
amount does not create a SaaS invoice or payment.
Subscription and append-only history commit atomically. History snapshots plan
name/code, previous plan, roomCount, amount, currency, cycle, dates, status and actor, with
actions created/changed_plan/renewed/changed_status/updated. History lists the latest
200 entries, newest first; editing plan metadata does not rewrite these snapshots.

Subscription/history have tenant RLS with system access. Tenant writes take the
tenant lock before subscription/plan locks, also used by renewal and quota checks.
Inactive, cancelled, future or expired subscriptions block tenant writes but retain
existing read access. Explicit feature=false blocks the corresponding module APIs
for reads and writes. Workspace aggregation remains scoped by tenant and role;
feature flags control module access and are not a separate confidentiality boundary.
Legacy tenants without a subscription retain read/edit access but cannot add or
reactivate rooms before receiving a registered room allowance.
Plan changes are observed on each API request; client workspace refresh/reload gets
the new configuration. Quotas cover creation/reactivation and bulk room edits;
lowering a quota preserves existing data and blocks additions above the new limit.
Tenant suspension independently blocks writes.

Workspace includes `subscription` (effectiveActive, blockedReason, raw
planFeatures, and effectiveFeatures for module reads), effective `features` for
writes, and `quota:{rooms:{used,limit},users:{used,limit}}`.
Billing/Tenants read and write these endpoints and reread the accepted server state.
Amounts in subscription history are manually recorded, not payment-gateway receipts.

## Manager feature controls and Owner access overview

The finite feature codes are DASHBOARD, ROOM_DIAGRAM, RESERVATION_VIEW,
RESERVATION_CREATE, TAPE_CHART, ARI_MANAGEMENT, HOUSEKEEPING, POS_SALES, CASHBOOK,
REPORTS_BASIC, OTA_SYNC, REPORTS_ADVANCED, INVENTORY_WAREHOUSE, MULTI_CURRENCY,
VOUCHER_PROMO and API_EXTERNAL. Commercial plans support additional codes; a feature flag
does not indicate that a future module has been implemented.

- GET `/api/features` is available to both system roles. It returns
  `{features:[{id,code,name,description,category,minPlan,enabledGlobal}],
  tenantFeatureOverrides:{tenantId:{code:override}}}`. minPlan is FREE/PRO.
  An absent global-control row means enabledGlobal=true.
- PATCH `/api/features/<code>` is SUPER_ADMIN only, accepts exactly
  `{enabledGlobal:boolean}` and returns `{feature:metadata}`. A global disable
  takes precedence over every plan and tenant grant.
- PUT `/api/tenants/<id>/feature-overrides/<code>` is available to both system
  roles. It accepts `{enabled:boolean,isTrial?:boolean,expiresAt?:timestamp|null,
  notes?:string}` and returns `{featureOverride:override}`. Defaults: isTrial=false,
  expiresAt=null and notes="". Timestamps require a timezone; notes are at most
  1000 characters. Trial grants require enabled=true and an expiry. An expiry in
  the past is stored but has no effect. Unknown fields/invalid values return 422;
  unknown feature/tenant returns 404.
- DELETE the same override URL returns `{ok:true}`, including an absent override;
  the tenant resumes its plan setting, subject to global controls.
- GET `/api/tenants/<id>/feature-overrides` is for that tenant's Owner or a system
  role, returning `{features:{code:boolean},featureOverrides:{code:override}}`.
  The feature map represents current write access; owners cannot mutate grants.

Override entries contain `{enabled,isTrial,expiresAt,notes,grantedBy,grantedAt}`;
grantedBy is the granting user's current display name. Resolution starts with the
plan (legacy tenants without a subscription default enabled), applies unexpired
tenant overrides, then global disables. Overrides cannot revive a suspended tenant
or an inactive/expired/future/cancelled subscription. Such tenants retain reads
provided by the plan, while the workspace write feature map is entirely false.
The frontend checks `subscription.effectiveFeatures` before module access and
separately blocks writes on subscription expiry; raw planFeatures remain available
to Billing. Role checks still apply when a grant enables a module.

Migration `0012_manager_features` adds `feature_controls` and
`tenant_feature_overrides` with FORCE RLS. Only Super Admin can write global
controls; only system roles can write overrides. Owners read only their hotel's
overrides. Mutations emit `feature.updated`, `feature_override.upserted` or
`feature_override.deleted` audit events in the same transaction. Downgrade refuses
to discard stored controls or grants. Run `python manage.py db upgrade` with the
target environment's migration URL before serving this code; no production
database URL is committed.

## BE-10 inventory

Tenant prefix `/api/tenants/<tenant_id>/inventory`; Owner/Accountant actions
`inventory.view` / `inventory.write`, feature `INVENTORY_WAREHOUSE`. RLS applies
to every row. Documents/movements are immutable; mutations have audit and require
`Idempotency-Key` (except catalog/recipe configuration).

- GET `/masters`: `{warehouses,itemCategories,items,suppliers,openingLocked,serviceStockLinks}`.
- POST/PATCH `/masters/<catalog>`; PATCH includes `id` in body. All references are tenant-scoped.
- POST `/documents`: `{kind,date,warehouseId,toWarehouseId?,supplierId?,note?,lines}`;
  kind `opening|receipt|issue|transfer|count`; lines
  `{itemId,quantity,unitCost?,warehouseId?,expectedVersion?}`. Count quantity is
  absolute and requires a matching stock version.
- GET `/documents?kind=&warehouseId=&start_date=&end_date=&page=&pageSize=` and `/documents/<id>`.
- POST `/documents/<id>/reverse`: `{reason}` creates compensating movements.
- GET `/stock?warehouseId=&start_date=&end_date=`: stock quantities, costs, low-stock flags
  and reconciliation. Dates inclusive; period closing is separate from current balance.
- POST `/service-stock-links`: `{serviceId,warehouseId,active,lines:[{itemId,quantity}]}`.
- POST `/pos/<invoice_id>/returns`: `{reason,lines:[{movementId,quantity}]}`;
  physical returns cannot exceed original unreturned consumption.

Opening is tenant-wide and one-time; use count corrections after opening locks.
Posting dates cannot exceed hotel today or precede the latest stock document.
Quantity/unit cost use 4 decimals; cost values use 8. Weighted average valuation,
transfers and reversals conserve value. Issues cannot produce negative stock.
Only configured POS recipes consume stock; insufficient stock rolls back the
invoice. Cancellation restores original quantities/costs. Money refunds alone
do not return goods. All stock writes commit with the shared idempotency journal.

## Day reconciliation timestamps

Confirmation responses from POST tenant `/reconciliation/confirm` and GET
`/reconciliation/history` serialize `createdAt` as ISO 8601 UTC (`+00:00`),
independently of the database session timezone. The stored business `date`,
`timezone` and snapshot are preserved; clients display the instant in that saved
hotel timezone. Existing idempotency keys replay their recorded JSON unchanged.
No migration or timestamp backfill is required for this serialization fix.

## BE-11 pricing and FX

GET tenant `/pricing` returns `{rules,vouchers,promotions,exchangeRates,baseCurrency,businessDate}`.
POST/PATCH `/pricing/rules|vouchers|promotions` use `settings.write`; PATCH body
includes `id`. Voucher/promotion features require `VOUCHER_PROMO`; exchange rates
require `MULTI_CURRENCY`.

- Rule: `{name,kind:weekend|los,roomTypeId?,priority,adjustmentPercent,weekdays,minNights,maxNights?,active}`.
  ISO weekdays Monday=1..Sunday=7. Daily override wins; otherwise highest priority
  eligible rule wins, ascending ID for ties.
- Promotion: `{name,kind:earlybird|lastminute|staypay,percent,minDaysBefore,maxDaysBefore?,minNights,stayN,payM,startDate?,endDate?,active}`.
  Stay window half-open. Stay/pay makes the cheapest eligible nights free per
  room. One largest eligible discount wins; no stacking.
- Voucher: `{name,code,discountType:percent|fixed,value,minNights,minTotal,validFrom?,validTo?,usageLimit?,active}`.
  Validity uses hotel booking date; validTo exclusive. Fixed values/minimum total
  are base currency. Explicit voucher replaces promotions. Quota consumed atomically
  only on booking creation (including zero-value redemption); cancellation does
  not restore usage. Quote never reserves quota.
- PUT `/pricing/exchange-rates`: `{currency,rate}` with a supported hotel currency;
  one foreign unit equals
  rate hotel-base units (positive, 8 decimals).
- POST `/quote` and `/reservations` accept additional `{currency?,voucherCode?}`.
  Missing currency defaults to the hotel's base currency for direct hotel bookings;
  guest nationality does not choose a currency. The client direct-booking form
  displays the hotel currency read-only and uses it for quotes and creation,
  without requiring FX configuration. Voucher entry and the Vouchers menu are hidden;
  the voucher API remains available for compatibility.
  OTA imports keep the currency and amounts supplied by Channex when the currency
  belongs to the common hotel-currency catalog.
  Different base currency requires a configured FX rate; no conversion rate is invented.
  Discounted nightly rates plus `pricingSnapshot,baseCurrency,exchangeRate,baseAmount`
  are saved by server at creation.

Old bookings retain applied policies/FX. CONFIRMED room/date changes reprice at
current FX and retain the original voucher policy and old payments; no second
redemption. Financial rows expose original money and frozen base money. Refunds
reuse payment FX; final refund conserves the remaining base amount. Cash reversals
reuse original FX. Funds have fixed currency after ledger history; payments and
transfers require matching currency. Transfers do not perform currency exchange.
Legacy financial rows retain original currency/rate 1; no historic FX is invented.

Channex is selected for BE-12. BE-10/11 make no live OTA requests.

## BE-12: Channex

Manager remote views require `SYSTEM_MANAGER` or `SUPER_ADMIN`; inactive or unknown
users fail closed. They use an explicit server-side `accountId` for every request.
Operational property reads and writes use the system OTA support scope,
with `OTA_SYNC` enabled and a matching saved property/environment.
Property listing and system-source property creation remain SaaS operations.
No automatic credential/environment fallback, hotel creation, mapping changes,
booking import/ACK, or ARI publication happens from these views.

- GET `/api/admin/channex/accounts`: `{accounts:[{id,label,environment,configured,errorCode}]}`.
  Optional `system:staging`/`system:production` sources read backend runtime
  `CHANNEX_MANAGER_API_KEY_STAGING`/`CHANNEX_MANAGER_API_KEY_PRODUCTION`.
  Existing `hotel:<tenantId>` connections use their saved encrypted or legacy
  credentials, including paused connections, through the system OTA support scope.
  Listing sources makes no provider call.
  Keys, environment variable references, ciphertext, and private provider fields are never returned.
- GET `/api/admin/channex/properties?accountId=&page=1`:
  `{environment,properties,pagination:{page,pageSize:25,totalItems,totalPages}}`.
  Fetches real Channex `/properties` with title ascending order, page and limit 25.
  Each property is `{id,name,currency,timezone,city,country,linkedHotel}`;
  `linkedHotel` is null or `{tenantId,name}` from a local property/environment match.
  Properties not linked to LOHA remain visible. Malformed or duplicate provider
  entities and inconsistent pagination fail without partial results. Page is a
  positive int32, matching the provider contract; supplied timezones must be valid IANA names.
- POST `/api/admin/channex/properties`:
  `{accountId,name,currency,timezone,country?,city?,address?,email?,phone?}`.
  Requires a system role and CSRF; only `system:staging` or `system:production`
  sources may create. Name is 1–255 characters, currency is an uppercase code from
  the common hotel-currency catalog below, timezone
  is a valid IANA name; country is two uppercase letters, city/address at most
  255 characters, email at most 254 and phone at most 32. Phone uses the same
  digit/separator format as Manager `contactPhone`; malformed phone returns 422
  `invalid_phone` before any provider call. Blank optional fields
  are omitted. The backend creates `property_type=hotel` in the Channex user's
  default group, returning 201 `{environment,property}` with the safe property DTO
  above and `linkedHotel:null`. It does not create a PMS hotel, link it, or publish
  inventory. Audit contains only the Property ID and environment. Creation is
  never retried automatically; reload/reconcile the list after an uncertain result.
  Upstream contract: [Create Property API](https://docs.channex.io/api-v.1-documentation/hotels-collection/create-property-api).
- GET `/api/admin/channex/properties/<property_id>/catalog?accountId=`:
  `{environment,property,roomTypes,ratePlans}`. The requested property is verified
  using the selected key. Rooms expose `{id,name,countOfRooms,adults,children,infants,mapped}`;
  missing counts/occupancy are null. Rates expose
  `{id,name,roomTypeId,currency,sellMode,rateMode,supported,rate,editable}`. All plans remain visible;
  support is calculated against the remote property's currency. The existing
  hotel mapping/catalog rules and response stay unchanged. Lists are bounded at 100 each.
  `rate` is the primary option's default price as a decimal string, or null when
  unavailable. `editable` permits a simple manual/per-room single primary option;
  complex, inherited, and provider read-only plans remain readable.
- GET `/api/admin/channex/properties/<property_id>/bookings?accountId=&page=1`:
  paginated latest remote bookings, including acknowledged history. The response
  allowlists display name, reference, source, dates, original amount/currency,
  room count and creation time. Contact details, cards, guarantees and notes are omitted.
  This endpoint never imports or acknowledges bookings.
- GET `/api/admin/channex/properties/<property_id>/inventory?accountId=&start_date=&end_date=`:
  inclusive `YYYY-MM-DD` range, at most 31 days. Returns dates, room availability,
  and rate/stop-sell matrices. IDs must belong to this property/catalog and dates
  must stay in the requested range. Missing/null values mean unknown, not zero.
  This endpoint never publishes inventory or rates.
- GET `/api/admin/channex/properties/<property_id>/channels?accountId=&page=1`:
  `{channels,pagination}` with safe channel identity, title, code, active status,
  nullable currency, unique mapped-rate count and property count. Counts describe
  the whole channel; a channel can serve several properties. Provider settings,
  credentials and actions are omitted. This endpoint never changes channel mappings.
  Native channel setup uses the separate mutation endpoints below.
- POST `/api/admin/channex/properties/<property_id>/room-types` and PATCH
  `/api/admin/channex/properties/<property_id>/room-types/<room_type_id>`:
  exact `{accountId,name,countOfRooms,adults,children,infants}` body. Name is 1–255
  characters, room count 1–10000, adults 1–50 and children/infants 0–50, all integers.
  Return `{roomType}` with the catalog room DTO, 201/200. Creates standard rooms
  with default occupancy equal to adults; updates preserve the existing default
  occupancy unless new adults require a reduction. No force/kind/capacity edits.
  Any saved LOHA mapping protects counts/occupancy; changing the name is allowed.
- POST `/api/admin/channex/properties/<property_id>/rate-plans`:
  exact `{accountId,name,roomTypeId,currency,rate}` body, returns `{ratePlan}` (201).
  Currency is uppercase three-letter code; rate is a nonnegative decimal string
  with at most 15 integer digits and four decimals. Creates manual/per-room,
  non-inherited rates with one primary adult occupancy option for the verified room.
- PATCH `/api/admin/channex/properties/<property_id>/rate-plans/<rate_plan_id>`:
  exact `{accountId,name,rate}` body, returns `{ratePlan}` (200). Property, room,
  currency and calculation modes cannot be changed. Complex options are not overwritten.
  Pending LOHA close-outs block edits; linked room IDs and hotel currency are validated.

Native catalog writes require CSRF and system authorization, verify remote property/resource
ownership, and use the existing linked-tenant lock to serialize with PMS mutations
and workers. Audit records contain identifiers/environment only. No deletes,
automatic retries or idempotency guarantee are provided;
reload the catalog after an uncertain response before submitting again. Default
rate edits do not publish daily ARI. Channex initializes new-room availability
to zero; daily inventory/rates still need their separate synchronization flow.

### Native OTA channel setup

All endpoints use the verified property prefix
`/api/admin/channex/properties/<property_id>`, require a system role and explicit
account source. Writes also require CSRF. Connection settings are allowlisted by
the actual adapter's descriptor; hidden fields cannot be submitted. Passwords,
tokens, private defaults and unknown settings never cross the API boundary.
Stored secrets are represented only by field names in `secrets`; blank edit
passwords preserve their stored value. Unknown advanced settings and unmentioned
mappings are merged server-side, since Channex replaces these objects wholesale.

- GET `/channel-adapters?accountId=` returns `{adapters,unavailableAdapters,groups,rateOptions}`.
  Descriptors contain `{code,name,kind,propertyMapping,mappingMode,oauth,fields,mappingFields}`.
  Only OTA descriptors are included. Unsupported OTA descriptors appear in
  `unavailableAdapters:[{code,name}]` without settings or defaults, and are disabled
  in the UI; they do not block other valid adapters. Malformed/duplicate public
  identifiers still fail the list. Individual adapter/probe/write requests retain
  full descriptor validation and reject unsupported schemas.
  Fields contain `{key,label,type,position,secret,options,rules,default?}`. Options
  are strings; conditional hidden rules contain `{apply,when,influenceField,withValue}`.
  Groups come only from the verified property's `relationships.groups`; options
  contain `{id,name,roomTypeId,occupancy}` from that property's validated catalog.
- GET `/channel-adapters/<code>?accountId=` returns `{adapter}`.
- GET `/channels/<channel_id>?accountId=` returns `{channel,adapter,rateOptions}`.
  Channel adds `{revision,editable,settings,secrets,mappings}` to the safe summary;
  mappings contain `{id,ratePlanId,settings,secrets}`. A channel spanning multiple
  properties is read-only (`editable=false`). `revision` is an opaque server HMAC
  of its current contents; stale writes return 409, including after external edits.
- POST `/channel-probe/<action>` with `{accountId,code,settings,channelId?,revision?}`.
  Action is `test_connection`, `connection_details` or `mapping_details`.
  Existing credentials are reused only after checking the channel and revision.
  Test returns `{success,message}`, connection details `{currency,available}`,
  mapping details `{rooms,pricingType,listings}`. OTA error bodies/settings are omitted.
  Rooms/rates expose only identifiers, names, occupancy and pricing/read-only metadata.
- POST `/channels` with `{accountId,code,name,groupId,settings,mappings}` creates
  one **inactive** connection and returns `{channel}` (201). Group and rate plan IDs
  must belong to the selected property. Mapping entries are `{ratePlanId,settings}`.
- PATCH `/channels/<channel_id>` with `{accountId,revision,name?,settings?,mappings?}`.
  Only rename is allowed while active. Mapping edits use `{id?,ratePlanId,settings}`;
  an existing ID is scoped to this channel and cannot change its rate plan. Omitted
  rows survive; `{id,ratePlanId,settings:null}` explicitly removes one mapping.
  Changing public connection fields while any mapping remains returns 409 to
  prevent old mappings being reused with a different OTA hotel/account. Secret
  rotation is allowed; explicitly removing all mappings in the same request also
  permits changing the public connection fields.
  Airbnb settings/mappings use its dedicated flow below instead of this bulk update.
- POST `/channels/<channel_id>/readiness` with `{accountId,revision}` returns
  `{ready,issues}`. Issue messages are local, never raw provider descriptions.
- POST `/channels/<channel_id>/activate` or `/deactivate` with
  `{accountId,revision,confirm:true}` returns `{channel}` after reloading actual state.
  Activation performs a readiness check first and starts full inventory/rate sync.
  Deactivation stops data exchange and **does not close OTA sales**; the provider may
  schedule deletion in 30 days. Airbnb requires its listing mappings removed first.
- DELETE `/channels/<channel_id>` with `{accountId,revision,confirm:true}` returns
  `{deleted:true}`. Only inactive, single-property connections can be removed.
  Removing a channel permanently removes its mappings/events; received bookings remain.

Explicit asynchronous provider responses return HTTP 202 `{pending:true,message}`
instead of claiming completion. Reload before sending another write; these APIs
do not automatically retry uncertain creates or provide a provider idempotency key.
Provider writes can race with a change made directly on Channex after the last read;
reload/reconcile before editing again. Property updates and deletion are not implemented.

Airbnb uses the official owner authorization and dedicated listing mapping APIs:

- POST `/airbnb/connection-link` with `{accountId,name,returnOrigin,groupId?,channelId?}`
  returns `{url,expiresIn}`. New links require a group; reconnect derives it from
  the verified channel. The return origin must be the caller's allowed LOHA origin.
- POST `/api/admin/channex/airbnb/confirm` with `{channelId,token}` validates the
  session-bound, signed OAuth state and returns `{accountId,propertyId,property,channel}`.
- GET `/channels/<channel_id>/airbnb/listings?accountId=` returns `{listings}`.
- POST `/channels/<channel_id>/airbnb/mappings` with
  `{accountId,revision,listingId,ratePlanId}` adds a listing to an inactive channel.
- DELETE `/channels/<channel_id>/airbnb/mappings/<mapping_id>` with
  `{accountId,revision,confirm:true}` explicitly unmaps a listing, including while
  active so the channel can be deactivated. Both return `{channel,status}` where
  status is `pending` or `completed`. OAuth credentials remain inside Channex/backend.

Provider requests follow the official [properties collection](https://docs.channex.io/api-v.1-documentation/hotels-collection/get-list-of-properties-api),
[room types](https://docs.channex.io/api-v.1-documentation/room-types-collection/get-list-of-room-types-api),
[room mutations](https://docs.channex.io/api-v.1-documentation/room-types-collection),
[rate plans](https://docs.channex.io/api-v.1-documentation/rate-plans-collection),
and [Channels API](https://docs.channex.io/api-v.1-documentation/channel-api) contracts.
Provider errors contain safe local messages; they never echo response bodies or keys.

GET `/api/admin/channex` requires `SYSTEM_MANAGER` or `SUPER_ADMIN` and returns
`{hotels:[{tenantId,name,city,roomCount,status,connection,mappingCount,closingCount,roomTypeCount,latestJob}]}`.
This roster uses local database aggregates only; no provider calls. It includes
all hotels with `OTA_SYNC` enabled, independently of PMS membership. `roomCount` counts
active physical rooms; `roomTypeCount` is active local room types. `mappingCount`
counts active mappings to active local room types without a pending pause;
`closingCount` counts all pending pauses, including inactive local room types.
`connection` is null or `{environment,propertyId,active,credentialsConfigured,credentialError,credentialSource,verifiedAt,webhookRegistered}`.
`latestJob` is null or `{kind,status,errorCode,createdAt}`. References, secret values,
ciphertext, job payloads and customer notes are excluded. Tenant IDs match tenant routes.

Tenant prefix `/api/tenants/<tenant_id>/channels`:

- GET `/`: connection, mappings, active local room types and latest 50 jobs.
  Top-level `credentialStorageAvailable` and `webhookRegistrationAvailable` describe
  shared server setup. Connection adds `credentialSource` (`encrypted|environment`),
  `verifiedAt`, `credentialError`, `credentialsConfigured`, `webhookConfigured`
  (secret readiness) and `webhookRegistered` (last successful registration).
  Secret values/ciphertext are never returned. Legacy reference names remain available.
- GET `/jobs`: complete tenant history, filtered and paginated in SQL, with
  `pageSize` (default 25, maximum 100), `status`, `kind`, `revisionId`, `start_date`,
  `end_date` and opaque `cursor`. Status/kind accept the supported job enums;
  `revisionId` is an exact match. Dates are strict `YYYY-MM-DD`, inclusive creation
  dates in the hotel's configured timezone. Unknown/duplicate query parameters,
  invalid filters and inverted date ranges return 422.
  Returns `{items,pagination:{page,pageSize,totalItems,totalPages,currentCursor,
  nextCursor,snapshotAt}}`; each item contains only
  `{id,kind,channelId,revisionId,status,attempts,errorCode,start,end,createdAt,completedAt}`.
  Ordering is `created_at DESC, id DESC`. Send `nextCursor` to continue, or save
  `currentCursor` to revisit a page, repeating the same filters/page size. A cursor
  fixes the creation-time cutoff so newly queued jobs do not move existing pages
  or inflate totals. Job statuses remain live, so processing/retry can change
  membership and totals for a status filter. Start without a cursor to include
  newer jobs. Cursors are signed, bound to the login session, tenant, filters,
  timezone and page size, and expire after 24 hours; invalid/mismatched/expired
  cursors return 422 `invalid_cursor`.
- GET `/jobs/<id>`: same safe job fields plus `availableAt`; requires
  `channels.view`, like history. Jobs belonging to another tenant return 404
  within an authorized tenant. History/detail never return raw payloads, provider
  responses, guest/payment data, secrets, ciphertext, actor IDs or dedupe keys.
  Structured values in public payload metadata fields are omitted. Migration
  `0032_channel_job_history` adds tenant/history and tenant/revision lookup indexes.
- GET `/catalog`: `{roomTypes:[{id,name}],ratePlans:[{id,name,roomTypeId,currency,supported}]}`.
  Loads credentials server-side and requests only the saved property's room types and
  rate plans. A configured paused connection can still load options for editing unused
  mappings. Names come from provider titles. `supported` uses the same predicate as
  ARI publication: per-room/manual, tenant currency and no inherited rate. Unsupported
  plans remain visible. Malformed, duplicate or cross-property resources fail the whole
  request; rate plans must belong to a returned room type. Catalogs are limited to 100
  resources of each kind; a larger catalog returns 422 `channel_catalog_too_large`.
  Missing configuration returns 409; unreadable/missing credentials return 503;
  invalid provider responses return 502 and retryable provider failures return 503.
- PUT `/config`: `{environment:staging|production,propertyId,active,apiKey?}`.
  System managers may instead submit the exact `{accountId,propertyId,active}`
  shape to link a property from `system:staging`, `system:production`, or the
  target hotel's own `hotel:<tenant_id>` source. Server credentials are verified
  and encrypted per hotel without being returned to the browser. Hotel sources
  cannot be reused for another hotel or property. PMS membership or Manager OTA support, feature
  entitlements, CSRF, property uniqueness and history protection still apply.
  A supplied key is verified against GET `/properties/{propertyId}` before saving
  tenant/property/environment-bound Fernet ciphertext with a generated webhook
  secret. Only status is returned. Blank/omitted key preserves the current source
  for the same target; a new target requires a key. Re-enabling verifies again;
  pausing works without decryption/provider availability. Property/environment
  cannot change after any channel history, including webhook setup jobs.
  Shared `CHANNEX_ENCRYPTION_KEY` is required for new encrypted storage. Corrupt
  ciphertext or an unavailable/wrong master key fails closed without env fallback.
  The exact legacy shape `{environment,propertyId,credentialRef,webhookSecretRef,active}`
  only preserves an existing property/environment binding; references must match
  server-generated tenant names. Creating a binding or changing one without history
  returns 422 `channel_api_key_required`, even when inactive or using a support alias;
  changing a binding with history still returns 409 `channel_has_history`.
  Provision new connections with a supplied API key or the authorized manager
  `accountId` source flow. Mixed legacy/new shapes are rejected. A legacy request
  cannot replace encrypted secrets.
- GET `/ari-preview?start_date=&end_date=`: read-only `{start,end,currency,inventoryHeld,warning,rows}`;
  same half-open window, reconciliation and remote-catalog validation as publication.
  Rows include `date,roomTypeId,roomTypeName,priceSource:base|daily,rate,currency,`
  `channexRoomTypeId,channexRatePlanId,availability,stopSell`. A closed zero-price date
  has `rate:null`. It creates no jobs or provider writes. Preview is a current
  outbound snapshot, not a promise of an OTA's displayed price or a publication lock.
- PUT `/mappings`: `{roomTypeId,channexRoomTypeId,channexRatePlanId,active,inboundRatePlanIds?}`.
  One local room type maps to one remote room and one primary manual/per-room
  outbound plan. Up to 99 additional distinct UUIDs may explicitly receive bookings;
  they may use derived/occupancy pricing. All must belong to the same remote room,
  property and tenant currency. No implicit parent/name fallback is performed.
  Omission preserves saved additional IDs; an explicit empty list clears only
  unused IDs. Used mappings cannot lose accepted IDs. Mapping responses include
  `inboundRatePlanIds`, `targetLocked` (remote identifiers protected) and
  `pauseRequested` (closing sales). Saves validate the current catalog before
  accepting new/active targets. Existing close requests remain possible when
  the catalog is unavailable. Target/alias changes require renewed inventory
  reconciliation. Primary IDs remain protected after use.
  Webhook jobs and empty booking polls do not lock unused mappings. Before ARI writes,
  the worker durably records each mapping's use and date windows; successful booking
  imports also record use. Protected mappings reject identifier changes with 409.
  Setting `active:false` on a used active mapping queues internal `pause_mapping`
  work and returns `active:true,pauseRequested:true` until closing succeeds. The worker
  sends availability zero and stop-sell on recorded windows plus the rolling baseline,
  then returns `active:false,pauseRequested:false`. Failed closing stays pending and
  supports normal job retry. Repeated pause requests are idempotent; re-enable while
  pending returns 409. After closing, the same identifiers may be re-enabled. Paused
  used mappings still resolve incoming booking revisions. Migration `0018` conservatively
  protects legacy ARI history because it lacks per-mapping publication records.
- POST `/jobs`: `{kind:push_ari,start,end}` or `{kind:pull_bookings}`; returns 202.
  Manual booking pulls retry failed revision/ACK jobs still present in the feed;
  scheduled polls and webhook replays do not reset terminal failures. Committed
  revision receipts retry only ACK, without importing the booking again.
  Job responses include nullable `revisionId`; a successful feed job means the
  feed was scanned and follow-up work queued, not that import/ACK has completed.
  ARI uses a half-open window of at most 31 days. Booking/catalog changes enqueue
  ARI within the same database transaction; the worker sends a fresh snapshot.
  The worker also polls booking feed every minute and schedules a daily 366-day
  baseline in 31-day jobs. ARI prices use base/DailyRate, not PMS LOS/promotions.
  Open dates require a positive OTA rate. A zero base/daily rate fails the job
  with `channel_rate_invalid` before either ARI write; correct the rate and retry.
  Closed dates can retain a zero PMS rate: the worker sends zero availability
  and stop-sell without publishing a zero rate.
  Each publication first sends zero room availability and reads it back from
  Channex, then sends the primary plan's rate/stop-sell and reads those values
  back. It refreshes the catalog, locks the hotel and compares a fresh local
  snapshot before sending the final availability. A mismatch leaves work retryable
  with `channel_inventory_unverified`, `channel_rate_unverified` or
  `channel_snapshot_changed`, without sending the final open. A request timeout
  still has an uncertain upstream result; inspect upstream state/history.
  The final opening holds the hotel mutation lock for at most the HTTP timeout
  (15 seconds). These readbacks establish stored Channex state, not completed
  delivery to each OTA. The extra close/readback requests briefly suspend sales
  for affected room dates; failures may require operator recovery before reopening.
  Any unresolved booking review or queued/processing/failed exact revision import
  without a committed receipt sets `inventoryHeld:true`: all mapped rooms in the
  outbound window get zero availability and stop-sell. Feed/ACK jobs and duplicate
  revisions with receipts do not hold inventory. Final reopening rechecks this
  condition under the hotel lock. Held publication remains queued with
  `channel_bookings_pending`, retaining its full date window for a fresh retry;
  if the retry budget expires, resolve the booking and retry the failed ARI job.
  This prevents an unimported OTA stay from being sold again by a later ARI push;
  it does not itself cancel the OTA stay or guarantee immediate closure everywhere.
  Migration `0023_channel_ari_pacing` persists a per-connection ARI cooldown:
  `push_ari` and `pause_mapping` attempts are spaced by at least 7 seconds, with
  at least 60 seconds after retryable failures (or longer job backoff). Booking
  reads and ACKs remain eligible during this cooldown. Worker polling interval
  can make the delay longer. Apply the migration before starting the new code.
- POST `/jobs/<id>/retry`: `{}`; retries failed work, retaining its history row.
- Snapshot includes `connection.inventoryReconciledAt` and `onboarding` with its
  `revision`, `reconciledAt`, pending revision/load/ACK count, review count and the
  latest `load_bookings` job for each remote channel (independent of the 50-job list).
- POST `/remote/<channel_id>/load_bookings`: `{revision,confirm:true}`, where
  `revision` is the remote channel revision. Requires a linked, active PMS connection
  and an active, mapped, single-property channel advertising `load_future_reservations`.
  Returns `{job}` with HTTP 202. The manager property channel-action endpoint supports
  the same action, using the linked hotel's durable queue. Repeated requests for an
  unchanged mapping target return the existing job; failed work may be retried manually.
  A succeeded load job means the provider accepted a background request, not that all
  bookings were imported. Timeouts, unknown results and abandoned processing claims
  fail without automatic POST replay. New load requests/retries invalidate reconciliation.
- POST `/onboarding/reconcile`: `{revision,confirm:true}`, where `revision` is the
  onboarding revision. The operator attests that existing future bookings are imported
  or entered manually and that inventory matches every OTA. Requires no pending load,
  revision import, ACK or unresolved booking review. Generic feed polls do not block
  this manual attestation, including when the queue is full. Returns `{onboarding}`.

Migration `0031_channel_onboarding` starts every connection unreconciled, including
existing connections. Manual ARI creation returns 409 `channel_inventory_unreconciled`;
workers hold queued ARI without spending attempts and preserve dirty inventory ranges.
Booking pulls/ACKs, webhook setup and mapping closure remain available. Confirmation
releases held inventory work. Reconnect/activation and mapping changes in LOHA invalidate the
checkpoint; stale confirmations return 409. During an in-flight ARI publication,
checkpoint-changing actions return 409 `channel_inventory_publishing`. Remote mutation
invalidation is committed before the provider call so a crash/timeout cannot undo it.
Stop old workers and deploy migration/API/frontend/worker together before reconciling.
This gate does not retract inventory already stored upstream: Channex activation or
mapping may itself synchronize that stored inventory; operators must check it first.

PMS routes require `channels.view` (owner/front desk) or `channels.write` (owner),
with active hotel membership. Manager support uses the equivalent channel routes
under `/api/admin/channex/tenants/<tenant_id>/channels` and requires
`SYSTEM_MANAGER` or `SUPER_ADMIN`, independently of hotel membership. Both
surfaces enforce `OTA_SYNC`, subscription write gates, tenant status and CSRF.
GET `/api/admin/channex/tenants/<tenant_id>/workspace` returns only
`{tenant:{id,name,status},settings:{timezone,currency},subscription,features}`.
The support namespace exposes no general PMS workspace, settings, users or reservations API.
Workers recheck the live actor's owner membership or system role, tenant status
and subscription before using credentials. Support jobs never create PMS membership.
API origin is fixed to Channex staging/production; redirects are refused.
Deactivating the connection pauses work; it does not close sales on remote OTAs.

With a trusted global HTTPS origin `CHANNEX_WEBHOOK_BASE_URL`, an active encrypted
save with a supplied key or re-enable queues internal `setup_webhook` work (empty
payload). The worker reconciles only the exact callback URL/property, creates or
updates a property-level `booking` webhook with `send_data=false` and its encrypted
secret header, then records registration success. Retries adopt an existing match
instead of creating duplicates; ambiguous matches/overlarge catalogs fail safely.
This job is not accepted through POST `/jobs`; failed setup can use normal retry.
Without the optional public origin, polling remains available. API and workers
must share the same stable encryption key and callback origin.

POST `/api/channex/webhooks/<tenant_id>` requires the configured
`X-Channex-Webhook-Secret` and matching property. It queues work and never trusts
webhook prices/guest data as an authoritative booking. The worker fetches booking
revisions, saves the reservation/receipt and an ACK job atomically, then processes
the ACK after commit. Repeated revisions cannot create a second reservation.
Completed imports atomically reuse their queue slot for ACK work, retaining the
500 pending-job cap. If older resolved reviews cannot all enqueue ACKs at once,
later feed polls recover them from their committed receipts.

Provider bookings need complete nightly prices, mapped rooms, supported currency
and available physical rooms. Unsupported extras, ambiguous order and changes to
settled/in-house stays remain unacknowledged for operator review. OTA prepaid flags
do not create local payments.
OTA revisions update only the primary guest; companions entered in the PMS retain
their links and profiles. PMS LOS/promotions/vouchers are not translated into
unsupported OTA rate rules. This implementation requires Channex sandbox acceptance
with real property mappings before live activation.

Migration `0037_channel_rate_safety` is required before running this version.
Accepted revision receipts contain an immutable, bounded `money_snapshot` with
remote room/rate IDs, nightly prices, total, currency, frozen FX/base amounts and
optional OTA commission. No card guarantee or arbitrary payload is retained.
Nonempty `taxes`/`collected_taxes` return `booking_financial_extras_unsupported`
for operator review; invalid commission returns `booking_commission_unsupported`.
No ACK is sent for these cases. Missing commission on a changed-total revision
of a booking with provider commission also requires review, rather than reusing
a stale amount. Local changes of OTA dates, room category/count or booking source
return 409 `channel_booking_requires_review`. Physical-room moves within the same
categories and dates preserve existing nightly prices, FX and complete snapshot.

A validated scalar `ota_commission` becomes `pricingSnapshot.commission.providerAmount`.
Commission candidates expose `providerAmount`, `calculationBasis:provider_amount`
and `percent:null`. Settlements freeze the exact amount and convert with the
booking's frozen FX; existing percentage settlements retain `calculationBasis:percent`.
Unresolved OTA booking reviews block commission payouts. An amount-based settlement
does not prove an OTA has already withheld or paid anything; payments still require
an explicit cashbook action. Existing hotel tax/remittance reconciliation remains
an operator responsibility. Downgrade is refused when it would discard aliases,
accepted monetary history or amount-based settlements.

Retryable failures remain `queued` until their retry budget is exhausted. These
attempts retain audit/history/log entries without sending an `OTA_SYNC_ERROR`
notification; terminal failures still notify. Existing notifications are retained.
Safe worker diagnostics include upstream `http_status` or a bounded transport
`cause`; provider response bodies, credentials and guest data are not logged.

Contracts: [booking revisions](https://docs.channex.io/api-v.1-documentation/bookings-collection),
[ARI](https://docs.channex.io/api-v.1-documentation/ari),
[rate limits](https://docs.channex.io/api-v.1-documentation/rate-limits),
[webhook authentication](https://docs.channex.io/api-v.1-documentation/webhook-collection).

## BE-12: in-app notifications

Tenant prefix `/api/tenants/<tenant_id>/notifications`:

- GET `/`: `{items,unreadCount,nextBefore}`. Query `limit` 1–100 (default 50),
  `unread=true|false`, `before=<opaque nextBefore>`; use URL encoding for the cursor.
  Each item has `id,eventCode,title,body,entityType,entityId,createdAt,readAt`.
  Timestamps are ISO UTC; count covers this user's unread inbox, independent of page.
- POST `/<id>/read`, POST `/read-all`: idempotent read marking for the current user.
- GET `/preferences`: `{events,availableRoles}`; each event exposes code/name,
  priority, recipient roles and the supported `in_app` channel.
- PATCH `/preferences`: `{events:[{code,roles:[...]}]}`; owner only. An empty roles
  list selects no recipients. Settings apply to future events.

Notifications share the business transaction and reference its audit record.
Rollback emits no notification. Default recipients are active hotel members with
the configured roles; inactive users are excluded. RLS protects the recipient's
inbox as well as tenant boundaries. No guest contact/payment payload is copied into
the notification body. Email, external delivery webhooks and mobile push are not
enabled by this contract.

## Manager: customer profiles and account sessions

System roles (`SUPER_ADMIN`, `SYSTEM_MANAGER`) manage SaaS customers at
`/api/tenants`; hotel guest information is managed within tenant reservations.

- GET `/api/tenants`: `{tenants:[...]}`. Each tenant contains `id,name,status,currency`, `contactName`,
  `contactEmail`, `contactPhone`, `address`, `city`, `taxId`, `domain`,
  `customerNotes`, `createdAt` and `owner` (null or `{id,name,email,active,createdAt}`).
  `owner` describes the login account independently of contact fields and never
  includes password or session data. Hotel settings and physical-room counts are
  excluded. For older hotels, missing contact name/email fall back to an
  Owner's identity. Explicit empty values stay empty.
- GET `/api/admin/customer-accounts?search=<name-or-email>`: system roles only.
  The trimmed search must contain 2–254 characters, with no control characters;
  unknown or repeated query parameters return 422. Searches name/email literally,
  case-insensitively (SQL wildcard characters are escaped), returning at most 20
  active ordinary customer accounts with at least one active `HOTEL_OWNER`
  membership, excluding staff-only, unassigned and system accounts. Response:
  `{users:[{id,name,email,active,createdAt,memberships:[{tenantId,tenantName,role,active}]}]}`.
  No hotel operational information, passwords or sessions are returned.
- GET `/api/admin/customer-accounts/directory`: paginated, system-role-only customer
  account directory. Returns the same safe identity/membership fields as the search
  endpoint, including disabled customer accounts and revoked memberships, excluding
  internal system accounts. Response adds `pagination:{page,pageSize,totalItems}`.
  Optional filters: `search` (trimmed name/email substring, 0–254 characters with no
  control characters, literal case-insensitive matching), `tenantId` (known hotel),
  `role` (a hotel role), `active` (`true` or `false`, account status), `page` (1–100000),
  `pageSize` (1–100; default 20). Hotel and role filters must match the same
  membership, including revoked memberships. Unknown/repeated/invalid parameters
  return 422; an unknown hotel returns 404. Every account appears once even when
  it belongs to several hotels. The account-picker search contract remains unchanged.
- POST `/api/tenants`: `name,status?,currency?`, optional contact fields above, and either
  `ownerName,ownerEmail,ownerPassword` to create an account or `ownerUserId` to
  use an existing active ordinary account with at least one active `HOTEL_OWNER`
  membership. The server locks and rechecks that membership before provisioning;
  staff-only, unassigned or revoked-owner accounts return 422 without creating a hotel.
  Combining both modes returns 422;
  an unknown account returns 404 and inactive/system accounts return 422.
  Creates the hotel, Owner membership and private contact profile atomically,
  preserving the existing account's name, email, password and other memberships.
  Omitted contact name/email default to the selected Owner's identity.
  `currency` is the hotel's canonical base currency, stored in hotel settings and
  used by PMS, auth-session hotel metadata and Channex mapping checks. It defaults
  to `VND`; string values are trimmed/uppercased and must belong to the common
  hotel-currency catalog, otherwise return 422 `invalid_currency`.
  The remaining default hotel settings are preserved.
  Manager profile PATCH does not accept `currency`; existing tenant settings and
  transaction-history guards govern later currency changes.
  It does not assign a subscription.
- The common hotel-currency catalog contains `VND`, `USD`, `EUR`, `GBP`, `JPY`,
  `KRW`, `CNY`, `HKD`, `SGD`, `THB`, `AUD`, `CAD`, `CHF`, `NZD`, `MYR`, `IDR`,
  `PHP`, `INR`, `AED` and `TWD`. These selected common codes were checked against
  Channex's public [staging currency reference](https://staging.channex.io/api/v1/currencies)
  on 2026-10-30. This is a subset of Channex's full catalog. It is shared by hotel
  creation, operational settings/FX and admin Channex Property creation; rate-plan
  mapping still requires an exact match with the hotel's configured currency.
  SaaS plan and invoice currencies remain `VND`/`USD` independently of hotel currency.
  Apply migration `0042_hotel_currencies` before enabling the new choices in a
  deployed database (`python manage.py db upgrade`). It expands existing currency
  and FX snapshot checks while retaining exact decimal amounts and historic rates.
  Downgrade refuses to remove support while hotel settings or money/FX records
  still use a currency outside `VND`/`USD`.
- PATCH `/api/tenants/<id>`: nonempty subset of `name,status` and contact fields.
  Contact name/city <=160, email <=254, phone/tax ID <=40, address <=500,
  domain <=253, notes <=4000 characters. Values must be strings; empty strings
  clear optional fields. Email is normalized/validated; domain accepts a DNS
  hostname (not a URL). Storing it does not provision DNS, Tunnel or TLS.
  On both POST and PATCH, a nonempty `contactPhone` must contain 7–15 ASCII digits
  and may contain spaces, dots, hyphens, parentheses and a single leading `+`.
  Letters and other characters return 422 `invalid_phone`. Formatting and leading
  zeroes are preserved after trimming; an empty string clears the phone.
  A nonempty `taxId` contains only ASCII digits with an optional hyphen followed
  by a three-digit branch suffix. Leading zeroes are preserved; letters, decimal
  points and exponent notation return 422 `invalid_tax_id`.
  Login/contact emails are trimmed and normalized to lowercase; the local part
  is 1–64 characters, cannot start/end with a dot or contain consecutive dots;
  each domain label is 1–63 alphanumeric/hyphen characters without leading or
  trailing hyphens. Existing single-label domains remain supported.
- GET `/api/tenants/<id>/customer-history`: system roles only, including when
  the hotel is suspended. Same filtering, paging and response as tenant `/audit`;
  only SaaS account/commercial events are included. URL fixes the tenant and
  `tenantId` query is rejected. Global SaaS payment
  events are excluded; invoice details hold their payment history.
- Tenant `/users` requires an ordinary HOTEL_OWNER for membership writes, subject
  to quota, subscription, suspension and last-Owner guards. POST may create an
  ordinary account or grant an existing ordinary account using `{userId,role,active?}` or
  `{email,role,active?}`. Granting an existing account cannot change its profile
  or password. Responses contain only the selected hotel's membership.
  System identities (`SUPER_ADMIN`, `SYSTEM_MANAGER`), including disabled accounts,
  cannot be added in either mode, by email or by user ID: return 409 `email_exists`
  before creating a membership or changing the account. Email matching trims spaces
  and ignores case. Existing legacy memberships remain manageable and are not
  automatically revoked; SaaS/OTA support access is unchanged.
  PATCH rejects changes to the actor's own hotel role or membership status with
  403 `self_permissions_locked`, even when another active Owner exists. Repeating
  the actor's current role/status remains allowed; personal profile updates keep
  their existing authorization rules. Owners may manage other accounts' hotel
  roles/status, preserving the last active Owner safeguard.
  Contact email changes never change an Owner's login identity.

Profiles are stored in `tenant_client_profiles` with system-only FORCE RLS.
Private contacts/CRM notes are not added to hotel `/workspace`, auth session
tenant payloads, or audit details. Profile audits record changed field names.

Any authenticated user may operate on their own account:

- PATCH `/api/auth/profile`: `{name}` only, trimmed 1–160 characters;
  returns `{user}`. Email, role, ID and other fields cannot be changed here.
- GET `/api/auth/sessions`: `{sessions:[{current,createdAt,expiresAt}]}` for
  this user's unexpired sessions, newest first. No tokens or other users' rows.
- POST `/api/auth/sessions/revoke-others`: `{}` returns `{ok:true,revoked}`;
  preserves the current session and removes other sessions for this user.
- POST `/api/auth/change-password` retains its existing validated
  `{currentPassword,newPassword}` contract and revokes other sessions.

All writes require CSRF. Profile/session-revoke emit global audit events;
user locking serializes them with concurrent login. Session validity is rechecked
after the lock so a revoked request cannot change profile/password or revoke the
surviving session. No 2FA is implemented.

## Manager: SaaS invoices and system overview

All routes below require a system role. Hotel roles receive 403. Hotel revenue,
POS invoices and ledger are separate from SaaS software invoices/payments.

- GET `/api/billing/invoices?tenantId=&status=&start_date=&end_date=&page=&pageSize=`:
  `{invoices,pagination:{page,pageSize,totalItems}}`. Status is
  `unpaid|partial|paid|void`. Dates are `YYYY-MM-DD` UTC creation dates:
  start inclusive, end exclusive; end must follow start. Paging uses the
  existing finance limits; frontend requests 20 per page.
- POST `/api/billing/invoices`:
  `{tenantId,description,amount,currency,dueDate?}` returns the invoice (201).
  Description is required, <=500 characters; currency `VND|USD`; due date is
  `YYYY-MM-DD`. Positive money uses Decimal, up to 15 integer and 4 fractional
  digits. Use decimal strings to avoid precision loss. Requires `Idempotency-Key`:
  same key/actor/route/body replays the original invoice (201), including after
  a lost response; changed content with the same key returns 409. Invoice and
  private retry record are saved atomically.
- POST `/api/billing/invoices/<id>/payments`:
  `{amount,method:bank|cash,reference?,note?}` with required `Idempotency-Key`.
  Reference <=160, note <=1000. Returns updated invoice (201). Same key/actor/
  route/body replays the original result; different content returns 409.
  Invoice locking and database guards prevent concurrent overpayment or payment
  on a void invoice. This records a received payment; it does not transfer funds.
- POST `/api/billing/invoices/<id>/void`: `{reason}` (required, <=1000) returns
  updated invoice. Only wholly unpaid invoices can be voided. The row and reason
  remain in history; invoices/payments cannot be deleted or rewritten.

Invoice:
`{id,number,tenantId,tenantName,description,amount,currency,dueDate,status,paid,
balance,createdAt,voidedAt,voidReason,payments}`. Number displays `SAAS-000001`.
Payment: `{id,amount,method,reference,note,createdAt}`. Money is serialized as
decimal strings; void balance is zero. Dates/timestamps use ISO representation.

GET `/api/manager/overview?start_date=&end_date=` uses the same half-open UTC date range,
defaulting to the current month. Returns:
`{start,end,tenants:{total,active,suspended},users:{active},
plans:{FREE,PRO,...customCodes,unassigned},currencies,recentPayments}`.
Each currency entry has `{currency,invoiced,received,outstanding,overdue}`.
Invoiced/received reflect the selected period; current outstanding/overdue cover
all unvoided invoices. Due dates before today's UTC date are overdue. Currencies
are never summed together. Recent payments include invoice number, hotel name,
currency, amount and timestamp. Plan counts include only currently effective
subscriptions to active plans, including custom and archived plans still serving
existing subscribers; other hotels are unassigned.

`saas_invoices`, `saas_payments`, `saas_idempotency_records` have FORCE RLS.
Writes and idempotency records remain system-only; migration `0035_owner_saas_billing`
adds SELECT-only access to invoices/payments for an active `HOTEL_OWNER` membership
matching the current tenant and user. Payment records/cache are append-only.
SaaS audit events have null tenant ID and tenant reference in system-only details;
owner billing reads use the dedicated routes below. Recording payment does not automatically grant/renew a plan;
subscription changes remain explicit at the existing subscription endpoint.

Migrations `0015_plan_room_limits` then `0016_room_type_codes` follow
`0014_manager_customers`. They preserve UUIDs and paid history; legacy finite
room allowances are retained and uncapped subscriptions register current active
room count (at least one). Review each hotel's actual room registration after upgrade.
Run `python manage.py db upgrade` using the target environment's
`DATABASE_MIGRATION_URL`, then check `/api/ready`. Downgrades refuse to discard
stored billing or customer records. No production migrations run automatically
from these feature changes.

## Owner: read-only SaaS orders and internal documents

The Profile → Orders tab reads only the selected hotel's billing. Each route uses
the `billing.view` tenant policy: active hotel owners can read their tenant;
`FRONT_DESK`, `HOUSEKEEPING`, and `ACCOUNTANT` receive 403, including staff who own
another hotel. System accounts also need an active `HOTEL_OWNER` membership
granted by the hotel's ordinary owner; global roles alone grant no access. Missing
authentication returns 401; inaccessible tenant paths return 403. Billing reads
remain available for expired/cancelled subscriptions, inactive plans and suspended
hotels. They do not grant features, record payments, modify or renew subscriptions.

- GET `/api/tenants/<tenant_id>/billing` returns
  `{subscription,summary:[{currency,amount,paid,balance}]}`. Subscription uses the
  Manager subscription shape, or null if absent. Summary covers all unvoided
  invoices for this tenant, independent of pagination and list filters. Amounts
  and collected payments come from the same SaaS records as Manager. Currencies
  remain separate, monetary values are decimal strings with four fractional
  digits, and an empty invoice history returns `summary:[]`.
- GET `/api/tenants/<tenant_id>/billing/invoices?page=&pageSize=&status=&start_date=&end_date=`
  returns `{invoices,pagination:{page,pageSize,totalItems}}` with the exact Manager
  invoice/payment fields described above. Filters have the same semantics as
  Manager; void invoices remain visible and have zero balance. A `tenantId` query
  parameter cannot override the tenant in the URL.
- GET `/api/tenants/<tenant_id>/billing/invoices/<invoice_id>` returns the same
  invoice document including payment confirmations, reference, note and any void
  reason. Unknown or foreign invoice IDs return the same 404. The Client offers
  an escaped HTML download and print view labelled as an internal document,
  not a tax invoice.
- GET `/api/tenants/<tenant_id>/billing/history?page=&pageSize=` returns
  `{history,pagination:{page,pageSize,totalItems}}`. History uses the same stored
  plan snapshots and ordering as Manager, with system actor identity omitted.
  Its `amount` is the note recorded when granting/renewing the plan; it is not
  proof of payment and is never added to the collected-payment summary.

Both lists use finance pagination: page 1–100000, pageSize 1–500, default 100;
invalid pagination returns 422. Ordering is deterministic, and pages beyond the
end return empty arrays with the true total. These four routes register GET only
(with standard HEAD/OPTIONS). POST/PUT/PATCH/DELETE return 405, and all Manager
billing and subscription write endpoints continue to deny hotel users.

Deploy migration `0035_owner_saas_billing` with `python manage.py db upgrade`
before using the Client billing tab, then check `/api/ready`. The migration adds
read policies without changing billing records; downgrade revokes owner reads
without deleting invoice/payment history.

## P1 business completion — 29/10/2026

Requires migration head `0041_operational_days` (after `0038_commission_review`,
`0039_saas_recovery`, `0040_channel_exceptions`). Additions below extend the
earlier contracts. All writes require CSRF and `Idempotency-Key`; retry with the
same body/key to replay the saved result. Changed intent with the same key returns
409. Tenant money uses decimal strings and preserves original/base currencies.

### In-house stay changes

Under `/api/tenants/<tenant_id>/reservations/<reservation_id>`:

- POST `/stay-change/preview`: `{rooms:[roomNumber,...],effectiveDate,checkOut,
  expectedVersion}`. Requires `reservations.write` and `IN_HOUSE`. Effective date
  is today in the hotel's timezone. Room count stays fixed. Target rooms must be
  active, clean for a move, available, within guest capacity and open for sale.
- POST `/stay-change`: same fields plus `{previewToken,reason,confirmOta?}`.
  Returns the updated reservation. Confirmation recomputes the quote under the
  tenant/booking/inventory locks; a changed version or quote returns 409.

Preview includes `bookingId,expectedVersion,effectiveDate,previousCheckOut,
checkOut,rooms,previousRooms,nightlyRates,total,previousTotal,difference,paid,
balance,refundRequired,currency,baseCurrency,exchangeRate,checkoutNow,otaLinked,
previewToken`. Nightly rows retain the booking's original money snapshots for
same-type existing nights; added nights/new room types use the current quote
converted at the booking's frozen FX. Served nights remain unchanged. Missing
overdue nights are quoted once and cannot be inserted into a closed day.

No automatic early departure penalty. Refund surplus through the existing refund
route before confirming (`refund_required`); same-day early checkout also requires
the projected balance to be zero (`unpaid_balance`). Moves release/reallocate
remaining inventory and create housekeeping work for vacated rooms. OTA-linked
stays require `confirmOta:true`, record a reconciliation incident and queue normal
inventory sync; they do not modify the provider booking. Ordinary post-check-in
editing remains guarded. This new flow is unavailable under temporary expiry access.

### Night Audit and closed hotel days

- GET `/api/tenants/<tenant_id>/reconciliation/night-audit?date=YYYY-MM-DD`:
  requires `reconciliation.view`. Returns `{date,timezone,lastClosedDay,
  recognitionStart,periodLocked,blockers,entries,totals,previewToken}` for an open
  date; closed dates return their stored snapshot plus `periodLocked:true,auditId`.
- POST the same path: `{date,previewToken,reason}`, requires
  `reconciliation.confirm` (Owner/Accountant). Returns the locked result (201)
  with `auditId,actor,reason`. A different second close returns `period_closed`.

Only dates before today in the hotel timezone can close. The first chosen date
starts a new revenue book (`recognitionStart`); earlier revenue is not reposted.
Afterwards dates must be consecutive (`audit_sequence`, `nextDate`). Unresolved
arrivals, departures and OTA booking reviews block closure (`audit_unresolved`).
Changed source data returns `preview_changed`. Close never auto checks in/out or
marks no-show.

Entries have `sourceKind:room|charge|pos,sourceId,sourceDate,amount,currency,
baseAmount,baseCurrency,details,adjustment`. Room nights of in-house/checked-out
stays, booking charges/discounts and standalone posted POS contribute once;
booking-linked POS is represented by its booking charge. Later corrections or
POS cancellation post a delta on the next open close. Revenue entries are
append-only and do not create ledger/payment/refund rows. Closed room-night
rewrites and backdated money are blocked in PostgreSQL, including direct SQL.
New corrections use the current open day. GET `/reports/financial` now includes
`recognizedRevenue` in summary and period rows, filtered by close business date;
it is a separate measure from invoice revenue and cash receipts.

The existing GET `/reconciliation`, POST `/reconciliation/confirm` and GET
`/reconciliation/history` retain their nonlocking snapshot behavior.

### Commission reconciliation and recovery

Under `/api/tenants/<tenant_id>/commissions/<commission_id>`:

- GET `/review` (`cashbook.view`): `{current,evidence,blockedByOta,roomSubtotal,
  baseRoomSubtotal,charges,refunds,previewToken}`.
- POST `/review` (`cashbook.write`): `{previewToken,allocations:[{chargeId,
  roomAmount}],reason,providerAmount?}`. Explicitly allocate every fee/discount;
  a room amount may be zero but must retain the original sign and stay within
  the source amount. Original percentage/FX remain fixed. Only provider-amount
  commissions accept `providerAmount`. Returns the revised commission (201).
- POST `/recoveries` (`cashbook.write`): `{amount,fundId,categoryId?,note}`.
  Returns the commission (201) and links an incoming cash receipt. Only the
  current net overpayment may be recovered; the shared receipt reversal flow
  restores the outstanding recovery.

Original settlements/payments remain immutable. Results expose revised liability,
review/recovery histories, net paid and `recoveryDue`; `OVERPAID` means money must
be recovered. New charges/refunds/manual OTA resolutions invalidate the evidence
and block further settlement/payment until re-reviewed. Resolve pending OTA
reviews before commission review. Recovery records actual returned money; it does
not initiate a transfer.

### OTA money and incidents

The importer supports documented room taxes and services: inclusive tax is split
from the room amount, exclusive tax/services are separate booking charges, and
the complete sum must equal provider `amount`. Provider nightly amounts and
commission money remain snapshotted. Unsupported/ambiguous tax or service forms,
withheld `collected_taxes`, cancellation fees, cancellations of bookings with
existing charges, and closed-day changes remain
durable reviews, unacknowledged. No provider receipt becomes a cash payment.

- POST `/api/tenants/<tenant_id>/channels/booking-reviews/<review_id>/resolve`
  is tenant Owner-only. Body `{reservationId,expectedVersion,providerTotal,
  expectedTotal,reason,confirm:true}`. Re-fetches the authoritative Channex
  revision; verifies identity/property/latest revision, booking version, currency,
  status, dates and room count. Stores the explicit PMS/provider difference and
  financial evidence without rewriting the booking total. Links the existing PMS
  booking, saves a resolution/receipt, then queues ACK in the same transaction.
  Superseded reviews or mismatched totals require a new review. This action has
  no broad system-support write alias.
- GET `/api/tenants/<tenant_id>/channels/incidents?status=open|resolved|all&page=&pageSize=`:
  `{items,assignees,pagination}`. Default status `open`.
- POST `/api/tenants/<tenant_id>/channels/incidents/<incident_id>/actions`:
  `{action:assign|resolve|reopen,reason,assigneeId?,verified?}`. Assignment must
  select an active authorized tenant member (or null to unassign). Resolving
  requires `verified:true` after checking actual channel state. Reasons and
  actions are audited. Scoped Manager support has equivalent incident-only
  routes under `/api/admin/channex/tenants/<tenant_id>/channels/incidents`.

Authenticated webhook events `sync_error,sync_warning,rate_error` create bounded,
deduplicated tenant incidents. Registrations use `event_mask:'*',send_data:true`;
unhandled authenticated events return 202. Booking events still trigger an
authoritative pull. Existing shared-secret validation, encrypted credentials,
safe payload filtering and durable receipt-before-ACK behavior remain required.
Definitions follow [Channex booking revisions](https://docs.channex.io/api-v.1-documentation/bookings-collection)
and [webhooks](https://docs.channex.io/api-v.1-documentation/webhook-collection).

### SaaS refunds and temporary expiry access

System roles only:

- POST `/api/billing/invoices/<invoice_id>/payments/<payment_id>/refund`:
  `{amount,reason}` returns the invoice (201). Amount is positive and capped at
  that receipt's unrefunded amount; invoice locking serializes concurrent writes.
  Invoice adds `refunded,refunds`; each payment adds `refunded,refundable`.
  `paid` is net receipts minus refunds, so balance/status, overview, Owner summary
  and internal documents reflect the same net amount. Histories stay append-only.
  This records a completed correction/refund, not a banking instruction, and
  does not change subscription dates or plans.
- GET `/api/billing/tenants/<tenant_id>/operational-access`: `{access}` (or null).
- POST same path: `{until:ISO-timestamp-with-zone|null,reason}` returns `{access}`
  (201). Non-null expiry must be in the next seven days; null explicitly revokes.
  Access is available only for an active hotel, active plan and active-status
  subscription that has expired. Grants bind the exact plan and subscription end;
  renewal/plan change invalidates the previous grant.

`access` contains `id,until,reason,createdAt,active` and is also exposed as
`subscription.operationalAccess`. Active grants allow payment/charge/refund and
checkout for existing in-house bookings, corrections/refunds for closed existing
stays, housekeeping task completion, OTA incoming booking handling, review and
incident actions. They do not allow new direct bookings, POS sales, configuration,
ordinary OTA publishing or plan renewal. Booking must predate the grant. Role,
membership, feature flags, tenant suspension and worker checks still apply.
Expiry is never bypassed automatically and no grant unlocks a suspended hotel.
