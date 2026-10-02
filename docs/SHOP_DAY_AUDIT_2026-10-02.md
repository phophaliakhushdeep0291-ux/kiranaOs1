# Shop-day audit, 1–2 October 2026

Tested through the browser against a private SQLite fixture: QA Full Shop Day, one kirana product, one customer, an owner and staff accounts. The API was deliberately stopped while the counter remained open, then restarted. All money and accounts were synthetic.

## Reproduced failures and changes

- Reports and cash closing omitted expenses saved during an API outage. They now read the same local expense ledger as Expenses, preserve pending edits/deletions, refresh authoritative date windows, and label local estimates. Storage and authorization failures remain visible.
- A ₹0.25 cash shortage displayed as “₹0”. Closing, bill amounts and refund history now preserve paise.
- A full return of an invoice rounded from ₹199.50 to ₹200 refunded ₹199.50. The final return now settles the remaining invoice amount, including rounding; partial refunds cannot exceed that balance. Preview, local projection and backend use the same rule. Tax and item amounts retain their original calculation.
- An online wrong-PIN cancellation could project changes before server rejection. It now verifies the PIN before local money/stock changes. During an actual API outage the existing queued approval flow remains available.
- Cancellation could select a retired local bill copy by its server alias. Lookup now selects the surviving persisted bill. Recovery hydration also excludes retired copies from pending-edit preservation, while retaining genuine pending edits and user deletions. Cancellation stock projections preserve the product’s existing sync status instead of creating an unqueued product edit and a false conflict.

The branch includes main’s independently merged expense visibility/cache pruning and sellable-return stock fixes (PRs 388–390); these are not duplicated here.

## Shop-day evidence

Cash sale ₹399, UPI sale ₹200, mixed cash/credit sale ₹399 with cash ₹100.25, collection ₹50.50 by UPI, and a one-unit cash return ₹199.50 were exercised through the UI. Collection survived an outage and reload and uploaded once after reconnect. Three cash expenses totalled ₹50.50 and synchronized once each.

For 1 October, the expected figures are sales ₹798.50, cash ₹299.75, UPI ₹250.50, outstanding customer credit ₹248.25, and cash drawer ₹749.25 from an opening float of ₹500. Closing was saved at ₹749.25 and persisted across outage/reload. Expense-inclusive estimated net profit was ₹267.50.

A viewer was redirected away from billing and received “Viewer cannot cancel bill” when trying cancellation. The viewer could read bill details. Relevant before/after browser captures are in [the evidence directory](evidence/shop-day-2026-10-01/).

## Validation and limits

Frontend production gate: typecheck, bilingual i18n checks, production build/budget/security checks, and full tests. Backend production gate and billing/report/retail/role integration suites were run. Frontend checks passed; the final full suite passed 3,225 tests with one skip using two workers after two default-worker timeouts under host contention. Backend billing integration passed 34 tests, with round-up, round-down, final partial return and replay assertions; report, retail, lifecycle and role suites also passed.

The browser rejected PIN 9999 with “Wrong PIN” before mutation. PIN 1234 then cancelled the same bill, kept it visible and restored server stock to 16. A new ₹200 sale was fully returned while the API was stopped: preview and local confirmation both showed ₹200, local inventory showed 16 while the server still showed 15, and reconnect created exactly one return with -20,000 paise and restored server inventory to 16. A further sale/cancellation verifies the final product-status repair. GitHub checks remain the merge gate.

This proves the exercised kirana shop-day paths, not every vertical or physical deployment. API outage testing retained browser network connectivity; true network-disabled behavior has separate automated coverage. Idle unlock still requires a valid available unlock method: an API outage with the browser reporting online is not treated as offline PIN unlock. No printer, payment-provider settlement or real production PostgreSQL deployment was exercised in this local browser pass.
