# Shop workflow and mobile audit — 8–9 September 2026

The app has working core POS flows for all 12 configured shop types. This audit found and fixed concrete mobile, stock, balance and AI defects. It does **not** establish that every specialist shop has everything it needs or that the current checkout is ready for an unrestricted paid launch.

## Changes in this audit

- Dashboard shop actions now lead to the dedicated rental, footwear size, fitment, serial-unit, prescription, book-list, furniture, tester and manufacturing workflows. Related page titles and English/Hindi guidance were corrected.
- Six wide specialist registers now use labelled cards on small phones, with actions kept in the card and touch-sized controls. Eight specialist summary grids use two columns on phones. Closed slide panels are hidden from keyboard navigation as well as from view.
- Electronics lookup results refresh after sale, return and service actions. Returned units count as stock on the shelf and appear under the in-stock filter. Serial entry accepts letters on phone keyboards.
- Returned rentals and delivered/installed furniture orders no longer disappear from the outstanding-balance summary while money remains due.
- Furniture order creation, changes, confirmation and restoration check available stock against other confirmed orders, reject products from another shop, and use a serializable transaction with bounded retries. Bill links must refer to an active bill in the same shop. Product-name search now matches the search field's promise. These holds are currently enforced within the order register; ordinary POS/catalog sales do not yet share this reservation check.
- Opening a cosmetics tester and removing its shelf stock now commit together. An injected register-save failure rolls back stock, stock ledger and audit changes. Default tester cost uses the actual stock-movement loss, including pack conversion.
- AI tool arguments support arrays and nested validation, so multi-item bill requests are accepted correctly. Ambiguous product names require a choice instead of selecting the shortest match. Provider calls have a bounded deadline. Capabilities and nine specialist summary tools are filtered by shop type, feature and role. Storage and unresolved-product failures no longer produce a false success message.
- The AI billing queue now serializes append/read/clear operations. Failed reads cannot overwrite earlier items, failed clears cannot hand out items that remain queued, and a cancelled reader leaves the queue intact. Billing waits for its saved draft before merging AI lines. The queue transaction does not make the later cart/draft write crash-atomic.
- Opening a school book set now saves the parked sale and new draft in one transaction. Storage failures are surfaced, a full counter cannot silently evict a parked bill, and a list with no available catalogue products cannot replace the current bill. Mobile verification opened a new ₹40 set while preserving the previous ₹40 sale.
- Sync health typing and legacy conflict identity handling were corrected; unresolved conflicts still require their actual acknowledgement.

## Coverage and remaining work by shop type

Every row passed isolated SQLite tenant setup, a confirmed cash sale, durable bill ownership and stock decrement. Dedicated workflow assertions below are additional coverage, not a claim that every button or edge case has been exercised.

| Shop type | Working capabilities and workflow exercised | Important remaining scope |
| --- | --- | --- |
| Kirana | Core counter billing, inventory, purchases, customer credit, returns, batch/expiry tools and public ordering exist. Core sale tested here; earlier full-flow evidence covers credit/sync/reporting. Live AI staged two known items into billing. | Exact release build, offline restart/recovery and connected payment/hardware proof remain launch gates. |
| Clothing | Product variants, stock counts and returns exist. Rental booking → pickup → return with damage fees passed; mobile booking/pickup/return and retained unpaid balance were exercised. | Rental final collection, deposit refunds and central cash/ledger reconciliation are incomplete. Alterations are notes rather than a full job workflow. |
| Footwear | Size axes, per-size stock, size profile, search and conversion exist. API profile/conversion and a populated mobile size run with a UK 8 lookup were exercised. | No direct size-search result → selected-size bill handoff. A complete size-exchange checkout still needs an end-to-end pass. |
| Auto parts | Vehicle fitment, year ranges, OEM references and catalogue billing exist. Fitment/reference API flow and mobile vehicle lookup → part → bill were exercised. | Vehicle lookup is a separate screen; fitment selection is not embedded in the bill. |
| Electronics | Serial/IMEI receipt, bill reference, warranty lookup, returns and service status exist. Receive → sell → return → service → back passed; mobile lookup/status refresh was exercised. | No full repair-ticket workflow or atomic serial selection within ordinary billing. The serial register and financial sale must be kept consistent by the operator. |
| Pharmacy | Prescription/dispense/refill register and core batch/expiry tools exist. Synthetic OTC record → dispense with bill link passed; mobile dispense and refill availability were exercised. | Register status does not itself create a bill or move stock. Automated salt/brand substitution and specialist compliance certification are outside the verified scope. |
| Stationery/books | School/class/year book lists, copying, stock readiness and set billing exist. Create/read/copy passed; mobile set-to-bill preserved the existing sale. | Institutional bulk-order management and ISBN metadata lookup are incomplete. |
| Furniture | Quote → confirmation → advance → ready → delivery → installation passed. Overbooking, invalid product/bill links, edit/restore conflicts and retained dues were tested. | Order holds are not shared with all sales channels. Delivery does not itself create the financial sale/stock movement. Advance/refund reconciliation with central money reporting needs completion. |
| Cosmetics | Shade/variant stock, expiry and tester register exist. Tester opening removes stock, then close/discard persists. Failure rollback is tested. | Tester requests lack a persistent request ID across retries; a repeated request can open a second tester. Replacement requires explicitly opening the new tester. |
| Restaurant | Tables, menu, KOT, recipes and QR ordering exist. Table → KOT → preparing → ready → served passed. | This pass does not certify every guest-order/payment/table-settlement path. Physical kitchen/receipt output and payment settlement remain unverified. |
| Manufacturing | BOM, production run, raw-material consumption, finished batch, QC and traceability exist in the API. A run consumed 12 raw units and produced 10 finished units; QC/trace records persisted. | **The current frontend shows recent runs but does not expose run creation/completion/release. This blocks a complete factory workflow through the UI.** Dispatch, wholesale invoicing, returns and export-document workflows also need a combined end-to-end pass. |
| Other/custom | Configurable core products, units, inventory, billing, customers and purchasing. Tenant setup and sale passed. | This is a configurable retail baseline, not complete support for every possible industry. |

Specialist registers still contain English-only copy and some form labels need accessibility work. Core translation checks passing does not certify complete specialist Hindi coverage.

## Verification

| Check | Result | Local log |
| --- | --- | --- |
| Twelve shop workflows plus stock integrity | **14 passed, 0 skipped** | `output/shop-audit-stock-integrity-final.log` |
| AI queue safety | **6 passed** | `output/shop-audit-staging-final.log` |
| AI and book-set handoff failures | **10 passed**: concurrent queues, cancelled reads, storage rollback, full-counter protection and missing catalogue products | `output/shop-audit-handoff-final.log` |
| Final frontend production gate | Typecheck, 5,782 translation keys, **2,422 passed / 1 skipped**, production build, bundle and app checks passed | `output/shop-audit-production-final.log` |
| Vertical baseline examples | 11 isolated example files passed | `output/shop-audit-vertical-baseline-isolated.log` |
| AI, stock, vertical and architecture regression | 10 isolated example files passed | `output/shop-audit-final-regression.log` |
| Payment software | Six isolated example files passed: credential encryption, retail integrity, dynamic QR contracts, provider connections, QR decoding and gift-card reversal | `output/shop-audit-payment-isolated.log` |

Failure-injection tests intentionally produce Prisma errors before checking rollback; the test result, rather than the presence of an injected error in a log, determines their outcome. The cosmetics failure trigger is SQLite-specific and is not PostgreSQL evidence.

The audit used disposable test databases for automated tests and dedicated `QA … Workflow` shops for live checks. It did not reset the live development database, make real charges, deploy the app or create commits. Other edits were being made in the shared checkout during the audit; these counts describe the tested working tree, not a signed release artifact.

## External and release limits

- **PostgreSQL:** the read-only connection retry failed password authentication. Migration execution, concurrent writes and an actual dump/restore cycle have not passed against PostgreSQL.
- **Printer:** the user has no printer. Receipt preview/software and simulated adapters can be tested; physical output, cutter and drawer behavior remain unverified. No additional printer connection is requested by this report.
- **Payments:** no Razorpay server credentials/sandbox were configured for a real provider round trip. Passing fixtures and QR decoding do not prove merchant settlement or a terminal transaction.
- **AI:** live provider use was exercised for catalogue-to-cart assistance, while most edge cases use deterministic tests. The nine new specialist tools provide summaries; they do not automate every trade operation. A crash between queue consumption and cart persistence can still lose the handoff.
- **Release:** repeat the critical flows on the exact production candidate, including clean installation, device restart while offline, recovery and external integrations. Earlier export/audit and release limitations remain in [the prior readiness report](../full-flow-audit-2026-09-07/readiness/README.md).

## Browser evidence

Evidence is a mixture of live DOM observations and viewport screenshots, not a browser automation certification for all 12 trades. Screenshots of loading screens or the More menu are not counted as proof of their originally intended flow. The mobile images listed in the final addendum were visually inspected before inclusion.

### Final live check addendum — 9 September

- Pharmacy: synthetic OTC entry moved to dispensed; repeat availability and counters updated. After the shared panel fix, the closed prescription form disappeared from the accessible page state.
- Stationery: a two-item-quantity set opened a ₹40 draft. Opening another set after the atomic-save fix preserved the first bill; two open bills and the new ₹40 total were visible.
- Furniture: confirmed → ready → delivered. Open count became zero while **₹80 still to collect** remained, and the delivered card retained its payment action.
- Cosmetics: discard removed the tester from active count and counter value while monthly cost remained **₹10**.
- Restaurant: synthetic ticket moved through cooking → ready → served; it appeared in the Served rail after restart. This was a register-only ticket, not a settled customer order.
- Manufacturing: the populated BOM card fits at the observed **375px page width**; table and table container both measured **337px**, with no horizontal overflow. The planned run was visible with no create/complete/release control, confirming the UI gap above.

Visually inspected images that support these checks:

| Image | What it shows |
| --- | --- |
| [Footwear](footwear-390.png) | UK 8 lookup, 10 pairs available and 20 pairs total |
| [Auto-parts bill](auto-parts-bill-390.png) | Found part transferred to a ₹20 bill |
| [Electronics](electronics-390.png) | Service status and the Back action in a phone card |
| [Pharmacy](pharmacy-390.png) | Compact statistics/filter controls and the prescription card |
| [School list](stationery-390.png) | Complete set, price and Put on a bill action |
| [Furniture](furniture-390.png) | Delivered order and retained ₹80 due |
| [Cosmetics](cosmetics-390.png) | Discarded tester with retained ₹10 cost |
| [Kitchen](restaurant-kitchen-390.png) | Completed ticket in the Served rail |
| [Manufacturing](manufacturing-mobile.png) | BOM card fitting the phone viewport |

`ai-cart.txt`, `stationery-billing.txt`, `furniture.txt`, `cosmetics.txt`, `restaurant-kitchen.txt` and `manufacturing.txt` contain additional live DOM observations. `ai-cart-390.png`, `auto-parts-390.png` and `clothing-cards-after-390.png` are excluded from proof: they captured a menu or an unsettled/loading screen. The earlier clothing booking/return and 390px card measurements were observed live, but this folder does not contain a reliable final clothing screenshot.

The final shared table selector was included in a fresh production build on 9 September (`output/shop-audit-build-2026-09-09.log`). The full 2,422-test production gate above passed on 8 September; unrelated lock/security changes continued in the shared checkout afterwards, so it should not be represented as certification of all subsequent edits.

### Priorities before selling specialist editions

1. Complete the factory run UI and verify raw lots, actual consumption, QC hold/release and finished output through it.
2. Connect rental and furniture collections/advances/refunds to the central financial ledger, and enforce furniture holds across all sale channels.
3. Integrate serial-unit selection with electronics billing and add repair tickets if repair shops are a target market.
4. Add durable request IDs to retryable specialist stock actions, and make AI queue consumption and draft persistence one recoverable handoff.
5. Finish the external and exact-release checks above, followed by merchant trials for the selected shop types. Specialist requirements should be agreed with those merchants; this matrix is not an exhaustive industry specification.
