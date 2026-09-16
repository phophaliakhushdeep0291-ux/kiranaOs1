# Scalability and optimization pass — 16 September 2026

Changes are local to `work/bugfix-interface-audit`, on top of the authentication improvements. They target repeated catalogue work and branch-stock reads; they do not establish a maximum supported merchant count or production throughput.

## What changed

- Product and stock-status screens build normalized search text once per catalogue snapshot. Subsequent searches normalize the query once and scan the index, preserving existing Hindi aliases, Unicode normalization, barcode/SKU matches and result order. The index is owned by the mounted screen, not a global cross-shop cache.
- Product filters use a single pass instead of a chain of intermediate arrays. The product and stock-status screens no longer truncate their input catalogue at 1,000 products; existing table pagination still bounds rendered rows.
- React Query receives a lazy initial-data reader, avoiding a complete cached-product scan on unrelated renders.
- A filtered product query makes one API request instead of also downloading the full catalogue. Its cache patch retains unrelated known products and respects pending edits and deletion markers. An unfiltered authoritative result still removes absent synced products.
- Display limits are applied after caching the full catalogue, so a 350-item picker cannot replace the master cache with 350 items.
- Concurrent IndexedDB cache hydrations share one pending read per shop/key. Pending entries are released on completion/failure and logout. A write version and logout generation prevent old reads from overwriting local edits or repopulating cleared memory. Readers that started under another shop discard their result.
- Product and inventory stock readers share a batched query with at most 1,000 product IDs. A branch selects only its own product-level rows. Primary-location readers still consume every allocation but process one batch at a time instead of retaining all rows across all batches. Existing primary rounding and product threshold behavior are preserved.

## Measurements and regression evidence

| Products | Index build | Previous: 10 queries | Indexed: 10 queries |
|---|---:|---:|---:|
| 1,000 | 16.83 ms | 145.17 ms | 0.77 ms |
| 10,000 | 121 ms | 1182 ms | 3.99 ms |


The benchmark uses synthetic data and measures CPU search work on this Mac. It excludes React render time, network transfer, database work and phone hardware. Index construction has an initial cost and runs again when the catalogue snapshot changes. These results are not an end-to-end app speedup claim.

Deterministic checks:

| Workload | Before | After |
|---|---:|---:|
| 100 overlapping cache reads for one shop/key | 100 IndexedDB reads | 1 |
| Filtered product query | 2 API requests | 1 |
| 2,501 products across 20 branches, viewing one branch | 50,020 stock rows returned | 2,501 |
| Product screen catalogue visibility | First 1,000 | Full snapshot, paginated rendering |
| Cache after a 350-item picker loads 1,500 products | Limited snapshot | All 1,500 retained |

New concurrency tests reproduced six failures in the original cache implementation before the fix. Regression coverage verifies local-write races, shop changes, logout, retries, caller-specific fallbacks, filtered cache patching, pending edits and tombstones, authoritative deletion, lazy cache initialization, Hindi/Unicode search parity, and searching beyond the first thousand products.

The stock integration test uses a real isolated SQLite database and compares batch quantities against single-product quantities for primary and secondary locations, including missing stock, per-location thresholds and variant-row exclusion. The stock reader unit tests verify bounded query size and on-demand batch consumption.

## Validation

Frontend `prod:check` passed: 2,701 tests passed, 1 intentional skip; typecheck, 6,032 translation keys, production build, bundle budgets and production-app checks all passed.

Backend `npm test` passed (exit 0), including pretest, the full isolated suite and posttest. The new stock integration and bounded-query tests also passed through `npm run test:variants`. `git diff --check` passed. Initial JavaScript remains within budget at 259.0 kB gzip (previous pass: 258.8 kB).

Reproduce the search measurement from `frontend` with `node scripts/benchmark-product-search.mjs`. Run frontend checks with `VITE_API_BASE_URL=/api npm run prod:check`. The backend's `npm run test:variants` includes both new stock-query tests; `npm test` runs them within the full suite.

## Remaining scale work

1. Measure production-like PostgreSQL API p50/p95 latency, query plans, memory, connection-pool waits and 429/5xx rates with large shop catalogues and concurrent devices. The existing load-test scripts need an isolated staging target and representative data before making capacity claims.
2. Replace full catalogue transfers with a versioned cursor/snapshot contract consumed by every offline reader and export path. Do not impose server-side limits on the current list endpoint: its clients expect a complete snapshot and would silently lose data.
3. Profile index construction and catalogue hydration on low-end Android devices. Consider background index construction or an IndexedDB search index if initial rebuild cost is noticeable.
4. Establish exact-candidate PostgreSQL/Redis concurrency, backup/restore and worker proofs before horizontally scaling production. This pass introduces no deployment, infrastructure purchase or new cache service.
