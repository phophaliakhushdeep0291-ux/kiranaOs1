# KiranaOS Financial Assurance Engine — Architecture

Status: Phase A foundation (feature/ai-audit-foundation)
Scope: continuous financial-control monitoring. **Not** a statutory audit product.
This module never claims to replace a Chartered Accountant, never issues a
statutory certification, and never produces a legally binding audit opinion.

---

## 1. Repository inspection summary

### 1.1 Data model inventory (backend/prisma/schema.prisma, mirrored in prisma-postgres/)

Both Prisma schemas (SQLite dev, PostgreSQL prod) carry the same 70 models.
String pseudo-enums are the repo convention (SQLite has no native enums).
Money is stored as Float rupees plus BigInt `*Paise` shadow columns
(`utils/money.js`: `round2`, `toPaiseBigInt`, `moneyShadows`, `moneyEquals`).

| Domain | Models | Notes |
|---|---|---|
| Tenant | `Shop`, `User`, `Session`, `Device`, `DeviceLicense`, `UserLocationAccess` | `User.role` ∈ `owner \| staff \| admin` (free string). All data is `shopId`-scoped. |
| Billing | `Bill`, `BillItem`, `BillCounter`, `Payment`, `RetailPaymentIntent` | `Bill.status` ∈ `active \| cancelled`; `billType` ∈ `estimate \| normal_sale \| gst_invoice \| udhar_entry \| sales_return` (returns via `returnOfBillId`). Rich money fields incl. `grandTotal`, `paidAmount`, `creditAmount`, `waivedAmount`, `discount`, `offerDiscount`, `loyaltyDiscount`, `giftCardAmount`. |
| Customer credit | `Customer` (`udharAmount` cache), `UdharLedger` | Ledger rows `type` ∈ `debit \| payment`, reversal via `reversedAt`/`reversalOfLedgerId` (rows are never edited). |
| Inventory | `Product` (`stockBaseQty` cache), `StockLedger`, `LocationStock`, `StockTransfer(+Item)`, `StockCountSession/Line`, `InventoryLot`, `BillItemLotAllocation` | `StockLedger.action` ∈ `sale \| purchase \| damage \| correction \| cancel_reversal`; every row carries `oldStockBaseQty`/`newStockBaseQty`. |
| Purchases | `PurchaseHistory` (quick purchase + PO-receipt projection), `PurchaseOrder(+Item)`, `PurchaseReceipt(+Item)`, `PurchaseReturn(+Item)`, `Supplier` | Receipt-level 3-way match already exists (`matchStatus`, `invoiceVarianceAmount`, `varianceApprovedByUserId`). |
| Expenses | `Expense` | Soft delete; `recordedBy` is a free-text name, not a userId (weakness, see §5). |
| Reports | `DailyClosingSnapshot` (lockable via `lockedAt`), `ReportExportJob`, reports.service.js (live aggregates) | Snapshot vs live recompute drift is detectable (`getSnapshotStaleness`). |
| Accounting | `FinancialLedger` (append-only, deterministic `idempotencyKey`, reversal = negated row), `accounting-control.service.js` (double-entry projection `accounting-control-v2`, per-source balanced-group check, trial balance, exceptions) | This is the closest thing to an existing control engine. |
| Sync | `OfflineSyncEvent` (`@@unique([shopId, eventId])`), `SyncCommand` (`@@unique([shopId, idempotencyKey])`), `SyncConflict`, `SyncIdMapping`, `ChangeLog` | sync.service.js (~3k lines) replays offline ops through the same services as online paths. |
| Security/audit | `AuditLog` (+ `audit.service.js#createAuditLog`), `AiActionLog` | Before/after JSON, ip, UA. Written for sensitive actions (PIN verify, price changes, cancellations…), not for every edit. |
| Diagnostics | `ErrorGroup/Event`, `SupportRequest`, `DeviceHealthSnapshot` | Not audit-relevant except device metadata. |

### 1.2 Existing controls the engine builds on (not duplicates)

- **Idempotency** — durable keys on Bill, Payment, UdharLedger, StockLedger,
  Product, PurchaseReceipt/Return, CustomerOrder, SyncCommand, FinancialLedger
  (`@@unique([shopId, idempotencyKey])` and/or `@@unique([shopId, sourceDeviceId, clientXId])`).
- **Server authority** — cashier attribution (`createdByUserId`, `deviceId`)
  comes only from the authenticated context, never the payload.
- **Owner PIN** — destructive/price actions gated by `requireOwnerPin*` and logged.
- **Purchase 3-way match** — receipt vs supplier invoice variance with approval trail.
- **Udhar invariants** — `udharBalance.service.js` recomputes outstanding from
  the ledger; negative-balance repair posts a visible `system_repair` row.
- **accounting-control-v2** — per-source double-entry balance over FinancialLedger.

### 1.3 Cancellation / return / correction semantics

- Bill cancel: `cancelBill` sets `status=cancelled` + `cancelledAt/Reason`,
  posts `cancel_reversal` stock rows, negated FinancialLedger rows, udhar
  reversal rows. Reports must exclude `status=cancelled` (rule target: verify).
- Sales return: a new Bill (`billType=sales_return`, `returnOfBillId`) with its
  own stock/ledger effects — never edits the original.
- Stock correction: `correctStock` writes a `correction` StockLedger row.
- Udhar reversal: new row + `reversedAt` marker on the original.
- Daily closing: snapshot lockable; recompute available for drift detection.

### 1.4 Evidence and attachment infrastructure

Available today: `lib/objectStorage.js` (S3-compatible or disabled),
`ai.upload.js` (audio uploads), `SupportRequest.screenshotKey`. There is **no**
generic document-attachment model — purchase invoices, expense receipts, UPI
screenshots are not stored anywhere. The Evidence Engine (Layer 4) introduces
the first first-class evidence store; file bytes are out of scope for v1
(references, identifiers, text and metadata only — documented limitation).

### 1.5 Tests and privacy controls

- Integration harness: `tests/integration/setup.js` (real HTTP server + real
  test DB, `resetDatabase`, factories). New audit tables must be added to
  `resetDatabase`. Runner: `npm run test:integration`.
- AuthZ: `requireAuth` (JWT + live user/session/device checks) → `requireShop`
  (shopId **only** from JWT) → `requireRole(...)`. Tenant isolation is enforced
  by always filtering on `req.shopId`; tenant-isolation integration tests exist.

---

## 2. Canonical vs derived records (source-of-truth decisions)

### 2.1 Canonical financial records (audit engine reads, NEVER writes)

| Record | Canonical for |
|---|---|
| `Bill` + `BillItem` + `Payment` | Sale amounts, tender split, discounts, credit split |
| `UdharLedger` | Customer credit events (debits, payments, reversals) |
| `StockLedger` | Stock movements (the movement history) |
| `PurchaseHistory`, `PurchaseOrder/Receipt/Return` chain | Purchases, supplier invoices, payables |
| `Expense` | Operating expenses |
| `FinancialLedger` | One immutable money row per economic effect (accounting projection) |
| `DailyClosingSnapshot` (locked) | The day's declared closing figures |
| `OfflineSyncEvent`, `SyncCommand`, `SyncConflict` | Offline replay facts |
| `AuditLog` | Who did what, before/after |

### 2.2 Derived records (caches — must reconcile to canonical)

| Derived | Canonical source | Known drift risk |
|---|---|---|
| `Customer.udharAmount` (+Paise) | Σ signed `UdharLedger` | Legacy customers without opening ledger rows (compat path exists) |
| `Product.stockBaseQty` | Σ `StockLedger.changeBaseQty` (+ opening) | Corrections/damage paths predating ledger coverage; primary location holds the residual, secondary in `LocationStock` |
| `Offer.usedCount/discountGiven` | Bills referencing the offer | Cancel/restore cycles |
| `LoyaltyAccount.pointsBalance` | `LoyaltyTransaction` | lifecycleCycle edge cases |
| `Bill.paidAmount/creditAmount` | Σ `Payment` + udhar debit | Written at confirm-time; later payment mutations would drift |
| `DailyClosingSnapshot` (unlocked) | live reports recompute | Late offline sync after generation |
| Reports (reports.service.js) | Bills/Payments/Ledgers | Recomputed live — inconsistency = bug signal |

### 2.3 Duplicated sources of truth (risk register)

1. **Float rupees vs BigInt paise shadows** on every money column — one value
   per amount, stored twice. Rules compare both and flag drift > 1 paisa.
2. **`Bill.paidAmount` vs Σ `Payment` rows** — the classic mismatch target.
3. **`Customer.udharAmount` vs Σ `UdharLedger`** — repair machinery exists;
   the engine flags rather than repairs.
4. **`Product.stockBaseQty` vs Σ `StockLedger`** — plus `LocationStock` split.
5. **`FinancialLedger` vs domain tables** — the ledger is written in the same
   transaction, but unwired paths (historical data, some flows) may miss rows.
6. **`DailyClosingSnapshot` vs live recompute** — drift after late sync.
7. **`PurchaseReceipt.totalAmount` vs Σ `PurchaseReceiptItem.lineAmount`
   vs `supplierInvoiceAmount`** — 3-way match variance.

### 2.4 Risky financial dependencies

- `Expense.recordedBy` is a display name, not a `userId` → staff attribution
  for expense rules is weak (documented; rule severity reduced accordingly).
- `Payment.shopId` is nullable (legacy) → shop-isolation rules must join
  through `Bill`.
- Bills allow stock shortfall (negative stock) by design for offline replay —
  negative stock is a *finding*, not an error.
- `estimate` bills are financially real (stock/tender/udhar/reports) — rules
  must NOT treat them as quotes; only `legacyQuoteEstimate` (no payments, no
  credit) shaped rows are excluded from payment-coverage rules.
- Backdating: `createdAt` is server time; offline bills replayed late have
  honest `createdAt` at replay time but belong to an earlier business day —
  "backdated after closing" rules must use the sync-event trail, not just
  timestamps.

---

## 3. System architecture — five layers

Module home: `backend/src/modules/assurance/` (name avoids colliding with the
existing `audit` module, which is the low-level AuditLog helper). Public API
prefix: `/api/audit` per product spec.

```
Canonical tables ──(read-only)──► Layer 1: Event extraction (normalized AuditEvent, in-memory)
                                        │
                                        ▼
                                  Layer 2: Deterministic rule engine (versioned registry)
                                        │
                                        ▼
                                  Layer 3: Risk scoring (transparent, reproducible)
                                        │
                                        ▼            persisted: AuditRun, AuditEvaluation,
                                  Finding upsert ──► AuditFinding(+Rule), evidence requirements
                                        │
                                        ▼
                                  Layer 4: Evidence engine     Layer 5: Review workflow
                                        │                            │
                                        └──────► immutable AuditFindingStatusHistory
                       (optional, isolated) AI provider: explanation / summary / classification
```

### 3.1 Layer 1 — Canonical audit event model

Events are **derived dynamically at evaluation time** from canonical records —
they are not persisted as a separate event store. Rationale:

- Zero duplication of financial data (safety rule 9: read-only).
- No risk of the event copy drifting from canonical rows.
- The existing tables already carry occurred/recorded timestamps, actor,
  device, idempotency identity — a persisted copy adds risk, not information.

What **is** persisted is `AuditEvaluation`: an immutable record of each
evaluation containing the input snapshot hash (`inputHash`), engine + ruleset
versions and the full deterministic result JSON, so every score is
reproducible and historical conclusions survive later data edits. This is the
"carefully controlled immutable snapshot" option, applied at the evaluation
level instead of raw-event level.

Normalized in-memory event shape (per spec):

```json
{
  "eventId": "sha256(entityType:entityId:eventType)",
  "shopId": "…", "eventType": "SALE_CREATED",
  "sourceEntityType": "BILL", "sourceEntityId": "…",
  "occurredAt": "…", "recordedAt": "…",
  "createdByUserId": "…", "deviceId": "…",
  "amountPaise": 118000, "currency": "INR",
  "metadata": {}, "sourceVersion": 1
}
```

Initial event types and their sources:

| Event type | Derived from |
|---|---|
| SALE_CREATED / SALE_CANCELLED / SALE_RETURNED | `Bill` (status/billType/returnOfBillId) |
| PAYMENT_RECEIVED | `Payment` (mode ≠ credit) |
| CUSTOMER_CREDIT_CREATED / CUSTOMER_CREDIT_ADJUSTED | `UdharLedger` |
| PURCHASE_CREATED / PURCHASE_PAYMENT_CREATED / PURCHASE_RETURNED | `PurchaseHistory` / `PurchaseReceipt` / `PurchaseReturn` |
| EXPENSE_CREATED | `Expense` |
| STOCK_INCREASED / STOCK_DECREASED / STOCK_CORRECTED | `StockLedger` |
| DISCOUNT_APPLIED | `Bill.discount` / `BillItem.lineDiscount` |
| DAILY_CLOSING_COMPLETED | `DailyClosingSnapshot` |
| RECORD_EDITED | `AuditLog` |
| OFFLINE_EVENT_SYNCED / SYNC_CONFLICT_DETECTED | `OfflineSyncEvent` / `SyncConflict` |

### 3.2 Layer 2 — Deterministic rule engine

- Rules are **code-defined** in `assurance/rules/*.rules.js`, one module per
  category, registered in `rule-registry.js`. Each rule:
  `{ ruleCode, name, description, category, severity, defaultWeight,
  applicableEventTypes, version, effectiveFrom, enabled, evidenceTypes,
  remediation, evaluate(context) }`.
- `evaluate` is a pure-ish async function over a read-only context bundle
  (entity + related rows + baselines + shop settings); it returns
  `{ triggered, details }` where `details` contains the exact numbers compared.
- Per-shop enable/threshold overrides live in the `AuditRule` table
  (`@@unique([shopId, ruleCode])`); the code registry is the versioned catalog
  (`RULESET_VERSION` = hash of `ruleCode@version` pairs). Rule version bumps
  are code changes; findings store the rule version they fired at, so old
  conclusions remain traceable (this stands in for a separate
  `AuditRuleVersion` table in v1 — documented deviation).
- The LLM has no vote here. Arithmetic is decided by `utils/money.js` with
  paise-exact comparisons and an explicit 1-paisa tolerance.

### 3.3 Layer 3 — Risk scoring

`risk-scoring.service.js` computes, per finding:

```
base       = Σ min(cap, triggeredRule.weight × severityMultiplier)
materiality= amount-based multiplier from baseline percentiles (0.8–1.3)
history    = repeat-offender modifier (same entity/staff pattern, 1.0–1.2)
final      = clamp(round(base × materiality × history), 0, 100)
confidence = deterministic function of data sufficiency (baseline status,
             evidence availability), NOT model output
```

Risk levels: `LOW < 30 ≤ MEDIUM < 55 ≤ HIGH < 80 ≤ CRITICAL`.
The full calculation (every input, multiplier and contribution) is stored in
`AuditFinding.scoreBreakdownJson` and `AuditFindingRule.scoreContribution` —
reproducible from `AuditEvaluation.resultJson` alone.

### 3.4 Layer 4 — Evidence engine

`AuditEvidenceRequirement` (what a rule demands) + `AuditEvidence` (what was
provided: reference/identifier/text + metadata + checksum where applicable).
Verification status: `REQUESTED → PROVIDED → VERIFIED | REJECTED |
INSUFFICIENT | NOT_APPLICABLE`. An uploaded reference is never auto-verified —
verification is a human (or later AI-assisted, human-confirmed) transition.
File-byte storage rides on `lib/objectStorage.js` when configured; v1 accepts
reference-type evidence (invoice numbers, UPI refs, URLs, text explanations)
everywhere and stores binary uploads only when object storage is enabled.

### 3.5 Layer 5 — Review and resolution workflow

Finding lifecycle:
`OPEN → EVIDENCE_REQUESTED → UNDER_REVIEW → CONFIRMED_ISSUE | FALSE_POSITIVE |
CORRECTED | ACCEPTED_RISK → CLOSED`.
Every transition writes an immutable `AuditFindingStatusHistory` row
(previous/new status, user, role, timestamp, comment, evidence link, approval
level). Findings are never hard-deleted; there is no delete API.

**Finding identity/dedupe:** one finding per
`(shopId, sourceEntityType, sourceEntityId)` (`@@unique([shopId, dedupeKey])`).
Re-evaluations update rules/score while the finding is in an active status;
findings resolved as FALSE_POSITIVE or ACCEPTED_RISK are not reopened by the
same rule signature (recorded in the evaluation only); a resolved finding whose
entity later trips a *different* rule set is reopened with full history.

---

## 4. Audit runs & triggering

- `TRANSACTION_TRIGGERED`: fire-and-forget hook invoked from controllers
  *after* the business transaction commits (never awaited by the response
  path; failures are logged + retried by the next scheduled run — an
  in-process bounded queue, upgraded to the jobs/queue infra when
  `QUEUES_ENABLED`).
- `SCHEDULED` / `MANUAL`: evaluate a date range or entity set via
  `POST /api/audit/runs`.
- Idempotent: `AuditEvaluation` is unique per (run, entity); findings dedupe
  by key; re-running a period is safe and cheap (unchanged `inputHash` skips).
- Audit failure can never fail the source transaction (isolation by
  construction: separate request lifecycle, try/catch, no shared transaction).

## 5. Areas where audit conclusions cannot yet be reliable

1. **Cash on hand between closings** — daily closing now persists a physical
   count with user/device attribution and counted-versus-expected variance, but
   between physical counts the "expected cash" remains an inference.
2. **UPI truth** — no bank/UPI provider feed; UPI reference values are
   operator-entered. Reuse detection works; authenticity checks do not.
3. **Historical expense attribution** — new online/offline expenses carry a
   server-authenticated user id and immutable role/name snapshots; legacy/imported
   rows with only `recordedBy` free text remain explicitly unattributed.
4. **Pre-ledger history** — rows created before FinancialLedger/StockLedger
   coverage cannot be reconciled to movements (flagged as INSUFFICIENT_DATA,
   not as violations).
5. **Offline clock skew** — client timestamps in offline payloads are not
   trustworthy; backdating conclusions rely on server `recordedAt` vs business
   date, with reduced confidence.
6. **Supplier identity/bank details** — no supplier bank-detail model exists;
   related rules (changed bank details) are deferred.
7. **Evidence authenticity** — checksums prove integrity after upload, not
   authenticity of the underlying document.

## 6. Privacy & AI boundary

- Deterministic engine works with AI disabled (`AUDIT_AI_PROVIDER=disabled`
  default). Providers: `disabled | mock | openai | groq` behind
  `AuditAIProvider` interface (explain/summarize/classify only).
- Redaction before any external call: customer/supplier names → role tokens,
  phones/UPI IDs/GSTIN/account numbers masked, no attachments, no credentials.
  Amounts and rule facts pass through (needed for explanation).
- Structured output validation (zod) on every provider response; timeout +
  retry limit + deterministic fallback explanation text.
- AI output is stored as `aiExplanation` alongside — never instead of — the
  deterministic `scoreBreakdownJson`, and uses "potential inconsistency"
  language, never accusations.

## 7. Role permissions (v1 mapping to existing roles)

| Product role | Repo role | Capabilities in audit module |
|---|---|---|
| OWNER | `owner` | everything incl. threshold config, assignment, resolution |
| MANAGER | `admin` | view all, submit evidence, review; cannot change rules/thresholds, cannot delete anything (nobody can) |
| STAFF | `staff` | view findings assigned to them; provide evidence/explanations |
| AUDIT_REVIEWER | `audit_reviewer` (new role string, optional) | review/verify/close per permissions; cannot touch canonical records |

`User.role` is a free string so `audit_reviewer` needs no schema change; audit
routes gate on explicit role lists.

## 8. Fields needed for risk analysis — availability check

Available now: server timestamps, actor userId + deviceId on bills/stock/
receipts, idempotency identity, before/after on audited actions, cancellation
reasons, invoice numbers, payment modes, locked closing snapshots, sync event
trail, purchase variance approvals.
Missing (worked around or deferred): expense userId, supplier bank details,
staff permission matrix for discounts (only global price floors exist — the
"discount outside staff permission" rule uses configured thresholds instead),
cash-count events outside daily closing, document attachments.

## 9. New database models

`AuditRule`, `AuditRun`, `AuditEvaluation`, `AuditFinding`,
`AuditFindingRule`, `AuditEvidenceRequirement`, `AuditEvidence`,
`AuditFindingStatusHistory`, `AuditReview`, `AuditCase`, `AuditCaseFinding`,
`AuditBaseline` — all with `id/shopId/createdAt/updatedAt`, indexed on
`shopId+status`, `shopId+riskLevel`, `sourceEntityType+sourceEntityId`,
`ruleCode`, `auditRunId`, `assignedReviewerId`, with unique constraints for
dedupe (see prisma schema). `AuditRunSummary` is folded into
`AuditRun.summaryJson`; `AuditRuleVersion` is represented by in-code version
constants + per-finding `ruleVersion` snapshots (documented deviations).

Canonical financial models are not modified. Migrations are additive only.
