# Deployment readiness — 22 September 2026

Decision: **NO-GO for deployment.** The rental financial flow and furniture delivery safeguards are locally verified; this is not certification of every product workflow or of a deployed environment.

23 September follow-up: [Furniture accounting](FURNITURE_ACCOUNTING_2026-09-23.md) records the implemented refunds/corrections, credit allocation and reconciliation fixes. [Restaurant stock](RESTAURANT_STOCK_2026-09-23.md) records the dish-stock corrections and latest checks. Open items and counts in this 22 September report describe that earlier source snapshot.

## Source and scope

Local changes based on `079f436d` on `work/free-access-launch`. No commit, push, production deployment, real payment or external message was performed. The preview uses a synthetic SQLite QA database and localhost ports 5317/5318. The source fingerprint and credential-free evidence are in `docs/evidence/deployment-readiness-2026-09-22/`.

The checkout at the start of this pass did not contain the preceding uncommitted rental changes, while the preview and synthetic database still did. Source changes were restored and verified against the current checkout; the preview was rebuilt. Previous test logs alone were not accepted as proof for this source.

## Rental changes

- Booking receipts require a payment method and stable request reference when money is received. An exact retry reuses its booking; changed details cannot charge again.
- Advance receipts and refundable deposits post separately as liabilities. Return recognizes rent and fees, applies the advance and records any receivable. Final collection and owner-PIN-approved refunds post their actual tender and date. Every event writes a balanced journal and mandatory audit atomically.
- Refund retries and simultaneous requests cannot pay twice. Invalid amounts, changed payment methods on replay, and failed audits leave money unchanged. Picked-up items must be returned before closing; cancellation does not imply cash was refunded.
- Daily closing, Cash & Payments, and bank/UPI statement matching include rental receipts and refunds. A refund on a later business day does not restate the original receipt. Deposits never inflate retail sales or profit.
- Branch-scoped lists, payment history, stock availability and direct record access honor branch assignments, including legacy records. Bookings with money history cannot be deleted. Received money cannot be rewritten through the edit form.
- Older version-0 bookings are explicitly marked for review. Their original tenders are unknown and are not fabricated. They are excluded from verified deposit totals; financial actions remain blocked pending reconciliation.
- Reporting failures no longer become apparently confirmed zero entries. The statement blocks incomplete results and recovers on retry. Cash closing deducts paid, active cash expenses only. Hindi labels and accessible return-fee controls are included.

## Furniture follow-up

- Delivery now requires a matching active sale bill: same customer, order total, catalogue/custom quantities, recorded tender totals and actual sale stock deductions. Foreign, cancelled, returned, reused, estimate and unrelated bills are refused. Installation rechecks the linked bill.
- Linking a bill does not create another receipt or deduct stock again. Exact delivery retries do not duplicate the status audit.
- Received payments are permanent history. Paid/invoiced/delivered orders cannot be deleted; paid orders cannot be cancelled as though the money had been refunded. Price edits cannot reduce an order below receipts or transfer the receipt to another customer.
- Payment submissions have a stable request identity, exact-content replay checks, current-balance checks and mandatory transactional audits. Lost-response retries remain safe after delivery. Old clients missing a receipt identity must reload the updated app.
- The delivery dialog accepts a sale bill number and explains mismatches. Older delivered orders without a linked sale show a review notice and cannot receive further payments through the order book.

New order receipts now post dated Dr tender / Cr furniture-advance-liability journals in the same transaction as the receipt and mandatory audit. Linking the matching delivery bill reverses the bill's repeated tender and consumes that liability, so the original receipt date remains in cash history while revenue is recognized once. Daily closing includes the net furniture tender events. Orders are branch-owned, direct access requires branch sell permission, lists and reservations are branch-scoped with primary-only legacy visibility, and stock reservations use the selected branch's actual quantity.

**Furniture remains blocked for rollout.** Credit recovery must reconcile back to the order; audited refunds/corrections and legacy delivery repair still need supported workflows. The existing synthetic installed order has deliberately not been rewritten or silently invoiced. PostgreSQL migration and multi-branch behavior still need exact-candidate certification.

Seven isolated integration scenarios cover successful matching and exact-once linking, balanced receipt/application journals, daily-closing cash, receipt retries/concurrency, stale/overpaid requests, protected history, audit rollback, wrong bills, returned/cancelled/stockless sales, tenant isolation and old deliveries. The all-trade fixture now creates the correct furniture invoice instead of linking an unrelated counter bill. All seven scenarios and all twelve trade fixtures pass after this change; backend production and migration-safety checks also pass.

## Auto parts follow-up

Auto-parts fitment and part-number lookup now use the active branch's inventory instead of company-wide stock. Route access follows branch assignments, while fitment and cross-reference changes require inventory permission. Vehicle suggestions scope variants to the selected model; searches no longer silently discard records after fixed row limits; and renamed catalogue parts are found under their current names.

The counter can record and look up OEM, alternative and supersession numbers, resolve a recorded number to its current catalogue product, and hand that product to the existing billing flow. Both fitment forms search the full catalogue through the product endpoint, including SKU and barcode. The isolated shop-type flow covers fitment, current-name search, model-specific variants, reference lookup, branch stock, sale, idempotent return and exact stock restoration.

These auto-parts changes were made after the evidence directory's source fingerprint and are **not** included in that earlier verification checkpoint. They require a fresh exact-candidate full gate and browser walkthrough before release. The local preview was locked at the counter during this pass, so the number-entry dialog, responsive layout and billing handoff were not manually certified in the browser.

The post-checkpoint frontend production gate passes typecheck, translation parity across 6,259 English/Hindi keys, production build, bundle/offline security checks, and 2,946 tests with one intentional skip. All 45 backend integration files were covered. In the single combined run, `rbac-pin.integration.test.js` exhausted the runner's file timeout after the preceding files; the same file then passed all 18 tests in isolation, and the remaining 14 files passed in a fresh continuation run. This segmented result establishes local functional coverage but is not a clean single-run CI certification. Backend production and dependency-security checks also pass.

## Browser and accounting proof

Synthetic booking `RNT-000002` was picked up, returned with a ₹10 damage fee, settled with ₹10 UPI, and refunded ₹200 cash using the owner's PIN. It remains returned after reload with ₹0 due and ₹0 deposit held. Its garment stock remains 20.

| Business date (Asia/Kolkata) | Rental cash | Rental UPI | Retail sales |
|---|---:|---:|---:|
| 21 September | +₹300 | ₹0 | ₹0 |
| 22 September | −₹200 | +₹10 | ₹0 |

The two-day statement contains exactly three money movements: ₹300 cash received, ₹10 UPI received, ₹200 cash refunded. Net cash is ₹100, net UPI is ₹10, and rental income is ₹110. Four journals balance. Rental advances, refundable deposits and receivables each net to zero. No opening float was declared for September 22; its −₹200 drawer figure is the day's net movement, not a claim that physical cash can be negative.

The booking was initially created in the September 21 QA build. The final posting metadata and new payment-history endpoint are also verified by fresh isolated integration fixtures. Connection loss and recovery are checked in the browser; no statement totals remain actionable while required reads fail.

The furniture browser check created `SO-000002` for one ₹100 item, blocked ₹101 as an overpayment, recorded one ₹100 cash receipt, and refused a nonexistent bill without changing the ready status. The matching sale `KOS-2026-000001` then allowed delivery and installation. A reload preserves the linked bill and removes collection/deletion actions. The final item label no longer says “held” after delivery. Read-only reconciliation proves one bill, one sale payment, one stock movement of −1, stock 20 → 19, one receipt audit and three status audits. The earlier `SO-000001` remains flagged and unchanged; the shared product's new stock of 19 comes solely from the new verified sale. This same-day cash fixture does not certify cross-day advances or credit/refund accounting.

## Automated verification

See `verification-summary.json` in the evidence directory for exact counts and execution stages. The full frontend production check passes: typecheck, 6,227 English/Hindi translation keys across 18 modules, production bundle/offline checks, and 2,946 tests passed with one skipped. Backend production and migration-safety checks pass (zero migration warnings). Both schema validation and an isolated SQLite upgrade smoke check pass.

The full backend example suite passed before the final branch-access, tender metadata and statement additions. Subsequent targeted tests cover those additions, and the final full integration run passes 415 tests with three PostgreSQL-only skips across 45 files. Tests use disposable databases; the browser fixture is preserved. PostgreSQL-only skips do not establish production concurrency safety. After the full frontend gate, the final one-line held-label correction also passed typecheck, build and unchanged bundle/offline security checks, and was verified in the browser. The full frontend suite was not rerun for that label-only correction.

The existing manufacturing reconciliation is retained as **prior-session evidence**: two consignments invoiced ₹200 and ₹40, both reversed on a whole-order return; net payments zero, raw stock 76, finished stock 24, pack stock 12. Manufacturing and all trade integration flows are included in the final automated run. A new manual browser walkthrough of every manufacturing screen is not claimed here.

## Required before release

1. Certify the exact committed candidate in CI, including PostgreSQL migrations/concurrency, Redis jobs, the production image, hosting configuration and live readiness checks. This local dirty-checkout run is not a clean-candidate certification.
2. Apply `000136_rental_financial_history` with a verified backup/restore plan before serving the updated app. Review historical rental advances/deposits with the owner; no legacy reconciliation UI is supplied by this change. Do not enable the new rental flow for a shop until its legacy operational bookings have an agreed reconciliation path. Do not roll back to old writers after new rental events exist.
3. Apply `000137_furniture_location`, then complete furniture refund/correction, credit recovery and legacy reconciliation as described above. New deliveries now require matching invoice/stock/payment proof and journal the advance application, but the earlier synthetic order remains installed with ₹120 in payments, no linked bill and stock of 20 at the initial recheck, before the new test sale. Its review warning is not an accounting repair.
4. Review other money surfaces before claiming product-wide financial completeness. Rental events are covered in daily closing, Cash & Payments, journals and bank/UPI matching. Generic sales/dashboard KPIs remain retail-sale measures; the “other” rental tender is shown separately in closing/accounting, outside the cash/UPI/bank statement.
5. Complete physical printer/device checks, production backup and isolated restore proof, provider/worker checks, release-owner approval and a deployed test-shop smoke test. Existing release-gate exceptions remain open.

No production readiness or deployment claim should be inferred from a green local build alone.
