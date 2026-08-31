# Financial Assurance Engine — MVP Acceptance Report

Branch: `feature/ai-audit-foundation` (no push to `main`, no force-push)
Engine: `assurance-engine-1.0.0` · Rule set: `ruleset-bc237f642ac6`
Date: 2026-07-26

---

## 1. What was built

| Layer | Location | Status |
|---|---|---|
| 1 — Canonical audit event model | `assurance/evaluation.service.js#materializeEvents` | Done — 18 event types, derived at evaluation time |
| 2 — Deterministic rule engine | `assurance/rules/` (7 modules + registry) | Done — 94 rules, versioned |
| 3 — Risk scoring | `assurance/risk-scoring.service.js` | Done — transparent, reproducible |
| 4 — Evidence engine | `AuditEvidenceRequirement` + `AuditEvidence` | Done — 15 types, 6 statuses |
| 5 — Review & resolution | `AuditFindingStatusHistory` + lifecycle guard | Done — append-only, no deletes |
| Baselines | `assurance/baseline.service.js` | Done — robust statistics, minimum samples |
| AI abstraction | `assurance/ai/` (providers, redaction, orchestration) | Done — disabled by default |
| APIs | `/api/audit/*` (26 endpoints) | Done — auth, isolation, roles, validation, limits, logging |
| Frontend | `frontend/src/features/assurance/` (9 pages) | Done — new "Financial Assurance" nav section |
| Investigation cases | `assurance/case.service.js` + Cases page | Done — deterministic grouping, AI narrates only |
| Scheduled runs | `workers/assurance.worker.js` + BullMQ scheduler | Done — daily sweep + daily baseline refresh |
| Reporting | `assurance/report.service.js` | Done — "Financial Assurance Report", never "statutory" |
| Docs | `docs/AI_AUDIT_ARCHITECTURE.md` + 5 more | Done |

**Database:** 12 new models (`AuditRule`, `AuditRun`, `AuditEvaluation`,
`AuditFinding`, `AuditFindingRule`, `AuditEvidenceRequirement`, `AuditEvidence`,
`AuditFindingStatusHistory`, `AuditReview`, `AuditCase`, `AuditCaseFinding`,
`AuditBaseline`), mirrored in both Prisma schemas, with 28 indexes and unique
constraints for dedupe. Additive migrations only:
`prisma/migrations/20260725090000_financial_assurance_engine` and
`prisma-postgres/migrations/000066_financial_assurance_engine`. **No canonical
financial model was modified.** Two spec models were deliberately folded rather
than created: `AuditRunSummary` → `AuditRun.summaryJson`, `AuditRuleVersion` →
in-code rule versions + per-finding `ruleVersion` snapshots (documented deviation).

---

## 2. Rules implemented and deferred

**94 implemented** across 9 categories: INVENTORY 15, CASH_CLOSING 14, PURCHASE 13,
CUSTOMER_CREDIT 12, SYNC_INTEGRITY 11, RECONCILIATION 9, EXPENSE 9, BILLING 7,
AUTHORIZATION 4. Full request-to-rule mapping in `AUDIT_RULE_CATALOG.md`.

**8 deferred**, each because the data cannot support it honestly:

| Requested | Why deferred |
|---|---|
| A2 duplicate idempotency key | `sourceDeviceId` is set for every sale; offline origin is not distinguishable. An early version fired on nearly every bill and was removed. DB unique constraints already prevent double-application. |
| B10 backdated ledger adjustment | `UdharLedger` has no business-date column separate from `createdAt` |
| C6 stock corrections per staff member | `StockLedger` has no actor column |
| D8 supplier-level payable reconciliation | no supplier ledger / supplier-payment table |
| D14 changed supplier bank details | no bank-detail fields on `Supplier` |
| E5 expense staff-permission check | `Expense.recordedBy` is free text, not a userId |
| F1/F10 counted-cash variance, repeated shortages | Historical at report date. Later completed with revisioned drawer counts plus `CLOSING_PHYSICAL_CASH_VARIANCE` and `CLOSING_REPEATED_CASH_SHORTAGE`. |
| G12 record overwritten by older version | no row-version column on canonical tables |

---

## 3. MVP acceptance scenario — actual results

One test shop, all 18 required events, run through the real API. Verbatim output
of `assurance-api.integration.test.js`:

```
  ✓ 1. normal cash bill → no finding (correct)
  ✓ 2. normal UPI bill → no finding (correct)
  ✓ 3. correct udhar bill → no finding (correct)
  ⚑ 4. bill marked paid without sufficient payment → MEDIUM 48/100
        [BILL_MARKED_PAID_WITHOUT_PAYMENTS]
        evidence: PAYMENT_RECEIPT, UPI_REFERENCE, STAFF_EXPLANATION
  ⚑ 5. duplicate bill retry → LOW 29/100
        [BILL_NEAR_DUPLICATE] evidence: SALES_INVOICE, CUSTOMER_CONFIRMATION
  ⚑ 6. excessive staff discount → CRITICAL 80/100
        [BILL_DISCOUNT_WITHOUT_AUTHORIZATION, BILL_EXCESSIVE_DISCOUNT, BILL_TOTAL_MISMATCH]
        evidence: SALES_INVOICE, OWNER_APPROVAL, STAFF_EXPLANATION
  ⚑ 7. purchase with missing invoice → HIGH 58/100
        [PURCHASE_MISSING_INVOICE_EVIDENCE, PURCHASE_RECORDED_AFTER_CLOSING_LOCK]
        evidence: PURCHASE_INVOICE, SUPPLIER_INVOICE_NUMBER, OWNER_APPROVAL
  ⚑ 8. purchase quantity differs from stock receipt → HIGH 68/100
        [PURCHASE_RECORDED_AFTER_CLOSING_LOCK, PURCHASE_STOCK_QUANTITY_MISMATCH]
        evidence: GOODS_RECEIPT_CONFIRMATION, PURCHASE_INVOICE, STOCK_COUNT_CONFIRMATION, OWNER_APPROVAL
  ⚑ 9. duplicate supplier invoice → CRITICAL 100/100
        [PURCHASE_DUE_AMOUNT_MISMATCH, PURCHASE_DUPLICATE_INVOICE_NUMBER,
         PURCHASE_MARKED_PAID_WITHOUT_PAYMENT, PURCHASE_RECORDED_AFTER_CLOSING_LOCK,
         PURCHASE_REPEATED_SAME_DAY_AMOUNT, PURCHASE_WITHOUT_STOCK_RECEIPT]
  ⚑ 10. expense without receipt → CRITICAL 94/100
        [EXPENSE_ADDED_AFTER_CLOSING_LOCK, EXPENSE_MISSING_PAYEE,
         EXPENSE_MISSING_RECEIPT, EXPENSE_UNATTRIBUTED]
  ⚑ 11. duplicate expense → HIGH 75/100
        [EXPENSE_ADDED_AFTER_CLOSING_LOCK, EXPENSE_DUPLICATE]
  ⚑ 12+13. unauthorized correction and unsourced stock movement → CRITICAL 100/100
        [STOCK_BALANCE_LEDGER_MISMATCH, STOCK_CHANGED_AFTER_CLOSING_LOCK,
         STOCK_DECREASE_WITHOUT_SOURCE, STOCK_LARGE_MANUAL_CORRECTION, STOCK_UNUSUAL_SHRINKAGE]
  ⚑ 14. customer payment exceeding outstanding → HIGH 67/100
        [UDHAR_NEGATIVE_BALANCE, UDHAR_PAYMENT_EXCEEDS_OUTSTANDING]
  ⚑ 15. backdated bill into locked closing → CRITICAL 81/100
        [BILL_BACKDATED_INTO_LOCKED_DAY, BILL_EDITED_AFTER_CLOSING_LOCK]
  ⚑ 16. duplicate offline sync event → MEDIUM 34/100 [SYNC_DUPLICATE_OFFLINE_EVENT]
  ⚑ 17. cancelled bill still in derived report → HIGH 64/100
        [BILL_CANCELLED_WITHOUT_AUDIT_LOG, CANCELLED_BILL_STILL_IN_LEDGER]
  ⚑ 18. cross-shop reference attempt → CRITICAL 85/100 [BILL_CROSS_SHOP_REFERENCE]
```

All three healthy transactions passed cleanly; all 15 broken ones were flagged with
the expected rule(s). Additionally asserted in the same test:

- every flagged finding's score is **re-derived from its persisted breakdown** and
  matches;
- every flagged finding raised at least one evidence requirement;
- every finding has a status-history row;
- re-evaluating all 18 entities creates **no** duplicate findings;
- the other tenant has **zero** findings despite one of its customers being
  referenced;
- `paidAmount`, `stockBaseQty` and `udharAmount` on the flagged records are
  **unchanged** after flagging;
- the report reflects the scenario and reports `isStatutoryAudit: false`.

A second, independent verification seeded a shop through the running dev server and
evaluated real records: the clean sale scored 0 with no finding; a paid-without-payment
bill scored HIGH 60; a discount+arithmetic bill CRITICAL 80; a receipt-less expense
HIGH 67; an over-collected khata HIGH 67.

---

## 4. Test results

```
npm run test:integration   →  212 tests, 211 pass, 0 fail, 1 skipped (pre-existing)
```

The suite grew from 169 to 212 tests; the 43 new tests are the three assurance
files. All 169 pre-existing tests still pass. Frontend: `tsc --noEmit` clean,
`npm run build` succeeds, all 9 assurance page chunks emit.

Coverage against the 25 required test areas:

| # | Requirement | Where |
|---|---|---|
| 1 | Rule determinism | engine: "risk score is deterministic…" |
| 2 | Duplicate finding prevention | engine: "evaluation is idempotent…"; api: MVP re-run |
| 3 | Risk score calculation | engine: score tests + every rule test asserting exact numbers |
| 4 | Risk-level thresholds | engine: "risk level thresholds sit on documented boundaries" |
| 5 | Rule versioning | engine: "rule registry is well formed and versioned" (ruleId, ruleset hash) |
| 6 | Evidence lifecycle | api: "evidence lifecycle is preserved end to end, and reuse is surfaced" |
| 7 | Finding status transitions | api: "finding lifecycle enforces legal transitions…" (incl. 422 on illegal) |
| 8 | Shop isolation | api: "shop isolation: a finding id from another shop is never readable" |
| 9 | Role permissions | api: staff/manager/reviewer tests |
| 10 | Idempotent evaluation | engine: idempotency test (one finding, upserted rules, no dup requirements) |
| 11 | Engine retries / fault isolation | engine: "a buggy rule cannot take down an evaluation" |
| 12 | AI provider failure fallback | engine: throw / malformed / policy-violation cases |
| 13 | Redaction before external calls | engine: "redaction strips identity before any provider call" |
| 14 | Missing evidence detection | api: evidence lifecycle; MVP #7, #10 |
| 15 | Bill-payment mismatch | engine + MVP #4 |
| 16 | Udhar reconciliation | engine: "udhar reconciliation…"; MVP #14 |
| 17 | Inventory reconciliation | engine: "inventory reconciliation…"; MVP #12+13 |
| 18 | Duplicate purchase | engine: purchase rules; MVP #9 |
| 19 | Duplicate expense | engine: expense rules; MVP #11 |
| 20 | Daily closing mismatch | engine: closing tests; MVP #15 |
| 21 | Backdated transaction detection | engine + MVP #15 |
| 22 | Cancelled-record exclusion | engine: "cancelled bill still affecting ledger, stock and udhar"; MVP #17 |
| 23 | Offline-sync duplicate detection | engine + MVP #16 |
| 24 | Cross-shop reference detection | engine + MVP #18 |
| 25 | Finding audit trail | api: timeline assertions; engine: auto-resolve history row |

Plus 45 frontend-contract checks run against the live dev backend, asserting every
field each page reads (dashboard totals/trend/affected, findings filters, detail
breakdown columns and reproducibility, evidence queue joins, submit→verify
round-trip, run detail, rules catalog and toggle persistence, report shape and
limitations, explanation fallback, baseline recompute).

---

## 5. Bugs found and fixed during implementation

Testing surfaced six real defects in my own code; all are fixed and the rule-level
fixes are documented in the catalog:

1. **Walk-in duplicate false positive.** Two ordinary walk-in sales of the same item
   for the same amount were flagged as duplicates. `BILL_NEAR_DUPLICATE` now needs an
   identified customer, or the same device within 120 s.
2. **Closing-lock finding flood.** A rule flagged every bill recorded after a day's
   lock — one finding per afternoon sale. Now only genuine backdating (pre-lock
   timestamp + post-lock sync trail) is reported per bill; day staleness is reported
   once on the closing. The same fix was applied to stock movements (sale movements
   excluded).
3. **Purchase quantity mis-attribution.** The quick-purchase context matched stock
   rows by time window, so a second purchase of the same product inside the window
   inflated the received quantity. It now follows the explicit `sourceType`/`sourceId`
   link, with the window only as a legacy fallback.
4. **Undetectable rule removed.** `BILL_WEAK_IDEMPOTENCY` fired on nearly every
   bill; removed and documented as deferred.
5. **Daily-closing payment window was wrong.** The closing context loaded payments
   by the *payment's* own date, while the product computes a day's cash from every
   payment attached to that day's bills (`reports.service.js#getDailyClosing`). A
   bill from one day paid on the next would have produced a false
   `CLOSING_CASH_FIGURE_STALE` **and** a false `CLOSING_SPLIT_PAYMENT_MISMATCH`
   (the rule saw only part of the bill's tender). The context now loads payments by
   the day's bill ids, matching the product's own formula.
6. **Background hook contended with foreground writes.** The post-commit queue
   drains on a 250 ms timer, so its audit writes could land in the middle of
   another operation's transaction. On SQLite (which serializes writers) this made
   unrelated test suites fail intermittently — 8 then 16 failures across billing and
   loyalty, depending on timing. Fixed by (a) having the test harness quiesce the
   queue before resetting the database and (b) disabling the automatic hook in the
   test environment, with a documented `setTransactionTriggeredEnabled()` override
   that the one test exercising the hook opts into. This is also a genuine operational
   control: it lets an operator pause post-commit evaluation without a restart.

One design gap was also closed: the 60-point per-rule cap made it impossible for a
single rule to reach CRITICAL, so a cross-tenant data leak scored only HIGH. Rules
can now declare a `minimumRiskScore` floor, applied last and recorded in the
breakdown.

---

## 6. False-positive risks

| Risk | Mitigation |
|---|---|
| Walk-in duplicate sales | device + 120 s requirement (fixed above) |
| Early closing lock ⇒ finding flood | per-bill rule narrowed to genuine backdating (fixed above) |
| `CLOSING_CASH_EXPENSES_NOT_DEDUCTED` fires most days | genuine product gap; materiality-gated, MEDIUM |
| `STOCK_NEGATIVE_BALANCE` in normal kirana operation | MEDIUM severity, framed as "resolve", not "wrong" |
| `UDHAR_AGEING_BEYOND_LIMIT` for shops carrying long khata | configurable ageing limit |
| `EXPENSE_CATEGORY_INCONSISTENT` keyword heuristic | LOW severity, conservative table, shop's own naming wins |
| Thin-history shops | baselines require minimum samples and are skipped otherwise |
| Multi-location stock | whole-product reconciliation skipped when secondary balances exist |

Every rule can be disabled or re-weighted per shop, which is the operational safety
valve for a shop whose practices legitimately differ.

---

## 7. Performance impact

Measured on the dev SQLite database, warm:

| Entity type | Median | Range |
|---|---|---|
| BILL | 15.8 ms | 8.4 – 25.1 ms |
| CUSTOMER | 15.4 ms | — |
| PRODUCT | 4.2 ms | — |
| EXPENSE | 16.8 ms | — |
| **Overall** | **15.8 ms** | p90 25.1 ms |

Full-suite timings: 37 assurance tests in ~10 s including database setup; a
period run over a small shop completes in well under a second.

**Billing latency is unaffected.** Transaction-triggered evaluation is queued
after commit and never awaited by the request; the billing endpoint returns before
any audit work starts (asserted by the transaction-triggered test, which must
explicitly flush the queue before it can observe the run). Evaluation is read-only
toward canonical data.

**One caveat, found while fixing the test flakiness above:** the queue's audit
writes are a separate transaction that can start while other work is in flight.
On SQLite, which serializes writers, that can briefly block a foreground write —
which is exactly what made unrelated suites fail. Production runs PostgreSQL with
MVCC, where an audit write to `Audit*` tables does not block a billing write to
`Bill`/`Payment`, so the effect should not appear there. It has not been measured
under real PostgreSQL load, and `setTransactionTriggeredEnabled(false)` exists to
pause the hook if it ever does.

Cost characteristics: ~10–25 queries per entity, all on indexed
`shopId`-prefixed paths. Period runs are capped at 2,000 entities per type with
truncation recorded in the summary. On PostgreSQL under real load these numbers
will differ; the shape (a bounded number of indexed reads per entity) will not.

---

## 8. Security risks

| Risk | Status |
|---|---|
| Cross-tenant read via id manipulation | Mitigated — shopId from JWT only; 404 for foreign ids; asserted across 5 endpoints |
| Privilege escalation through the audit module | Mitigated — capability matrix; staff/manager negatives asserted |
| Deletion of inconvenient findings | Impossible — no delete path for findings, evidence or history |
| Canonical data mutation by the engine | Impossible by construction; asserted by snapshot test |
| Secret leakage into findings/explanations | No env value, key or token is read into any response |
| Evaluation used as a DoS vector | Per-shop-per-user rate limits on evaluation and explanation routes |
| Findings concentrate sensitive facts | Accepted — same sensitivity as reports, same auth chain, stricter staff filter |

## 9. Privacy risks

| Risk | Status |
|---|---|
| Customer PII sent to an external AI provider | Default `disabled`; redaction + pseudonymisation + a post-redaction PII guard; per-shop consent required |
| Attachments leaving the shop | Blocked unless `AUDIT_AI_ALLOW_ATTACHMENTS=true` |
| Payment references in findings | Masked to last four characters |
| Other tenant's identity in a cross-shop finding | Only "belongs to another shop" + the offending id; asserted no foreign shopId appears |
| Staff inference from assigned findings | Assignment is owner-only and deliberate |
| Provider retention | Unprovable; hence disabled-by-default and per-shop consent |

## 10. Migration risks

- **Additive only.** 12 CREATE TABLEs + indexes; zero ALTER or DROP on existing
  tables. Verified by inspecting the generated SQL.
- **No previously applied migration was modified.**
- **Both schemas updated** (SQLite dev + PostgreSQL prod) and both validate.
- **Rollback** is dropping the 12 new tables; nothing else references them.
- **Test-reset updated** so the new tables are cleared in the right FK order.
- Residual risks: the Postgres migration has not been applied against a real
  PostgreSQL instance in this session (only generated and validated), and
  `resetDatabase` ordering should be re-checked if further FKs are added.

## 11. Unresolved limitations

Full list in `AUDIT_LIMITATIONS.md`. The ones that most constrain what this
product can claim today:

1. It detects **inconsistency, not absence** — a fully off-book sale is invisible.
2. ~~**No physical cash count exists**, so no true cash variance can be computed.~~ Superseded: counts, variance and repeated-shortage trends are now server-backed and attributed.
3. **No bank/UPI feed** — reference reuse is detectable, authenticity is not.
4. **Legacy attribution gaps** remain; new stock movements and expenses carry authenticated actor ids and immutable snapshots.
5. Scheduled runs are wired to BullMQ; execution still requires Redis and a production worker.
6. **Transaction-triggered queue is in-process**, not a durable outbox; dropped
   work is recovered by the next period run because evaluation is idempotent.
7. Investigation-case grouping and its owner-facing UI now exist.
8. **Baseline recomputation is on demand**, not scheduled.

## 12. Readiness assessment

| Stage | Verdict | Reasoning |
|---|---|---|
| **Developer testing** | **Ready** | 206 integration tests pass, builds pass, MVP scenario passes, 45 live contract checks pass |
| **Family-shop testing** | **Ready** | Read-only toward financial data, AI off by default, findings are advisory, every rule can be disabled. Recommend starting with manual runs and reviewing the first week's findings together to tune thresholds |
| **Limited external pilot** | **Ready with conditions** | Needs: (a) the Postgres migration applied and smoke-tested on a real instance, (b) a scheduler for `SCHEDULED` runs, (c) baseline recomputation scheduled, (d) an operator watching false-positive rates per rule for the first weeks. AI should stay `disabled` unless a pilot shop explicitly consents |
| **Paid usage (historical verdict at report date)** | **Not yet** | At the time of this report the blockers included no durable outbox, no server cash count, no supplier ledger, attribution gaps and no investigation-case UI. Later releases added the offline outbox, server-backed revisioned drawer counts, supplier-payment ledger evidence and investigation cases; use current competitive/release evidence rather than this historical verdict for launch decisions. |

### Recommended next steps, in order

1. ~~Add a counted-cash field to daily closing.~~ Completed: the physical count,
   float, till movements, variance, user/device attribution and revision are now
   persisted through the offline outbox.
2. ~~Add `userId` to `Expense` and an actor column to `StockLedger`.~~ Completed for new online/offline records; legacy rows remain explicit.
3. ~~Wire `SCHEDULED` runs and baseline recomputation into the existing jobs infrastructure.~~ Completed; production execution still depends on Redis/worker deployment.
4. Move the transaction-triggered queue onto the durable jobs queue when
   `QUEUES_ENABLED`.
5. ~~Build the `AuditCase` grouping UI and its AI summary.~~ Completed.
6. Add a supplier ledger for true supplier-statement reconciliation.

---

## 12a. Follow-on surfaces completed after the first pass

Three things had models or provider methods but no caller. All three are now
wired, tested and documented.

**Scheduled runs** (`workers/assurance.worker.js`). Registered on the existing
BullMQ scheduler alongside the backup cleanup job: a sweep every 24 h over a 26 h
overlapping window (so a late offline sync is never skipped between ticks), plus a
daily baseline refresh. The sweep only visits shops with activity in the window,
caps at 200 shops per tick, and one shop's failure never stops the rest. Because
evaluation is idempotent, a repeated tick creates nothing — asserted by test
(`findingsCreated === 0` on the second sweep). Requires `QUEUES_ENABLED`, Redis
and a running worker; without those, runs remain transaction-triggered or manual.

**Investigation cases** (`assurance/case.service.js` + Cases page). Grouping is
deterministic: findings are proposed as a group because they share a customer,
supplier, staff member, locked business day, or a repeating rule (a rule firing
across unrelated records is usually a systemic control gap, not isolated
mistakes). Proposals are read-only — nothing is persisted until a reviewer opens a
case. The AI layer only narrates a case that already exists, falling back to
deterministic text when disabled. Closing a case does **not** close its findings;
each keeps its own lifecycle and history, asserted by test.

**Evidence classification** (`POST /api/audit/evidence/classify`). Advisory only:
it suggests an evidence type from a free-text description, is restricted to the
types the engine actually recognises, and returns `advisory: true` plus a note
that the submitted type and its verification remain human decisions. With the
provider disabled it declines rather than guessing (`evidenceType: null`).

Six new tests cover these (case grouping by shared entity, case create /
summarize / close without touching findings, case shop isolation including
rejection of a foreign finding id, scheduled sweep idempotency, baseline refresh,
and the advisory classifier).

---

## 13. Definition-of-done checklist

| # | Criterion | Status |
|---|---|---|
| 1 | Engine evaluates real KiranaOS transactions | ✅ real bills/customers/products/purchases/expenses/closings/sync events |
| 2 | Normal transactions not unnecessarily blocked | ✅ 3 healthy transactions clean; nothing is ever blocked — the engine cannot reject a transaction |
| 3 | Known inconsistencies generate findings | ✅ 15/15 broken events flagged |
| 4 | Each finding explains exactly which rule triggered | ✅ per-rule name, description, numbers, remediation |
| 5 | Every risk score reproducible | ✅ re-derived from persisted breakdown in tests + input hash |
| 6 | Evidence requested, submitted, reviewed, preserved | ✅ full lifecycle asserted |
| 7 | Findings have an immutable lifecycle | ✅ append-only history, no delete path, illegal transitions 422 |
| 8 | Shop isolation verified | ✅ asserted across 5 endpoints + cross-shop rule |
| 9 | Duplicate evaluation ≠ duplicate findings | ✅ asserted |
| 10 | AI-provider failure does not stop the engine | ✅ throw/malformed/policy cases all fall back |
| 11 | No canonical financial data automatically modified | ✅ snapshot test + MVP field assertions |
| 12 | Automated tests pass | ✅ 205/206 (1 pre-existing skip) |
| 13 | Production builds pass | ✅ tsc clean, frontend build succeeds |
| 14 | MVP acceptance scenario passes | ✅ all 18 events |
| 15 | Limitations clearly documented | ✅ `AUDIT_LIMITATIONS.md`, surfaced in the report and UI |
