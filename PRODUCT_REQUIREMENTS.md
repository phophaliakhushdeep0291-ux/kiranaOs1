# KiranaOS Product Requirements

Status: Baseline v1.0  
Owner: Product and engineering  
Last updated: 2026-07-16

## Product outcome

KiranaOS is a phone-first, offline-first point-of-sale and shop-management product for Indian kirana and small retail stores. It must let a shop bill continuously during network failure, maintain trustworthy stock and ledgers, meet GST billing needs, work with common retail hardware, and give an owner a two-minute view of the business.

The first commercial target is a dependable kirana POS, not a general Shopify replacement or a full ecommerce platform.

## Users and operating conditions

| Persona | Primary need | Constraint |
|---|---|---|
| Owner | Control cash, stock, dues, staff, tax and profitability | Limited time; needs auditability |
| Cashier | Create and settle a bill quickly | One-handed phone/tablet use; interruptions |
| Stock/purchase staff | Receive, count and correct stock | Barcode/batch data may be incomplete |
| Customer | Receive a clear receipt, buy on credit, order remotely | May use WhatsApp rather than an app |

Expected conditions include intermittent internet, shared devices, low-cost Android phones, thermal printers, barcode scanners, Indian number/currency conventions, and GST-inclusive or GST-exclusive pricing.

## Non-negotiable product rules

1. A confirmed bill, stock movement, payment, or customer-credit entry must never be silently lost or applied twice.
2. Money is calculated in integer paise at trust boundaries; the backend independently validates financial results.
3. Every offline mutation has a stable idempotency key and an inspectable sync state.
4. Owner-sensitive actions require authorization and an audit record.
5. Every requirement below must map to at least one automated test and one QA flow before release.
6. Mobile controls are at least 44px, have no horizontal page scroll, and are not covered by fixed navigation.

## Functional requirements

IDs are permanent. Split a requirement instead of reusing or renumbering an ID.

### Billing and payments

| ID | Requirement | Acceptance evidence | Current repository evidence | Priority |
|---|---|---|---|---|
| BILL-001 | Cashier can create a cash bill offline and receive a stable bill number. | Calculation, local transaction and sync-dedup tests; mobile checkout QA. | `frontend/src/features/billing`, billing/offline tests, backend bills module. | P0 |
| BILL-002 | Bill supports custom items, quantity/unit pricing, barcode lookup and discounts. | Unit/price/discount tests; 390px add-item QA. | Billing and pricing tests; product barcode fields. | P0 |
| BILL-003 | Bill supports cash, UPI/card, split payment and udhar with exact tender reconciliation. | Paise parity and backend validation tests; payment QA. | Retail payment and money safety modules/tests. | P0 |
| BILL-004 | Pakka GST invoice and estimate use separate number series and histories. | GST/estimate tests; print QA. | GST engine, estimate tests and estimate counter migration. | P0 |
| BILL-005 | Cashier can hold and resume a draft without changing stock or ledger prematurely. | Draft lifecycle and crash-recovery tests; mobile hold/resume QA. | Open-bills implementation/tests; verify full flow. | P0 |
| BILL-006 | Authorized user can refund/return/cancel with reversal entries, reason and audit log. | Reversal, stock and ledger tests; QA from bill history. | Return/reversal migrations and tests. | P0 |
| BILL-007 | Receipt can print, retry, and share without duplicating the bill. | Print/share tests and hardware journal QA. | Receipt tests/hardware bridge; retry journal to certify. | P1 |
| BILL-008 | Owner approval is enforced for configured discount thresholds and sensitive edits. | Permission/audit tests; cashier-versus-owner QA. | Owner PIN and permission tests. | P0 |

### Customers and udhar

| ID | Requirement | Acceptance evidence | Current repository evidence | Priority |
|---|---|---|---|---|
| CUST-001 | Create/search/edit customers with phone-based duplicate warning. | Validation and duplicate tests; mobile customer QA. | Customer module/tests. | P0 |
| CUST-002 | Udhar balance is ledger-derived and supports payments, reversals and statements. | Ledger invariants and offline-sync tests; statement QA. | Udhar services and accounting tests. | P0 |
| CUST-003 | Owner can see due aging, collection progress and safe reminders. | Report/permission tests; reminder QA. | Reminder worker and customer ledger tests. | P1 |

### Products, inventory and purchases

| ID | Requirement | Acceptance evidence | Current repository evidence | Priority |
|---|---|---|---|---|
| INV-001 | Products support barcode/SKU, tax, units/loose items, selling prices and low-stock level. | Product/pricing tests; add/edit/scan QA. | Product and pricing migrations/tests. | P0 |
| INV-002 | Every stock change has source, quantity, actor, time and resulting balance. | Audit/invariant tests; stock-history QA. | Inventory/retail-operation foundation; certify end-to-end. | P0 |
| INV-003 | Purchase order progresses through receipt and payment while updating stock once. | Lifecycle/idempotency tests; mobile receiving QA. | PO lifecycle migrations and purchase tests. | P0 |
| INV-004 | Supplier ledger records purchases, payments, reversals and outstanding due. | Ledger reconciliation tests; supplier statement QA. | Supplier/purchase modules; gap audit required. | P0 |
| INV-005 | Support transfers, batches/expiry, stock counts and weighted average cost. | Inventory accounting tests; operational QA. | Relevant migrations and WAC scripts; certify UI coverage. | P1 |
| INV-006 | Generate/print barcodes and suggest reorder quantities. | Format/calculation tests; printer QA. | Gap audit required. | P1 |

### Offline, sync and recovery

| ID | Requirement | Acceptance evidence | Current repository evidence | Priority |
|---|---|---|---|---|
| SYNC-001 | Local reads/writes remain usable offline and queue transparently. | Offline mutation tests; airplane-mode billing QA. | Dexie/local-first and outbox modules/tests. | P0 |
| SYNC-002 | Retries and multiple devices cannot duplicate financial or stock effects. | Idempotency/concurrency tests; two-device QA. | Sync idempotency, monotonic feed and integration tests. | P0 |
| SYNC-003 | Conflicts are deterministic, visible and recoverable without data loss. | Conflict-policy tests; forced-conflict QA. | Conflict ledger/reconciliation modules; certify policies. | P0 |
| SYNC-004 | User sees pending, failed, last-success and actionable recovery status. | State tests; offline/failed/recovered mobile QA. | Sync status page and repair tests. | P0 |
| SYNC-005 | Backup and restore are documented, tested and meet declared RPO/RTO. | Automated restore proof and signed run record. | Backup artifacts and disaster-recovery scripts. | P0 |

### Reports and owner control

| ID | Requirement | Acceptance evidence | Current repository evidence | Priority |
|---|---|---|---|---|
| RPT-001 | Daily closing reconciles cash, bank/UPI, udhar, refunds and expected drawer. | Timezone/money tests; closing QA. | Exact API fixture reconciles mixed tender, udhar recovery, refund, cash expense, live closing and persisted snapshot; focused report integration passes 12/12. Premium layout passes 375/390/430/768 live geometry with zero overflow and 44px main-content controls. | P0 |
| RPT-002 | GST report and invoice totals agree exactly for the selected tax mode. | Compliance parity tests; sample return QA. | Inclusive-GST release fixture nets the invoice/credit note to ₹100 taxable + ₹18 tax with exact report parity and estimate exclusion. Exclusive-GST discount policy remains tracked in BUG-003. | P0 |
| RPT-003 | Owner sees sales, P&L, top products, dues, staff sales and inventory health. | Aggregation/range tests; 390px report QA. | Operational tables + locked snapshots are the report authority. Owner/admin reconciliation gates any future FinancialLedger read cutover with exact-paise variance; focused backend integration passes 11/11. Premium report hierarchy passes 375/390/430/768 live geometry with zero overflow and focused frontend coverage. | P1 |
| RPT-004 | Authorized exports produce CSV/PDF with shop/date context and no cross-tenant data. | Export and tenant isolation tests; file inspection QA. | Export workers/tests. | P1 |

### Hardware, online ordering and administration

| ID | Requirement | Acceptance evidence | Current repository evidence | Priority |
|---|---|---|---|---|
| HW-001 | Certified thermal printers support print, retry and observable failure. | Per-model certification record. | Hardware bridge exists; real-device certification required. | P1 |
| HW-002 | Certified scanners, cash drawers and weighing scales work in billing. | Per-model certification record and live QA. | Gap/certification required. | P1 |
| PAY-001 | Razorpay/UPI/card confirmation and failure reconcile idempotently. | Webhook/payment tests; sandbox and device QA. | Payment provider and webhook tests. | P1 |
| ORD-001 | Customer can browse a shop link/QR and place pickup/delivery order. | Public catalog/order tests; customer-phone QA. | Public catalog/customer-order modules/tests. | P1 |
| ORD-002 | Owner accepts/rejects, reserves stock and converts order to one bill. | State-machine/idempotency tests; owner QA. | Ordering foundation; certify reservation/conversion. | P1 |
| ADM-001 | Roles, owner PIN, device limits and tenant isolation are enforced server-side. | RBAC, session and isolation tests. | Auth/RBAC/device tests. | P0 |
| ADM-002 | Settings expose billing, tax, printer, backup, security and sync safely on mobile. | Permission tests; settings mobile QA. | Settings UI/module; page audit required. | P1 |

## Quality attributes

| ID | Requirement | Release threshold |
|---|---|---|
| QUAL-001 | Billing responsiveness | Product search feedback under 200ms from local data; confirm action immediately shows durable local state. |
| QUAL-002 | Reliability | Zero unexplained loss or duplicate financial/stock writes in release tests and beta telemetry. |
| QUAL-003 | Mobile usability | 375, 390, 430 and 768px: no horizontal scroll, overlap or unreachable primary action. |
| QUAL-004 | Security | Tenant isolation, authorization, production-secret checks and rate limits pass. |
| QUAL-005 | Accessibility | Keyboard-visible focus, labeled controls, usable contrast and 44px touch targets on core flows. |
| QUAL-006 | Observability | Correlation IDs and actionable logs/metrics exist for bill, payment, print and sync failures. |

## Delivery sequence and exit criteria

1. Control system: these six documents exist and are maintained.
2. Production base: `RELEASE_GATE.md` P0 gate is green; no new feature work while red.
3. Mobile quality: all core pages pass the viewport matrix.
4. Core POS, inventory/purchase, sync, hardware/payments, ordering and reports: complete P0 before P1 expansion.
5. Beta: 3-5 real shops complete four weeks with measured billing time, sync/print failures, mistakes and support friction.

## Change control

Every pull request must cite requirement IDs, test evidence, and QA flow IDs. New scope first changes this document; defects go to `BUG_BACKLOG.md`; release evidence goes to `RELEASE_GATE.md`. A requirement is complete only when implementation, automated evidence and QA evidence all exist.
