# Phase 25 — Production Proof Runbook

This backend is feature-rich enough that the next production blocker is not more features. The blocker is proof: PostgreSQL migrations, real DB-backed integration tests, device-enforced API calls, concurrency, payment webhooks, workers, and frontend contract behavior must pass together.

## 1. Isolated PostgreSQL test database

Create a disposable database whose name clearly contains `test` or `_ci`.

Example local URL:

```bash
POSTGRES_TEST_DATABASE_URL="postgresql://kiranaos:kiranaos@localhost:5432/kiranaos_test?schema=public"
ALLOW_POSTGRES_TEST_DB=true
```

The scripts intentionally refuse PostgreSQL URLs unless:

- `ALLOW_POSTGRES_TEST_DB=true` is set.
- The database name contains `test` or ends with `_ci`.
- The database name does not look like production.
- The host is local/CI/test-looking.

This is because the PostgreSQL setup step uses `prisma migrate reset`, which is destructive.

## 2. Full PostgreSQL proof command

Run:

```bash
POSTGRES_TEST_DATABASE_URL="postgresql://kiranaos:kiranaos@localhost:5432/kiranaos_test?schema=public" npm run proof:postgres
```

This performs:

1. PostgreSQL Prisma client generation.
2. PostgreSQL schema validation.
3. Isolated PostgreSQL test DB reset/migration.
4. DB-backed integration tests.
5. API contract checks.
6. Production static checks.

## 3. Concurrency proof

The integration suite now includes:

```text
tests/integration/production-concurrency.integration.test.js
```

It proves:

- Two parallel bills cannot oversell the same product.
- Stock never becomes negative.
- Only one sale ledger is written when only one bill can succeed.
- Two parallel udhar payments cannot over-decrement a customer balance.
- Only one udhar payment ledger is written when only one payment can succeed.

These tests are most meaningful on PostgreSQL. SQLite can pass basic logic, but PostgreSQL is the real production database.

## 4. Device-enforced integration tests

Protected routes now require `x-device-id`. The integration setup lazily activates one real test device when a protected route responds with `DEVICE_REQUIRED`, then retries the same request with that device header.

This means tests prove the real device middleware path instead of bypassing it.

Important exception:

- `/api/sync/*` and `/api/devices/license` do not auto-attach a device, because some tests intentionally verify `DEVICE_REQUIRED`, removed devices, or blocked devices.

## 5. Commands to run before selling

```bash
npm install
npm run prisma:generate:postgres
npx prisma validate --schema prisma-postgres/schema.prisma
npm run proof:postgres
npm start
npm run contract:smoke
npm run smoke:test
```

With Redis enabled in another terminal:

```bash
npm run worker
npm run worker:health
```

With Razorpay test-mode credentials enabled, repeat the checkout + webhook flows from `docs/E2E_PRODUCTION_PROOF.md`.

## 6. Production gate

Do not call the backend sell-ready until all of these are true:

```text
PostgreSQL proof passed
Concurrent stock proof passed
Concurrent udhar proof passed
Razorpay test-mode checkout/webhook passed
Redis worker heartbeat passed
Contract smoke passed against running backend
Frontend sync/device/subscription E2E passed
Backup/restore drill completed
```
