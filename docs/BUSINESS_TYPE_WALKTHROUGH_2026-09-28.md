# Business-type shopkeeper walkthrough — 27–28 September 2026

## Assessment

The exercised workflows work on this local candidate, including ordinary cash
sales, a settled rental, restaurant table settlement, cosmetics stock loss and
manufacturing production/QC. Two additional issues were corrected: missing
expenses/opening-float inputs in the dashboard financial snapshot, and misleading
electronics serial-registration wording. This is evidence for the scenarios
below, not certification that every specialist workflow is complete.

## Environment and method

- Worktree: `.claude/worktrees/bug064-final-qa`, branch
  `work/bug064-final-qa`, starting at `6c731aa0`.
- Frontend `localhost:5501`; API port 3007; isolated SQLite database
  `/tmp/bug064-final-browser-test.db`. Server working directories were checked.
- Dedicated synthetic QA shops, products and opening stock were seeded. Retail
  products generally started with 10 units, ₹30 cost and ₹50 price. Footwear
  started with six UK-7 and four UK-8 pairs. Manufacturing started with 100 raw
  units and 10 finished units, with matching opening lots.
- The transactions described below were performed through the app UI. Database
  reads independently checked selected stock and financial results. No real
  customer, payment-provider transaction or production repair was involved.
- Most specialist flows were checked on desktop. The corrected expense card was
  also visually checked at 390 × 844. Viewport overrides were reset afterwards.
- Kirana and furniture rows refer to the preceding passes in this same worktree;
  their linked reports retain the detailed evidence.

## Coverage

| Business type | UI workflow and result | Limits of this pass |
| --- | --- | --- |
| Kirana | Product creation, supplier credit purchase, cash/UPI/udhar bills, customer recovery, return, expense, offline sale/reconnect, supplier payment and exact ₹135 closing. | See [27 September report](SHOPKEEPER_WALKTHROUGH_2026-09-27.md). No live payment settlement or hardware proof. |
| Furniture | Synthetic installed legacy order: review historical receipts, refuse wrong PIN, repair missing invoice, preserve original dates and deduct stock once. | See [BUG-064 report](FURNITURE_LEGACY_RECONCILIATION_2026-09-27.md). Actual reported production order remains unrepaired pending owner evidence. |
| Restaurant | Seat T1, add one ₹50 tea, fire ticket, cook, ready, serve and collect cash. Bill KOS-2026-000001 saved; table became free. Untracked cooked-dish stock stayed at 10. | Single counter; shared table occupancy and physical kitchen printing not verified. |
| Pharmacy | Save RX-000001 for a synthetic patient/doctor and OTC item, mark dispensed, reload and confirm persistence. | Register-only check; no linked sale/stock movement or specialist compliance certification. |
| Electronics | Register QA-SERIAL-001 against existing QA Handset stock; one unit appears on shelf with a 12-month warranty starting at sale. Product stock remains 10. | Sale/return/service and atomic linkage with ordinary billing were not exercised in this pass. |
| Clothing | RNT-000001: one-day ₹50 rental, ₹100 security deposit, ₹20 advance, pickup, return, ₹30 final cash collection and ₹100 deposit refund with owner PIN. Final balance and retained deposit both zero; stock remains 10. | No size exchange or multi-order settlement; central report reconciliation of all rental money not certified here. |
| Footwear | Size runs show 10 pairs. EU-42 lookup finds four UK-8 pairs and equivalent sizes. Save UK/unisex size profile; assumed-size warning disappears. | No sale of a selected size or exchange checkout. |
| Auto parts | Save QA Motors / QA Hatch / 2020–2026 fitment. Search year 2024, put the matching filter on a bill and collect ₹50 cash. Server stock 10 → 9. | Other fitment/reference combinations not exhaustively tested. |
| Stationery/books | Create QA School / Class 6 / 2026–27 list, select QA Class 6 Maths, put the ₹50 set on a bill and collect cash. Server stock 10 → 9. | Multi-item shortages and institutional order handling not exercised. |
| Cosmetics | Open Rose 05 tester, deduct one lipstick, show ₹30 tester cost. Inventory 10 → 9 and stock value ₹270; one damage/wastage movement. | Replacement/discard and interrupted-request retries not exercised. |
| Manufacturing | Create QA Pouch Recipe and QA-RUN-001 for five pieces. Consume 10 from QA-RAW-001; create QA-FINISHED-001 on QC hold; release and trace it back to the source lot. Raw stock 100 → 90; finished stock 10 → 15. Release changes lot status without adding stock again. | One source and one output; wholesale dispatch/invoicing checked by integration tests, not this browser run. |
| Other/custom | Sell one QA Gift Box for ₹50 cash; save ₹5 paid cash packing expense. Stock 10 → 9, one server bill. Declare ₹100 opening float and count ₹145: exact close, retained after reload. Phone dashboard shows expense ₹5. | Configurable retail baseline; no claim of support for every unlisted industry. |

## Fixes in this continuation

### Dashboard financial snapshot omitted saved expenses and till declarations

The previous kirana walkthrough saved a ₹5 expense, but the dashboard expense
card remained zero. The snapshot builder loaded neither expense rows nor the
opening-float/cash-movement settings.

It now loads shop-scoped saved expenses and the selected day's drawer
adjustments. Expense grouping uses the local spending date, ignores deleted
rows, and keeps all recorded expenses separate from paid cash expenses. UPI,
bank and pending expenses therefore do not reduce physical cash. An explicit
cash-expense override remains supported without double counting.

Five regressions cover recorded versus paid-cash totals, IST date boundaries,
deleted records, explicit overrides, scoped storage loading and storage-read
failure. Live verification in QA Custom Shop showed Expenses ₹5 on the phone
dashboard. Daily Closing showed `100 + 50 - 5 = 145`, with the matching count
and opening float retained after reload.

### Serial registration incorrectly implied a stock receipt

The electronics panel said “Add units to stock”, although it only records unit
identities. Product stock correctly remains separate from that register. The
panel now says **Register serial numbers** and explains that adding quantities
requires a purchase or Stock In. The title, accessible name and guidance use
English/Hindi translations. This avoids making a second inventory receipt for
stock already received through purchasing. The revised panel was opened and
visually checked.

## Remaining shopkeeper friction and verification limits

- Unsaved form recovery is inconsistent. A cosmetics entry had to be entered
  again after the counter locked. Manufacturing completion has persisted draft
  recovery, but that does not establish recovery for other forms. This friction
  remains open; the lock itself was not weakened.
- Register actions and sale/stock actions remain separate in some specialist
  flows, particularly prescriptions and electronics. Operators need clear
  guidance; serial registration wording is corrected, but full workflow
  integration was not added by this change.
- Specialist forms still contain English-only copy. Translation-key checks
  are not proof that every specialist screen works entirely in Hindi.
- Restaurant table handling in the tested flow is device-local; multi-counter
  seating and checkout need a separate concurrency pass.
- Some checks are narrow: pharmacy persistence, footwear lookup and electronics
  registration do not prove full bill/return lifecycles.
- PostgreSQL concurrent whole-order returns were skipped because the integration
  run used SQLite. Physical printing/scanning, real provider settlement,
  multi-device offline recovery and deployment remain outside this pass.
- The manufacturing expiry-field failure during automated filling disappeared
  when a native date-control key event committed the date. It was a test-input
  issue, not a reproduced app defect.

## Validation and evidence

- Frontend `npm run prod:check`: passed typecheck, 6,391 English/Hindi keys,
  production build, bundle budget, app checks and **3,006 tests** across 400
  passing files. One pre-existing test/file skipped. Log:
  `/tmp/business-types-frontend-final-gate.log`.
- Focused finance/drawer tests: **34 passed**, including the five new
  regressions. Log: `/tmp/business-types-finance-check.log`.
- Twelve backend example files passed for vertical architecture/entitlements,
  prescriptions, serial units, fitment, sizes, book lists, testers, rentals,
  restaurant tables/kitchen and manufacturing. These include contract/source
  checks and are not all transaction-level integration tests. Log:
  `/tmp/business-types-backend-check.log`.
- Manufacturing production/dispatch and rental settlement integration:
  **34 passed, one PostgreSQL-only concurrency case skipped**. Log:
  `/tmp/business-types-integration-check.log`.
- `git diff --check` passed. These walkthrough results were recorded before
  GitHub publication; they do not establish deployment or production-data repair.

Screenshots and visible page text:

- [Phone dashboard showing ₹5 expense](evidence/business-types-2026-09-28/mobile-dashboard-expense.png)
- [Dashboard text](evidence/business-types-2026-09-28/mobile-dashboard-expense.txt)
- [Custom-shop exact closing](evidence/business-types-2026-09-28/custom-shop-closing.png)
- [Closing text after reload](evidence/business-types-2026-09-28/custom-shop-closing.txt)
- [Serial-registration guidance](evidence/business-types-2026-09-28/serial-registration-guidance.png)
- [Server stock, production and transaction assertions](evidence/business-types-2026-09-28/server-verification.json)
