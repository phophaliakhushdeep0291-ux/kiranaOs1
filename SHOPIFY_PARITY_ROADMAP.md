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

- [ ] **Per-line discounts** — flat ₹ (UI also accepts %) per cart line with
      GST-aware taxable value; flows through offline bill path, sync payload,
      backend totals, print, and returns. *(iteration 1 — in progress)*
- [ ] **Exchanges** — one flow that returns items from a bill AND sells new
      items, settling only the difference (refund or collect). Today returns
      and new sales are separate bills; Shopify POS treats exchange as a
      first-class object.
- [ ] **Line-item notes** — per-line note (e.g. "no bag", weight callout)
      stored on the bill item and printed on the receipt.
- [ ] **Discount reasons + report** — optional reason chip on cart/line
      discounts; discounts-given report by staff/day.

## Tier 2 — Inventory depth

- [ ] **Stocktake / cycle count** — count-session UI: freeze expected qty,
      enter counted qty, post variance adjustments in one commit with reasons.
- [ ] **Stock adjustment reasons taxonomy** — damage/theft/expiry/correction
      enums on manual adjustments, reportable.
- [ ] **Barcode label printing** — generate/print price labels (name, price,
      barcode) for products from the products page.
- [ ] **Low-stock workflow** — reorder suggestions page driven by
      reorderLevel → one-tap draft purchase order per supplier.

## Tier 3 — Staff & analytics

- [ ] **Per-cashier attribution everywhere** — staff on every bill/return;
      sales-by-staff report (verify depth; staff module exists).
- [ ] **Analytics upgrade** — sales by hour heatmap, top products by margin
      (not just revenue), average basket size trend.
- [ ] **Register-session over/short history** — daily close variance log with
      trend, not just today's close.

## Tier 4 — Customer & receipts

- [ ] **Customer timeline** — unified profile view: bills, returns, payments,
      udhar, loyalty in one chronological feed.
- [ ] **Receipt customization** — logo, footer message, show/hide fields,
      configurable from printer settings.
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
| 2026-07-17 | Roadmap created; per-line discounts started | — |
