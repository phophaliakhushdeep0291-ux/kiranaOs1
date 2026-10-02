# Offline history and cache optimization — 3 October 2026

Base: `a6a92641b4166cf296db4d879fc130cde29912c5` (main, PR #402).
Branch: `work/dashboard-customer-sync-reads`.

## Changes

The dashboard reads recent bills through a date index and resolves identity twins
before deduplication. It loads children for those bills rather than every item and
payment. Cancelled local identities survive the merge with stale API results, so
an active echo cannot reappear. Overlapping refreshes keep the latest result.

Customer detail reads linked customer identities, ledger, bills, payments and
audit records through derived indexes. It avoids loading the whole customer list
and reading the ledger twice. Customer lists and balance reconciliation build
their mapping graph once per snapshot rather than scanning it per customer.

Sync records affected cache dependencies, shares reads within a refresh, and
serializes refreshes. Startup, explicit recovery, restores and unknown changes
retain a full rebuild. Changes arriving during a refresh remain dirty; failed
reads retry instead of replacing a cache with an empty list. Derived balances
are calculated and written inside a financial transaction, preventing an older
refresh from overwriting a concurrent payment.

## Measured work

| Workload | Before | After |
|---|---:|---:|
| Ten recent bills from 10,000 bills, one item and one payment each | 30,000 returned rows | 80 returned rows |
| Full business cache rebuild | 13 snapshot table reads | 9 |
| Bill sync cache rebuild | 13 snapshot table reads | 7 |
| Supplier sync cache rebuild | 13 snapshot table reads | 2 |
| Expense-only sync cache rebuild | 13 snapshot table reads | 0 |

The first measurement uses actual Dexie queries against fake IndexedDB. It counts
rows returned to application code, not physical database pages, device latency,
memory peaks or checkout p95. Cache counts exclude the existing native orphan
cleanup scans; baseline counts follow the previous rebuild's call sites and the
new counts have regression assertions. Legacy bills without durable identity and ledger rows requiring
global duplicate checks retain full-history fallbacks. No worst-case bounded-read
claim is made for those records or for many cancelled recent bills.

## Compatibility and validation

Database version 8 backfills derived indexes without changing business fields,
pending outbox entries or the device license. Hooks maintain keys on direct Dexie
writes, partial updates, restores and reference rewrites. Versions 1–7 now declare
schema changes only; resolved tables and indexes are checked against the original
full definitions retained in `offline-schema-v1-v7.json`.

The migration is additive. A frontend rollback must retain version-8 database
compatibility; an older version-7 build cannot reopen an already upgraded
database. Preserve the offline database and pending outbox during rollback.

Regression coverage includes a real version-7 upgrade, reloads, alternate ID
spellings, mapping chains, shop switches, older cancelled twins, stale API echoes,
pending payments, ledger-only recovery, global legacy deduplication, cache retries
and changes arriving mid-refresh. The delayed balance-write test fails with 100
instead of 75 when its transaction is disabled, then passes with the transaction.

The release command is `KIRANA_BUILD_ID=a6a92641b416 VITE_API_BASE_URL=/api npm run
prod:check -- -- --maxWorkers=4`. Four workers bound local test concurrency; all
tests remain enabled. The serial 10,000-row measurement uses
`KIRANA_MEASURE_HISTORY=1 npm run test -- --maxWorkers=1
src/tests/offline-indexed-history.test.ts`.

The final local gate passed 3,308 tests, with one existing skip, across 426 passed
files and one skipped file. Typecheck, translations, production build, bundle
limits and the production application check all passed in that same run.

Bundle budgets and feature configuration are unchanged. The largest offline
package is approximately 1,279.8 kB gzip against 1,280 kB; startup is 273.5 kB
against 300 kB. Headroom is tight. Comparisons pin the build ID and use identical
frontend environment settings; this baseline was 1,278.1 kB gzip.

## Acceptance still outside this change

This evidence does not replace a fresh browser offline restart, low-end-device
latency testing, a large counter fleet reconnect test, physical printer/drawer
acceptance, or production backup/restore and monitoring acceptance. Local browser
verification remains unavailable under the existing URL-policy restriction.
Exact-candidate CI certification and deployment status must be checked separately.
