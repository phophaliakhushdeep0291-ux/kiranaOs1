# KiranaOS Product Requirements

Status: Baseline v1.0  
Owner: Product and engineering  
Last updated: 2026-08-01

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
| BILL-001 | Cashier can create a cash bill offline and receive a stable bill number. | Calculation, local transaction and sync-dedup tests; mobile checkout QA. | Core offline cash billing is verified. Live restaurant checkout created and synced KOS-2026-000002 once at exactly ₹675; complete airplane-mode transition coverage remains under SYNC-001. | P0 |
| BILL-002 | Bill supports custom items, quantity/unit pricing, barcode lookup and discounts. | Unit/price/discount tests; 390px add-item QA. | Pricing regressions distinguish recipe portions from retail packs: a ₹590 Large portion plus ₹85 add-on remains ₹675 instead of being clamped by the product MRP. Frontend/backend examples pass, and add-on configuration plus checkout pass the live 375/390/430/768 matrix with 44px controls and no overflow. | P0 |
| BILL-003 | Bill supports cash, UPI/card, split payment and udhar with exact tender reconciliation. | Paise parity and backend validation tests; payment QA. | Retail payment/money-safety suites pass; restaurant database integration persists the exact ₹675 cash total for ₹590 + ₹85. Dedicated live Udhar checkout remains open. | P0 |
| BILL-004 | Pakka GST invoice and estimate use separate number series and histories. | GST/estimate tests; print QA. | GST engine, estimate tests and estimate counter migration. | P0 |
| BILL-005 | Cashier can hold and resume a draft without changing stock or ledger prematurely. | Draft lifecycle and crash-recovery tests; mobile hold/resume QA. | Open-bills implementation/tests; verify full flow. | P0 |
| BILL-006 | Authorized user can refund/return/cancel with reversal entries, reason and audit log. | Reversal, stock and ledger tests; QA from bill history. | Verified. Exact mixed cash/UPI/Udhar cancellation proof covers wrong-PIN denial, reason/audit persistence, zero-paise financial and Udhar netting, stock restoration and retry exact-once (backend billing 19/19). Offline cancellation atomically restores pooled/per-pack stock and appends stable Udhar/audit/outbox effects, including server-hydrated snake-case records. Live 390px bill-history QA proves a synced cancellation persists after reload, Udhar ₹362 -> ₹356, reason/audit visibility, destructive-action removal, 44px controls and zero overflow/runtime errors. | P0 |
| BILL-007 | Receipt can print, retry, and share without duplicating the bill. | Print/share tests and hardware journal QA. | Partially verified. At 390x844 the live 80mm preview, GST and previous-Udhar toggles, HTML download, browser print launch, bill duplicate-print action and email-share dialog work with 44px controls, zero overflow/runtime errors and no bill mutation. Restaurant bill detail and duplicate-receipt data retain the immutable `Large` variation and `Smoked mozzarella +₹85` add-on snapshot; phone cards at 375/390/430 and the 768px table have no internal horizontal scroll or sub-44px active controls. External WhatsApp/email delivery was not sent; real-printer retry/failure certification remains open under HW-001. | P1 |
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
| INV-002 | Every stock change has source, quantity, actor, time and resulting balance. | Audit/invariant tests; stock-history QA. | Restaurant add-on database integration ties the persisted ₹675 sold line to exact stock effects: 1.4 dish units, 0.56 recipe units and 0.1 add-on ingredient units, with the immutable option snapshot retained. Broader stock-history certification remains in scope. | P0 |
| INV-003 | Purchase order progresses through receipt and payment while updating stock once. | Lifecycle/idempotency tests; mobile receiving QA. | PO lifecycle migrations and purchase tests. | P0 |
| INV-004 | Supplier ledger records purchases, payments, reversals and outstanding due. | Ledger reconciliation tests; supplier statement QA. | Supplier/purchase modules; gap audit required. | P0 |
| INV-005 | Support transfers, batches/expiry, stock counts and weighted average cost. | Inventory accounting tests; operational QA. | Relevant migrations and WAC scripts; certify UI coverage. | P1 |
| INV-006 | Generate/print barcodes and suggest reorder quantities. | Format/calculation tests; printer QA. | Gap audit required. | P1 |

### Offline, sync and recovery

| ID | Requirement | Acceptance evidence | Current repository evidence | Priority |
|---|---|---|---|---|
| SYNC-001 | Local reads/writes remain usable offline and queue transparently. | Offline mutation tests; airplane-mode billing QA. | Live 390px cash-bill proof covers stable local save, reload durability, automatic reconciliation and one visible synced bill. Offline mutation/sync suites cover retry paths; full airplane-mode toggle QA remains open. | P0 |
| SYNC-002 | Retries and multiple devices cannot duplicate financial or stock effects. | Idempotency/concurrency tests; two-device QA. | Backend sync integration covers exact-once financial ledger, stock, same-bill replay and multi-device acknowledgement. Repair requires durable identity parity so distinct repeat sales remain distinct. For mutable customer edits, the synced `baseUpdatedAt` is an exact optimistic version guard and a rejected event reuses one durable conflict instead of creating a second review row. Targeted two-device integration passes 1/1 and focused frontend coverage passes 33/33. | P0 |
| SYNC-003 | Conflicts are deterministic, visible and recoverable without data loss. | Conflict-policy tests; forced-conflict QA. | Live 390x844 forced-conflict QA showed one customer card with Device B local data, Device A cloud data and valid ISO timestamps. Owner-authenticated `use_server` resolution moved the only open customer row to resolved, wrote an owner/device audit and preserved the ledger; historical in-UI recovery also proved client convergence. Immutable bill/payment/stock conflicts remain correction/reversal-only and still require the full entity certification tracked by BUG-008. | P0 |
| SYNC-004 | User sees pending, failed, last-success and actionable recovery status. | State tests; offline/failed/recovered mobile QA. | Live 390px Cloud Backup shows online backend, last success under one minute, pending/failed/conflicts 0, current-device sequence lag 0 and no overflow; failed/recovered live QA remains open. | P0 |
| SYNC-005 | Backup and restore are documented, tested and meet declared RPO/RTO. | Automated restore proof and signed run record. | Local tenant-logical proof restores 1,781 records across 77 tables in 0.616s with 0 paise/unit variance; corruption, deliberate one-paise/unit drift, stale-device replay and audited recovery rollback are covered. The runbook declares a <=60s small-shop logical RTO target. Production <=24h RPO is not yet proven because shop artifacts are on-demand and the required daily PostgreSQL/provider backup plus managed restore drill remain external gate work. | P0 |

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
# Vertical release surface

The shipped acquisition surface is Kirana / General Store (`kirana`) plus the
Custom / Other (`other`) escape hatch. The remaining profiles—clothing,
footwear, auto parts, electronics, pharmacy, stationery/books, furniture/home,
beauty/cosmetics, and restaurant—are dormant by default and can be offered by
building/deploying both frontend and backend with
`ENABLE_DORMANT_VERTICALS=true`.

The flag controls only what signup and settings offer. Existing shops retain
full backward-compatible behavior for their stored business type regardless of
the flag. Dormant source and database schema remain intact; no tables or data
are dropped when the flag is off.

## WhatsApp bill delivery

Sending one completed bill on WhatsApp is included in Starter and every higher
plan. A configured WhatsApp Business API provider is selected automatically;
otherwise the app opens a prefilled `wa.me` share. Only bulk and scheduled
customer reminders remain gated by the Business-plan `whatsapp_reminders`
feature. Deep-link handoff is labelled **Opened in WhatsApp**, never sent.
