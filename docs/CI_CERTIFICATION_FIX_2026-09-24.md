# Release certification correction — 24 September 2026

Failure investigated: [release run 35917229328](https://github.com/phophaliakhushdeep0291-ux/kiranaOs1/actions/runs/35917229328)
for [PR #360](https://github.com/phophaliakhushdeep0291-ux/kiranaOs1/pull/360),
head `ea71a1db92e0115b170af959861b08bf0703f39f`.

## Causes and changes

1. PostgreSQL reported `P2002` when concurrent furniture receipt/refund requests
   inserted the same deterministic payment ID. The losing request returned 409
   although the other request had committed the payment. After rollback, the
   service now verifies that the payment exists on the same tenant's order and
   opens a fresh transaction to execute the existing replay-content checks.
   Different amounts or other changed details still fail. Receipts, refunds,
   tender corrections, ledger entries, journals, and mandatory audits remain
   atomic.
2. Stock movements omitted money fields unrelated to the movement. Their rupee
   defaults were zero, while the corresponding paise fields defaulted to null.
   A faithful database restore therefore failed read-only money reconciliation.
   Migration `000140_stock_ledger_money_defaults` supplies matching zero defaults
   for all five stock-ledger money pairs and fills only missing historical paise
   values. Existing paise values, including inconsistencies requiring review,
   remain unchanged. SQLite and PostgreSQL schemas carry matching defaults.

No CI checks were disabled. Restore verification still forbids automatic
backfill, and historical migrations remain unchanged.

## Verification

The original PostgreSQL tests reproduced both duplicate-record failures before
the service fix. Regression coverage now also checks conflicting concurrent
receipt payloads, concurrent tender corrections, exact ledger/journal counts,
stock money across purchase/sale/return/damage/correction, migration replay and
preservation of established values, and restored stock rows with omitted money
fields.

- `backend: npm test` — passed.
- SQLite integration: furniture delivery and counter lifecycle — 18 tests passed.
- `frontend: VITE_API_BASE_URL=/api npm run prod:check` — passed; 2,960 tests
  passed, one pre-existing skip.
- `backend: node scripts/migration-safety-check.js` — passed, no warnings.
- PostgreSQL restore runtime — all six cases passed with two synthetic tenants,
  147 tables compared, matching content hashes and verified business data.
- Full PostgreSQL production proof — passed, including all 50 integration files
  (446 tests passed, seven existing platform skips),
  payment-provider rollback checks, money reconciliation, API contract checks,
  and production static checks.

Local verification uses Node 22, disposable PostgreSQL 16 databases, and an
isolated checkout. A first broad PostgreSQL run timed out after a long local
execution pause; the rerun inhibits idle sleep for the duration of the command.
The existing device-license tests passed on the rerun without source changes.
Local evidence does not establish production deployment, scheduled backup
cadence, or a successful GitHub certification run for the correction commit.

Reports and hashes of the eight tested source files are saved in
`docs/evidence/ci-certification-2026-09-24/`. The reports identify the original
base commit with a dirty checkout; the source hashes identify the tested fix.
