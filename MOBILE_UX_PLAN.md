# Mobile UX Plan

Status: Execution baseline  
Last updated: 2026-08-22

## Outcome

KiranaOS must feel designed for a cashier's phone, not compressed from desktop. The core loop is scan/search, adjust quantity, choose customer/payment, confirm, print/share, and immediately start the next bill.

This plan complements `MOBILE_UX_ARCHITECTURE_REPORT.md` and turns it into testable work.

## Global contract

- Viewport matrix: 375x667, 390x844, 430x932 and 768x1024, plus desktop regression.
- Minimum interactive target: 44x44 CSS pixels.
- Page gutter: 16px; respect safe-area insets.
- No horizontal document scroll at any target width.
- Fixed bottom navigation reserves content space and never covers actions, keyboard fields or toasts.
- Add/edit/checkout use focused full-screen flows on phones; dense tables become list cards.
- Primary actions stay visible; secondary actions may use a labeled overflow menu.
- Network state never blocks access to safe local data.
- Loading, empty, offline, permission-denied and recoverable-error states are part of each page definition.

## Navigation model

Bottom navigation: Home, Billing, Inventory, Customers and More. Billing is the emphasized central action. More contains Purchases, Bills/Returns, Expenses, Reports, Orders, Settings and Sync. A page header contains one back/menu affordance, one concise title and at most two actions.

## Page work and QA IDs

| QA ID | Page | Phone-first flow | Must prove |
|---|---|---|---|
| MQA-BILL-01 | Billing | Search/scan -> cart -> customer -> payment -> confirm -> receipt | Keyboard and nav do not hide totals/actions; offline confirm is durable; under/over tender prevented |
| MQA-PROD-01 | Products | Search/filter -> product card -> full-screen add/edit | Barcode, tax, units and low-stock fields are reachable; errors stay with fields |
| MQA-CUST-01 | Customers/Udhar | Search -> customer -> statement/payment -> receipt | Due and risk are legible; payment reversal/owner gates are clear |
| MQA-INV-01 | Inventory | KPIs/actions -> item movements -> correction/count | Resulting stock and reason visible; destructive correction protected |
| MQA-PUR-01 | Purchases | Supplier -> PO/receipt lines -> payment -> stock result | Long item lists usable; totals sticky; duplicate submission prevented |
| MQA-RPT-01 | Reports | Date/filter sheet -> summary -> drill-down/export | Owner gets cash, dues and exceptions first; charts never force horizontal scroll |
| MQA-SET-01 | Settings | Group -> focused editor -> save feedback | Billing, tax, printer, security and backup reachable in two taps |
| MQA-SYNC-01 | Sync status | Summary -> failed item -> retry/review | Plain language distinguishes local safety from cloud backup; retry result visible |

## Implementation order

1. Shell and shared primitives: safe-area layout, bottom-nav spacing, page header, mobile list card, action sheet, sticky action bar and responsive form field.
2. Billing, because it determines the core interaction and keyboard behavior.
3. Products and Customers/Udhar, the dependencies most often opened during billing.
4. Inventory and Purchases.
5. Reports, Settings and Sync status.
6. Remaining pages and desktop regression.

Use existing components and routes; avoid page rewrites where a shared primitive or layout correction solves the issue.

## Execution evidence

- 2026-07-18: Billing, Products, Inventory, Purchases, Reports, Settings and Sync overview routes passed automated live Chrome checks at 375, 390, 430 and 768 widths with zero horizontal document overflow or runtime errors.
- 2026-07-18: The 390px purchase-order creation task passed full-screen geometry (390x844 at 0,0), 44px minimum control height, zero horizontal overflow and a sticky safe-area footer at the viewport edge. Artifact: `frontend/purchase-create-task-390.png`.
- 2026-07-18: Focused live receive QA completed a sent PO at 390px with a partial supplier payment. The task passed full-screen geometry, 44px controls, zero overflow and zero runtime errors; API reconciliation proved stock 24 -> 28, receipt total ₹920, paid ₹100, due ₹820 and retained supplier invoice `QA-SUP-1001`. Verifier: `frontend/scripts/capture-purchase-receive-ui.mjs`.
- 2026-07-18: Supplier-due settlement was upgraded from a mutable purchase overwrite to dedicated `RECORD_SUPPLIER_PAYMENT` and owner-gated `REVERSE_SUPPLIER_PAYMENT` events. Each payment has an immutable local row, an exactly-once append-only financial-ledger entry, transactional due reconciliation and audited reversal. Focused frontend tests pass 8/8 and backend sync integration passes 37/37.
- MQA-PUR-01 is verified for PO create, receipt/stock mutation, partial supplier settlement, owner reversal and lost-ack replay. The focused 390px verifier proved full-screen 390x844 geometry, 44px controls, zero overflow/runtime errors and exact due movement ₹900 -> ₹700 -> ₹900 across replay. Artifacts: `supplier-payment-task-390.png` and `supplier-payment-reversal-task-390.png`; verifier: `frontend/scripts/capture-supplier-settlement-ui.mjs`.
- 2026-08-01: MQA-BILL-01/MQA-SET-01 receipt software paths passed live 390x844 QA. The premium 80mm preview reacts to GST and previous-Udhar toggles; HTML download records Saved, browser printing records Dialog opened, and bill duplicate-print leaves the cancelled bill unchanged. Printer, bill-share and email-dialog actions measure 44px, the page remains 390px wide and console errors are zero. External message delivery and physical-printer certification were intentionally not claimed.
- 2026-08-08: MQA-SYNC-01 passed the mutable-customer two-device recovery flow at 390x844. Devices A and B saved different offline names from the same base record; after A synced, B showed one actionable customer conflict with a plain local/cloud comparison and valid timestamps, not duplicate cards. Historical in-UI `Keep cloud` recovery removed the customer review and converged B; the fresh owner-authenticated decision also left zero open customer rows and a server audit. One unrelated historical bill review remains intentionally unresolved because financial conflicts require compensating entries. The final fresh post-resolution screenshot was not recaptured after the QA browser reopened onto a policy-blocked connection-error page; HTTP/database/audit evidence closes the server decision while the earlier live interaction supplies the UI-convergence proof.
- 2026-08-08: MQA-BILL-01 restaurant add-on configuration, ₹675 checkout and final bill detail passed the complete 375x667, 390x844, 430x932 and 768x1024 live matrix. The cashier-selected Large at ₹590 plus `Smoked mozzarella` at +₹85 remains visible through review, cash collection, synced history and final detail. Live QA first caught an internally scrolling phone detail table and replaced it with a full-width item card, then the 375px run exposed checkout controls below 44px. Cart layout, portion/rate/note/quantity/remove controls, coupon/loyalty rows, partial payment, tender shortcuts, clear-cart, add-on option rows and the shared dialog close affordance now meet the 44px contract. All four documents/dialogs match their viewports, phone detail cards are 331/331, 346/346 and 386/386, the 768px item table wrapper is 660/660, and no measured active control is below 44px after dialog motion settles. Automated bill-option/receipt/layout/touch regressions pass; backend database integration remains 3/3 for snapshot and stock consumption. Twelve screenshots plus the geometry manifest are retained in `docs/evidence/mobile-restaurant-addon/`. MQA-BILL-01 is closed for this restaurant cash/add-on transaction; Udhar, offline-toggle and other billing variants remain separate open proof.
- 2026-08-10: MQA-BILL-01/MQA-SYNC-01 now include the 390x844 backend-unavailable Udhar variant. A walk-in was rejected, the named customer saved a local ₹675/₹0-paid bill, retry reconciled `PENDING-B87FA9` to `KOS-2026-000003`, and a repeated force sync left exactly one server bill, one ₹675 ledger debit, zero payment rows and ₹675 customer outstanding. The resulting synced detail now passes 375x667, 390x844, 430x932 and 768x1024: each retains the exact customer, Large and ₹85 add-on, ₹675/₹0-paid/₹675-Udhar split and ₹675 ledger impact; phone cards measure 331/331, 346/346 and 386/386, the tablet table is 660/660, and every width has zero overflow or undersized active controls. At 375x667 the final audit card clears fixed navigation by 217px. Sync Status also recovered visibly to 0 pending/failed/conflicts; diagnostics refresh and the shared Owner details action now both pass live at 44px. The full checkout was only executed at 390px, and operating-system airplane-mode proof remains open.
- 2026-08-11: MQA-SET-01 now includes the server-authoritative subscription/Staff transition at 390x844 plus settled-layout proof at 375x667, 430x932 and 768x1024. `Check payment status` changed an expired Starter licence to the server-confirmed active Growth plan, showed protected cloud state and unlocked Staff without a reload; after removing the temporary database row, the live Starter plan again blocked Staff behind `Upgrade to Growth`. The active Staff list is a fitted card with a concise permission summary, visible `server confirmed` badge and no internal horizontal scroll. The width audit caught 28px segmented-tab targets; shared tabs now expose 44px targets, and the Add Staff phone task uses a sticky safe-area footer while the 768px layout remains a centered modal. All three new widths have document width equal to viewport width and zero measured sub-44px active controls after motion settles. Six retained screenshots and the geometry/checksum manifest are in `docs/evidence/mobile-staff/`. Focused authority, subscription, scope and mobile-task coverage passes 15/15. The exact post-fix frontend production gate passes typecheck, all 1,091 translation placeholders, 1,374 tests with one intentional skip, production build, bundle budgets and production-app checks. The full subscription state transition was executed at 390px; the other three widths certify the same signed-Growth Staff and Add Staff layouts.
- 2026-08-11: MQA-SET-01 covers the full Settings hub plus Billing, Taxes & GST, Printer, Sync/Backup and Security at 375x667, 390x844, 430x932 and 768x1024. All 24 post-fix captures match document width to viewport width, have no horizontal overflow and expose no active target below 44px. The audit added the missing direct Taxes & GST shortcut; enlarged shared switch/toast-close targets; removed 18-34px text actions; replaced the clipped phone security table with fitted cards; and labeled/enlarged the password reveal action. Stateful 390px checks exercised subscription refresh, reversible composition/security switches, printer feedback, Sync Now, owner-PIN backup creation/validation/download and Change PIN cancellation without leaving configuration changes. The initial missing `BACKUP_ENCRYPTION_KEY` was surfaced accurately; after a 32-byte key was placed only in ignored local `.env`, the normal port-3000 UI created a 193-record AES-256-GCM/SHA-256 artifact, restore-previewed it as restorable with credentials preserved and completed the owner-PIN-protected download. Request/completion/preview/download audits were persisted. The temporary row, object and downloaded copy were removed, and destructive restore was intentionally not executed against the working shop. The exact frontend gate passes typecheck, 1,107 translation keys, 1,384 tests plus one intentional skip, production build, bundle budgets and production-app checks. Screenshots, hashes, measurements and cleanup are recorded in `docs/evidence/mobile-settings/manifest.json`; deployed key custody/object storage/managed restore remain SYNC-005 work rather than an open mobile-layout defect.

- 2026-08-11: the premium Product Pricing editor passed stateful 390x844 QA for owner-approved quantity slabs. The settled overview and created-rule states both match the 390px viewport, have no horizontal overflow and expose zero active controls below 44px (24 before the rule, 25 with it). Live QA caught stale browser-cached pricing reads: the first rule existed on the server but appeared only after reload. Pricing rules, settings and selling-unit reads now use `cache: no-store`; a second reversible rule appeared immediately after creation and disappeared immediately after archive. The 4-digit owner PIN cleared after both successful mutations. The audit also exposed a legacy-session path that retained the approving owner but lost the device; pricing controllers now prefer the device resolved by `requireDeviceActivated`, with focused regression coverage. Two temporary archived rules and the temporary Growth subscription were deleted; four control audits remain, and the frontend Growth route gate was restored after QA. Screenshots, checksums, measurements and cleanup are in `docs/evidence/mobile-pricing/manifest.json`. Focused pricing coverage passes backend 1/1 and frontend 11/11; the exact frontend gate passes 1,393 tests plus one intentional skip, typecheck, translation parity, build and security checks.

- 2026-08-13: MQA-BILL-01 now includes BILL-005 hold/reload/resume crash-recovery proof. Live 390x844 QA held a one-item INR 6 cart, confirmed the empty active workspace plus parked bill after a full reload, resumed the exact cart and confirmed it again after a second reload. The hold transition now persists active and held workspaces atomically before changing the screen, serializes in-flight transitions, refuses a new workspace at the ten-bill cap and cannot evict an unrelated held bill during resume; a forced second-write failure leaves the current UI intact. Live QA also caught and fixed the checkout sheet remaining open on an empty cart after hold and two undersized auxiliary actions. Settled 375x812, 390x844, 430x932 and 768x1024 states all match document width to viewport width, have zero horizontal overflow and zero active controls below 44px. Backend bill count (130), ledger count (387) and Parle-G stock (95 base units) remained identical before hold, after hold and after resume, proving that drafts do not post inventory or financial mutations. Focused workspace coverage passes 13/13; the exact local frontend gate passes typecheck, 1,195 translation keys, 1,423 tests plus one intentional skip, production build, bundle budgets and production-app checks. Screenshots, checksums, geometry and database invariants are retained in `docs/evidence/mobile-billing/manifest.json`; this remains local evidence rather than exact-candidate CI.

- 2026-08-22: MQA-BILL-01 now includes BILL-008 cashier-versus-owner approval. At 390x844 a staff cashier entered a ₹100 discount on a ₹118 estimate, received the mandatory owner-PIN plus audit-reason sheet and successfully saved the approved transaction. The local-first retry converged to exactly one `EST-2026-000002`; database and rendered detail evidence retain the staff actor, the approval reason and one `BILL_LARGE_DISCOUNT_APPROVED` audit. Billing History passes 375x812, 390x844, 430x932 and 768x1024 with exact document/viewport width parity and zero active controls below 44px. The live run exposed and fixed both a stale approval-state closure and Billing History hook/hidden-chart console noise; fresh 390px and 1024px reloads have zero warnings/errors. The exact-current frontend gate passes typecheck, 4,714-key translation parity, 1,726 tests plus one intentional skip, build and security checks; the complete backend harness, production check, migration safety and release gate pass. Evidence and checksums: `docs/evidence/mobile-billing-bill008/manifest.json`.

## Live audit procedure

For each QA ID and viewport:

1. Seed deterministic data including long names, large currency, empty state and error state.
2. Capture the first screen and every full-screen/modal step.
3. Exercise touch navigation, keyboard open/close, rotation where relevant, offline transition and browser back.
4. Check `document.documentElement.scrollWidth <= clientWidth`.
5. Verify bottom-most action remains visible above navigation and keyboard.
6. Store screenshot artifacts named `<qa-id>-<width>-<state>.png` and link them in the release record.

## Definition of done

A page is done only when its requirement IDs, automated responsive/behavior tests and all four viewport screenshots are linked; no P0/P1 mobile bug remains; and a human can complete the primary flow without instruction. Screenshot approval alone is insufficient—the flow must be exercised live.
