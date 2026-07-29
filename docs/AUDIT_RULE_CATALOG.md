# Audit Rule Catalog

Engine: `assurance-engine-1.1.0` | Rule set: `ruleset-4c8a90da9c6e` | **95 rules implemented**

Every rule is deterministic code in `backend/src/modules/assurance/rules/`. No LLM
participates in deciding whether a rule triggers. Each rule declares its own
`ruleCode`, `version`, `severity`, `defaultWeight`, evidence requirements and
remediation guidance; `GET /api/audit/rules` returns the live catalog and each
shop's overrides.

Rules by category:

| Category | Rules |
|---|---|
| INVENTORY | 15 |
| CASH_CLOSING | 14 |
| PURCHASE | 13 |
| CUSTOMER_CREDIT | 12 |
| SYNC_INTEGRITY | 11 |
| RECONCILIATION | 9 |
| EXPENSE | 9 |
| BILLING | 7 |
| AUTHORIZATION | 4 |

`AUTHORIZATION` and `RECONCILIATION` are cross-cutting categories: a rule lives
in the file for its business area (billing, purchase…) but is categorised by what
it actually tests, so the dashboard can group "arithmetic that does not
reconcile" and "actions taken without approval" separately from domain noise.

---

## Mapping to the requested rule library

The spec's A–G lists are the source of requirements. The table below maps each
requested check to the rule that implements it, or records why it is deferred.
Where a requested item is better tested on a different entity than the spec
implies, the mapping says so.

### A. Billing rules

| # | Requested | Implemented as | Notes |
|---|---|---|---|
| 1 | Duplicate bill number | `BILL_DUPLICATE_NUMBER` | CRITICAL. DB has a unique constraint; the rule catches historical/legacy breaches. |
| 2 | Duplicate idempotency key | **DEFERRED** | Not detectable — see §Deferred. Retry duplication is covered by #3 and #20. |
| 3 | Same customer/amount/items in a window | `BILL_NEAR_DUPLICATE` | 10-min window for identified customers; same-device + 120 s for walk-ins (see §False positives). |
| 4 | Total ≠ items − discounts + tax | `BILL_TOTAL_MISMATCH` | Reproduces the total from line totals, discount, loyalty discount and GST mode. |
| 5 | Paid amount exceeds total | `BILL_PAID_EXCEEDS_TOTAL` | |
| 6 | Outstanding ≠ total − paid | `BILL_OUTSTANDING_MISMATCH` | Also subtracts `waivedAmount` (KiranaOS let-go handling). |
| 7 | Marked paid without sufficient payments | `BILL_MARKED_PAID_WITHOUT_PAYMENTS` | Requires `paidAmount` to exactly equal confirmed payment rows, including negative return tenders. |
| 8 | Udhar bill marked paid after sync | `UDHAR_BILL_MISSING_LEDGER_DEBIT` | Implemented as the detectable form: a credit bill whose udhar debit never landed. |
| 8b | Udhar return missing from khata | `UDHAR_RETURN_MISSING_LEDGER_CREDIT` | Requires an exact customer-ledger return credit for every Udhar-refunded sales return. |`n| 9 | Cancelled bill still in sales reports | `CANCELLED_BILL_STILL_IN_LEDGER` | Checks FinancialLedger rows net to zero per entryType. |
| 10 | Cancelled bill still reducing inventory | `CANCELLED_BILL_STOCK_NOT_RESTORED` | Plus `STOCK_CANCELLED_SALE_NOT_RESTORED` at product scope. |
| 11 | Returned bill not reversing inventory | `RETURN_BILL_STOCK_NOT_REVERSED` | |
| 12 | Suspiciously high manual discount | `BILL_EXCESSIVE_DISCOUNT` | Threshold `audit.maxDiscountPercent` (default 20%). |
| 13 | Discount outside staff permission | `BILL_DISCOUNT_WITHOUT_AUTHORIZATION` | Non-owner + above ceiling + no reason + no approval log. |
| 14 | Bill created after closing but backdated | `BILL_BACKDATED_INTO_LOCKED_DAY` | Requires a sync trail proving late arrival — see §False positives. |
| 15 | Bill edited after closing without approval | `BILL_EDITED_AFTER_CLOSING_LOCK` | |
| 16 | Negative/impossible quantity | `BILL_INVALID_QUANTITY` | |
| 17 | Zero-price item without reason | `BILL_ZERO_PRICE_ITEM` | |
| 18 | Selling below purchase price | `BILL_SOLD_BELOW_COST` | Tolerance `audit.belowCostTolerancePercent` (default 2%). |
| 19 | Excessive cancellations by one staff member | `STAFF_EXCESSIVE_CANCELLATIONS` | Min sample 20 bills / 30 days. |
| 20 | Repeated bill creation during retry | `BILL_SYNC_RETRY_STORM` | |

### B. Customer and udhar rules

Invariant enforced: `outstanding = Σ(non-reversed debits) − Σ(non-reversed payments)`,
where the legacy opening balance is itself a `legacy_opening_balance` debit row.

| # | Requested | Implemented as |
|---|---|---|
| 1 | Outstanding does not reconcile | `UDHAR_BALANCE_LEDGER_MISMATCH` |
| 2 | Payment without matching ledger entry | `UDHAR_CREDIT_SALE_WITHOUT_LEDGER` (credit sale missing from the ledger) |
| 3 | Ledger entry without source transaction | `UDHAR_LEDGER_ORPHANED_ENTRY` |
| 4 | Balance unexpectedly negative | `UDHAR_NEGATIVE_BALANCE` |
| 5 | Payment exceeds outstanding | `UDHAR_PAYMENT_EXCEEDS_OUTSTANDING` (chronological running balance) |
| 6 | Reversed payment still reducing outstanding | `UDHAR_REVERSAL_NOT_APPLIED` |
| 7 | Cancelled bill still contributing to udhar | `UDHAR_CANCELLED_BILL_STILL_COUNTED` |
| 8 | Credit limit exceeded | `UDHAR_CREDIT_LIMIT_EXCEEDED` (silent unless `audit.creditLimitPaise` configured) |
| 9 | Large manual balance adjustment | `UDHAR_LARGE_MANUAL_ADJUSTMENT` |
| 10 | Backdated ledger adjustment | `UDHAR_LATE_REVERSAL` (adapted — see §Deferred) |
| 11 | Duplicate customers | `CUSTOMER_DUPLICATE_IDENTITY` |
| 12 | Unusual rise in customer credit | `UDHAR_UNUSUAL_CREDIT_GROWTH` (≥3 prior 30-day windows required) |
| 13 | Old outstanding beyond ageing limit | `UDHAR_AGEING_BEYOND_LIMIT` (oldest-first payment allocation) |

### C. Inventory rules

| # | Requested | Implemented as |
|---|---|---|
| 1 | Stock differs from movements | `STOCK_BALANCE_LEDGER_MISMATCH` (+ `STOCK_LEDGER_CHAIN_BROKEN` for internal arithmetic) |
| 2 | Decrease without a valid source | `STOCK_DECREASE_WITHOUT_SOURCE` |
| 3 | Increase without a valid source | `STOCK_INCREASE_WITHOUT_SOURCE` |
| 4 | Negative stock | `STOCK_NEGATIVE_BALANCE` (MEDIUM — KiranaOS deliberately allows overselling) |
| 5 | Excessive manual correction | `STOCK_LARGE_MANUAL_CORRECTION` (>25% of stock, or no reason at all) |
| 6 | Frequent corrections by one staff member | `STOCK_FREQUENT_CORRECTIONS` (per product; staff attribution unavailable — see §Deferred) |
| 7 | Sale quantity exceeds available stock | `STOCK_SALE_EXCEEDED_AVAILABLE` |
| 8 | Purchase stock ≠ purchase items | `PURCHASE_STOCK_QUANTITY_MISMATCH` (purchase scope) |
| 9 | Cancelled sale not restoring stock | `STOCK_CANCELLED_SALE_NOT_RESTORED` |
| 10 | Purchase return not reducing stock | `PURCHASE_RETURN_NOT_CREDITED` (supplier-credit side; stock side via #1) |
| 11 | Inventory changed after closing | `STOCK_CHANGED_AFTER_CLOSING_LOCK` (sale movements excluded — see §False positives) |
| 12 | Unusual shrinkage | `STOCK_UNUSUAL_SHRINKAGE` (>5% of sold quantity, min 10 base units sold) |
| 13 | Product sold while archived | `STOCK_SOLD_WHILE_ARCHIVED` |
| 14 | Unit conversion mismatch | `BILL_UNIT_CONVERSION_MISMATCH` (bill scope; uses the product's own conversion factors) |
| 15 | Loose-item decimal inconsistency | `BILL_LOOSE_ITEM_DECIMAL_INCONSISTENCY` |
| 16 | Duplicate stock movement | `STOCK_DUPLICATE_MOVEMENT` (identical shape within 60 s) |

### D. Purchase and supplier rules

| # | Requested | Implemented as |
|---|---|---|
| 1 | Duplicate supplier invoice number | `PURCHASE_DUPLICATE_INVOICE_NUMBER` |
| 2 | Same supplier/amount/date repeated | `PURCHASE_REPEATED_SAME_DAY_AMOUNT` |
| 3 | Purchase payment without purchase | `PURCHASE_PAYMENT_WITHOUT_GOODS` |
| 4 | Purchase without stock receipt | `PURCHASE_WITHOUT_STOCK_RECEIPT` |
| 5 | Stock receipt ≠ purchase quantity | `PURCHASE_STOCK_QUANTITY_MISMATCH` |
| 6 | Purchase amount ≠ item totals | `PURCHASE_AMOUNT_ITEM_TOTAL_MISMATCH` |
| 7 | Price unusually above historical range | `PURCHASE_PRICE_ABOVE_HISTORICAL_RANGE` (median + 3×IQR, min 5 samples) |
| 8 | Supplier payable does not reconcile | `PURCHASE_DUE_AMOUNT_MISMATCH` (per-purchase form — see §Deferred for supplier-level) |
| 9 | Marked paid without matching payment | `PURCHASE_MARKED_PAID_WITHOUT_PAYMENT` |
| 10 | Payment exceeds supplier balance | `PURCHASE_PAYMENT_EXCEEDS_TOTAL` |
| 11 | Return not reflected in supplier balance | `PURCHASE_RETURN_NOT_CREDITED` |
| 12 | Missing purchase invoice evidence | `PURCHASE_MISSING_INVOICE_EVIDENCE` |
| 13 | Supplier identity missing | `PURCHASE_SUPPLIER_IDENTITY_MISSING` |
| 14 | Recently changed supplier bank details | **DEFERRED** — no supplier bank-detail model exists |
| 15 | Large new supplier transaction | `PURCHASE_LARGE_NEW_SUPPLIER` (supplier <30 days old + above threshold) |
| 16 | Backdated purchase | `PURCHASE_RECORDED_AFTER_CLOSING_LOCK` |
| 17 | Purchase recorded after stock was sold | `PURCHASE_RECORDED_AFTER_STOCK_SOLD` |

### E. Expense rules

| # | Requested | Implemented as |
|---|---|---|
| 1 | Duplicate expense | `EXPENSE_DUPLICATE` |
| 2 | Missing expense receipt | `EXPENSE_MISSING_RECEIPT` |
| 3 | Unusually high for category | `EXPENSE_UNUSUALLY_HIGH_FOR_CATEGORY` (per-category baseline, min 10 samples) |
| 4 | Repeated rounded cash expenses | `EXPENSE_REPEATED_ROUNDED_CASH` (≥3 round-₹500 cash expenses / 30 days) |
| 5 | Created outside staff permission | `EXPENSE_UNATTRIBUTED` (adapted — Expense has no userId, see §Deferred) |
| 6 | Backdated expense | `EXPENSE_BACKDATED` (>2 days between `spentAt` and `createdAt`) |
| 7 | Added after daily closing | `EXPENSE_ADDED_AFTER_CLOSING_LOCK` |
| 8 | Edited without reason | `EXPENSE_EDITED_WITHOUT_REASON` |
| 9 | Category inconsistent with description | `EXPENSE_CATEGORY_INCONSISTENT` (conservative keyword table, LOW severity) |
| 10 | Same receipt used more than once | Covered by the evidence engine: checksum reuse is detected and surfaced on submission |
| 11 | Unusual expense frequency | `EXPENSE_UNUSUAL_FREQUENCY` (≥4 weeks of history required) |
| 12 | No payee above threshold | `EXPENSE_MISSING_PAYEE` |

### F. Cash, UPI and daily-closing rules

| # | Requested | Implemented as |
|---|---|---|
| 1 | Expected cash differs from closing cash | `CLOSING_CASH_FIGURE_STALE` verifies recorded cash-in; physical counts remain device-local and unavailable to server assurance. |
| 2 | Cash sales ≠ bill payments | `CLOSING_CASH_FIGURE_STALE` |
| 3 | UPI sales ≠ recorded UPI payments | `CLOSING_UPI_FIGURE_STALE` |
| 4 | Customer payments excluded from cash | `CLOSING_UDHAR_RECOVERY_STALE` |
| 5 | Expenses excluded from cash | `CLOSING_CASH_EXPENSES_NOT_DEDUCTED` now verifies expected cash as confirmed cash collections + supplier cash refunds - supplier cash paid - paid cash expenses. The rule code is retained for history compatibility. |
| 6 | Refund excluded from cash | `CLOSING_REFUND_NOT_IN_CASH` |
| 7 | Daily closing changed after completion | `CLOSING_CHANGED_AFTER_LOCK` |
| 8 | Late offline transaction affects closed day | `CLOSING_LATE_TRANSACTION_AFTER_LOCK` |
| 9 | Large closing difference | `CLOSING_LARGE_DIFFERENCE` (threshold `audit.closingDifferenceAlertPaise`, default ₹200) |
| 10 | Repeated shortages by staff/device | **DEFERRED on the server** - counted cash exists only in device-local storage and is not synced. |
| 11 | UPI reference reused | `CLOSING_UPI_REFERENCE_REUSED` (reference masked in the finding) |
| 12 | Split payment ≠ total paid | `CLOSING_SPLIT_PAYMENT_MISMATCH` |
| — | Sales total stale vs bills | `CLOSING_SALES_FIGURE_STALE` (added) |

### G. Sync and data-integrity rules

| # | Requested | Implemented as |
|---|---|---|
| 1 | Duplicate offline event | `SYNC_DUPLICATE_OFFLINE_EVENT` (same event id **or** identical request payload under a new id) |
| 2 | Same idempotency key applied twice | Enforced by `@@unique([shopId, idempotencyKey])`; residual risk covered by #1 |
| 3 | Local record differs from server version | `SYNC_CONFLICT_UNRESOLVED` (uses the existing SyncConflict snapshots) |
| 4 | Failed event marked successful | `SYNC_FAILED_EVENT_MARKED_SUCCESS` |
| 5 | Partial financial operation | `SYNC_EVENT_STUCK_PROCESSING` + `BILL_MISSING_CHILD_ROWS` |
| 6 | Missing child record | `BILL_MISSING_CHILD_ROWS` |
| 7 | Orphaned payment | `BILL_ORPHANED_PAYMENT_SCOPE` |
| 8 | Orphaned ledger entry | `UDHAR_LEDGER_ORPHANED_ENTRY` |
| 9 | Orphaned stock movement | `STOCK_DECREASE_WITHOUT_SOURCE` / `STOCK_INCREASE_WITHOUT_SOURCE` |
| 10 | Cross-device conflict | `SYNC_CONFLICT_UNRESOLVED` (reports distinct device count) |
| 11 | Event applied out of order | `PURCHASE_RECORDED_AFTER_STOCK_SOLD` (the materially detectable case) |
| 12 | Record overwritten by an older version | **DEFERRED** — no per-row version column on canonical financial tables |
| 13 | Financial record without shopId | `BILL_ORPHANED_PAYMENT_SCOPE` (Payment.shopId is nullable for legacy rows) |
| 14 | Cross-shop entity reference | `BILL_CROSS_SHOP_REFERENCE` — CRITICAL, with a declared score floor of 85 |
| 15 | Missing audit log for sensitive change | `BILL_CANCELLED_WITHOUT_AUDIT_LOG` |
| — | Synced with no result payload | `SYNC_SYNCED_WITHOUT_RESULT` (added) |

---

## Deferred rules and why

These are **not** implemented because the data to evaluate them honestly does not
exist yet. Each would produce guesses or false positives if forced.

1. **A2 — duplicate idempotency key.** `Bill.sourceDeviceId` is populated from
   the request's device header for *every* sale, and no column marks offline
   origin, so "an offline bill without a durable key" cannot be distinguished
   from an ordinary counter sale. An early version of this rule
   (`BILL_WEAK_IDEMPOTENCY`) fired on essentially every bill and was removed.
   Database unique constraints already make double-application impossible.
2. **B10 — backdated ledger adjustment.** `UdharLedger` has no business-date
   column separate from `createdAt`, so a ledger row cannot be backdated.
   Implemented instead as `UDHAR_LATE_REVERSAL` (reversal >30 days later).
3. **C6 — frequent corrections *by one staff member*.** `StockLedger` has no
   actor column. The rule reports per-product correction frequency and marks
   `staffAttributionAvailable: false`, which lowers the finding's confidence.
4. **D8 — supplier-level payable reconciliation.** There is no supplier-payment
   table; payments live on each purchase row. Per-purchase reconciliation is
   implemented; a true supplier statement needs a supplier ledger.
5. **D14 — changed supplier bank details.** No bank-detail fields on `Supplier`.
6. **E5 — expense outside staff permission.** `Expense.recordedBy` is free text,
   not a `userId`, so role checks are impossible. `EXPENSE_UNATTRIBUTED` reports
   missing attribution and marks `userIdAttributionAvailable: false`.
7. **F1/F10 - counted vs expected cash, repeated shortages.** The Daily Closing UI records physical counts only in device-local storage. Because those counts are not synced to `DailyClosingSnapshot`, server assurance can verify expected cash but cannot compare it with the shopkeeper's count.
8. **G12 — record overwritten by an older version.** Canonical financial tables
   carry no row version, only `updatedAt`.

---

## False-positive risks and the mitigations applied

Three rules were tightened during testing after they produced findings on
legitimate behaviour. These are recorded because they are the most likely places
for future noise.

1. **Walk-in duplicate sales.** Two different customers buying the same item for
   the same amount minutes apart is ordinary kirana trade. `BILL_NEAR_DUPLICATE`
   therefore requires an identified customer, *or* the same device within 120
   seconds. Without a device id on a walk-in bill the rule stays silent.
2. **Locking a closing early.** A rule that flagged every bill recorded after a
   day's lock produced one finding per afternoon sale. `BILL_BACKDATED_INTO_LOCKED_DAY`
   now fires only when the bill's timestamp precedes the lock *and* a sync event
   proves it arrived after — genuine backdating. The "figures are now stale" fact
   is reported once on the closing itself.
3. **Stock movements after a lock.** `STOCK_CHANGED_AFTER_CLOSING_LOCK` skips
   `sale` movements for the same reason; only deliberate entries (corrections,
   damage, purchases) are reported.
4. **A bill paid the next day.** The closing rules originally loaded payments by the
   payment's own date, so a bill from one day settled on the next produced both a
   false `CLOSING_CASH_FIGURE_STALE` and a false `CLOSING_SPLIT_PAYMENT_MISMATCH`.
   The context now loads payments by the day's bill ids, which is exactly how
   `reports.service.js#getDailyClosing` computes the day's cash.

Remaining known noise sources, by design:

- `EXPENSE_CATEGORY_INCONSISTENT` is keyword-based and LOW severity by design;
  a shop's own category naming always wins.
- `UDHAR_AGEING_BEYOND_LIMIT` will fire for any shop that carries long-standing
  khata, which is normal in this market. The ageing limit is configurable.

## Per-shop configuration

Owners can disable any rule or override its weight (`PATCH /api/audit/rules/:ruleCode`),
stored in `AuditRule` per shop. Thresholds live in the shop's
`settingsJson.audit` block: `maxDiscountPercent`, `belowCostTolerancePercent`,
`largeAdjustmentPaise`, `expenseReceiptRequiredAbovePaise`,
`purchaseInvoiceRequiredAbovePaise`, `udharAgeingLimitDays`, `creditLimitPaise`,
`closingDifferenceAlertPaise`, `staffCancellationRateAlert`.
