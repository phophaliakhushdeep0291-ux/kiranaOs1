# Tax and accounts assistant

Updated 23 September 2026. Build the shopkeeper workflow inside KIRANAOS and use an authorized partner for government filing. A general language model is not the calculation engine or a substitute for a required CA audit.

## Step 1 — delivered locally

Settings → Taxes contains a **Tax review assistant** for users with the GST reports feature. Choose dates and run a review. It reads synced sales, purchase receipts and expenses in the authorized location; it does not send records to an external AI or filing provider.

The owner/admin endpoint `GET /compliance/tax-review?from=YYYY-MM-DD&to=YYYY-MM-DD` uses the existing authentication, device activation, feature gate and location-access middleware. It rejects invalid/reversed dates and periods longer than 366 days. Checks cover seller/buyer GSTIN format, HSN format, return references, invalid tax amounts, missing supplier invoice details, unreconciled purchase receipts, repeated supplier invoice references and absent expense vendors. Findings include source references (up to 25 samples per check, with the full count retained).

This is a deterministic data review, not an LLM conversation or tax return. No filing, tax payable calculation, automatic ITC claim or statutory audit opinion is produced. Empty or clean records still require completeness, registration/scheme, GSTR-2B, expense evidence, adjustment and provider reviews. The ITR checklist does not store answers or prepare an ITR yet.

Coverage limits: synced server records only; purchase receipts use receipt creation dates because supplier invoice dates are not captured here. Repeated references can represent partial deliveries. GSTIN/HSN format checks do not establish portal registration status or correct tax classification. Expense records do not currently provide sufficient tax-invoice evidence. A location review is not registration-wide or taxpayer-wide completeness. No new migration is needed for this step.

Validation: `cd backend && npm run test:tax-review`; existing compliance regression tests should use `scripts/run-db-example-tests.js` to protect the development database. Frontend: `npm run typecheck` and `npm run i18n:check`.

## Reconciliation comparison — delivered locally

Settings → Taxes also includes an invoice comparison tool with a downloadable JSON template. `POST /compliance/tax-reconciliation` accepts the strict `kirana-tax-reconciliation-v1` interchange format. This is not a parser for raw GSTN downloads. A shopkeeper/accountant must populate both invoice-level books and statement arrays from their actual records; saved purchase receipts are not automatically converted because invoice date and tax-component snapshots are incomplete.

The recipient GSTIN must be configured for the current shop. Admins need access to every mapped branch; only the owner can use an unmapped shop-level registration. The comparison rejects malformed GSTINs/dates, future-period documents, fractional/negative paise, duplicated source IDs and unknown fields. Up to 2,000 records on each side are supported, with a 1.8 MB browser upload limit. Credit notes use positive magnitudes and a distinct document type. Identity includes supplier, document type, conservatively normalized invoice number and Indian financial year. Dates and every tax component, including cess, are compared exactly; a one-paise difference remains a mismatch. Repeated invoice identities are flagged for review instead of merged or silently counted twice.

Results distinguish exact matches, differences, missing-in-books, missing-in-statement and duplicate review. Statement ITC availability is carried through independently of the match; eligible ITC stays unknown and filing stays disabled. Uploaded data is explicitly unverified. Special cases including amendments, imports and ISD are not supported by this normalized domestic-document comparison. There is no persistence or external provider call. Responses are paginated in the UI; changing the active location aborts pending work and clears the imported data/results.

## Step 2 — capture missing evidence

Add persisted taxpayer profiles, business structure, registration scheme, financial/tax year and registration-to-location mapping. Capture supplier invoice date, supplier and recipient GSTIN snapshots, invoice-level tax components, original documents and correction history. Add expense invoice evidence, opening balances, stock valuation and bank reconciliation. Keep purchase invoice identity separate from receipt identity so split deliveries cannot duplicate ITC. Capture annual ITR questionnaire answers with actor, timestamp and evidence.

## Step 3 — reconciliation and return drafts

Import GSTR-2B through a documented file format or authorized partner; validate recipient GSTIN and period. Reconcile invoice values, tax components, credit notes and amendments. Require explicit review of eligibility, reversals and exceptions. Reuse current GSTR-1 and outward GSTR-3B working papers after registration-wide coverage checks. Implement tax-year-versioned rules and fixtures reviewed by an Indian tax professional. Keep draft, reviewed, submitted, verified and acknowledged states distinct.

For ITR, reconcile AIS/26AS, all businesses and other income, stock/assets/depreciation, deductions and tax payments. Select a form only after eligibility has been established for the applicable year. Do not equate cash flow, purchases or POS margins with taxable profit.

## Step 4 — authorized filing integration

Verify the partner's exact supported GST returns and business ITR forms/tax years, embedded-use licensing, sandbox access, authorization flow, data retention, pricing and support. Build an adapter against that contract, with idempotency, timeout/status reconciliation and immutable payload hashes. Review must bind to the exact payload being submitted; changed records invalidate approval. Taxpayer verification and payment are separate explicit actions. Store genuine acknowledgements; never infer filing success from payload validation or HTTP acceptance. Existing e-invoice/e-way-bill provider support is not GST-return or ITR filing support.

No vendor account, purchase, production credentials or taxpayer consent was supplied for this implementation, so live filing remains unconnected.

## Step 5 — conversational assistance

Expose the tested review/calculation functions as narrowly scoped read tools to the app's assistant. Let it explain findings and ask for missing facts. Treat uploaded text as data, require evidence for classifications, and never let generated prose change calculated values or mark a return filed. Add evaluations for missing information, cross-shop access, hallucinated tax advice and unauthorized submissions before enabling external model access to tax documents.

## Market shortlist and build/buy decision

These are integration candidates, not installed plugins or verified commercial contracts. Checked against vendor documentation on 23 September 2026:

| Candidate | Documented capability | What must be confirmed |
| --- | --- | --- |
| Clear | GST preparation and GSTR-1/3B workflows; published guide describes AI-assisted reconciliation | Embedded API licensing, small-shop pricing and exact integration scope |
| IRIS GST | GST ecosystem APIs; Sapphire API documentation includes GSTR-2B reconciliation | Return-submission endpoints, onboarding, sandbox and commercial terms |
| Sandbox / Quicko | GST sales page describes GSTR-1, GSTR-2B reconciliation and GSTR-3B; legacy ITR preparation documentation exists | Current business ITR forms/year support and submission/verification access. Current income-tax API overview primarily lists calculation, reports and OCR, so do not assume full ITR filing coverage |

Recommendation: own the accounting records, review experience and evidence history; evaluate Sandbox and IRIS for GST integration, and Clear where its reconciliation/commercial offering fits. Evaluate ITR separately rather than assuming one provider covers every return. No need to train our own foundation model for this workflow.

Sources:
- [Clear GST workflows](https://www.clear.in/s)
- [Clear AI reconciliation guide](https://assets1.cleartax-cdn.com/finfo/wg-utils/retool/6f97f654-687c-49ac-adde-f4789cb2a661.pdf)
- [IRIS API overview](https://developer.irisgst.com/)
- [IRIS Sapphire API reference](https://developer.irisgst.com/sapphire/index.html)
- [Sandbox GST offering](https://sandbox.co.in/gst)
- [Sandbox current income-tax overview](https://developer.sandbox.co.in/api-reference/it/overview)
- [Sandbox legacy ITR preparation reference](https://sandbox-docs.readme.io/reference/prepare-itr)
- [Income Tax Department ERI API specifications](https://www.incometax.gov.in/iec/foportal/api-specifications)
- [Income Tax Department business/profession guidance](https://www.incometax.gov.in/iec/foportal/help/individual-business-profession?mobile-app=1)

## Validation results

- Seven tax-review engine/schema/service tests passed, plus existing compliance-tax and GST discount regressions.
- Seven reconciliation schema/engine tests cover paise differences, cess, dates, duplicates, credit notes, numbering across financial years, bounds and no automatic ITC claims.
- Isolated HTTP integration tests exercise authentication, staff rejection, cross-shop location rejection, soft-deleted/out-of-period expense exclusion and registration-wide admin access.
- TypeScript, English/Hindi placeholder checks, and dictionary/hardcoded-text tests are run for the changed screens.
- The development database is not used by these tests. No migrations, deployment, provider purchase, tax payment or return submission has been performed.
