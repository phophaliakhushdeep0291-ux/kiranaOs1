# Design: QR customer self-order (offline-capable)

Status: **Design for review — not built.** Phase 2 of the billing work (Phase 1 = multiple
open bills, shipped). This doc is the spike output: a concrete, buildable design plus the
decisions still open.

## Goal

A customer browses the shop's products on **their own phone**, selects what they want, and
that list reaches the owner's billing screen **without the owner typing it in**. The owner
fulfils the items and confirms the bill. It should work **even with no internet at the
counter**, in keeping with the app's offline-first design.

## Constraints discovered (why the obvious approaches don't fit)

- **No npm packages can be added** in this environment (the installer is broken). So we cannot
  `npm i` a QR library. → We **vendor a single self-contained public-domain QR encoder source
  file** into the repo instead (e.g. Nayuki's QR-Code-generator, MIT/public-domain, one file).
  This is just source code we add — no installer involved.
- **No live server push** (`useRealtimeRefreshBridge` is local BroadcastChannel only) and the
  owner's device may itself be offline. → A "customer posts to backend, owner polls" transport
  fails whenever the counter is offline, so it's not the primary path.
- An **in-app camera QR *decoder*** (owner scanning) is the genuinely hard piece to build
  without a library (image processing + error correction). → We **avoid it entirely** (below).

## Chosen architecture: QR deep-link + the phone's native camera

The data travels *inside* the QR, and the owner uses their phone's **normal camera app** to scan
— not an in-app scanner.

1. Owner shows a small static **"Order here" QR** (encodes the customer order-page URL for this
   shop, e.g. `https://<app>/order/<shopCode>`). Printable / always on screen.
2. Customer opens it → the **customer order page** (a public route in the same PWA). They browse
   the cached catalog and build a cart **offline**.
3. The customer page renders a **result QR** that encodes a deep link:
   `https://<app>/import-order#o=<compact-cart>` — the cart data is in the URL fragment.
4. Owner scans that QR with the **native camera** → the phone opens KiranaOS at `/import-order`
   → the app reads the cart from the URL fragment (no network), creates a new **open bill**
   (reusing the Phase-1 held-bill/open-bills machinery), and the owner reviews + **confirms**.

Why this works offline: the cart is carried by the QR itself; the owner's PWA is installed/
cached; nothing is fetched at scan time. No backend, no in-app decoder.

## Components & where they plug in

- **Vendored QR encoder** — `frontend/src/lib/qr/qr-encoder.ts` (single-file source, byte mode,
  with a thin `toSvg()`/`toCanvas()` wrapper). Only the *encoder* is needed.
- **Customer order page** — new public route `/order/:shopCode` (add to `app/routes.tsx` as a
  PublicRoute-style, no auth). Lists the cached catalog (name + **selling price only**), a
  quantity stepper, a running total, and a "Show my order" button that renders the result QR.
  Reuses product display helpers (`fromBaseQty`, `productDisplayUnit`).
- **Catalog cache for customers** — the order page fetches a **customer-safe catalog**
  (id, name, unit, sellingPrice, image — **never cost/margin**) once while online and caches it
  (IndexedDB) keyed by shopCode, so it reopens offline.
- **Import route** — new `/import-order` route (auth required) that parses `location.hash`,
  decodes the cart, maps product ids to the owner's local catalog, and calls into BillingPage to
  open a new bill pre-filled with those lines (extend `open-bills.ts` with a
  `billFromImportedCart()` builder; load it via the existing `loadBillIntoActive`).
- **Owner "Order here" QR** — surfaced on the billing screen + printable from Settings.

## Cart encoding (the format in the QR)

- Payload = list of `{ productId, qty }`. Serialize compactly (e.g. `id:qty` joined by `;`),
  then base64url into the `#o=` fragment. Include a 1-char version tag + the shopCode for safety.
- **Capacity**: a byte-mode QR holds ~1–2 KB comfortably at a scannable density. A typical order
  (5–20 lines) fits in one QR. For very large carts, **split into multiple QRs** ("1/2", "2/2")
  the owner scans in turn — rare; can be a v2 refinement.
- **Id strategy decision (open):** raw server ids (CUIDs ~25 chars each) are robust but bulky.
  Alternatives: use `barcode`/`sku` when present, or a short per-catalog index agreed between the
  cached catalog and the owner. Recommendation: start with productId + multi-QR fallback; optimize
  only if real orders overflow.

## Trust / security model

- The customer page is **public and read-only** and the imported cart is only a **suggestion** —
  the owner reviews and confirms, which is what actually creates the bill / touches stock. So
  there's no money/stock risk from a malicious cart.
- The **customer catalog must exclude cost price and margin** — expose only name, unit, selling
  price, image. (Needs a dedicated customer-catalog shape, not the full product record.)
- Unknown/blocked product ids on import are skipped with a clear notice.

## Limitations (state these to the user)

- **First-time catalog needs one online load**: a brand-new customer phone with zero internet
  can't load the order page/catalog. After one online open it works offline. (A small shop could
  alternatively encode a compact catalog in the "Order here" QR — only viable for tiny catalogs.)
- The owner scans with the **native camera** (one tap from most lock screens) — acceptable, and
  avoids building a scanner. If a fully in-app scan is later required, that's a separate decoder
  project.
- Prices on the customer page are a **snapshot** from the last cache; the owner's confirm uses
  live prices, so the final bill is always correct.

## Phased build plan

1. **QR encoder**: vendor the single-file encoder + `toSvg` wrapper; unit-test against known
   vectors; render a sample QR. (De-risks the riskiest piece first.)
2. **Cart codec**: `encodeCart()` / `decodeCart()` pure module + unit tests (round-trip, version,
   capacity guard, multi-QR split).
3. **Customer order page** (`/order/:shopCode`) + customer-catalog fetch/cache (cost excluded).
4. **Import route** (`/import-order`) → new open bill via `open-bills.ts`; owner review + confirm.
5. **Owner "Order here" QR** on billing + printable.
6. Polish: multi-QR for large carts, empty/error states, abuse guards.

Backend: only a small **customer-safe catalog read** may be needed (or reuse `/products`
filtered to safe fields). No order-storage endpoint is required for the offline path.

## Verification

- Unit tests: QR encoder vectors; cart codec round-trip + capacity.
- Manual/E2E: open `/order/<shop>` on a phone, build a cart, render QR; scan with another phone's
  camera → confirm KiranaOS opens `/import-order` and a matching open bill appears; airplane-mode
  both devices (after one online catalog load) and repeat to prove the offline path; confirm the
  bill and check totals/stock.

## Open decisions for you

1. **Id encoding**: productId + multi-QR fallback (simple, robust) vs a compact short-index
   (smaller QR, more moving parts). Recommend starting simple.
2. **Catalog offline bootstrap**: accept the "one online load to cache" caveat (recommended), or
   invest in encoding a compact catalog inside the owner's QR (tiny catalogs only)?
3. **Scope of v1**: single-QR carts only (cap ~20–30 lines) for the first version, with multi-QR
   as a fast-follow?
