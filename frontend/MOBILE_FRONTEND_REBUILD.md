# Artha mobile frontend rebuild

## Product goal

The phone experience is a counter companion, not a compressed desktop dashboard. Every screen must help a shop owner finish a common task with one hand, understand whether data is safely saved, and recover from an interrupted or offline workflow without guessing.

## Information architecture

The bottom navigation has five stable destinations:

1. **Home** — today's sales, collections, shop health, and urgent follow-up.
2. **Sell** — product search, cart, customer, payment, receipt.
3. **Stock** — inventory health, products, counts, and adjustments.
4. **Customers** — udhar balances, collection, reminders, and ledger.
5. **More** — grouped secondary tasks: bills, purchases, reports, money, staff, sync, and settings.

The Sell destination is ordinary navigation. It is not a floating action disguised as a tab. Long-tail tools live in a task-grouped bottom sheet instead of a desktop navigation dropdown.

## Mobile component contract

- One contextual top bar: page, active store/location, sync health, search, alerts.
- One bottom tab bar: minimum 44px targets, safe-area aware, never overlays page actions.
- One page canvas: 14px phone gutters, 20px primary card radius, consistent border and shadow.
- One section rhythm: heading, optional helper/action, then cards or rows.
- Lists use readable rows instead of miniature tables. Primary text is at least 13px; supporting text is at least 11px.
- Fixed checkout actions sit above the tab bar and use the shared clearance variable.
- Sheets and full-screen task panels own focus, scroll independently, and expose an explicit close action.
- Sync state is semantic: synced, working, attention, or offline-safe. A server value never silently overwrites unsynced local work.

## Screen blueprints

### Home

- Net-sales hero with tender split and direct New sale / Collect due actions.
- Four shop-health cards: profit, udhar, expenses, low stock.
- Sales trend with an explicit period control.
- Readable insights, top products, and recent bills as full-width rows.

### Sell

- Search/scanner first, category chips second, products third.
- Persistent compact cart summary; checkout opens a focused mobile task panel.
- Customer and udhar requirements are visible before confirmation.
- Payment methods, amount remaining, validation, save state, and receipt outcome are one linear flow.

### Stock

- Health summary followed by Search, filter chips, then product rows.
- Stock in/out/count/adjustment actions are grouped by task and confirm quantity/unit/location.
- Low-stock, batch, and expiry signals must remain readable without opening a product.

### Customers

- Outstanding summary, search, balance filters, then customer rows.
- Customer detail leads with balance and Collect payment.
- Ledger is a mobile timeline/list; debit, credit, and running balance remain distinct.

### Bills

- Search and status/date filters precede readable receipt rows.
- Detail actions are Share, Print, Return, and Delete/void where authorized.
- Destructive actions show business impact and require confirmation.

## Delivery phases

- [x] Establish the dedicated mobile top bar, five-tab navigation, and grouped More sheet.
- [x] Remove the hidden legacy mobile header/navigation implementation.
- [x] Rebuild the Home hierarchy and readable mobile row patterns.
- [x] Preserve and align the existing focused mobile checkout panel and fixed-action clearance.
- [ ] Migrate every secondary route to the shared card/list/form patterns.
- [ ] Complete authenticated visual QA at 320, 375, 390, 430, 768, and 1024px.
- [ ] Complete keyboard, screen-reader, reduced-motion, slow-network, and offline/reconnect QA.

## Production release gates

- TypeScript, unit tests, production build, bundle limits, and app checks pass.
- No horizontal scrolling at supported widths.
- No control below a 44px touch target on a primary task.
- A new sale, udhar payment, stock adjustment, return, and sync recovery work online and offline.
- All calculated amounts reconcile after reload and after offline-to-online synchronization.
- Empty, loading, error, permission-denied, and offline states are designed for every primary route.
- A real device pass covers Android Chrome and iOS Safari before release.
