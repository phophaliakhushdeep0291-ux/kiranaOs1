# Large-shop report performance — 2 October 2026

The synthetic fixture holds a year of 10,000 bills, 10,000 item rows, 10,000 cash/UPI payments and 1,000 products. Bills omit stored gross profit to exercise the legacy/offline profit fallback. Three-run medians measure computation with in-memory table reads; they exclude IndexedDB I/O, React rendering and networking.

| Fixture | Daily closing before | After | Year report before | After |
| --- | ---: | ---: | ---: | ---: |
| 1,000 bills | 92.03 ms | 9.51 ms | 542.61 ms | 293.73 ms |
| 10,000 bills | 2,646.79 ms | 89.82 ms | 21,743.15 ms | 3,424.44 ms |

For 10,000 bills, closing computation improved about 29.5 times and the yearly report about 6.3 times. The final standalone run took place after the full regression suite finished to avoid concurrent test load. This is not a measurement of complete browser screen latency.

## Confirmed causes and corrections

Payment tender selection scanned all payment rows for each bill, twice per aggregation. It now builds one bill lookup per aggregation, maintaining original payment order across local/server aliases and preserving the existing tender deduplication.

Legacy profit calculation rebuilt all item and product lookups for each bill. A shared lookup is built once per aggregation; stored profit, item deduplication, return signs and discount rounding still use the existing calculation.

Daily closing built the entire report overview, including comparison windows and trends it does not display. It now aggregates only the requested trading day.

## Sync clarity

The earlier pilot showed an empty local backup queue alongside one server-recorded failed cancellation. Diagnostics now explain that server counts cover the whole shop and can include changes removed locally or sent from another device. When the device's queue is known to be clear, the suggested action asks the owner to check the affected record and other devices instead of promising automatic retry. The badge describes retryability as “Can retry”. Both English and Hindi are updated.

## Verification and limits

The before/after closing outputs match exactly for both fixtures. Benchmark assertions cover sales, bill count, fallback profit, cash/UPI totals and the 31-day trend length. Existing focused finance/closing/ledger/supplier-payment regression suites passed 76 tests.

The full frontend production gate passed: typecheck, i18n, production build, bundle/security checks and 3,274 tests, with one skip. The computation benchmark is invoked separately so its longer runtime does not enter the normal five-second regression test budget.

The isolated browser preview uses this worktree's production build and an API backed by a separate copy of the synthetic shop database. The sync screen visibly explains the empty local queue alongside the historical wrong-PIN cancellation. Evidence is saved in `docs/evidence/large-shop-performance-2026-10-02/sync-diagnostics.txt`.

The optimized closing screen still shows ₹798.50 net sales, ₹299.75 cash received, ₹250.50 UPI received and ₹50.50 cash expenses. With the ₹500 float, expected and counted cash remain exactly ₹749.25. Evidence: `daily-closing.txt` in the same folder.

Run the standalone benchmark from frontend:

```sh
REPORT_BENCHMARK_OUTPUT=/tmp/report-benchmark.json npx vitest run --config scripts/report-benchmark.config.mjs
```

The yearly report still spends seconds calculating its 31-day trend on this fixture. Further improvement would need to reuse date-grouped financial inputs while retaining old-credit recovery and supplier settlement semantics. Full-year browser rendering, large IndexedDB reads, physical shop hardware and independent counter operation remain outside this computation benchmark.
