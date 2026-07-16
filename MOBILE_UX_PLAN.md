# Mobile UX Plan

Status: Execution baseline  
Last updated: 2026-07-16

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
