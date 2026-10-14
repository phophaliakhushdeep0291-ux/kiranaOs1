# Populated catalogue proof — 14 October 2026

The original catalogue path failed the existing 800 ms latency budget with a populated shop. Identical overlapping reads now share their database query; the global HTTP listing also shares immutable JSON serialization. SQLite uses its shop ChangeLog head (writers are serialized). PostgreSQL uses `pg_current_snapshot()` because sequence allocation does not guarantee commit order; a dedicated PostgreSQL regression covers an older sequence committing after a newer one without changing the head. Snapshot visibility semantics are documented in the [PostgreSQL manual](https://www.postgresql.org/docs/16/functions-info.html#FUNCTIONS-PG-SNAPSHOT). Completed and failed results are immediately evicted, and pending sharing is capped at 128 keys. Unknown engines fall back to unshared reads.

Tenant and query filters are part of the key. Non-HTTP callers receive independent deep copies. Branch inventory and low-stock responses still resolve their location data separately. No response fields, sorting, stock calculations, security gates or latency budgets were removed.

## Measured results

Owned disposable SQLite database; Node 22; 1,000 products, 200 customers and 400 bills, created through the real API and counted before measurement. Six read scenarios, each 10 seconds with 25 connections. No other local test suite was running during the final timed phase.

| Scenario | Before p97.5 | After p97.5 |
| --- | ---: | ---: |
| Product listing | 1,506 ms | 659 ms |
| Product search (matches all 1,000) | 1,699 ms | 630 ms |
| Customer listing | 153 ms | 96 ms |
| Bill listing | 644 ms | 129 ms |
| Live daily closing (400 bills) | 426 ms | 201 ms |
| Health | 4 ms | 3 ms |

All measured scenarios returned zero non-2xx responses and zero transport errors. Final status: **passed** against p97.5 <= 800 ms and errors <= 1%. Product throughput increased from 17.8 to about 45 requests/second. Improvements on unchanged routes are run-to-run variation, not claimed optimizations.

Raw evidence: [before](evidence/catalogue-performance-2026-10-14/before.json), [after](evidence/catalogue-performance-2026-10-14/after.json). Both measurements used uncommitted working trees: the first was based on `c24b3d90` with the new accounting/seed harness; the final was based on `a80b6919` plus this catalogue implementation. The baseline report predates the dirty-tree metadata field and its revision alone must not be treated as an exact clean-source certificate. The final report explicitly records `workingTreeDirty: true`.

## Reproduction and limits

From `backend`, run `LOADTEST_REPORT_PATH=/tmp/kirana-loadtest.json npm run loadtest:local`. `loadtest:postgres` uses an isolated Docker database or an explicitly supplied guarded `POSTGRES_TEST_DATABASE_URL`. This machine has neither Docker nor a configured test PostgreSQL; production-engine functional tests belong to release CI.

Reports use autocannon's actual 97.5th percentile (it does not expose p95). Timeouts are already part of its error count and are counted once. Threshold checks use unrounded values. Invalid configuration, unavailable servers and partial seeds cannot reuse a previous passing report. Existing-account mode does not seed records.

These results prove this local read workload, not production capacity, concurrent sale throughput, long-duration stability, branch-list throughput, 10,000-product scale, hardware latency or offsite disaster recovery.

Regression coverage exercises concurrent query/serialization sharing, mutable-result isolation, safe/large integer JSON, failure eviction, new committed stock/pack changes while an older read is pending, tenant/search filtering and fresh branch stock through the HTTP API.
