# Accounting and audit integrity — 14 October 2026

This change strengthens the recorded general ledger and the audit-review workflow. It does not certify statutory accounts or automatically correct historical shop books.

## Corrections

- Accounting controls and journal posting now share one mapping. Rental receipts, deposits/advances and furniture advances no longer show as unmapped solely because the control's old mapping lagged behind the posting engine.
- A trial balance is not declared balanced just because aggregate debits equal credits. Reports also check every posted journal, exact source-to-line account/amount coverage, duplicate/missing postings, business dates, accounting-market snapshots, tenant boundaries and evidence claims. Errors can no longer cancel one another into a green result. Empty books show `no_data`.
- Trial balance, P&L and balance sheet carry the same integrity assessment. The screen displays missing-source, source-discrepancy and invalid-journal counts and explains that totals contain posted entries only. Counts are complete; example issues in the API are capped at 100.
- Closed periods reject source postings, manual postings and historical projection. Closing rejects missing/inconsistent postings. Projection is atomic for both API and direct script callers, replays without duplicating source rows, and separates one business source across different business dates.
- PostgreSQL postings and closing share a shop-row write lock. Retrying serializable transactions re-read a newly closed period instead of committing from an older snapshot. A dedicated PostgreSQL concurrency test is included; local SQLite execution skips that case explicitly.
- Integer minor units remain exact through report aggregation. Values beyond the existing numeric API's safe integer range produce `ACCOUNTING_AMOUNT_OUT_OF_RANGE` rather than rounded money. Historical inactive accounts remain in reports. Manual service calls reject negative, fractional and two-sided journal lines.
- A newly recorded damaged sale return reverses the original sale cost, then debits Inventory losses (6200) and credits Inventory for the damaged portion. This prevents unsellable goods from increasing the inventory asset or overstating profit. Mixed damaged/resellable return replay posts the loss once. This follows the inventory-loss expense principle described in [IAS 2](https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/); it is not an assertion of IFRS compliance for the whole product.
- Financial audit payloads preserve BigInt evidence as exact decimal strings. System-account initialization records its actual account count instead of a hard-coded 19.
- Audit review, reviewer assignment, evidence requests/submission/verification and their required status history now commit in the same retrying transaction. An invalid requested transition does not leave a saved review. Review responses retain the finding ID.
- Report boundaries use the supported shop accounting timezone (Kolkata or Dubai), not the viewing device timezone. Clearing a date input no longer causes an invalid-date exception.

## Verification

An isolated business-cycle regression starts with 1,000.00 capital, purchases 1,000.00 of goods (300.00 paid), settles another 200.00, sells for 118.00 including 18.00 tax at 60.00 cost, records a 25.00 expense, then fully refunds the sale with all 60.00 of goods damaged. Expected closing values are asserted independently:

| Result | Amount |
| --- | ---: |
| Inventory | 940.00 |
| Total assets | 1,415.00 |
| Supplier liabilities | 500.00 |
| Net loss | 85.00 |
| Equity including earnings | 915.00 |
| Balance-sheet difference | 0.00 |

Regression coverage also includes unposted rows, equal-and-opposite corrupt journals, wrong accounts, duplicate journals, forged coverage without actual lines, foreign accounts, wrong dates, closed-period backfill, projection rollback/replay, inactive accounts, integer overflow, audit-history failure rollback and HTTP permission boundaries. Existing sales, returns, tax, payment, purchase, bank-reconciliation and audit-rule tests remain in the release gates.

Local release gates passed: full isolated backend `npm test`, backend `prod:check`, frontend `prod:check` (3,570 tests passed, one existing skip), and 100 selected HTTP accounting/billing/assurance tests. The PostgreSQL-only concurrency case is explicitly skipped by SQLite; its production-engine proof remains a CI requirement. The largest-shop offline bundle remains within the unchanged 1,290 kB gzip budget.

Browser verification uses the real Accounting page with synthetic API responses. Missing postings were visible on all three financial report tabs; verified and empty states were checked separately. This is UI proof, not a production-data audit. The temporary fixture is not shipped.

## Boundaries and follow-up acceptance

- Integrity checks reconcile FinancialLedger to JournalEntry/JournalLine. They do not prove that every real transaction has been entered into source business tables or the financial ledger. Opening balances, source-document completeness and outstanding offline sync conflicts require separate reconciliation before relying on a close.
- Old damaged returns are not rewritten by this release. Existing bad/missing postings are surfaced, not silently repaired. Historical corrections require review of original documents and append-only correction entries in an appropriate open period.
- Non-purchase stock adjustments, counts, repacking and standalone write-offs are not comprehensively journaled by this change. Recorded-cost inventory is not a complete perpetual valuation system. The existing recycle-bin reporting semantics also require accountant review when reconciling physical stock to the books.
- Purchase tax-credit eligibility, GST components, statutory filing, bank feeds, depreciation/payroll and jurisdiction-specific financial statements remain separate work. INR is the currently live market; UAE remains an engineering preview.
- Audit findings are signals to investigate, not proof of fraud or confirmed financial loss. The assurance engine remains read-only toward canonical financial records.
- Release requires review/CI and a reconciled pilot period with an accountant. No live shop records, deployed database or production service were changed during this verification.
