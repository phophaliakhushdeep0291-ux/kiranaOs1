# Report trend computation — 2 October 2026

PR #401 removed per-bill history scans and separated closing from the report overview. The remaining yearly-report cost came from rebuilding the same history for each comparison window and each of the 31 trend days.

The report now prepares one local-data snapshot per refresh. It reuses bill/item/payment lookups, parsed timestamps, bill tender values and current outstanding balances across those windows. Date bounds are compiled once per window. Stock movements are bucketed in one pass by local calendar day, with their existing business-date precedence and paise rounding.

Prepared state is confined to the refresh. A local edit or shop switch reads rows and constructs a new calculator. Returned outstanding/customer and supplier rows are copied, so changing one window's result cannot alter another window's balances.

## Clean comparison

Three-run medians on Node 26.1.0, macOS arm64, using the same synthetic one-year fixture as PR #401:

| Bills | Year report before | After | Closing before | After |
| --- | ---: | ---: | ---: | ---: |
| 1,000 | 272.29 ms | 28.48 ms | 9.75 ms | 6.65 ms |
| 10,000 | 3,131.02 ms | 250.26 ms | 80.14 ms | 72.54 ms |

The 10,000-bill yearly computation improved about 12.5 times beyond PR #401. These timings use in-memory table reads and exclude IndexedDB I/O, browser rendering and networking. The initial baseline run exceeded its test timeout after a long cold-run outlier; a subsequent clean before/after comparison completed successfully. No unrelated local processes were stopped.

The entire report and closing output match the previous implementation exactly for both fixture sizes, including all trend points, selected/comparison windows, profit, payment splits and stock summaries. Benchmark artifacts are in `docs/evidence/report-trend-performance-2026-10-02/`.

## Checks

Eighty focused finance/closing/ledger/supplier-payment regressions passed. Added coverage verifies collection dates, independent drawer adjustments, local-midnight boundaries, fresh rows after edits/shop changes, and stock business dates preceding upload timestamps.

The full frontend production gate passed: typecheck, i18n, production build, bundle/security checks and 3,278 tests, with one skip.

The browser loaded the new production assets from the isolated worktree. The QA day still closes at exactly ₹749.25; its year-to-date report retains ₹798.50 sales, ₹248.25 outstanding credit and ₹267.50 net profit. The browser fixture is small; it confirms the UI path and totals rather than the large-data timing.

The standalone benchmark now captures complete report output as well as closing output:

```sh
REPORT_BENCHMARK_OUTPUT=/tmp/report-benchmark.json npx vitest run --config scripts/report-benchmark.config.mjs
```

Database-read and browser-rendering costs still need measurement with a large real IndexedDB dataset. This change only claims the computation improvement shown above.
