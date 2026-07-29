# KiranaOS Mobile UX Architecture V2

## Product Goal

The mobile app must feel like a native, one-hand POS companion for a kirana owner. It must not reuse crowded desktop layouts. The rule is simple: desktop can be dense; mobile must be sequenced, thumb-friendly, offline-first, and financially clear.

## Non-Negotiable Mobile Rules

1. No desktop tables on phones. Every table becomes a card list with the key decision fields first.
2. No horizontal page scroll. If content does not fit, it stacks vertically.
3. No hidden primary action. Add, save, pay, print, sync, and accept actions must be visible or in a clear bottom sheet.
4. Every page gets the same mobile shell: header, optional sync strip, page controls, KPI cards, content cards, bottom nav.
5. Every money view must show who, when, mode, reference, amount, and status.
6. Every offline write must be visible immediately and sync without duplicate backend rows.
7. Technical sync/conflict details stay out of normal owner flow. Normal users see retryable, plain-language states.

## Mobile App Shell

### Header

- Height: stable, never wraps.
- Left: menu button.
- Center: KiranaOS brand on home-like pages, page title on detail pages.
- Right: notification and store/profile button.
- Store names must truncate before they collide with actions.

### Sync Strip

- Appears near the top on operational pages.
- Good state: green icon, `Synced`, `Just now`, `Sync Now` button.
- Offline state: `Offline safe`, `Saved on this device`.
- Failure state: `Backup did not finish`, `Try again when internet/backend is working`.

### Bottom Navigation

- Fixed bottom nav with Dashboard, Billing, Inventory, Customers, More.
- Center floating plus goes to Billing.
- More opens every secondary module: Bills History, Orders Received, Sales Overview, Purchases, Returns, Reports, Money Statement, Expenses, Offers, Settings, Sync.
- Every page reserves bottom safe-area space so buttons are not covered.

## Shared Mobile Components

Use these primitives for all mobile pages:

- `MobilePage`: page wrapper with white background, safe spacing, and bottom-nav clearance.
- `MobileSyncStrip`: consistent online/offline/sync status.
- `MobileKpiGrid`: two-column phone KPI grid.
- `MobileKpiCard`: icon, label, value, percent trend, sparkline.
- `MobileToolbar`: search/filter/date/action grouping that wraps cleanly.
- `MobilePillButton`: tab/filter chip with active state.
- `MobileSection`: title, action, content card.
- `MobileListCard`: table-row replacement.
- `MobileActionGrid` and `MobileActionTile`: big touch actions.

## Page Architecture

### Dashboard

Order:
1. Sync strip.
2. Business Overview with six KPI cards: sales, cash, UPI, profit, outstanding udhar, expense/stock alert.
3. Sales trend chart full-width.
4. Quick Insights.
5. Top Products and Recent Bills.
6. Bottom nav.

Rules:
- KPI cards always show mini sparklines.
- Only the percent value is colored; `vs yesterday/week` remains neutral.
- Payment breakdown and chart sections must animate consistently.

### Billing

Order:
1. Customer selector.
2. Product search and barcode scan.
3. Recent products carousel.
4. Category chips.
5. Product cards.
6. Sticky mini-cart.
7. Cart review and payment in bottom sheets/step screens.

Rules:
- Pakka bill and Estimate bill use the same cart quality and print support.
- Estimate bill has a separate number series and separate cleanup/history.
- If stock is lower than sold quantity, allow negative stock but show a clear warning.

### Bills History

Order:
1. KPI cards.
2. Search/date/filter controls.
3. Status chips.
4. Bill cards.
5. Bill detail bottom sheet with print, share, cancel, refund, mark paid/udhar.

Rules:
- All bills must be visible, including synced, pending, estimate, and finalized bills.
- Bill numbers may be simplified visually, but full reference must be available in detail.

### Orders Received

Order:
1. Pending/accepted/rejected KPI cards.
2. Order cards with customer name, phone, address, amount, time.
3. Accept & Bill loads the order into Billing, never WhatsApp.
4. Already-loaded orders open the existing Billing draft instead of duplicating.

### Inventory

Order:
1. Stock KPI cards.
2. Action tiles: Add Stock, Correction, Damage, Supplier Purchase, More.
3. Product stock list.
4. Stock by location.
5. Recent stock updates.

Rules:
- Inventory root must be a real overview page.
- Stock In and Stock Out must only show relevant movement records, not every product as stock out.
- Low/out-of-stock state is based on available quantity and threshold, not accidental movement rows.

### Customers / Udhar

Order:
1. Customer KPI cards.
2. Search/filter/sort/add customer controls.
3. Customer list; no customer selected by default.
4. Selected customer detail card.
5. Record payment card.
6. Collection progress.
7. Udhar ledger.

Rules:
- Payment cannot exceed outstanding balance.
- Split payments must sum exactly to payment amount.
- Customer list amount/tick/status must align in one stable row.
- Every ledger row shows date, time, reference, debit, credit, mode, and running balance.

### Purchases

Order:
1. Purchase KPI cards.
2. Supplier insight strip.
3. Search/filter/add purchase controls.
4. Purchase bill cards.
5. Recent activity and due alerts.

Rules:
- Purchase due date must be normalized before sync.
- Partial payment cannot exceed bill amount.
- Purchases must be idempotent during retry.

### Returns

Order:
1. Return KPI cards.
2. Sales/Purchase return tabs.
3. Return order cards.
4. Top returned items.
5. Return summary.

Rules:
- Return stock impact must be explicit.
- Refund/cash/bank/UPI movement must appear in Money Statement.

### Reports

Order:
1. KPI cards in mobile two-column grid; desktop 4 + 4 grid when requested.
2. Sales trend.
3. Category/payment charts.
4. Top products/customers/closing summaries as cards.

Rules:
- White background.
- No flicker while rendering; preserve previous data while refetching.
- Charts keep stable dimensions.

### Money Statement

Order:
1. Cash, UPI, Bank, Net KPI cards.
2. Search/date/filter toolbar.
3. Mode chips separated from flow chips.
4. Statement cards/table with customer/supplier name, date, time, reference, mode, received, paid, status.
5. Detail drawer showing bill/payment line items.

Rules:
- Filtering by mode must not zero unrelated summaries unless the selected filter explicitly scopes totals.
- Udhar bank payments must appear as bank received.

### Expenses

Order:
1. Expense KPI cards.
2. Category breakdown and spending trend.
3. Search/filter/export/add expense.
4. Expense list cards.

### Settings

Order:
1. Grouped settings cards.
2. Store Profile, Staff, Device, Printer/Billing, Taxes, Sync, Security, Notifications.
3. Every visible action must either work or be clearly marked unavailable.

Rules:
- Store profile save updates header and General settings card.
- Device management is owner-friendly, not technical.
- Printer page must support scan/connect/test print where browser/device capability allows.

## Responsive Breakpoints

- 320-374px: single-column fallback for wide controls.
- 375-430px: primary mobile target.
- 431-767px: wider phone layout, still mobile shell.
- 768-1023px: tablet can use 2-column sections but no desktop sidebar compression.
- 1024px+: desktop layout.

## Verification Checklist

For every page:

- Open at 375, 390, 430, 768, 1024, 1440.
- No text collision.
- No horizontal scroll.
- Header actions do not overlap store name.
- Fixed bottom nav does not cover submit buttons.
- Local data renders before backend response.
- Writes update instantly offline.
- Sync retry does not duplicate bills/payments/ledger/purchase rows.
- Money totals match canonical deduped records.
- Build, typecheck, and targeted UI tests pass.
