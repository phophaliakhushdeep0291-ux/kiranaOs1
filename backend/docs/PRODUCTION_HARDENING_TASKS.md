# KiranaOS Backend Production Hardening Tasks

Use these as small, safe implementation prompts. Apply one task at a time, run tests after each task, and do not add new product features until these stability/security tasks are proven.

## Phase 18A — Env and security middleware proof

Prompt:

> Fix validated environment configuration for all rate-limit and production-security variables used by middleware. Ensure every variable used from `env` exists in `src/config/env.js`, has safe defaults, is documented in `.env.example`, and fails fast in production when required secrets are missing. Do not bypass validation. Add or update tests so missing env keys cannot silently break rate limiting.

Status in this patch: **Done** for API/Auth/AI rate-limit vars and owner/manual activation env flag.

## Phase 18B — Manual subscription activation tenant safety

Prompt:

> Harden manual subscription/payment activation. Public tenant routes must never accept `shopId` from request body. They must use `req.shopId` only. Disable manual subscription activation by default behind an explicit env flag. Razorpay/payment success must not be faked. Add tests proving body `shopId` is ignored/rejected and manual activation is disabled unless explicitly enabled.

Status in this patch: **Done** for body `shopId` removal and default-disabled manual activation flag.

## Phase 18C — Staff plan gating and owner-role safety

Prompt:

> Enforce Growth+ staff-login gates at route and service level. Starter/Standard must not create staff users. Enforce max staff from the plan, count both `staff` and `admin`, reject owner creation through staff invite, and block owner-role transfer through generic staff-role update. Add tests for plan gate, staff limit, no second owner, and self/owner removal safety.

Status in this patch: **Done** for route gate, service gate, staff limit, and owner-role blocking. Remaining: DB-backed tests for all edge cases.

## Phase 18D — Device enforcement on protected shop APIs

Prompt:

> Apply backend device enforcement to protected shop APIs, not only sync. Domain APIs like products, customers, bills, inventory, reports, suppliers, udhar, jobs, reminders, AI, and shop settings must require an activated, non-blocked, non-removed device. Exclude login, refresh, device activation, subscription status/checkout/payment verification, webhook, health, and public plan routes. Add route-level tests to prove missing/blocked device cannot access paid shop APIs.

Status in this patch: **Done** for protected shop route middleware. Remaining: DB-backed route tests.

## Phase 18E — Subscription/feature gates for premium actions

Prompt:

> Enforce feature gates on paid actions at the route and service layer. Billing creation, staff management, purchase entry, stock correction, supplier entry, P&L reports, CSV exports, and WhatsApp reminders must be blocked when the subscription is expired or the plan is too low. Old data viewing must remain allowed after expiry. Add tests for Starter, Growth, Pro, active, grace, and expired subscription states.

Status in this patch: **Partially done** for key route gates. Remaining: deeper service-layer gates and DB tests.

## Phase 18F — Sync pull pagination correctness

Prompt:

> Fix sync pull pagination so one entity type cannot skip another. Replace single global cursor logic with per-entity cursors for products, customers, bills, stockLedger, and udharLedger. Keep backward compatibility for old clients, but return `sync.entityCursors` and `sync.hasMoreByEntity`. Add tests with uneven entity counts where one entity has more pages and another has fewer rows.

Status in this patch: **Done** backend support for per-entity cursors. Remaining: frontend must send `sync.entityCursors` back as `cursors` JSON.

## Phase 18G — Razorpay verification hardening

Prompt:

> Harden Razorpay payment verification and webhooks. Before activating a subscription, verify signature, transaction ownership, provider order id, amount, currency, local transaction id, payment status, and idempotency. Webhooks must not create/activate a subscription without a matching local checkout transaction. Add tests for wrong amount, wrong currency, wrong order, duplicate webhook, missing transaction, and refund events.

Status in this patch: **Done** for amount/currency/order/local transaction checks. Remaining: deeper refund entitlement reconciliation.

## Phase 18H — Stock concurrency safety

Prompt:

> Make bill confirmation and stock decrement concurrency-safe for PostgreSQL. Use a transaction with row locking or atomic conditional update to prevent overselling when two counters sell the same item at the same time. Add PostgreSQL integration tests with parallel bill confirmation attempts against limited stock.

Status in this patch: **Not started**. This needs real PostgreSQL DB testing.

## Phase 18I — Money precision migration

Prompt:

> Replace financial Float usage with paise integers or Decimal strategy. Billing, payments, udhar, profit/loss, inventory valuation, discounts, and report totals must not depend on JavaScript floating-point precision. Add migration plan, compatibility mapping, and tests for rounding edge cases.

Status in this patch: **Not started**. Needs schema/migration planning.

## Phase 18J — Real production proof phase

Prompt:

> Run full validation on real machine with SQLite and PostgreSQL: `npm install`, `npm run prisma:generate`, `npm run prisma:generate:postgres`, `npx prisma validate`, `npm run setup:test-db`, `npm run test:db`, `npm test`, `npm run prod:check`, `npm run prisma:deploy:postgres`, `npm start`, and `npm run smoke:test`. Fix every runtime, Prisma, migration, Redis, worker, and frontend-backend mismatch found. Do not add new features until this passes.

Status in this patch: **Pending on real machine** because Prisma engines/database runtime cannot be fully proven in this sandbox.

## Phase 19A — Bill stock concurrency safety

Prompt:

> Make bill confirmation stock-safe under parallel sales. Aggregate same-product bill lines before validation, then use an atomic conditional update such as `stockBaseQty >= requestedQty` with `decrement` inside the transaction. If another bill used the stock first, fail with a clear 409 conflict and do not create a partial bill. Add PostgreSQL integration tests with two parallel bill confirmations against limited stock.

Status in this patch: **Implemented backend guard** with same-product aggregation and atomic conditional decrement. Remaining: real PostgreSQL parallel integration test.

## Phase 19B — Inventory stock write safety

Prompt:

> Harden inventory mutations. Purchase and stock correction must not overwrite concurrent stock changes; use optimistic stock guards and fail with a retryable conflict. Damage/loss must use atomic conditional decrement so stock cannot go negative. Add tests for concurrent purchase, damage, correction, and stock ledger correctness.

Status in this patch: **Implemented backend guard** for purchase, damage, and correction. Remaining: real DB concurrency tests.

## Phase 19C — Udhar balance atomic updates

Prompt:

> Replace read-calculate-write customer balance updates with atomic increments/decrements wherever possible. Credit bills, bill cancellation, bill restore, and udhar payment/reversal must not lose updates when two devices update the same customer balance. Add parallel update tests.

Status in this patch: **Partially implemented** for bill create/cancel/restore udhar effects. Remaining: audit udhar module payment/reversal flows.

## Phase 19D — Refund entitlement reconciliation

Prompt:

> A Razorpay refund webhook must not only mark the payment as refunded; it must also reconcile the subscription entitlement. If the refunded transaction funded the current subscription, cancel/block that subscription, close period/grace immediately, and write audit logs. Duplicate refund webhooks must be idempotent.

Status in this patch: **Implemented backend reconciliation** for matching local refunded transactions. Remaining: provider-level E2E tests with real Razorpay webhook samples.

## Phase 20A — Money/quantity input guardrails

Prompt:

> Add shared Zod validation helpers for money, percentage/rate, paise, and quantity inputs. Reject NaN/Infinity, reject money values with more than 2 decimal places, reject suspiciously huge payload values, and normalize accepted money through the central money helper. Apply this to product prices, billing totals/payments, inventory purchase amounts, udhar payments, stock corrections, and payment-provider paise inputs. Add tests proving invalid precision and non-finite values are rejected before DB writes.

Status in this patch: **Implemented shared validation helpers** and applied them to billing, products, inventory, customers/udhar, sync stock/udhar payloads, and manual payment paise inputs. Remaining: DB-backed route tests.

## Phase 20B — Manual udhar payment atomicity

Prompt:

> Make manual udhar payment concurrency-safe. Replace read-calculate-set balance updates with an atomic conditional decrement guarded by `udharAmount >= amount`. If another device changes the balance first, fail with a retryable 409 conflict and do not hide the race. Add parallel tests for two simultaneous udhar payments.

Status in this patch: **Implemented backend atomic decrement** with `UDHAR_PAYMENT_CONCURRENT_MODIFICATION`. Remaining: real DB parallel test.

## Phase 20C — Customer/product duplicate hardening

Prompt:

> Harden duplicate identity rules. Customer mobile updates must reject another active customer using the same mobile. Soft-deleted customers must not permanently block mobile reuse under DB unique constraints. Product create/update must reject active duplicate product names after normalization. Add tests for create, update, soft-delete, and offline sync duplicate scenarios.

Status in this patch: **Implemented service-level duplicate guards** for customer mobile update/reuse and product normalized name create/update. Remaining: DB-backed route/sync tests.

---

# Phase 21A — Auth/session production proof

Prompt:

> Harden auth/session behavior for a production SaaS backend. Protected requests must not trust stale JWT role claims blindly. `requireAuth` should verify the token, load the active user from the DB, block deleted/disabled users, and attach the current DB role so role changes apply immediately. Staff removal must become soft deactivation, not hard delete, so audit/report references remain safe. Deactivation must revoke all staff refresh sessions, free reusable mobile/email slots, and create an audit log. Password changes must revoke existing refresh sessions. Refresh token replay/reuse must revoke the session and return a clear error code.

Status in this patch: **Done**. Added `User.disabledAt`, `Session.revokedReason`, active-user DB verification in `requireAuth`, soft staff deactivation, session revocation reasons, refresh-token reuse detection, and password-change refresh-session revocation.

# Phase 21B — Production preflight guard

Prompt:

> Add a production preflight script that fails deployment when dangerous production environment values are present: SQLite DATABASE_URL, placeholder JWT/license secrets, localhost/wildcard/non-HTTPS CORS origins, manual subscription activation enabled, metrics without token protection, incomplete Razorpay credentials when enabled, unsafe storage/export config, missing Redis when queues are enabled, or incomplete provider credentials. Wire it into package scripts and static production checks.

Status in this patch: **Done**. Added `npm run prod:preflight` via `scripts/production-preflight.js` and wired Phase 21 static checks into `npm test` and `npm run prod:check`.


## Phase 22 — Payment webhook operational hardening

### Phase 22A — Webhook processing state

Prompt:

> Add explicit processing state to payment provider webhook events. Store shopId, processingStatus, processingAttempts, processingError, processedResultJson, lastAttemptAt, and processedAt. Ensure failed processing attempts become visible and retryable instead of being silently hidden behind duplicate event detection.

### Phase 22B — Retry-safe duplicate webhook handling

Prompt:

> Update Razorpay webhook handling so duplicate events that were already processed stay idempotent, while duplicate events stuck in received/failed state can be safely retried with a processing lock. Store final processing result and mark failed events with useful error codes.

### Phase 22C — Owner/admin event operations

Prompt:

> Add owner/admin-only routes to list payment provider events by status and retry a failed/stuck payment webhook event. Do not expose raw provider payloads in list responses. Add static tests and operational documentation.

---

## Phase 23A — Worker heartbeat readiness

Prompt:

> Add Redis-backed worker heartbeat support. The worker process must periodically publish a sanitized heartbeat with instance id, queue names, status, lastSeenAt, concurrency, and pid. The API must expose owner/admin worker readiness through `/api/jobs/workers` and include `workerHeartbeat` in `/api/jobs/status`. Do not expose Redis URLs, raw payloads, secrets, customer contact data, or tenant-specific labels.

## Phase 23B — Worker health CLI and metrics

Prompt:

> Add a `npm run worker:health` script that fails when queues are enabled but no fresh worker heartbeat exists. Add metrics for `worker_ready_status` and `worker_heartbeat_age_ms`. Document how to alert on stale workers and queue backlogs.

## Phase 23C — Worker operations runbook

Prompt:

> Add a worker operations runbook that explains API process vs worker process, Redis requirements, health commands, alerting rules, failed job retry/discard safety, and the rule that core financial operations must never be moved to background jobs.

## Phase 24A — Frontend/backend API contract proof

Prompt:

> Add a machine-readable API contract and matching human-readable frontend integration guide. The contract must document auth headers, device header requirements, owner PIN requirements, feature gates, payment verification expectations, Razorpay raw-body webhook semantics, sync entity cursor expectations, and protected route groups. Add a static contract checker so backend route/security assumptions cannot drift silently.

Status in this patch: **Done** with `contracts/api-contract.v1.json`, `docs/API_CONTRACT.md`, `scripts/check-api-contract.js`, and `npm run contract:check`.

## Phase 24B — Production E2E proof checklist

Prompt:

> Add an E2E production proof checklist that the real frontend must pass against PostgreSQL, Redis/BullMQ, and Razorpay test mode. Cover owner onboarding, device activation, billing/stock, offline sync, subscription/payment webhook, worker proof, and staff/session security.

Status in this patch: **Done** with `docs/E2E_PRODUCTION_PROOF.md` and `npm run contract:smoke` for basic live API contract smoke checks.

---

## Phase 25A — Real PostgreSQL proof runner

Prompt:

Implement a destructive-safe PostgreSQL production proof runner. It must refuse to run unless the target DB name clearly contains `test` or `_ci`, `ALLOW_POSTGRES_TEST_DB=true` is set, and the host is local/CI/test-looking. It should generate the PostgreSQL Prisma client, validate the PostgreSQL schema, reset/migrate the isolated test database, run DB-backed integration tests, run API contract checks, and run production static checks.

Acceptance:

- `npm run proof:postgres` exists.
- `scripts/postgres-production-proof.js` exists.
- Production DB-looking URLs are refused.
- `docs/PRODUCTION_PROOF.md` documents the command.

## Phase 25B — Device-enforced integration test repair

Prompt:

Repair integration test infrastructure so protected APIs are tested with real active devices after device enforcement. Do not bypass middleware. When a protected non-sync route returns `DEVICE_REQUIRED`, lazily activate one integration test device for that JWT and retry once with `x-device-id`. Keep `/api/sync/*` and `/api/devices/license` tests able to intentionally omit device headers.

Acceptance:

- `tests/integration/setup.js` lazily activates a real device.
- Sync/device-license tests can still assert `DEVICE_REQUIRED`, removed device, and blocked device behavior.
- No production middleware is weakened.

## Phase 25C — Production concurrency integration tests

Prompt:

Add DB-backed integration tests proving that parallel bill creation cannot oversell stock and parallel udhar payments cannot over-decrement a customer balance. Verify only one operation succeeds, one fails with conflict, final balances are correct, and only one ledger row is written.

Acceptance:

- `tests/integration/production-concurrency.integration.test.js` exists.
- Parallel bill test expects one `201` and one `409`.
- Parallel udhar payment test expects one `200` and one `409`.
- Final stock and udhar balances never go negative.

## Phase 28A — PostgreSQL backup creation proof

Prompt:
> Add a safe PostgreSQL backup command that creates a non-empty logical backup with `pg_dump --format=custom --no-owner --no-privileges`. The command must not print DB passwords and must expose `npm run backup:postgres`.

Status in this patch: **Done** with `scripts/postgres-backup-create.js` and `npm run backup:postgres`.

## Phase 28B — Restore drill proof

Prompt:
> Add a disaster-recovery proof command that restores a backup into a separate restore-test database, refuses production-looking restore targets, verifies restored tables, and runs money paise reconciliation against the restored DB.

Status in this patch: **Done** with `scripts/disaster-recovery-proof.js` and `npm run proof:dr`.

## Phase 28C — Full ops proof integration

Prompt:
> Add disaster recovery as an optional strict step in the full operational proof suite using `PROOF_REQUIRE_DR=true`.

Status in this patch: **Done** in `scripts/production-proof-suite.js`.

## Phase 29A — Release gate and migration safety

Prompt:
> Add a release gate that blocks unsafe production rollout unless migration safety, changelog/version documentation, rollback plan, release runbook, and production launch checklist are present. Add a migration safety checker that detects destructive SQL and unsafe NOT NULL migrations before deploy.

Status in this patch: **Done** with `scripts/release-gate.js`, `scripts/migration-safety-check.js`, `docs/RELEASE_RUNBOOK.md`, `docs/ROLLBACK_PLAN.md`, and `docs/PRODUCTION_LAUNCH_GATE.md`.

## Phase 29B — Release proof command

Prompt:
> Add one command that runs migration safety, release gate, and the operational proof suite so a release candidate has a single pre-sell backend gate.

Status in this patch: **Done** with `npm run proof:release`.

## Phase 29C — Release evidence manifest

Prompt:
> Add a script that writes a release manifest containing version, commit, required proof commands, and required human rollout checks.

Status in this patch: **Done** with `npm run release:manifest`.
