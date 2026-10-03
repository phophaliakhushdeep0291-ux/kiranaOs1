# Financial calculation and display audit — 3 October 2026

The audit found real inconsistencies and added 27 frontend regressions. The final local release gate passes: **3,335 tests, 1 skipped, 429 passing files**, typecheck, translation checks, production build, bundle budgets and production app check. This is evidence for the tested workflows, not a claim that every possible transaction or live screen has been certified.

## Fixed

- Dashboard amounts retain paise on mobile and trade layouts. Negative expected cash and refund tenders retain their signs; a refund is not drawn as a positive pie slice.
- A completed financial read returning zero/empty customers takes precedence over stale cache/server results. An unpopulated cache no longer hides available backend totals. Customer totals include all customers, including those after the first fifty.
- Cached dashboard and fallback payment breakdowns use the same financial aggregation rules as reports: refunds, cancelled/rejected bills, split tenders and sync duplicates follow one calculation path.
- Today's dashboard no longer borrows the selected week's collections/drawer. Payment requests carry the selected day. Late refresh results cannot overwrite a newer financial snapshot.
- Daily chart buckets use actual hourly records, not an artificial closing-time spike. Yesterday's sales are no longer replaced with today's last chart bucket. The decorative seven-point trends were replaced with the two observed values.
- Product revenue/profit includes the allocated invoice discount; profit also includes allocated waived amounts. Historical line costs take precedence over current product costs. Fractional quantities retain three decimals.
- GST uses integer arithmetic with four-decimal rate support, avoiding half-paisa drift between counter, saved offline items, A4 invoice, returns and backend. The stored money on existing invoices is not migrated or rewritten.
- An older offline exclusive-tax invoice can retain its already collected payable only when trusted replay exactly matches one of the historical rounding results. There is no arbitrary payment tolerance or client-supplied tax override; live invoices use the corrected result.
- Partial returns preserve three-decimal quantities, allocate money in integer paise, and cap each subtotal/tax/cost allocation at the remaining original amount. The final return consumes the remainder.

## Independent arithmetic evidence

| Case | Expected result | Verified through |
|---|---:|---|
| 61 customers owing ₹10.25 each | ₹625.25, 61 customers | Actual instant-cache snapshot |
| ₹50 opening cash minus ₹171.50 cash expense | −₹121.50 | Aggregator and dashboard selector |
| Mixed-rate lines ₹59.75 + ₹200.50, invoice discount ₹10.25 | Taxable ₹250; GST ₹37.54; payable ₹287.54 | GST engine and receipt output |
| Same invoice with nearest-rupee round-off | Payable ₹288; adjustment +₹0.46 | Counter rounding and 58mm/80mm/A4 receipt HTML |
| Discounted sale, mixed tenders, debt recovery, refund, supplier payment, expense, drawer movements | Sales ₹239.50; profit ₹95.30; outstanding ₹117; closing cash ₹132.25 | Reports and closing services |
| ₹2.90 at 5%, exclusive tax | GST ₹0.15; payable ₹3.05 | Frontend/backend, saved offline bill and item |
| ₹0.42 at 12%, inclusive tax | Taxable ₹0.38; GST ₹0.04 | Frontend/backend, saved offline bill and item |
| Four partial returns of a line with ₹0.02 tax | ₹0.01 + ₹0.01 + ₹0 + ₹0 | Frontend and backend return arithmetic |
| Return 0.005 of 0.015 units sold | Quantity 0.005 retained; one third refunded | Return preview, consumption and reload |

The generated audit exercises **3,000 seeded invoices** across no-tax, inclusive and exclusive modes, checking against independent integer-ratio arithmetic and the backend implementation. It includes discounts, mixed rates and four-decimal rates. These are 3 parameterized tests, not 3,000 additional test cases in the headline suite count.

## Validation and limits

- Local gate: `KIRANA_BUILD_ID=a6a92641b416 VITE_API_BASE_URL=/api npm run prod:check -- -- --maxWorkers=4`.
- Final gate log: `/private/tmp/kirana-financial-audit-prod-check-final.log`.
- Largest offline package: **1,278.8 kB gzip**, within the unchanged 1,280 kB limit.
- Backend GST/legacy replay examples, billing-unit examples, profit examples and JavaScript parsing passed locally. Server API integration regressions were added for tax ties, trusted offline replay and repeated partial returns; exact-commit server certification is required on the PR.
- React server rendering verifies actual mobile amount and refund-breakdown components; receipt generation verifies HTML output. These checks do not verify browser layout, contrast or physical printing.
- Live browser verification remains unavailable: the Browser tool blocked the localhost navigation with its URL policy after the owned server was started and its worktree verified. No alternative browser access was used to bypass that restriction.
- No production transactions, production database, deployment or merge were performed as part of this audit.
