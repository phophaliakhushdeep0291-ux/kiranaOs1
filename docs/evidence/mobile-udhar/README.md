# Mobile Udhar checkout and sync proof

Date: 2026-08-10  
Viewport: 390x844 CSS pixels  
Requirements: BILL-003, CUST-002, SYNC-001, SYNC-002, SYNC-004, QUAL-002, QUAL-003, QUAL-005  
QA flow: MQA-BILL-01 / MQA-SYNC-01

## Exercised flow

1. The restaurant cart contained one Large `Truffle Paneer Flatbread` at Rs 590 and `Smoked mozzarella` at +Rs 85, for an exact Rs 675 total.
2. Udhar checkout rejected a walk-in customer. The cashier supplied `Udhar Mobile QA` and `9876500088`; checkout then showed Rs 675 Udhar and Rs 0 paid.
3. With the backend unavailable, the app committed local bill `PENDING-B87FA9` (`clientBillId` `bill_7e1ce51e-060e-4d43-bbad-e95984b87fa9`) and retained it in Billing History.
4. The first retry exposed a stale local QA database missing `MenuComboComponent`. `npm run prisma:push` brought that non-production SQLite database to the committed schema without deleting its data.
5. Retry reconciled the same local bill to cloud bill `KOS-2026-000003` (`cmsm86c7n002rte5d3dj7okd9`). A second forced sync reported 0 uploaded, 0 downloaded and 0 failed.

## Authoritative results

- Mobile history: 3 bills, Rs 2,023 sales, 1 Udhar bill; KOS-2026-000003 is Synced.
- Mobile detail: Rs 675 total, Rs 0 paid, Rs 675 Udhar; customer name/mobile and immutable Large/add-on snapshot are present.
- Server database after the repeated sync: exactly 1 bill for the client identity, exactly 1 linked Udhar debit, 0 payment rows, and customer outstanding `67500` paise.
- Server money: `grandTotalPaise=67500`, `paidAmountPaise=0`, `creditAmountPaise=67500`; the ledger debit is `67500` paise.
- 390px detail geometry: document width 390/390 and 0 active controls below 44px after the shared skip-link correction.
- 390px Sync Status geometry: document width 390/390. The live audit found the diagnostics refresh action at 36px; it is now 44px in source with a regression test, and its post-fix live recapture is intentionally still pending.

## Retained artifact

- `mqa-bill-synced-detail-390x844.png` — synced final detail showing the exact customer, money split, sold-line options and one ledger impact.

## Scope limits

This proves the backend-unavailable/local-save/retry path on one 390px device. It does not claim an operating-system airplane-mode toggle, a second-device checkout, external payment/provider delivery, or the full four-viewport matrix for the Udhar variant.
