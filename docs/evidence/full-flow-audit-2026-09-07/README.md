# Full-flow audit — 7 September 2026

Local working-tree audit of Artha/KiranaOS, with emphasis on a 390×844 phone. This is not production certification or a claim that every feature has been used. The existing [release gate](../../../RELEASE_GATE.md) remains NO-GO pending candidate, external, and manual evidence.

## Readiness follow-up — 8 September 2026

The customer persistence, supplier settlement, and standard file-export fixes have now been implemented and tested. See [readiness verification](readiness/README.md) for current results and remaining external checks. The original findings below are retained as the audit history.

## Transaction flows exercised

All new business records belong to the dedicated **Full Flow Audit Shop** QA tenant. No real customer messages, external payments, public catalog publishing, or physical printing were performed.

| Flow | Exercise and result |
| --- | --- |
| Registration and setup | Required-field validation; new Kirana shop; owner PIN; profile save and reload. The phone persisted; browser text snapshots omitted the value, but the screenshot and database confirmed it. |
| Product creation | QA Soap: cost ₹30, sell ₹50, opening 20 pieces. Owner approval and server sync completed. |
| Cash sale | Two pieces, ₹100 bill; ₹200 tender showed ₹100 change. One server bill and payment. |
| Customer return | One resellable piece, ₹50 refund, owner approval, stock restored. Return item count corrected from duplicate local/server children to one. |
| Udhar sale | Walk-in credit was blocked. Selected a named customer, switched back to walk-in and back again, saved ₹50 credit bill. |
| Collection | Recorded ₹20 cash against the customer. Customer outstanding is ₹30. |
| Supplier and purchase | Created QA Wholesale; received five pieces for ₹150 on credit; paid ₹75 cash. Remaining supplier due ₹75. |
| Inventory | One product displayed after sync; final stock 23 = 20 − 2 + 1 − 1 + 5. Movement history no longer repeats optimistic sale/return entries. |
| Expenses | Empty form validation; ₹10 paid cash expense, QA packing bags. Saved and reflected in cash totals. |
| Money statement | Five movements: ₹100 sale + ₹20 collection − ₹50 refund − ₹75 supplier payment − ₹10 expense = **−₹15**. Pending expenses are excluded by regression test. |
| Daily closing | ₹100 opening float gives expected ₹85; counted ₹85, saved an exact close. Net units sold 2, net product revenue ₹100. |
| Stock count | Started a named blind count; counted 23; saved, submitted, reviewed zero variance, approved with owner PIN and audit note; status Applied. |
| Sync review | Inspected a product conflict created during purchase sync; selected the verified cloud record. The review cleared. |
| Local export | Download action succeeded. Inspected the exported QA data to trace sync identities. The export covers selected tables and is now labeled “Export local records”; it is not a complete restore artifact. |
| Subscription | Verified Business ₹599/month consistently in the Kirana plan badge and plan details. |
| Counter lock | A fresh tab locked correctly; reloading retained the lock; an incorrect PIN was rejected; the correct PIN unlocked it. Before/after snapshots retained. |
| Offers | Tested ₹500 subtotal with no active offers; correctly returned no applicable offer. |

## Fixes delivered during this audit

- Inventory product identity merging now recognizes durable local/server aliases. Pending edits retain precedence while authoritative inventory supplies synced stock.
- Sale/return stock movement echoes reconcile by exact bill, product, action, and matching quantity.
- Billing customer selection remains available after choosing a named customer.
- Cash statements retain refunds, classify supplier payments as outflows, avoid counting the purchase aggregate a second time, and exclude unpaid expenses.
- Daily closing recognizes server ledger identities when matching collections to payments. Product summaries use complete bill snapshots and subtract returned quantities and costs.
- Sync collection responses use the unique ledger ID, not a customer ID shared by all their payments. The frontend handles older response envelopes as well. A backend integration test verifies two same-amount collections remain distinct and retry idempotently.
- A locked counter persists its lock across a same-tab reload; authentication or successful unlock clears it.
- Verification document contents and metadata are excluded from the settings sync payload. The UI explicitly states that verification is not available.
- Purchase form fields have accessible names, including product, quantity, and unit cost.
- Shop plan names and prices are consistent; Manage Plan opens Subscription.
- Cash summary cards use a compact two-column phone layout. Negative balances retain their sign, paise are preserved, and fabricated sparklines have been removed.
- Setup says “First sale,” and cost-based pricing says “Markup on cost.” English/Hindi wording is maintained for translated controls.

## Remaining work before calling the product finished

| Priority | Finding | Evidence / next step |
| --- | --- | --- |
| Fixed (8 Sep) | Customer credit limits and follow-up dates were not persisted end to end | The form accepts these fields; backend Customer schema and customer API validation omit them. Local validation also omits the date fields. Add migration, API/sync support, and save/reload/reconnect tests. Notes also need server persistence. |
| Fixed (8 Sep) | Daily closing attributed cumulative supplier payments to purchase date and one mode | `FinancialAggregationService` still sums `paid` on purchase rows dated in the closing range. Payments on later dates or in mixed tenders need the individual supplier payment ledger. The same-day flow above passes; historical-date settlement is not certified. |
| Fixed for standard file exports (8 Sep) | Export approval preference was not consistently enforced | Security says Export Data is protected, but Advanced local export downloaded without a PIN. Apply a shared approval gate across export entry points and verify role/PIN/audit behavior. |
| High | Production recovery and device proof remain incomplete | Verify the exact candidate with PostgreSQL concurrency, a complete backup/restore, production offline restart, clean Windows install, and real receipt hardware. See RELEASE_GATE.md. |
| Medium | Verification and two-factor enrollment are unavailable | Store Profile and Security now describe these limits. There is no verification upload/badge service; two-factor enrollment is not offered. |
| Medium | Recurring expense wording promises scheduling | Source inspection found recurrence fields stored, but no expense generation worker was found. Validate or implement generation, duplicate prevention, and failure recovery before promising automatic repetition. |
| Medium | Some mobile forms still lack accessible names | Gift-card issuance and loyalty rules expose unnamed numeric/select controls. Some supplier dialogs also lack descriptions. Finish semantic labels and keyboard/screen-reader QA. |
| Medium | Sync health summaries disagree | A product review appeared in Sync Status while the header said Synced and Daily Closing said zero conflicts. The specific QA review was resolved, but shared health reporting needs correction. |
| Medium | Payment/provider and hardware readiness varies | The card-terminal fallback explicitly returns 501 for unimplemented providers. Real payment confirmation, WhatsApp/email, AI invoice/voice, printer, scale, and customer-display flows were not exercised with external services or hardware. |

## Coverage limits

The core menu and settings routes were opened, but route loading is a smoke check, not full feature validation. Some early snapshots contain loading shells or hidden panels. Gift cards and loyalty were inspected at their forms; no card issuance/redemption or points-earning/redemption cycle was performed. Coupons were not created/redeemed. Purchase orders, transfers, batch expiry, staff role switching, assurance cases/rules, customer QR orders, external integrations, and destructive recovery need dedicated scenario coverage. Only the Kirana business profile was exercised live; other verticals have automated coverage, not this audit's live acceptance.

The temporary five-minute session timeout was restored to its original fifteen minutes. The original idle-check tab was closed during browser reconnection, so the final live persistence check used the fresh-tab lock. No secrets or exported settings backup are included in this evidence folder.

## Verification and evidence

- Full frontend production check: **2,333 passed, 1 skipped**, 332 test files; TypeScript, 5,767 translation keys, Vite build, bundle budget and app checks passed (`output/full-flow-complete-check.log`).
- Subsequent unpaid-expense regression: four focused files, **30 passed**, including the added expense test. Final cash-card changes received typecheck, production build, bundle and app checks (`output/full-flow-ui-final-build.log`). Final artifact verification is recorded in `output/full-flow-final-artifact-build.log` and `output/full-flow-final-artifact-check.log`.
- Backend full suite passed earlier in the audit (`output/full-flow-backend-tests.log`). After changing collection response identity, isolated sync integration passed **59/59**, including two collections and idempotent retry (`output/full-flow-sync-regression.log`).
- Earlier full isolated integration matrix: 34 files, **329 passed, 1 skipped**; the skip is PostgreSQL-specific (`output/full-flow-integration.log`).
- `final-geometry.json`: final cash statement document width equals viewport width at 360, 390, and 1440 pixels. Screenshots were visually inspected. This is not a complete accessibility certification.
- `daily-closing-counted.txt`, `stock-count-applied.txt`, `customer-balance.txt`, `purchase-balance.txt`, and `money-statement-final.txt` record the actual QA outcomes. Before-fix snapshots are retained with explicit filenames.
- Previous frontend polish evidence remains in [mobile-ux-polish](../mobile-ux-polish/README.md).

At the original audit cutoff the backend had not been restarted. The readiness follow-up applied the additive local database update after a consistent backup and restarted the API for browser verification. Repository commits changed during the session; this agent did not create those commits or deploy the app.
