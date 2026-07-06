# KiranaOS Mobile UX Architecture Report

## Goal

Make KiranaOS feel like a production mobile POS app, not a desktop dashboard squeezed onto a phone. The mobile experience should be fast, thumb-friendly, offline-first, and visually consistent across Dashboard, Billing, Bills History, Inventory, Customers/Udhar, Purchases, Returns, Expenses, Reports, Settings, and Sync.

## Core Mobile Layout

Every mobile page should use the same structure:

1. Header
   - Left: menu button.
   - Center: page title or KiranaOS brand.
   - Right: notification/profile.
   - Keep height predictable and avoid wrapping.

2. Sync strip
   - Show a compact green synced/offline-safe state.
   - Primary action: Sync Now.
   - Use plain language for failure states: "Backup did not finish. Try again."
   - Keep technical conflict details behind an advanced/review screen.

3. Page controls
   - Search, date range, filter, export, add actions should become large touch targets.
   - On mobile, filters should open a bottom sheet instead of compressing dropdowns inline.

4. KPI section
   - Use a 2-column card grid on phones.
   - Each card should have icon, label, value, trend percentage, and optional sparkline.
   - Only the number and percent sign should use positive/negative color; comparison text stays neutral.

5. Main content
   - Tables should become stacked list cards on mobile.
   - Desktop tables can remain from `md` upward.
   - Cards should show the decision-making data first: customer/supplier/product, amount, status, and next action.

6. Bottom navigation
   - Fixed bottom nav with Dashboard, Billing, Inventory, Customers, and More.
   - Center floating `+` action goes to Billing because billing is the highest-frequency POS action.
   - More opens all secondary modules: Bills History, Sales Overview, Purchases, Returns, Expenses, Reports, Offers, Settings, Sync.

## Data Fetching Architecture

KiranaOS is local-first, so mobile pages should read in this order:

1. IndexedDB instant cache for immediate paint.
2. React Query active refetch for currently visible screens after local writes.
3. Sync queue state for pending/failed backup status.
4. Backend pull after successful sync or when app becomes online.

Rules:

- Never block mobile UI waiting for the server if local data exists.
- Never calculate financial totals from raw duplicated local/server echoes. Use deduped bills and canonical record ids.
- Every write must have an idempotency key so retrying sync does not create duplicate backend rows.
- Offline writes should update local UI immediately, then reconcile when online.
- If sync fails, keep local data safe and retry without double-applying balances.

## Page-Specific Mobile Placement

### Dashboard

- Sync strip.
- Business Overview KPI cards in 2 columns.
- Sales Trend chart full-width.
- Quick Insights card.
- Top Products and Recent Bills side-by-side only on wider phones/tablets; stacked on narrow phones.

### Billing

- Customer selector.
- Product search and barcode scan.
- Recent products carousel.
- Category chips.
- Product cards.
- Sticky mini cart bar.
- Cart review and payment as step screens or bottom sheets.
- Pakka bill and Estimate bill share the same billing quality, but use separate number series and separate history cleanup.

### Bills History

- KPI cards.
- Search and filters.
- Bill list cards on mobile.
- Bill detail/action bottom sheet with print, share, cancel, refund, mark paid/udhar.

### Inventory

- Stock KPI cards.
- Action tiles: Add Stock, Stock Correction, Damage Entry, Supplier Purchase, More.
- Product stock summary as mobile list cards.
- Stock by location and recent updates below.
- Product, Categories, Stock In, Stock Out, Adjustments, Transfers remain available from Inventory submenu.

### Customers / Udhar

- Customer KPI cards.
- Search, filter, sort, add customer.
- Customer list cards with risk and outstanding amount.
- Selected customer payment card.
- Collection progress and recent payments.
- Udhar ledger as cards on mobile and table on desktop.

### Purchases

- Purchase KPI cards.
- Supplier insights strip.
- Search/filter/columns/add purchase controls.
- Purchase bill cards on mobile.
- Activity and due alerts below.

### Returns

- Return KPI cards.
- Sales Return / Purchase Return tabs.
- Return order cards on mobile.
- Top returned items and return summary below.

### Expenses

- Expense KPI cards.
- Category donut and monthly trend.
- Search/filter/export/add expense controls.
- Expense list cards on mobile.

### Reports

- KPI cards with sparklines.
- Sales Trend, Category Performance, Payment Breakdown.
- Tables become compact summary cards on mobile.
- Filters open a bottom sheet.

### Settings

- Use grouped cards with large rows.
- Avoid dense desktop grids on phone.
- Device, printer, billing, backup, and security settings should be reachable in one or two taps.

## Visual System

- Background: white on mobile.
- Cards: 18px radius, light border, soft shadow.
- Primary blue: vibrant POS blue.
- Success green, warning orange, danger red, UPI violet.
- Minimum touch target: 44px.
- Page gutter: 16px.
- Bottom safe area: always reserve room for fixed nav.
- No horizontal page scrolling.

## Implementation Standard

Shared primitives should be used before page-specific custom layout:

- `StatsGrid`: 2-column mobile KPI grid.
- `StatCard`: mobile-friendly card proportions and readable labels.
- `MobileSection`: title/action/content block.
- `MobileListCard`: table replacement for mobile.
- `MobileActionGrid`: touch-first action tiles.

## Production Test Checklist

For every mobile page:

- 375px, 390px, 430px, 768px, and desktop widths.
- No horizontal scroll.
- Bottom nav does not cover buttons.
- Primary action is reachable by thumb.
- Search/filter/add flows work.
- Offline-first data appears immediately.
- Sync retry does not duplicate data.
- Totals match deduped backend/local calculations.
- Empty states, loading states, and error states are user-safe.

