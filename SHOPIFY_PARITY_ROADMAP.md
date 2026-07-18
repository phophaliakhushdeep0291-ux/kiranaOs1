# Shopify-POS Parity Roadmap

Goal: bring KiranaOS checkout, returns, inventory, and staff workflows to the
interaction depth of Shopify POS while keeping the kirana-first model
(offline-first, udhar, GST, phone-first).

How this file is used: an autonomous improvement loop picks the top unchecked
item, implements it full-stack (frontend + offline path + backend + sync),
verifies with `tsc --noEmit` + `vite build` (frontend) and syntax/tests
(backend), commits, and checks the item off with the commit hash.

Audit date: 2026-07-17. "Already at parity" claims below were verified against
the codebase, not assumed.

## Already at parity (verified)

- Cart-level discount, coupon offers, split cash/UPI/bank tender, gift-card
  tender, loyalty redemption (`bills.schema.js`, `BillingPaymentPanel`).
- Park/retrieve carts — multiple open bills (`open-bills.ts`).
- Custom sale line items (`CartItem.isCustom`).
- Cash drawer / daily close (`DailyClosingPage`, dashboard cash drawer).
- WhatsApp receipt sharing (`BillingSummary`).
- Purchase orders, supplier ledger, batch/expiry lots, multi-location stores.
- Staff module, owner-PIN gates for sensitive actions.
- Smart pricing rules with per-line explanations (beyond Shopify).

## Tier 1 — Checkout & returns depth

- [x] **Per-line discounts** — flat ₹ (UI also accepts %) per cart line with
      GST-aware taxable value; flows through offline bill path, sync payload,
      backend totals, print, and returns. *(done 2026-07-17)*
- [x] **Exchanges** — ReturnDialog gained a "Customer takes new items" section:
      return + replacement sale in one flow, each document fully settled in the
      same tender so the drawer nets to the difference (offline-capable, no
      schema change). Both entry points (standalone return + bill detail)
      inherit it. *(done 2026-07-17)*
- [x] **Line-item notes** — per-line note chip in the cart ("no bag"), stored
      on BillItem (both schemas + migrations), flows through offline path and
      sync, printed under the item on receipts. *(done 2026-07-18)*
- [x] **Discount reasons + report** — optional reason input on the bill
      discount (stored on Bill, both schemas + migrations, offline path);
      "Discounts Given" report card (desktop + mobile) splitting
      manual/coupon/loyalty/line totals with recent discounted bills and
      their reasons. *(done 2026-07-18 — Tier 1 complete)*

## Tier 2 — Inventory depth

- [x] **Stocktake / cycle count** — already existed (re-audit 2026-07-18):
      `StockCountsPage` + backend stockCounts module — sessions with blind
      counts, review state, per-line reasons, owner-PIN apply/cancel.
- [x] **Stock adjustment reasons** — already existed (re-audit 2026-07-18):
      damage adjustments require a reason, corrections require owner PIN
      (`inventory/local-actions.ts`); free-text covers theft/expiry.
- [x] **Barcode label printing** — "Print label" on every product row: printable
      48mm label sheet with name/price/MRP and a scannable code — vendored
      EAN-13 SVG encoder (UPC-A/12-digit normalization + checksum) with QR
      fallback for unbarcoded products. *(done 2026-07-18)*
- [x] **Low-stock workflow** — already existed (re-audit 2026-07-18):
      `PurchaseOrdersPanel` reorder suggestions grouped by supplier with
      demand-forecast confidence and explanations.

## Tier 3 — Staff & analytics

- [ ] **Per-cashier attribution everywhere** — staff on every bill/return;
      sales-by-staff report (verify depth; staff module exists).
- [x] **Analytics upgrade** — "Sales by Hour" chart + Busy Hours insight
      (peak/quiet hour callouts) in Reports, computed offline from local
      bills *(done 2026-07-18)*; top products already report margin %.
- [ ] **Register-session over/short history** — daily close variance log with
      trend, not just today's close.

## Tier 4 — Customer & receipts

- [x] **Customer timeline** — "Activity timeline" card on the customer page:
      one chronological feed of sales, estimates, returns, payments (with
      reversals), and ledger adjustments — deduped against ledger echoes,
      bills clickable. *(done 2026-07-18)*
- [x] **Receipt customization** — already existed (re-audit 2026-07-18):
      printer settings cover logo, footer text, copies, paper size, and a
      dozen show/hide content toggles (`printer-config.ts`).
- [ ] **Email receipts** — in addition to WhatsApp/print (needs SMTP creds —
      may stay blocked on integration credentials).

## Explicitly out of scope

- Shopify-style ecommerce storefront/theme system (QR self-order catalog
  already covers kirana-scale online ordering).
- Card-present payment hardware certification (tracked separately in
  hardware-bridge).

## Iteration log

| Date | Item | Commit |
|---|---|---|
| 2026-07-17 | Roadmap created; per-line discounts shipped full-stack | feat(billing): per-line discounts |
| 2026-07-17 | Exchanges shipped in ReturnDialog; live browser QA of discounts + exchange | feat(returns): exchange flow |
| 2026-07-18 | Line-item notes shipped full-stack (cart chip → receipt) | feat(billing): line-item notes |
| 2026-07-18 | Barcode label printing (EAN-13 + QR fallback) from products page | feat(products): price-label printing |
| 2026-07-18 | Customer activity timeline (unified feed on customer page) | feat(customers): activity timeline |
| 2026-07-18 | Discount reasons + Discounts Given report — Tier 1 complete | feat(billing): discount reasons + report |
| 2026-07-18 | Re-audit: stocktake/adjustments/reorder/receipt-custom already exist; Sales by Hour shipped | feat(reports): sales by hour |
