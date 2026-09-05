# End-to-end quality review — 5 September 2026

This pass repaired defects found in fresh setup, billing, subscription display,
sync status and test execution. The local production checks pass. This report
does **not** certify a deployment or every physical-device workflow.

Changes were made on `codex/end-to-end-quality-20260905`, based on `bf61bd22`, in
an isolated worktree. Other work continued in the main checkout during the
review; it was not overwritten or included in this branch.

## Defects repaired

| Area | Observed problem | Result |
| --- | --- | --- |
| Fresh database | Prisma's Windows SQLite setup failed when the target file did not exist. | Setup and guarded reset create the parent/file without truncating existing data. |
| Seeded catalog | The invented demo GSTIN failed location validation; catalog requests returned HTTP 422. | New demo shops have no invented registration; reseeding repairs only the exact old demo placeholder. The seed loads environment configuration and selects the configured Prisma client. |
| Incremental sync | Local schema push did not install the SQL migration triggers, so local mutations did not populate the change feed. | Both setup and reset install the existing 33 sync triggers. A transaction rollback also rolls back its feed entries. Architecture documentation now describes this behavior. |
| Test execution | A restaurant script passed three test filenames as unused arguments to Node. Manufacturing and sync-conflict groups were absent from the full suite; the latter also lacked its isolated database runner. | Every listed restaurant test runs, the missing groups join the full suite, and a regression guard detects this silent omission pattern. |
| Fresh test install | The full suite's datasource-separation check required a PostgreSQL client that a fresh install had not generated. | The full-suite runner generates it when missing, without connecting to PostgreSQL. |
| Subscription display | Generic legacy pricing could show Rs 999 for a Kirana Business plan whose current price is Rs 599. | Badges and subscription views use trade-specific presentation, preserve matching server prices including grandfathered rates, and leave feature entitlements unchanged. |
| Billing feedback | A failed catalog request could look like an empty shop with no products. | An empty failed catalog displays the error and a retry action. Cached products remain usable. |
| Queued sale amount | A paid cash bill displayed Rs 0 because the sync screen read its zero credit balance instead of its sale value. | The screen prefers bill totals/actual amounts, including nested payloads; malformed values do not become fake zeroes. |
| Hindi sign-in | The sign-in button and three benefit strings remained English. | Those strings now use the English/Hindi dictionaries. |
| Runtime dependencies | The backend production dependency audit reported the vulnerable `qs` dependency chain. | `qs` is pinned to 6.16.0 through an override, with an updated lockfile. The production dependency audit reports zero vulnerabilities. |

## Automated validation

Run from each named package directory after installing its locked dependencies.
The frontend was installed with pnpm 9.15.9; runtime was Node 24.12.0 on Windows.

| Check | Result |
| --- | --- |
| `frontend: npm run prod:check` | Passed typecheck, translation checks, tests, production build, bundle budget and production-app checks. 2,314 tests passed, 1 live-API opt-in test skipped. |
| Translation parity | 5,746 keys checked across 17 modules; no problems. |
| Frontend startup payload | 253.0 kB gzip across 5 initial JS files, within the existing budget. Largest shop offline payload: restaurant, 1,010.7 kB gzip. |
| `backend: npm test` | Passed pretest, complete isolated source/calculation suite and posttest database workflows. Includes the newly enabled restaurant, manufacturing and sync-conflict checks. |
| Fresh setup smoke | Passed setup → seed → repeat setup → HTTP login/catalog → cash bill → stock/payment/feed checks → transaction rollback → guarded reset. Uses a unique disposable database. |
| `backend: npm run test:integration` | 34 files; 329 passed, 0 failed, 1 PostgreSQL concurrency test skipped on SQLite. |
| `backend: npm run test:warehouse` | Storage-bin, repack and replenishment workflows passed. |
| `backend: npm run prod:check` | Module graph and production-source checks passed. |
| `backend: npm run migration:safety` | Passed; zero warnings. |
| Prisma schema validation | Both SQLite and PostgreSQL schemas passed. PostgreSQL validation used local placeholder URLs; no PostgreSQL connection was exercised. |
| `backend: npm run contract:check` | Static API contract passed for 174 endpoints. |
| `backend: npm run razorpay:fixtures` | Six local checks passed: payment/webhook signatures, tamper rejection and body parsing. |
| `backend: npm run storage:verify` with `STORAGE_PROVIDER=local` | Write, read-back, delete and missing-after-delete confirmation passed. |
| `backend: npm run competitive:evidence` | Checker passed: 17 verified, 7 partial and 3 externally blocked claims. |
| `hardware-bridge: npm test` | 32 passed, 0 failed. Covers protocol, pairing, recovery and installer contracts. |
| `backend: npm audit --omit=dev` | Zero reported production vulnerabilities at review time. |
| `backend: npm audit` | Three moderate development-only entries remain: autocannon → hyperid → uuid. npm's proposed fix downgrades autocannon from 8.x to 2.0.1; that breaking tooling change was not applied. |

Some backend tests intentionally reject invalid data or force audit failures to
prove rollback. Their expected error output is followed by passing assertions;
it does not indicate a failed suite.

## Browser and database verification

The browser used the isolated Vite server on port 5174 and isolated API on port
3001, with a newly seeded demo database and the `127.0.0.1` frontend origin.
Existing data on the older `localhost` origin was not cleared.

1. Signed in and loaded all 10 demo products. Confirmed the Rs 599 Business badge.
2. Added a Rs 6 biscuit, held the bill, reloaded the page and resumed the same cart.
   Collected cash and verified the synced bill, one payment and stock decrement.
3. At 390 × 844, stopped only the isolated API, sold Rs 58 milk, and navigated to
   the bills page. The locally saved bill survived the full page navigation.
4. Restarted the API and synced. Repeating sync did not duplicate the bills,
   payments or stock movement.
5. After the amount-display fix, repeated the API outage with another Rs 6 cash
   sale. The pending operation showed **Rs 6**, then uploaded successfully.
6. Final database reconciliation: bills `KOS-2026-000001` through `000003` total
   Rs 6, Rs 58 and Rs 6; three payments. Biscuit stock moved from 120 to 118;
   milk stock moved from 5,000 to 4,000 base units. The sync queue had no pending,
   failed or conflict items after reconnection and repeated sync.
7. Core pages loaded at phone width without horizontal document overflow:
   billing, bills, inventory, customers, purchases, returns, reports, cash and
   payments, expenses, settings and subscription. Billing, customers, purchases
   and subscription also fit 768 × 1024. Browser warnings/errors were empty in
   the online route checks. Expected network failures occurred during API outages.

## Limits and remaining release work

- The API outage proves local bill persistence and recovery while the frontend
  server remains available. A cold PWA launch with the entire network unavailable
  was not tested in this pass.
- Production PostgreSQL concurrency, Redis workers, Docker packaging, cloud
  object storage, offsite backup/restore and deployed health checks were not run.
  Existing evidence elsewhere in the repository was not treated as a fresh run.
- No physical printer, barcode scanner, payment terminal, live payment-provider
  settlement or messaging delivery was exercised.
- The browser pass covered the core Kirana flow and route layouts. It was not a
  full manual exercise of every workflow in all 12 business verticals, nor a
  complete accessibility audit. Other verticals have automated coverage.
- The complete release-certification command was not run; the individual local
  checks above do not replace its external-service and deployment requirements.

Raw local logs and dependency-audit results are retained in the worktree's
ignored `qa-artifacts/end-to-end-quality-20260905/` directory. The reusable
regression tests are committed with these changes; no credentials, runtime
database or shop-data export is part of the source changes.
