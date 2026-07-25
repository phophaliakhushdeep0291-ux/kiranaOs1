# KiranaOS Stabilization Audit

Branch: `stabilize/kiranaos-v1`
Base commit: `16c9eabe` (origin/main)
Audit date: 2026-07-25
Scope: inspection only — no application logic was modified to produce this report.

---

## Verification status of this document

Findings are labelled by evidence strength. This matters: the repository already
contains confident claims that this audit found to be inaccurate, so nothing here
is asserted from documentation alone.

| Label | Meaning |
|---|---|
| **VERIFIED** | Read the code path end to end and confirmed the behaviour directly during this audit. |
| **CITED** | Located and read by a module audit with a file:line anchor, but not independently reproduced yet. Treated as credible, not proven. |
| **UNPROVEN** | Requires a running app, production data, or infrastructure this audit could not reach. |

No finding in this document has been reproduced with an automated failing test yet.
That is the next step and is required before any fix, per the agreed fixing process.

---

## 1. Repository structure

Monorepo with two independently deployed workspaces plus a hardware bridge.

```
/backend          Node 22 + Express 4 + Prisma 5.14 (ESM)   -> Railway (Docker)
/frontend         React 18 + Vite 6 + TypeScript            -> Vercel (static SPA)
/hardware-bridge  local printer/scanner bridge
/.github/workflows/release-certification.yml
```

Root also carries a large body of prior process documentation
(`RELEASE_GATE.md`, `BUG_BACKLOG.md`, `PRODUCTION_CHECKLIST.md`,
`CODE_REVIEW_LOGIC_FLAWS.md`, `SHOPIFY_PARITY_ROADMAP.md`) and a substantial
number of committed `*.log` / `*.png` QA artifacts and stray SQLite `.db` files
under `backend/prisma/`.

## 2. Frontend stack

React 18.3, Vite 6.3, TypeScript 5.8, TanStack Query 5, Dexie 4 (IndexedDB),
Radix UI + Tailwind 4, wouter routing, Vitest 4. Package manager is **pnpm 9.15.9**
(`packageManager` field), Node `>=20`.

## 3. Backend stack

Express 4.19, Prisma 5.14, `jsonwebtoken`, `bcryptjs`, `zod`, BullMQ + ioredis
(background jobs), Sentry, Helmet, `express-rate-limit`, AWS S3 SDK. Node 22 in
the Docker image. Package manager is **npm** (`package-lock.json`).

> Lockfile inconsistency across the repo (pnpm frontend / npm backend) is
> intentional and each workspace is internally consistent.

## 4. Database and Prisma structure

**Dual schema**, which is the single most important structural fact:

| | Path | Provider | Migrations |
|---|---|---|---|
| Dev | `backend/prisma/schema.prisma` | SQLite | 49 |
| **Prod** | `backend/prisma-postgres/schema.prisma` | PostgreSQL | 67 |

Both define the **same 70 models** — verified by diffing the model lists; the
migration-count gap is history granularity, not model drift. Both validate
cleanly (Postgres needs `DIRECT_DATABASE_URL`, which the Dockerfile defaults to
`DATABASE_URL`).

**Money representation (VERIFIED — highest-value architectural finding).**
Rupee `Float` columns remain authoritative. The `*Paise BigInt?` columns are
**nullable shadow columns**. `backend/src/utils/money.js` states this outright:
*"This is an in-memory helper only; DB columns remain Float for now."*
`docs/PAISE_SHADOW_COLUMNS.md` describes an 8-step staged migration; steps 7–8
("switch reads/reports to paise-first", "remove or freeze old Float columns")
are **not done**. The one exception is `FinancialLedger.amountPaise`, which is
non-null BigInt with no Float twin and is genuinely integer-paise end to end.

In-memory arithmetic is safe: all money math routes through integer paise in
`money.js` (`round2`, `sumMoney`, `subtractMoney`, `multiplyMoney`, `moneyEquals`).
Residual raw-float `reduce` sums exist in purchase totals (§18).

No transaction sets an `isolationLevel`, so production runs at **READ COMMITTED**.

## 5. Authentication flow

JWT HS256 access tokens (15 min) + opaque rotating refresh tokens (30 days,
bcrypt-hashed at rest, reuse detection revokes the whole token family). Bearer
only — no cookies anywhere, so no CSRF surface. bcrypt cost 10 at every hashing
site; `sanitizeUser()` strips `passwordHash`/`pinHash` from all responses; the
logger redacts credential-shaped keys.

`requireAuth` re-reads the user, session, and device from the database on
**every** request, so revoked staff and role downgrades take effect immediately
rather than at token expiry. That is a deliberate correctness-over-latency
trade-off and it is implemented correctly.

## 6. Shop and user isolation model

**VERIFIED SOUND.** `shopId` is derived only from the verified JWT and then
re-read from the database row (`middleware/auth.js:105-109`); `requireShop` sets
`req.shopId` from that. The historical "shop-header trust" bug is genuinely
fixed — `x-shop-id` appears exactly once in `src/`, inside a comment. A sweep of
Prisma calls against tenant-owned models found **no cross-tenant read/write
defect in the business modules**; unscoped `where: { id }` sites are all
follow-up writes guarded by a preceding shop-scoped `findFirst`.

Client-supplied `locationId` is always re-resolved through
`resolveOperationalLocation(shopId, id)`, so cross-tenant location IDs cannot
resolve. Unauthenticated routers (public QR storefront, Razorpay/WhatsApp
webhooks, integrations API-key) each carry their own verified gate.

The cross-tenant P0 below is **not** in the business modules — it is in the job
queue admin surface.

Frontend IndexedDB is scoped by `tenant_id + store_id` on every read and write
path (`rowMatchesCurrentScope`), with a `local_tenant` fallback when no session
is loaded (§18, P2).

## 7. Billing flow

**VERIFIED WELL-ENGINEERED.** `confirmBill` (`bills.service.js:124`) wraps bill +
items + payments + udhar ledger + stock ledger + financial ledger in a **single
`$transaction`**, with an in-transaction idempotency re-check and an outer
catch for the unique-constraint race. Duplicate prevention is enforced by three
real DB constraints:

```
@@unique([shopId, billNo])
@@unique([shopId, idempotencyKey])
@@unique([shopId, sourceDeviceId, clientBillId])
```

Cancellation is race-safe (conditional `updateMany` claim, `count !== 1` check)
and reverses stock, udhar, financial ledger, loyalty, offers, gift cards and lot
allocations **inside one transaction**, using compensating entries rather than
destructive edits. Sale returns are modelled as negative-amount bills, so every
report that sums active bills reverses automatically. This is good design.

Caveat: all three idempotency columns are nullable, and SQL unique constraints do
not collide on NULL. The server never *requires* an identity. The shipped client
always sends `clientBillId` + `x-device-id` (deliberately — see the comment at
`BillingPage.tsx:1229`), so there is **no live duplicate bug**, but a direct API
caller gets zero protection (§18, P2).

## 8. Inventory flow

**The weakest subsystem.** There is no single authoritative stock-movement table.
Four independent stores exist: `Product.stockBaseQty`, `LocationStock.stockBaseQty`,
`StockLedger`, and `InventoryLot.availableBaseQty`. `StockLedger` is a **log, not
a source of truth** — nothing derives stock from it.

Most paths (sale, cancel, return, restore, damage, correction, count, PO receipt,
purchase return, sync sale) correctly write the cached quantity and the ledger row
in one transaction. But several paths mutate stock with **no movement record at
all**, so the invariant "current stock == sum of authoritative movements" is
structurally false, and **no reconciliation script, test, or diagnostic exists
anywhere in the repo** to detect drift.

Units are handled well (`baseUnit` g/ml/piece vs display/rate units; unknown
units rejected rather than defaulted to 1). Negative stock is deliberately
allowed for sales only and blocked everywhere else, consistently.

## 9. Customer and udhar ledger flow

**VERIFIED CORRECT in design.** Balance is derived from `UdharLedger`
(`calculateCustomerUdharRawBalance`), with `Customer.udharAmount` as a
denormalized cache refreshed by `syncCustomerUdharBalance`. Rounding is applied
once per customer, so list and detail views agree.

Two concerns, §18: the `repairNegative` behaviour, and `/udhar-ageing` reading
the cache instead of the ledger.

## 10. Purchase and expense flow

Purchases: PO create, receipt, three-way match, partial-payment pro-rata
allocation (remainder to last line — correct, no paise leakage), weighted-average
cost, purchase returns. All single-transaction. **Supplier outstanding balance is
never computed anywhere, and there is no supplier-payment HTTP endpoint** —
supplier payments exist only as an offline sync event.

Expenses: create/update/delete/restore all transactional with paired
`FinancialLedger` postings; edits correctly modelled as reverse-then-repost with
a shared operation id. But expenses have **no idempotency key of any kind** — the
only money-moving entity in the codebase without one — and **cannot be created
offline** (no `EXPENSE` sync event type exists).

## 11. Reports calculation flow

All reports are computed **live from canonical domain tables**, not from
maintained counters. The only snapshot is `DailyClosingSnapshot`, used only for a
locked or explicitly requested day. CSV exports re-call the same service
functions rather than reimplementing.

`totalSales` is provably consistent between dashboard and reports (identical
predicate + identical sum). However **"cash" has four different formulas**,
`netProfit` has **two different definitions**, and two different date-range
parsers are in use. See §18.

**BUG-002 is confirmed still open.** `FinancialLedger` is written from 13 call
sites and read by exactly **two** places, neither of which is a report
(`/api/accounting/control` and the backup dumper). `summarizeFinancialLedger` has
zero production callers. The service header comment calling it the accounting
"source of truth" is currently false. It cannot reconcile with the report layer
for five structural reasons — most importantly it has **no `locationId` column**,
so it can never be branch-scoped, while every bill-derived report is.

## 12. Offline storage architecture

Dexie/IndexedDB, scoped by `tenant_id + store_id`. Bills are written locally first
and enqueued in a `sync_outbox`; the UI renders from local data immediately. One
deliberate exception: bills carrying an offer, loyalty redemption, or gift-card
payment bypass the outbox and post directly online, because value redemption must
commit atomically with the bill (`queries.ts:18-23`).

## 13. Synchronization architecture

Documented thoroughly in `backend/docs/SYNC.md` (accurate as far as this audit
checked). Verified mechanics:

- **Atomic event claim** — insert-first on `@@unique([shopId, eventId])`; a
  concurrent claim gets P2002 and returns the existing result rather than
  re-applying. Stale/failed claims are reclaimed by compare-and-swap on
  `(status, updatedAt)`. This is a correct implementation.
- The claim, the business mutation, and the SYNCED mark are **three separate
  commits**. A crash between mutation and mark leaves the event `PROCESSING`, and
  the stale-retry path would re-apply it — but the inner domain idempotency
  (`findExistingCreateBillResultByIdempotency` plus the DB unique constraints)
  catches this. Defence in depth is present and load-bearing.
- Dependency-aware batching resolves offline `localId -> serverId` within one push.
- Owner-gated event types verify the owner PIN by bcrypt; `ownerPin` is stripped
  before the event is persisted and never logged or returned.

## 14. Device-management flow

Slot accounting with a per-shop in-process mutex **plus** a
`pg_advisory_xact_lock` inside the transaction, which closes the classic TOCTOU
race on the device cap. Login fails closed in production when `x-device-id` is
absent. Over-limit login issues a 5-minute replacement challenge requiring
owner/admin role and a correct owner PIN. No device-limit bypass was found via
header rotation — but see P0-2, which bypasses the cap by a different route.

## 15. Deployment configuration

- **Frontend → Vercel.** `vercel.json` is an SPA rewrite only.
- **Backend → Railway via Docker.** `node:22-bookworm-slim`. The container `CMD`
  runs `prisma migrate deploy` **on every boot** before `npm start`. Prisma takes
  an advisory lock, so concurrent boots serialise rather than corrupt — but
  migrations executing as part of normal app start is a deployment risk worth
  naming (a bad migration takes the service down rather than failing a
  deploy step).
- Health endpoints `/health`, `/health/ready`, `/api/health`; Docker `HEALTHCHECK`
  polls `/health/ready`.
- CORS in production requires exact-match HTTPS non-loopback origins, enforced at
  boot. Helmet + HSTS + explicit security headers; `x-powered-by` disabled.
- Metrics endpoints are gated behind a separate operator credential.

## 16. Existing test coverage

| Suite | Result |
|---|---|
| Frontend Vitest | **727 passed, 1 skipped** (124 files) |
| Backend example suites (~104 files) | **all passed** |
| Backend integration (isolated SQLite) | **155 passed, 1 skipped, 0 failed** |

Coverage is broad and genuinely exercises business outcomes rather than mocks.
Real gaps, relative to the risk map:

- **No stock reconciliation test anywhere** (sum of movements vs on-hand).
- **No test reconciling `FinancialLedger` against bill-derived reports.**
- The two timezone tests named in the repo assert only pure helpers and
  regex source-text guards; neither runs an actual report query across an IST day
  boundary, and neither exercises the custom `from`/`to` branch.
- No test covers a late-syncing offline bill's date attribution.

## 17. Existing TypeScript, lint, build, migration and test errors

**Baseline is clean.** Nothing was failing before this audit:

| Check | Result |
|---|---|
| `frontend: npm run typecheck` | pass |
| `frontend: npm run test` | 727 pass / 1 skip |
| `frontend: npm run build` | pass (2852 kB raw / 845 kB gzip) |
| `frontend: npm run security:check` | pass (bundle budget + production-app) |
| `frontend: npm run prod:check` | pass (full chain) |
| `backend: npm test` | pass |
| `backend: npm run test:integration` | 155/156, 1 expected Postgres-only skip |
| `backend: npm run prod:check` | pass |
| `backend: npm run migration:safety` | pass, 0 warnings |
| `backend: npm run release:gate` | pass, 1 warning (`RELEASE_APPROVED` not set) |
| `prisma validate` (both schemas) | valid |

Notes:
- **No lint script exists in either workspace**, so item 17's "lint errors" has no
  baseline and no CI enforcement. Recommend adding ESLint before pilot.
- Local `backend/prisma/dev.db` has **all 49 migrations unapplied** — it was built
  via `db push`. "A fresh database migrates and boots cleanly" is therefore
  **UNPROVEN** in this checkout.
- `npm run money:paise:reconcile` is **Postgres-only** and refused to run locally.
  Float↔paise drift in production is **UNMEASURED**. This audit did not connect to
  any production database.

---

## 18. Findings

### P0 — must fix before any external use

**P0-1 — Cross-tenant job queue control. (VERIFIED)**
`lib/queue.js:179` `retryFailedJob(queueName, jobId)` and `:194`
`discardFailedJob(queueName, jobId)` take no `shopId` and perform **no ownership
check whatsoever**. `:157` `getFailedJobs` returns every tenant's failed jobs
including job IDs, and `jobs.routes.js:11` `GET /failed` has no owner-PIN gate.
The mutating routes do require `requireOwnerPin` — but that is the caller's *own*
PIN. Job IDs are structured and predictable (`shop-backup-<artifactId>`,
`webhook_<deliveryId>`).
*Impact:* any shop owner can enumerate other tenants' jobs, then permanently
discard Shop B's backups, WhatsApp reminders, webhook deliveries and report
exports; `POST /queues/:name/pause` halts a queue **platform-wide for every
tenant** in one request. Violates core invariants 6 and 7.
*Fix shape:* require `job.data.shopId === req.shopId` before retry/discard, filter
`getFailedJobs` by it, and move queue pause/resume behind the platform-operator
credential already used by `/metrics`.

**P0-2 — Device-limit challenge token is accepted as a full access token. (VERIFIED)**
`middleware/auth.js:30` reads `if (payload.tokenType && payload.tokenType !== "ACCESS")`.
A token carrying **no** `tokenType` passes the guard. The device-replacement
challenge token (`devices.service.js:243`) is signed with the same `JWT_SECRET`,
carries `userId` + `shopId`, and has **no `tokenType` and no `sessionId`** — so the
entire session/device/revocation block at `auth.js:46-100` is skipped. It is
handed to the client inside the `DEVICE_LIMIT_EXCEEDED` **rejection** response.
*Impact:* a login that was just refused for exceeding the device cap yields 5
minutes of session-less, device-unbound authenticated access to every
`requireAuth + requireShop` route lacking `requireDeviceActivated()`. None of the
revocation checks apply to it. Not cross-tenant (the `shopId` claim is
re-validated), but it defeats an intentional security gate.
*Fix shape:* make the check positive (`payload.tokenType !== "ACCESS"` → reject)
and reject any payload carrying `purpose`. One line.

**P0-3 — `PATCH /api/products/:id` silently overwrites stock. (VERIFIED)**
`products.schema.js:28` declares `stockBaseQty`; `:49`
`updateProductSchema = createProductSchema.partial()` therefore accepts it on
PATCH. `products.routes.js:14-20` `protectedProductFields` **omits** it, so no
owner PIN is required. `products.service.js:216-230` spreads it straight into
`tx.product.update`.
*Impact:* stock is rewritten with **no `StockLedger` row, no `LocationStock`
adjustment, no audit log, and last-write-wins over concurrent sales** (the only
guard is an optional `baseUpdatedAt` with a 1-second tolerance). Meanwhile
`POST /api/inventory/correction`, which does exactly this correctly, **does**
require an owner PIN. `createProduct` has the same passthrough for opening stock.
*Fix shape:* strip `stockBaseQty` from the update schema and require callers to
use `/inventory/correction`; or add it to `protectedProductFields` and route it
through the stock primitives so a ledger row is written.

### P1 — financial correctness

**P1-1 — Offline bills are recorded on the wrong business day. (VERIFIED)**
`bills.service.js:415` `tx.bill.create` never sets `createdAt`, falling back to
`@default(now())`. `sync.service.js:2982` `stripKnownSyncPayloadKeys` explicitly
discards any client `createdAt`, and `confirmBillSchema` has no such field.
`businessDate` exists only on `FinancialLedger`, never on `Bill`.
*Impact:* a bill rung up offline on 1 June and synced on 3 June is permanently a
**3 June sale**. 1 June's daily closing is silently and permanently short, and no
staleness check can detect it because the bill's timestamp falls outside 1 June's
window entirely. GST periods can be filed against the wrong month. This defeats
the core offline-first promise of the product.
*Fix requires a new nullable column on `Bill` plus a migration, and it changes
user-visible report numbers. Blocked pending explicit approval.*

**P1-2 — Expenses list/summary use UTC day boundaries. (VERIFIED)**
`expenses.service.js:19-22` `dateRangeWhere` uses raw `new Date(from)` — UTC
midnight is 05:30 IST. `getExpenseOverview` directly beside it handles shop
timezone correctly, *with a comment warning about this exact bug*.
*Impact:* `/expenses` and `/expenses/summary` disagree with `/expenses/overview`
and `/pnl` by 5.5 hours; a single-day query returns the wrong day's expenses.
Contained fix, no schema change.

**P1-3 — Expenses have no idempotency key. (CITED)**
`schema.prisma:1051-1078` — no `idempotencyKey`, no `clientExpenseId`, no
`@@unique`; `createExpense` does no dedupe. Every other money-moving entity
(Bill, Payment, UdharLedger, StockLedger, FinancialLedger) has one. A double-tap
or retried POST creates two expenses and two ledger postings.

**P1-4 — Online inventory endpoints have no idempotency. (CITED)**
`inventory.controller.js:21/28/56` call the service with two arguments, so
`identity = {}`. A double-tap or timed-out retry on `POST /api/inventory/purchase`
doubles stock **and** doubles the supplier due via a duplicate `PurchaseHistory`
row. Only the sync path is protected. Same for damage and correction.

**P1-5 — PO receipt `idempotencyKey` is optional and never server-derived. (CITED)**
`purchaseOrders.schema.js:36` `.optional()`; no idempotency middleware exists. A
client omitting the key gets zero replay protection: a retried receive creates a
second receipt, a second stock increment, a second supplier due and a second cost
recalculation.

**P1-6 — Stock mutated with no movement record, in several paths. (CITED)**
Beyond P0-3: stock transfers (`stores.service.js:142-157`) write no ledger row —
which also defeats the stock-count staleness guard, so applying a count silently
erases a concurrent transfer. The sync purchase-quantity edit
(`sync.service.js:2135-2145`) does a non-atomic read-modify-write, skips
`LocationStock`, and **mutates the existing ledger row in place** rather than
appending a compensating row, breaking append-only and staling later rows.
`DELETE_PURCHASE_BILL` zeroes the money but leaves the stock.

**P1-7 — `InventoryLot` diverges from `stockBaseQty`. (CITED)**
Lots are created only on PO receipt and are not maintained by damage, correction,
count, transfer, or manual purchase. Because lots are location-scoped,
transferring batch-tracked stock strands them at the source: the destination
raises `BATCH_STOCK_INSUFFICIENT` while the source can still allocate stock it no
longer physically holds.

**P1-8 — Missing cost data reports 100% margin, unflagged. (CITED)**
`bills.service.js:191` falls back to `?? 0` for cost. With zero cost,
`lineProfit == lineTotal`, so a shop that never entered purchase costs sees
**profit == revenue** across `/pnl`, `/sales-summary`, `/monthly-breakdown` and
`/top-products`, with no `costDataMissing` flag. Contrast `getInventoryHealth`,
which does flag its estimate.

**P1-9 — Supplier outstanding is never computed. (CITED)**
No balance function, no statement/ledger endpoint, and **no supplier-payment HTTP
endpoint at all** — payments exist only via offline sync. Worse, the payable is
keyed by receipt id while the payment is keyed by purchase-history id, so account
2000 nets only in aggregate and never per document. `softDeleteSupplier` performs
no outstanding-due check, though customers get exactly that protection.

**P1-10 — `/udhar-ageing` reads a cache that is permanently stale. (CITED)**
`reports.service.js:361-363` filters `Customer.udharAmount` and does not filter
`deletedAt`, while the cache writer skips soft-deleted customers. A soft-deleted
customer's balance is frozen forever and keeps appearing in ageing, while
`/udhar/summary` (ledger-derived) correctly excludes them. Violates invariant 8 of
the project's own `financial-ledger-consistency.md`.

**P1-11 — Cancelling a paid udhar bill erases the customer's refund claim. (VERIFIED path, UNPROVEN end to end)**
`bills.service.js:648-671`. Bill debits ₹500 → customer pays (balance ₹0) →
cancel posts a reversal payment of ₹500 (balance −₹500, shop owes customer) →
`repairNegative: true` posts a synthetic `system_repair` debit of ₹500, returning
the balance to ₹0. The customer's money is absorbed and their claim disappears
from the balance. It is traceable (the repair row carries a note), so this is not
silent data loss — but the balance is wrong.

**P1-12 — `cancelPurchaseReturn` has no atomic status claim. (CITED)**
`purchaseReturns.service.js:93` is read-then-act, then `:135` updates
unconditionally. Under READ COMMITTED two concurrent cancels both proceed and both
restock. Double restock is prevented only *incidentally* by a `FinancialLedger`
unique-key collision — which stops working when `totalAmount <= 0`. Correct
outcome, wrong mechanism.

**P1-13 — Reports disagree with each other. (CITED)**
Four different "cash" formulas across `/daily-closing`, `/sales-summary`,
`/payment-modes` and `/payment-summary`; **none deducts cash expenses**.
`netProfit` means two different things (`:487` subtracts expenses, `:606` does
not), so twelve monthly figures will not sum to the yearly one. Two different
date-range parsers disagree whenever `from`/`to` carry a time component.
`roughBills` counts cancelled estimates. Returns never reverse the discount
total. `/payment-modes` hardcodes `refundPaise: 0` and asserts
`unsupported: { refunds: false }` while netting refunds into `cashPaise`.

**P1-14 — Daily closing has no opening cash, counted cash, or variance. (CITED)**
`DailyClosingSnapshot` stores `expectedCashPaise` and nothing else cash-related.
Drawer counting is entirely client-side and device-local, so the variance that
makes a closing meaningful is never persisted or auditable. The two sides also
disagree on what "expected" means. Additionally, no scheduler ever generates
closings — the only trigger is a manual CLI whose BullMQ `jobId` dedupes, so
re-running it after late data arrives is dropped.

**P1-15 — Owner PIN has no attempt counter, lockout, or dedicated throttle. (CITED)**
4-digit space = 10,000. Failures are not counted, not locked, and not audited
(only successes are logged). Rate-limit buckets are per top-level path segment,
giving ~6,000 attempts per 15 minutes across six independent buckets. An
authenticated staff account can exhaust the space in under an hour and thereby
obtain owner authority over cancellations, stock corrections, deletions, staff
invitation and device removal.

### P2 — weak validation, recoverable errors, edge cases

- **Server never requires a bill idempotency key.** All three columns are
  nullable; the shipped client always sends one, so no live duplicate bug, but the
  API is unprotected for direct callers. (VERIFIED)
- **Audit trail is not transactional.** 82 `createAuditLog` call sites, only 5
  inside the business transaction, and the helper swallows its own errors.
  `AuditLog` has no first-class `deviceId` or `reason` column. Core invariant 12
  is therefore only partly met. `updateExpense` is not audit-logged at all,
  despite being able to change amount and date. (VERIFIED)
- **`apiLimiter` key includes client-controlled `x-device-id`**, so rotating it
  yields a fresh bucket per request and defeats the limiter on unauthenticated
  routes (e.g. flooding public QR order submission). Does not widen login brute
  force (`authLimiter` is IP-keyed) or the PIN attack on authenticated routes. (CITED)
- **Unvalidated client `conversionToBase`** (`inventory.schema.js:29` is
  `.passthrough()`) poisons the purchase cost basis permanently; `1e400` yields
  `Infinity` and a bare 500. (CITED)
- **3-decimal quantities are rounded to 2 dp for stock but logged raw**, so
  `oldStockBaseQty + changeBaseQty != newStockBaseQty` on those rows. Quantity
  precision is also coupled to money precision via `round2`. (CITED)
- **Merged inventory lot causes a false `IDEMPOTENCY_KEY_REUSED`** on a legitimate
  retry; a client reacting with a fresh key produces a genuine double receipt. (CITED)
- **Purchase-return replay key has no payload binding** — a reused key silently
  returns the wrong document instead of erroring. (CITED)
- **Purchase return does not reverse weighted-average cost.** (CITED)
- **Expenses cannot be created offline** (no `EXPENSE` sync event type), so a shop
  recording expenses while offline loses them. (CITED)
- **Expense `category` is free text** with no normalisation, so "Rent"/"rent"/"rent "
  split into three buckets. `amount` allows 0, creating rows with no ledger
  counterpart. (CITED)
- **Offline scope falls back to `local_tenant`/`local_store`** when no session is
  loaded; rows written before auth hydration would be stranded. Low exposure
  because the API layer requires auth, but non-zero. (VERIFIED)
- **`GET /api/devices/license`** accepts an arbitrary `deviceId` and mints a
  license row; shop-scoped, so intra-tenant only, but any staff user can do it. (CITED)
- **`JWT_SECRET` is reused** as the dev fallback for `INTEGRATION_SIGNING_SECRET`.
  Production forces a distinct value, so dev-only — but secret reuse across trust
  domains is a smell. (CITED)
- **CSV export defaults to `status: "all"`**, including cancelled bills — the
  opposite default from every API report — and emits a UTC date beside a
  server-local time. (CITED)

### P3 — low impact

- Raw float `reduce` sums for PO/receipt/return totals instead of the `sumMoney`
  helper the same files already import; three different float tolerances
  (`0.000001`, `0.001`, `0.01`) across one domain.
- `BUG_BACKLOG.md:29` marks BUG-011 *Verified* against a claim the code
  deliberately does not implement — invoice number is explicitly **not** bound in
  the replay key (`purchaseOrders.service.js:42-45`). `updateCost` is also unbound
  despite affecting the cost write. The exclusion is defensible; the backlog entry
  is inaccurate.
- `refundMode` is ignored when splitting supplier credit vs cash refund.
- Committed QA artifacts: multi-megabyte `*.log` files, ~40 `*.png` screenshots,
  and stray SQLite `.db` files under `backend/prisma/`.
- `sync.controller.js.tmp`, a zero-byte stray file.

---

## High-risk areas where financial data could become inconsistent

Ranked by likelihood × blast radius:

1. **Stock.** Four parallel stores, at least four write paths with no movement
   record, and zero reconciliation tooling. Drift is undetectable today.
2. **Business-date attribution.** Every offline bill that syncs after midnight is
   booked to the wrong day, corrupting closings and GST periods.
3. **The Float/paise split.** Storage is Float-authoritative with nullable paise
   shadows; drift in production is unmeasured and the migration is half-finished.
4. **`FinancialLedger` vs reports.** Two parallel accounting truths that
   structurally cannot reconcile (no `locationId`, different reversal dating,
   incomplete purchase coverage), with no reconciliation test.
5. **Idempotency holes outside billing.** Billing is well protected; expenses,
   online inventory mutations and PO receipts are not.
6. **Supplier ledger.** No computed outstanding, no payment endpoint, payable and
   payment keyed to different entities.

---

## Recommended fix order

1. **P0-2** (one-line auth guard) and **P0-1** (scope job queue) — small,
   self-contained, no financial logic, no schema change.
2. **P0-3** (product stock overwrite) — schema-level input restriction.
3. **P1-2** (expenses timezone) — contained, no schema change.
4. **P1-1** (business date) — **needs approval**: new column + migration + changes
   user-visible numbers.
5. Idempotency gaps (P1-3/4/5), then stock reconciliation tooling, then the report
   disagreements.

Each fix per the agreed process: reproduce → failing regression test → smallest
safe fix → related tests → full suite → typecheck/lint/build → separate commit.

---

## Production readiness assessment

Against the brief's own bar, and independent of the fact that everything builds:

| Use case | Verdict |
|---|---|
| 1. Developer testing | **Yes.** |
| 2. Family-shop testing | **Not yet** — P0-3 and P1-1 will corrupt stock and daily figures in ordinary use. |
| 3. Limited external pilot | **No** — P0-1 is a cross-tenant integrity break; unacceptable with more than one real shop. |
| 4. Paid production use | **No** — 3 unresolved P0s, 15 unresolved financial-correctness P1s, no stock reconciliation, unmeasured money drift, and no verified backup/restore evidence in this checkout. |

`RELEASE_GATE.md`'s standing **NO-GO** is correct and is now backed by specific
defects rather than missing paperwork. Note that the gate's claim of "Open P0: 0"
is **inaccurate** as of this audit — three were found, all confirmed by reading
the code.
