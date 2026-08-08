# KiranaOS — Claude Code Prompt Pack

Nine prompts, in dependency order. Each is self-contained and copy-pasteable.

**How to use this:** one prompt per Claude Code session. Let it finish, run the
tests, review the diff, commit, then start the next. Do not paste two at once —
these touch billing, money and sync paths, and a large mixed diff is how a P0
gets in.

**Prompts 1–4 are the ones that decide whether a stranger buys.** 5–9 matter but
can wait. If you only do four, do the first four.

---

## Prompt 1 — Ship the starter catalog as a one-tap built-in

```text
Make the kirana starter catalog a built-in first-run action, not a file the
shopkeeper has to find.

Context: catalog/kirana-starter-catalog.csv holds 560 curated kirana products
(names, Hindi + Hinglish aliases, category, pack size, unit, HSN, GST 2.0 slab,
starting MRP/cost/selling, 48 loose per-kg items). Its header row already matches
PRODUCT_IMPORT_COLUMNS in
frontend/src/features/core/products/import/product-import-csv.ts exactly, so the
existing importer parses it today with no mapping work. catalog/README.md explains
the data. catalog/verify_catalog.py validates it against the app's real rules.

Build:

1. Bundle the catalog as a typed module, not a runtime file read. Add a build step
   (frontend/scripts/) that converts the CSV into
   frontend/src/features/core/products/starter-catalog/kirana-catalog.generated.ts
   exporting a frozen StarterCatalogItem[]. Commit the generated file. Add an npm
   script `catalog:generate` and a test that fails if the generated file is stale
   relative to the CSV.

2. Code-split it. 560 rows must NOT enter the startup bundle — a counter that
   never opens setup should never download it. Load it dynamically only when the
   shopkeeper triggers the action. The existing bundle budget check
   (`npm run security:check`) must still pass; report the before/after startup
   size in your summary.

3. Add a "products" step action in the merchant setup flow
   (frontend/src/features/core/settings/pages/MerchantSetupPage.tsx and
   merchant-setup-state.ts): "Load 560 common kirana items — you can delete what
   you don't sell." Show it only when the shop's businessType is `kirana` and the
   product count is 0. Reuse the existing import pipeline
   (product-import-csv.ts + the products create path) — do NOT write a second
   product-creation route. Honour the existing "skip-existing" strategy.

4. Show progress and make it cancellable. 560 creates is not instant. Show
   "Adding 240 of 560…", let the user cancel, and leave already-created products
   in place on cancel (no partial rollback — a half-loaded catalog is fine, a
   corrupted one is not).

5. Make it idempotent and offline-safe. Run it twice: the second run must create
   0 duplicates. Run it offline: products must queue through the normal outbox and
   sync exactly once, with no duplicate on the server. Reuse the existing
   clientProductId / idempotencyKey mechanism — do not invent a new one.

6. After it completes, route the shopkeeper to Products with a filter hint so he
   can bulk-delete categories he doesn't stock.

Tests (required):
- generated file matches the CSV (staleness guard)
- import of the full catalog creates 560 products, 48 with isLooseItem true
- re-running creates 0 duplicates
- offline load then sync produces 560 server products, not 1120
- units in the generated data are all members of UNITS in
  frontend/src/features/core/products/pages/product-pricing.ts

Constraints: do not change the CSV schema, the importer's column contract, the
money helpers, or the sync engine. Run `npm run typecheck`, `npm run test` and
`npm run build` in frontend/ and report results.
```

---

## Prompt 2 — Barcode capture-on-first-scan

```text
Let the product catalog learn barcodes by being used, instead of requiring a
shopkeeper to type them in.

Why: catalog/kirana-starter-catalog.csv deliberately ships with every barcode
blank — real EAN-13 codes for specific SKUs cannot be invented, and a wrong
barcode silently bills the wrong item. The correct design is capture-on-first-scan.

Build, in frontend/src/features/core/billing/pages/components/BillingSearch.tsx
and the billing scan path:

1. When a scanned code matches no product, do not just show "not found". Show a
   bottom sheet: "New barcode 890…. Which item is this?" with the normal product
   search box beneath it. Picking a product binds the code to that product's
   barcode field and adds it to the cart in the same action.

2. Offer "Create new product" in the same sheet, pre-filled with the scanned
   barcode, for genuinely new stock.

3. Binding rules — these are correctness, not polish:
   - A barcode must be unique per shop. If the code is already bound to a
     different product, refuse and say which product owns it. Add a DB-level
     guard, not just a UI check.
   - Never rebind a barcode that already points somewhere. Rebinding is an
     explicit, separate action from the product edit screen.
   - Binding must work offline and sync through the existing outbox exactly once.
     A bind that races with another device must resolve deterministically through
     the existing conflict path — add it to the conflict matrix rather than
     inventing a new resolution rule.

4. Keep it fast. The sheet must appear within one frame of the scan and be
   dismissable with one tap. A cashier with a queue must never be blocked: "Skip"
   adds the item by search without binding anything.

5. Log each bind to the existing audit trail with device and user.

Tests (required):
- unknown scan opens the sheet; picking a product binds + adds to cart in one step
- duplicate barcode across two products is rejected at the service layer
- offline bind syncs once and does not duplicate on replay
- concurrent binds from two devices resolve without data loss
- skip path adds the item and binds nothing

Constraints: do not change the bill, payment or stock models. Do not slow the
scan-to-cart path. Run backend `npm test`, the sync integration suite, and
frontend `npm run typecheck && npm run test`.
```

---

## Prompt 3 — Finish Hindi to 100% and default to it

```text
Make Hindi complete and make it the default, so no shopkeeper ever hits an
English string mid-bill.

Current state: frontend/src/features/core/settings/i18n.tsx composes English from
translations/{shell,billing,products,customers}.ts with Hindi counterparts in the
matching .hi.ts files, lazily loaded. Hindi is typed against English so a missing
key is a build failure — but only for those four modules. Everything else is
English-only.

Build:

1. Extend the dictionary to every screen a shopkeeper touches daily, in this
   order: billing (done — audit it), udhar/customer ledger, payments and
   checkout, bills history, daily closing, inventory and stock, purchases and
   suppliers, reports, settings, sync status, and every error/toast/confirm on
   those paths. Errors matter most — an English error is where trust dies.

2. Extend frontend/src/tests/i18n-dictionary-completeness.test.ts so a missing or
   empty Hindi string in ANY registered module fails the build. Also fail on a
   Hindi value identical to its English value, which is how untranslated strings
   hide.

3. Add a lint/test that fails on hardcoded user-visible strings in the modules
   above — no bare text in JSX, no bare string in a toast or thrown user-facing
   message. Grandfather the rest of the app with an explicit allowlist so this is
   enforceable today, and shrink the allowlist over time.

4. Default the UI language to Hindi for new shops, with a one-tap switch to
   English in settings and on the login screen. Keep the existing lazy-load: a
   Hindi shop must not watch the billing screen swap languages on first render.

5. Use the words shopkeepers actually use, not literal translations. udhar not
   ऋण, बिल not चालान, स्टॉक not भंडार. Where the Hinglish term is what's spoken,
   use it in Devanagari.

6. Check layout at 375, 390, 430 and 768 px. Devanagari runs longer than English
   and will overflow buttons. Zero horizontal overflow, no sub-44px control, no
   clipped label.

Tests (required):
- completeness test fails on a deliberately removed Hindi key
- completeness test fails on a Hindi value equal to English
- hardcoded-string check fails on a deliberately added bare JSX string
- new shop defaults to Hindi; switching to English persists across reload
- the four target widths pass with zero overflow on billing, udhar and checkout

Constraints: do not increase the startup bundle — Hindi stays lazily loaded.
Run `npm run typecheck && npm run test && npm run build && npm run security:check`.
```

---

## Prompt 4 — Close SYNC-005: prove backup and restore

```text
Close SYNC-005 in RELEASE_GATE.md with real evidence. This is the gate before any
stranger's shop data goes into this system — losing a shopkeeper's udhar ledger
ends the business in one day.

Current state: RELEASE_GATE.md lists "Backup restore proof and rollback rehearsal
(SYNC-005)" as Not verified. backend/src/modules/backups/ exists and
backend/src/workers/backup.worker.js runs. There is no proof a backup can be
restored.

Build:

1. A restore path that is actually exercised, not just a backup path. If restore
   is missing, build it. It must reconstruct a shop's full state: products,
   bills, bill items, payments, udhar ledger, stock ledger, inventory lots,
   suppliers, purchases, customers, audit log.

2. An automated drill, runnable as `npm run backup:drill`, that:
   - seeds a shop with a realistic year of activity (reuse
     backend/scripts/year-sim/ if it fits)
   - takes a backup
   - destroys the database
   - restores from the backup
   - reconciles the restored state against the pre-backup state at EXACT integer
     paise and exact stock units: total sales, per-tender totals, every customer's
     udhar balance, every product's stock, every supplier's due, GST totals, and
     row counts per table
   - fails loudly on any variance, printing the first differing record

3. Corruption and partial-failure handling: a truncated or tampered backup
   artifact must be rejected before any data is written, not halfway through.
   Restore must be atomic — on failure the existing database is untouched.

4. A restore that does not break sync. After restore, devices must reconcile
   without duplicating bills or replaying the outbox. Prove it with a
   two-device test: restore the server, then let a device with pending local
   writes reconnect. Zero duplicates, zero lost writes.

5. A written runbook at backend/ops/restore-runbook.md: exact commands, expected
   output, how long it takes, who to call, and what to tell the shopkeeper while
   it runs.

6. Update RELEASE_GATE.md SYNC-005 with the drill output and date, and update
   BUG_BACKLOG.md. Do not mark it Verified unless the drill actually passes.

Tests (required):
- full drill passes with 0 paise and 0 unit variance
- deliberately corrupted artifact is rejected with the database untouched
- restore + reconnecting device produces no duplicate bills
- a deliberately introduced 1-paise drift is detected and fails the drill

Constraints: do not weaken any existing reconciliation check to make this pass.
If the numbers don't reconcile, report the discrepancy — do not adjust the
tolerance. Run backend `npm test` and the integration suite.
```

---

## Prompt 5 — Hide the non-kirana verticals behind a flag

```text
Reduce the shipped surface to the one trade that has a customer.

Current state: backend/src/verticals/ registers 11 business profiles (kirana,
clothing, footwear, auto-parts, electronics, pharmacy, stationery-books,
furniture-home, beauty-cosmetics, restaurant, custom) via registry.js. The schema
carries RentalBooking, Prescription, RestaurantTable, DishRecipeComponent,
FootwearSizeProfile, PartFitment and more. Zero of these has a paying user, and
every one is support surface and test surface you are paying for.

Build:

1. A single build-time flag (env, default off) that controls which business types
   are offered at signup and in settings. With it off, only `kirana` and `custom`
   appear. Do not delete the code — flag it.

2. Existing shops on a hidden business type must keep working exactly as they do
   now. The flag governs what is OFFERED, never what is HONOURED. Prove this with
   a test: a shop with businessType `restaurant` still resolves its profile,
   navigation and capabilities when the flag is off.

3. Trim the shipped frontend. Vertical-specific routes and pages under
   frontend/src/features/verticals/ must not enter the startup bundle for a
   kirana shop. Report the startup bundle size before and after.

4. Remove hotel-demo/ and hotel-pitch/ from the repo (they are unrelated
   prototypes), or move them to a clearly separate archive directory excluded
   from build, test, lint and CI.

5. Do NOT drop any database tables or write a destructive migration. Hiding is
   reversible; dropping is not.

6. Update SHOP_TYPE_WORKFLOWS.md and PRODUCT_REQUIREMENTS.md to state which
   verticals are shipped and which are dormant behind the flag.

Tests (required):
- with the flag off, signup offers only kirana and custom
- an existing restaurant shop resolves profile/navigation/capabilities unchanged
- kirana startup bundle excludes vertical-specific chunks
- full backend and frontend suites still pass with the flag off AND on

Constraints: no destructive migrations, no deleted vertical source. Run the full
backend and frontend suites in both flag states.
```

---

## Prompt 6 — One-tap WhatsApp bill send

```text
Make "send this bill on WhatsApp" a one-tap action that visibly works. This is
the feature kirana shopkeepers ask for by name.

Current state: backend/src/modules/reminders/whatsapp.provider.js and the
reminder worker exist; whatsapp_reminders is gated to the `pro` plan in
backend/src/modules/subscription/planConfig.js. The bill screen
(frontend/src/features/core/bills/pages/BillDetailPage.tsx and
billing/pages/components/BillingSummary.tsx) has share actions, but RELEASE_GATE.md
records that no external WhatsApp message has ever been sent.

Build:

1. A primary "WhatsApp" button on the bill screen and on the post-checkout
   screen, next to Print. One tap from finishing a sale.

2. Two delivery paths, both supported:
   - wa.me deep link with a prefilled message and the bill as a shareable file
     or short link. Works with zero setup, zero cost, on any phone. This is the
     default.
   - the existing WhatsApp Business API provider, for shops that configure it.
   Pick automatically based on configuration; never make the shopkeeper choose.

3. The message is Hindi-first and readable in the notification preview: shop
   name, bill number, total, and previous udhar balance if any. Respect the
   existing GST/previous-udhar toggle already implemented for the receipt.

4. Move basic bill sharing OFF the `pro` plan. A Starter shop that cannot send a
   bill on WhatsApp will not renew. Keep bulk automated reminders as the paid
   feature; single-bill send is table stakes. Update planConfig.js accordingly
   and note the change in the plan docs.

5. Record delivery state on the bill: not sent / opened share sheet / sent via
   API / failed. Never claim "sent" for a deep link the user may have abandoned —
   say "opened in WhatsApp".

6. Works offline: queue the intent, send on reconnect, exactly once.

Tests (required):
- one tap from a completed bill produces a correctly formatted Hindi message
- previous-udhar line appears only when a balance exists and matches the ledger
  to the paise
- a Starter-plan shop can send a single bill
- offline send queues and delivers exactly once on reconnect
- delivery state never shows "sent" for an unconfirmed deep link

Constraints: do not change bill immutability or the financial ledger. No customer
phone number in logs. Run backend `npm test` and frontend `npm run test`.
```

---

## Prompt 7 — Udhar khata as a one-tap home screen

```text
Give the shopkeeper his udhar book in one tap. Who owes what is the single thing
he thinks about most, and Khatabook built a company on only this.

Build a dedicated udhar screen, reachable from the first tap of the home screen
(not buried under Customers):

1. Default view: every customer with an outstanding balance, largest first. Per
   row — name, amount owed, days since last payment, and a WhatsApp reminder
   button. Nothing else.

2. Header: total outstanding, count of customers, and how much came in today.
   Those three numbers, large, readable across a counter.

3. Row tap opens the customer's ledger: every debit and credit, running balance,
   and "Record payment" as the primary action. Recording a payment must go
   through the existing udhar ledger path — do not write a second money path.

4. Sort and filter: by amount, by oldest unpaid, by name. Search by name or
   phone. Aliases and Hindi spellings must match, same as product search.

5. Everything works offline and reconciles exactly. A payment recorded offline
   must reach the server once, and the displayed balance must equal the ledger's
   computed balance to the paise at all times — never a cached or denormalised
   number that can drift.

6. Hindi-first, following Prompt 3. Use the word udhar (उधार), not ऋण.

7. Phone-first: 375/390/430/768 px, zero horizontal overflow, no sub-44px
   control, reachable primary actions.

Tests (required):
- displayed balance equals the ledger's computed balance for every customer,
  including after a cancellation and a partial payment
- offline payment syncs exactly once, no duplicate ledger entry
- reminder button sends the right amount for the right customer
- search matches Hindi and Hinglish spellings
- four widths pass with zero overflow

Constraints: do not add a denormalised balance column that can drift from the
ledger. Do not change the udhar ledger schema or the cancellation reversal path.
Run backend `npm test`, the billing/cancellation suites, and frontend tests.
```

---

## Prompt 8 — One-click hardware bridge installer

```text
Remove PowerShell from the shopkeeper's life.

Current state: hardware-bridge/ is set up by exporting KIRANA_BRIDGE_TOKEN,
KIRANA_BRIDGE_ALLOWED_ORIGINS, KIRANA_BRIDGE_PRINTER_TRANSPORT and
KIRANA_BRIDGE_PRINTER_NAME, then running `npm start`. No shopkeeper can do this.
BUG-005 in BUG_BACKLOG.md is open: real printer failure/retry certification is
unproven.

Build:

1. A signed Windows installer (.exe or .msi) that installs the bridge, registers
   it as a Windows service set to auto-start, and needs no terminal.

2. A single setup window on first run: detect installed printers and list them,
   let the user pick one, generate the token itself, and show a 6-character
   pairing code. In KiranaOS Printer Settings the shopkeeper types that code and
   they are paired. No copy-pasting a 32-character token.

3. A "Test print" button in that window that prints a real receipt and reports
   success or a plain-language failure ("Printer is off or out of paper"), never
   a stack trace or an error code.

4. Keep every existing security property: bind to 127.0.0.1 only, per-device
   bearer token, explicit origin allowlist, request size and time limits, no
   remote bridge URL accepted from the frontend. The pairing code must be
   short-lived and single-use.

5. Auto-update, or at minimum a visible version and an "update available" notice.
   You cannot drive to 40 shops to patch a printer bridge.

6. Certify exactly TWO printer models — the ones you will actually resell. For
   each, test and retain artifacts for: normal print, paper-out mid-print,
   cable/network disconnect mid-print, printer powered off, retry after each
   failure, duplicate-print guard, and cash-drawer kick. Write the results into a
   per-model matrix in hardware-bridge/README.md. Ignore every other model.

7. Update BUG-005 in BUG_BACKLOG.md with the evidence, and close it only for
   those two models — say so explicitly.

Tests (required):
- fresh install on a clean Windows machine reaches a successful test print with
  no terminal use
- pairing code expires and cannot be reused
- each failure case above recovers without duplicating a receipt
- print journal survives a service restart mid-job (existing behaviour must not
  regress)

Constraints: do not weaken the bridge's origin, token or binding rules for
convenience. Run hardware-bridge tests.
```

---

## Prompt 9 — Re-price around the bundle

```text
Restructure pricing so the software is sold as part of a serviced bundle, not as
a standalone subscription competing on price with Vyapar.

Why: backend/src/modules/subscription/planConfig.js currently prices Starter at
₹349/month (₹2,999/year), Growth ₹599 (₹4,999), Business ₹999 (₹8,999). Vyapar
starts around ₹699/year and myBillBook Silver is ₹33/month. Starter is roughly 4x
the market entry price from a brand with no ads and no app-store presence. Verify
both competitors' current pricing on their own sites before implementing, and put
the dated figures in the commit message.

Build:

1. Re-price Starter to sit credibly against the market entry point. Keep Growth
   and Business where the added value is real and demonstrable (multi-device,
   staff, multi-store).

2. Add a first-year onboarding SKU: a one-time setup fee, separate from the
   subscription, recorded against the shop. This is the line item that carries
   in-person installation, catalog entry and training — the thing the incumbents
   cannot sell.

3. Add a founding-customer path: software free for 12 months, applied per shop by
   an owner/admin, with an explicit end date and a visible countdown in the app.
   It must expire cleanly into a paid plan without losing data or blocking
   billing. Reuse the existing subscription grace-period logic — do not add a
   second expiry mechanism.

4. Every existing shop, including your father's, must keep its current plan and
   price. Grandfather explicitly and test it. Never silently re-price a live shop.

5. Renewal must never brick the shop. On expiry, degrade to read-only-plus-billing
   — the shopkeeper can always finish the sale in front of him and always export
   his data. Losing access to your own udhar ledger because a payment failed is
   how a business dies and a reputation with it.

6. Update the plan comparison in the app and in the docs to describe the bundle
   (setup + hardware + support + software), never the software price alone.

Tests (required):
- existing subscriptions keep their original price and feature set after the change
- founding-customer free period expires into the intended paid plan with no data loss
- an expired subscription can still complete a sale and export data
- the existing subscription grace-period tests still pass unchanged

Constraints: do not change the payment provider integration or the financial
ledger. Do not remove any feature from a plan a live shop is currently on. Run
backend `npm test` and the subscription integration suite.
```

---

## After each prompt

Before you commit, check:

- [ ] `cd backend && npm test` passes
- [ ] `cd frontend && npm run typecheck && npm run test && npm run build` passes
- [ ] `cd frontend && npm run security:check` passes (bundle budgets)
- [ ] Integration suite passes for anything touching money, stock or sync
- [ ] BUG_BACKLOG.md and RELEASE_GATE.md updated if the change closes or opens an item
- [ ] The diff does one thing

And the rule that matters more than any of this: **after prompts 1–4, stop
building and go to a shop.** The backlog is not what's blocking you.
