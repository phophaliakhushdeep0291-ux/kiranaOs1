# UAE pilot readiness — 5 October 2026

**Decision: engineering preview; not ready for real UAE trading.**

The first target is an English-first UAE retail pilot. This change provides a
reviewable regional foundation and prevents misleading currency changes. It
does not enable AED sales, accept UAE card payments, issue a UAE tax invoice,
or certify tax compliance. Existing shops still operate in INR.

## What is implemented

| Area | Behavior and evidence |
| --- | --- |
| Setup preview | Settings → UAE pilot preview (`/settings/uae-pilot`), an online setup page with English and Hindi copy. It records no sale, invoice, customer, payment or outbox event. Inputs are transient. |
| Currency | Explicit `formatMoney(value, "AED")`, two decimal places and international grouping. Default INR formatting stays compatible. There is no global mutable currency and no foreign-exchange conversion. |
| VAT arithmetic | A separate preview calculator handles inclusive/exclusive 5%, distinct zero-rated/exempt categories, three-decimal quantities and proportional invoice discounts in integer fils. No whole-dirham rounding. |
| Return arithmetic | A pure preview helper apportions the saved original net/VAT across cumulative partial returns. Tests serialize/reload the snapshot and conserve every fils. This helper is not connected to live returns. |
| Local dates | An explicit Asia/Dubai business-date helper with tests on either side of midnight, independent of the device time zone. Existing live reporting is not yet migrated to this helper. |
| Contact formats | UAE mobile normalization retains +971 and checks the published mobile prefixes. TRN helper checks 15-digit syntax only. Neither verifies ownership or FTA registration; live signup remains India-only. |
| Accounting identity | Shop and Bill records now persist country, currency, accounting time zone and tax regime. Sales capture the shop snapshot; linked returns inherit the original sale. New registrations remain INR/GST. Backend rejects unsupported markets and edits through shop/bill APIs. These are application guards, not database immutability constraints. |
| Offline accounting identity | Local sale/return records and their outbox payloads retain the same four fields. Mismatches are rejected before local financial writes. Backend push, pull and idempotent retries preserve the snapshot; fuzzy bill reconciliation keeps equal INR/AED amounts distinct. Actual AED writes remain disabled. |
| Old-client compatibility | Absent fields mean the previously supported INR/GST ledger. Explicit foreign values are rejected. Existing offline checkout fingerprints remain compatible, so adding metadata does not turn a retry into a second sale. |
| Display repair | The settings hub shows the actual INR denomination. Store Profile shows India as read-only. An unchanged legacy cosmetic foreign-country/currency label is corrected on a later settings save, without changing balances. |

Example: AED 105 inclusive → AED 100 net + AED 5 VAT. A discount of AED 10.50
produces AED 90 net + AED 4.50 VAT = AED 94.50. Mixed-category allocation and
partial-return examples are covered by 1,000 seeded cases inside one regression
test; they are not 1,000 independently certified transactions.

The preview and its detailed translations load on demand. Navigation labels
remain available offline. The page explicitly requires connectivity to open;
it is not evidence that UAE trading works offline. No bundle limit was raised.

## Requirements and primary sources

These are implementation inputs checked on 5 October 2026, not a legal opinion
or an approval from the FTA. Recheck the official sources before onboarding.

- The FTA's guidance distinguishes simplified invoices from full invoices. The
  preview uses the VAT-inclusive AED 10,000 boundary for registered buyers;
  non-registered buyers can receive a simplified invoice. Real issuance and
  delivery, mandatory fields, timing, seller registration and credit notes need
  their own acceptance review. [FTA tax invoice guidance](https://tax.gov.ae/DataFolder/Files/Pdf/06-Tax-Invoices.pdf)
- The FTA checklist illustrates seller identity/TRN, invoice identification,
  VAT and AED totals. The preview does not produce such a document.
  [FTA invoice checklist](https://tax.gov.ae/DataFolder/Files/Pdf/Infographic/TAX%20invoice%20Eng.pdf)
- MoF defines electronic invoicing as structured exchange and reporting through
  the applicable system. A printout or PDF is not that integration. Scope and
  rollout obligations must be checked for the actual merchant, including B2C
  exclusions and subsequent amendments. Do not ship deadlines copied from an
  older announcement. [MoF eInvoicing portal and legislation](https://mof.gov.ae/en/about-us/initiatives/einvoicing/)
- TDRA lists 050, 052, 054, 055, 056 and 058 as UAE mobile prefixes in its
  portability guidance. This supports syntax validation, not active-number or
  ownership verification. [TDRA mobile guidance](https://tdra.gov.ae/en/consumer-tool-hub/topics/porting-numbers)

## Work required before admitting a real UAE shop

| Priority | Deliverable | Acceptance evidence |
| --- | --- | --- |
| 1 | Complete accounting snapshots across payments, ledgers, exports, backup/restore and every document path | Shop and sale/return Bill columns plus offline payloads are implemented for INR. Still prove AED snapshots across restart, sync, reprint, restore and shop switches before enabling AE. Verify PostgreSQL deployment/backfill; any market migration must be explicit and audited. |
| 1 | UAE signup, staff/customer/supplier identities, TRN-aware seller/location and buyer validation | +971 identities survive login/recovery/invites/offline reads; unregistered sellers cannot collect VAT through a toggle. |
| 1 | VAT invoices and credit notes, including receipt/A4/export paths | Seller identity, TRN, sequential references, dates, buyer details where required, original-invoice reference, taxable values and AED VAT totals reconcile. No CGST/SGST/IGST or GSTIN labels appear on UAE documents. |
| 1 | All live AED calculations and displayed amounts | Counter, saved bill, partial return, customer credit, supplier balance, reports, exports and accounting agree to the fils. India subscription pricing is not silently relabeled in AED. |
| 1 | UAE offline workflow and Dubai report boundaries | Two counters: cash sale offline → process restart → partial return → reconnect/retry → authoritative acknowledgement → duplicate replay → ledger/report reconciliation. Include network loss, expired auth, device revocation, conflicts and restore. No real card approval can be inferred from an offline save. |
| 2 | Country-specific payment and tax capabilities | Hide and reject India-only UPI/GST filing/e-way/Tally assumptions for AE. Verify UAE card capture, refund, webhook replay and settlement against a contracted provider before offering them. |
| 2 | Operational and legal review | Review hosting/data handling, privacy notice, contracts, tax registration, document retention, support responsibilities, backup restoration and UAE hardware with the actual merchant and local advisers. |
| 2 | eInvoicing, when the merchant/transaction is in scope | Accredited-provider onboarding plus structured-document validation, acknowledgements, duplicate/rejection handling, credit notes and audit evidence. Never replace this with a “compliant” badge. |
| 3 | Paid pilot and commercial evidence | Record real activation, reconciled trading days, support time, failure recovery, willingness to pay and renewal. A test count is not market traction or a valuation. |

Recommended initial scope: one retail shop, one AED ledger, English UI, cash and
explicitly recorded external tenders. Expand scope only after its acceptance
evidence exists. Cross-border sales, currency conversion, complex VAT treatments,
Arabic layouts and provider automation need separate work.

## Verification

Backend local API regressions passed on a disposable SQLite database with the
copied `.env` disabled: market policy, auth, settings/reminders, billing and sync,
122 tests total (12 + 37 + 8 + 4 + 61).
They include failed-write rollback, old-client compatibility and rejection of an
unsupported registration before any tenant is created.

A separate isolated database regression exercises saved sale/return market fields,
reloads, rejected relabeling, shop-edit guards, duplicate bill/event replay,
cross-counter pull responses and one-time stock deductions. It is wired into
`backend/npm run test:market-snapshot` and automatic SQLite/PostgreSQL integration-test discovery.

`frontend/npm run prod:check` passed: 3,358 tests passed, one skipped; typecheck,
translation checks, production build, bundle and production-app checks passed.
The largest shop's offline JavaScript payload is 1,279.8 KB gzip against the
unchanged 1,280 KB limit; initial JavaScript is 273.5 KB against 300 KB.
`backend/npm run prod:check` and migration safety checks also passed.

Frontend validation includes INR compatibility, AED formatting, invalid input,
fractional quantities, discounts, zero/exempt distinction, return conservation,
Dubai midnight, phone/TRN syntax, invoice-kind thresholds and static screen
rendering. CI results, when available, are recorded with the pull request.

No real UAE merchant, live payment-provider credentials, accredited eInvoicing
connection or physical printer was exercised. Browser interaction/screenshot
verification remains outstanding; static rendering is not a substitute. No
production deployment or data migration was performed.

## Deployment ordering for the accounting snapshot changes

The mirrored Prisma schemas add four non-null columns to each of Shop and Bill.
PostgreSQL migration `000142_accounting_market_snapshot` adds them with explicit
`IN` / `INR` / `Asia/Kolkata` / `GST` defaults.
Existing money and stock are not recalculated and free-text profile labels are
not used for the backfill. Startup schema verification checks both tables.

Deploy the additive migration and generate the matching Prisma client before
starting the updated API. Local SQLite uses the repository's schema-update
command. An application rollback can retain these additive columns; it must not
delete them. No deployment has been performed here. The local SQLite results and
SQL safety check do not constitute a PostgreSQL migration/backfill proof; obtain
that release-certification evidence before merging or deploying.

## 9 October follow-up: payment ledgers and Tally

The user selected cash and recorded external payments for the eventual UAE pilot.
Payment, customer-credit ledger, financial ledger and journal entry rows now also
carry the four accounting market fields; reversals preserve their source snapshot.
Additive migrations 143/144 prepare those fields and separate UAE tax identity
columns. UAE mobile parsing and explicit AE market metadata are prepared, while
public UAE registration/trading remains disabled. Cashier VAT issuance, AED UI,
receipts, business-day reports and full live AED/offline acceptance remain open.

The requested Tally connection is implemented with company discovery and binding,
a review step, separate masters/voucher imports, strict acceptance counters,
persistent duplicate/uncertain-outcome protection and signed confirmation recovery.
It currently supports INR books; AE exports fail explicitly. See
[Tally connection setup and acceptance boundaries](TALLY_CONNECTION_2026-10-09.md).
Migration 145 adds the linked company identity. None of these migrations has been
applied to a production database by this task.
