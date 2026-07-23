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

- [x] **Per-cashier attribution** — bills already carry createdByUserId
      (server-side attribution, Phase 12); the computed sales-by-staff data
      is now RENDERED as a "Sales by Staff" report table (bills, sales, avg
      bill per cashier). *(done 2026-07-19)*
- [x] **Analytics upgrade** — "Sales by Hour" chart + Busy Hours insight
      (peak/quiet hour callouts) in Reports, computed offline from local
      bills *(done 2026-07-18)*; top products already report margin %.
- [x] **Register over/short history** — Daily Closing gained "Count the
      drawer": type the physically counted cash, get an instant over/short
      verdict vs expected, and a 90-day per-date variance history (offline,
      device-local). *(done 2026-07-19)*

## Tier 4 — Customer & receipts

- [x] **Customer timeline** — "Activity timeline" card on the customer page:
      one chronological feed of sales, estimates, returns, payments (with
      reversals), and ledger adjustments — deduped against ledger echoes,
      bills clickable. *(done 2026-07-18)*
- [x] **Receipt customization** — already existed (re-audit 2026-07-18):
      printer settings cover logo, footer text, copies, paper size, and a
      dozen show/hide content toggles (`printer-config.ts`).
- [ ] **Email receipts** — BLOCKED: needs SMTP/provider credentials only the
      owner can supply (Settings → Integrations). Everything else on this
      roadmap is done; revisit when credentials exist.

## Phase 2 — Prove it, then deepen

Phase 1 shipped features; Phase 2 proves they survive a real counter and
closes the polish gaps that separate "feature exists" from "shop trusts it".

### 2A — Live verification of Phase 1 work

Per-line discounts and exchanges were driven end-to-end in a browser against
a real backend (2026-07-17). The rest shipped with unit tests + typecheck +
build only, so drive each one live and record what was observed.

- [x] **Line-item notes** — VERIFIED live 2026-07-19: typed "no bag please"
      on one of two cart lines, saved, synced; server row shows
      `note="no bag please"` on that BillItem and `null` on the other.
- [x] **Discount reasons** — VERIFIED live 2026-07-19: ₹20 off with reason
      "regular customer"; server bill shows `discount=20`,
      `discountReason="regular customer"`, subtotal 150 → total 130.
- [x] **Per-cashier attribution** — VERIFIED live 2026-07-19: the synced bill
      carries `createdByUserId` from server-side auth context.
- [ ] **Discounts Given report UI** — split rendering not yet driven live.
- [ ] **Barcode label printing** — print a label for a barcoded and an
      unbarcoded product; confirm EAN-13 vs QR fallback renders.
- [ ] **Customer activity timeline** — bill + payment + return for one
      customer, confirm one event each, correct signs, no ledger echoes.
- [ ] **Sales by Hour / Sales by Staff** — confirm buckets and attribution
      against known bills.
- [ ] **Drawer over/short** — save a count, confirm variance + history
      survive a reload.

**Environment note (2026-07-19):** live QA shares one browser preview and one
dev backend with other concurrent sessions. Mid-run, another session's shop
replaced the auth/session state and forced a logout, so the remaining 2A
items were deferred rather than verified against contended state. Re-run 2A
when no other session is driving the preview.

**Non-finding (recorded so it is not re-investigated):** registering twice
with the same mobile creates two shops. That is intentional — mobile is
unique per shop (`@@unique([shopId, mobile])`), one owner may hold several
shop tenants, and login offers a shop chooser. The register button is
already `disabled` while the request is in flight, so double-taps are
guarded client-side; the duplicate observed during QA came from the test
automation re-firing the request, not from a product defect.

### 2B — Depth gaps (queue after 2A)

- [x] **Receipt preview in printer settings** — the preview card already
      existed, but four toggles changed nothing in it: `showHsn`,
      `showGstBreakup`, `showReturnPolicy`, and the Phase 1 line
      discount/note features were absent from the sample bill, so the preview
      misrepresented what would print. Sample extracted to
      `receipt-preview-sample.ts` (testable outside the settings screen) and
      extended to exercise every toggle; 10 regression tests assert each one
      visibly changes the output. *(done 2026-07-19, verified live)*
- [x] **Bulk price/stock edit** — row checkboxes + select-all on Products, a
      floating action bar (bulk edit / print labels), and a dialog: raise or
      cut price by % or ₹ or set absolute; set/increase/decrease stock. Prices
      that would fall below a product's minimum are clamped up to it and
      counted; owner-PIN gated when any selected product has a min price. Pure
      math in `bulk-edit.ts` (11 tests). *(done 2026-07-20)*
- [ ] **Held-bill expiry hygiene** — open bills currently live forever; warn
      or auto-archive stale ones so the switcher stays usable.
- [ ] **Offline-first coverage for expenses/offers** — both are online-only
      today (noted in project-prod-readiness); a kirana counter is offline
      often enough that this matters.

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
| 2026-07-19 | Sales by Staff table + drawer count over/short history — ROADMAP COMPLETE (email receipts blocked on creds) | feat(reports): staff sales + drawer counts |
| 2026-07-19 | Phase 2 opened; notes + discount reasons + staff attribution verified live | docs(roadmap): phase 2 |
| 2026-07-19 | Receipt preview toggles fixed (4 toggles were inert) + 10 regression tests | fix(settings): receipt preview toggles |
| 2026-07-20 | Bulk price/stock edit on Products (select → edit dialog, min-price floor) | feat(products): bulk price/stock edit |
