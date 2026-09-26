# BUG-064: legacy furniture repair verification

The legacy repair implementation merged in PR #366 (`3188fa92`, merge
`1d487d8c`). This follow-up verifies it on `aa3fdf5d` and adds regression
coverage and clearer review labels. It does not change production records.

## Repair workflow

1. Open Order Book → Everything and locate the completed order without a bill.
2. Choose **Review historical receipts**. Compare the displayed dates, amounts,
   payment methods and references with the original records. Confirm the review,
   enter a note and the owner PIN. Each missing receipt is posted on its original
   payment date. No new collection is made.
3. Choose **Repair missing invoice**. Confirm the original sale date and tax
   treatment. Explicitly confirm that no invoice already exists and the delivered
   goods are still included in recorded stock. Enter the review note and owner PIN.
4. The repair creates and links one sale bill, deducts stock once, and applies the
   advance without collecting it again. Original delivery/installation dates and
   the completed status are preserved.

Closed periods, incomplete or conflicting accounting history, an existing bill
reference, and a sale date before the latest receipt require review; the repair
refuses them. It cannot determine from a missing bill link alone whether someone
already deducted stock manually. The owner's stock confirmation is required.

The form echoes the displayed amounts and methods back to the server for stale
data validation; it does not require an independent re-entry of every amount.

## Regression verification

- Isolated SQLite integration: **44 passed, 0 failed, 0 skipped** across
  furniture delivery (17), invoice (10), and historical repair (17).
- The seven additional historical-repair cases cover simultaneous receipt repair,
  orphaned journals, tenant/branch scope, receipt-audit rollback and retry,
  invalid/closed sale dates, invoice-audit rollback with concurrent retry, and
  prevention of a second invoice when a bill reference already exists.
- The installed-order regression checks ₹120 on the original receipt date,
  ₹120 sales and zero additional cash on the sale date, stock from 10 to 9, and
  unchanged delivery and installation dates. Retrying leaves one bill and one
  stock deduction.
- Backend `npm run prod:check` passed.
- Final frontend `npm run prod:check` passed: typecheck, 6,387 translation keys,
  build, bundle and production-app checks, and **2,995 tests passed, one existing
  skip**. An earlier run hit a 10-second setup-hook timeout in the unrelated
  snapshot-hydration test during heavy machine load. A full test rerun with two
  workers passed, as did the final production gate at default concurrency.

## Authenticated browser verification

Used the isolated `bug064-final-qa` frontend on localhost:5501 and API on port
3007 with `/tmp/bug064-final-browser-test.db`. Both server process working
directories were checked before observations. All data was synthetic.

- The installed SO-000001 with ₹120 cash, stock 10 and no invoice was visible
  under Everything. Invoice review initially refused missing receipt accounting.
- Receipt review displayed the original 1 June 2026 date, amount and cash method.
  A wrong owner PIN was refused. The correct PIN completed the review.
- Invoice repair defaulted to the original sale date, 3 June 2026. Submission
  remained disabled until the owner confirmed that no invoice existed and the
  delivered goods were still in recorded stock.
- Completion removed the missing-invoice warning and repair actions, showing
  **Installed, ₹120 paid up, Linked sale bill: KOS-2026-000001**.
- A read-only check of the QA database confirmed one original receipt, one bill,
  one sale stock movement and stock 9. Delivery at 3 June 08:00 UTC and installation
  at 4 June 08:00 UTC were preserved. Cash remained dated 1 June; the invoice and
  advance offset were dated 3 June in Asia/Kolkata.
- Fixed the receipt review's misleading “Refund reason” label to **Review note**
  in English and Hindi, and reused it for historical invoice review.

## Scope and remaining rollout work

No production data was repaired or deployed by this follow-up. The original
reported SO-000001 still needs its actual receipt, invoice and stock evidence
reviewed by its owner; synthetic QA data is not proof of that repair. PostgreSQL
runtime/concurrency and deployment verification remain separate release checks.
There are no new database migrations. Split allocation of a collection across
several orders is a separate capability from this missing-invoice repair.

This report supersedes the 23 September report's statements that atomic invoice
creation and a furniture legacy repair workflow are still unimplemented.
