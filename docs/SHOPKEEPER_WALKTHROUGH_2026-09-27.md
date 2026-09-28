# Kirana shopkeeper walkthrough — 27 September 2026

## Scope

Used the app through its browser UI as a shopkeeper, beginning with an empty
synthetic shop. Only the tenant/account was created with a fixture; products,
stock receipt, sales, customer, collections, return, expense and closing were
entered through the UI. No production customer records were used or changed.

- Worktree: `.claude/worktrees/bug064-final-qa`, based on `cde2cc3a`.
- Frontend: `http://localhost:5501`; isolated API: port 3007.
- Database: `/tmp/bug064-final-browser-test.db`.
- Tenant: QA Neighbourhood Kirana (`cmuiz0vi300002yq4rc3h50tf`).
- Local timezone: Asia/Kolkata. Started around 04:00 IST, when UTC still read
  26 September, making the date-boundary defects directly observable.
- Exercised the phone layout and inspected the desktop stock/report/closing
  layouts. This is a scripted shop-day scenario, not a full production pilot.

## Transactions and results

| Action in the UI | Result |
| --- | --- |
| Add QA Soap: cost ₹15, selling ₹20, opening 20 pieces | Saved with owner PIN; stock 20 |
| Add loose QA Rice: cost ₹40/kg, selling ₹60/kg, opening 10 kg | Saved; internal stock 10,000 grams |
| Receive 10 soaps from a new supplier, invoice QA-DELIVERY-001, full credit | Stock 30 soaps, supplier due ₹150 |
| Sell two soaps for ₹40 cash; customer tenders ₹100 | Correct ₹60 change; bill KOS-2026-000001 |
| Sell 0.5 kg rice for ₹30 UPI | Correct fractional price; bill KOS-2026-000002 |
| Sell one soap for ₹20 udhar to a new customer | Customer created; bill KOS-2026-000003; due ₹20 |
| Collect ₹10 cash from that customer | Due ₹10; separate debit and payment ledger entries |
| Return one unopened soap against the original cash bill | ₹20 cash refund; one piece restocked; return linked to original bill |
| Record paper carry bags, ₹5 cash expense | Paid expense saved on 27 September |
| Stop this task's API and sell one soap for ₹20 cash | Saved locally; pending-backup message; retained after reload |
| Restart API | Outage sale becomes KOS-2026-000004; one server bill and one stock decrement |
| Pay ₹10 cash against supplier invoice | Partial status, paid ₹10, remaining due ₹140 |
| Declare ₹100 opening float and count ₹135 | Expected ₹135, counted ₹135, exact close; retained after reload |

Final balances independently checked against the isolated server database:

- Soap: `20 + 10 − 2 − 1 + 1 − 1 = 27` pieces, value ₹405.
- Rice: `10 − 0.5 = 9.5` kg (9,500 grams), value ₹380.
- Total stock value: ₹785.
- Gross sales ₹110 less return ₹20 = ₹90 net sales.
- Gross profit ₹25 less expense ₹5 = ₹20 net profit.
- Customer due ₹10; supplier due ₹140.
- Cash drawer: `100 + 40 + 20 + 10 − 20 − 5 − 10 = ₹135`.
- UPI recorded ₹30. This was an operator-confirmed test entry, not a real
  provider settlement. The UI correctly warned that no UPI provider was connected.
- Four sale bills and one return on the server, with the expected stock ledger
  entries. Closing showed zero pending operations, failed syncs and conflicts.

## Problems reproduced and fixed

1. **Purchase defaults to yesterday before 05:30 IST.** The form used a UTC date
   substring. Initial and reset dates now use the device's local calendar date.
   Retested before the UTC day changed: new purchase showed 2026-09-27.
2. **Daily report assigns today's expense and customer purchase to yesterday.**
   Expense grouping and customer date labels truncated UTC timestamps. Reports
   now convert timestamps to the same local calendar day as the expense picker.
   Retested: 27 September shows sales ₹90, expenses ₹5, net profit ₹20;
   26 September shows no expense. Customer last-purchase dates are 27 September.
3. **Misleading inventory statistics combine incompatible units.** After three
   sales, inventory displayed 13.4× turnover because it divided base-unit sales
   (including 500 grams) by a total of display units (pieces plus kilograms).
   Its 200-movement preview also could not establish 30-day turnover. Removed
   that unsupported ratio and mixed-unit total, retained stock value, SKU count,
   alerts and per-product quantities. Removed the similar cross-product quantity
   total in Reports. Final stock view shows 27 pieces and 9.5 kg separately.
4. **Opening float looks empty after reload despite a saved declaration.** The
   field initialized before its asynchronous data arrived. It now fills from
   loaded data while protecting unsaved typing. Browser checks: reload fills
   ₹100; an unsaved ₹120 survives Refresh; reload returns to the saved ₹100.
5. **The return form describes an exact-refund path without a way to reach it.**
   Added an English/Hindi “Find original bill” link in the new-return dialog.
   Verified it opens billing history, where the original bill provides Return
   items. The standalone-return option remains available.

## Remaining friction and limits

- Creating a simple product still exposes a long form with optional grocery,
  packaging, image and supplier fields. Defaults allow completion, but grouping
  advanced fields behind a disclosure would reduce first-day effort.
- Owner PIN is required for each product creation and for the return. These
  controls worked; they were not weakened for convenience.
- One apparent checkout-tap failure disappeared after the test browser was made
  visible and reloaded. Cash, UPI and udhar checkout then worked repeatedly.
  It is not recorded as a confirmed product defect.
- The outage test stopped the API while the frontend remained available. It
  verifies local saving, reload with API unavailable and reconnect sync; it does
  not certify a cold PWA launch without any network.
- Physical printing, scanner/scale hardware, live payment settlement, multiple
  devices and production restore were outside this scenario.
- Changes are local to this worktree; this run does not establish deployment.

## Validation

- Added six report-calendar regressions for IST/US day boundaries, date-only
  records, daylight-saving dates, deleted expenses, missing dates and totals.
  Together with existing expense-date tests: 9 passed.
- Browser retested purchase date, original-bill link, stock totals, report dates,
  closing hydration, refresh draft protection and persisted cash count.
- Final `frontend/npm run prod:check` passed: typecheck, 6,389 English/Hindi
  translation keys, production build, bundle budget, app checks and 3,001 tests
  across 399 test files. One pre-existing test/file remains skipped.
- Evidence images: `/tmp/kirana-shopday-inventory-fixed.png` and
  `/tmp/kirana-shopday-closing.png`; gate log:
  `/tmp/shopday-frontend-release-gate.log`.
