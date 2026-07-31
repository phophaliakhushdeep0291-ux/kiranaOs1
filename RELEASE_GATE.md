# Release Gate

Current decision: **NO-GO — candidate/external/manual evidence incomplete**
Gate owner: Release owner  
Last evaluated: 2026-07-22

No new feature should enter a release branch while the P0 production gate is red. This document records the decision; `PRODUCTION_CHECKLIST.md` contains the full operational checklist.

## Candidate

| Field | Value |
|---|---|
| Version/tag | Not assigned |
| Commit | Not recorded |
| Staging URL | Not recorded |
| Evaluated by | Not assigned |
| Evidence directory/run URL | Not recorded |

## Automated P0 gate

Run against a clean checkout with supported Node versions and frozen installs.

| Gate | Command/evidence | Status |
|---|---|---|
| Frontend typecheck | `cd frontend && npm run typecheck` | Local baseline passed 2026-07-22 |
| Frontend tests | `cd frontend && npm run test` | Local baseline passed 2026-07-22: 682 passed, 1 skipped |
| Frontend production build/security | `cd frontend && npm run build && npm run security:check` | Local baseline passed 2026-07-22: 2825.9 kB raw / 838.0 kB gzip; bundle budget and production-app check passed |
| Backend tests | `cd backend && npm test` | Local baseline passed 2026-07-18, including AI hallucination, GST, loyalty and payment integrity suites |
| Backend production check | `cd backend && npm run prod:check` | Local baseline passed after Railway packaging fix |
| Integration tests | Isolated DB run, including billing/sync/tenant paths | SQLite baseline: 153 passed, 1 PostgreSQL-only suite skipped; focused owner-RBAC expansion passed 13/13 |
| Migration safety | `cd backend && npm run migration:safety` | Local baseline passed, 0 warnings |
| Existing release gate | `cd backend && npm run release:gate` | Local baseline passed; human approval warning remains |
| CI certification | `.github/workflows/release-certification.yml` run URL | Candidate run URL not recorded |

Any failure is red. Skips require a written exception below; P0 financial, migration, tenant or offline safety checks cannot be waived.

## Manual P0 gate

| Proof | Requirement/QA | Status |
|---|---|---|
| Cash, split, udhar and GST/estimate checkout | BILL-001..004 / MQA-BILL-01 | Not verified |
| Cancel/refund/return exact reversal | BILL-006 | Not verified |
| Offline bill survives reload and syncs once | SYNC-001..002 / MQA-SYNC-01 | Not verified |
| Two-device duplicate/conflict proof | SYNC-002..003 | Not verified |
| Purchase receipt and supplier/stock reconciliation | INV-002..004 / MQA-PUR-01 | Verified. Backend proofs cover partial due, weighted cost, exact stock/lots, audit uniqueness and strict replay identity. Live 390px create/receive reconciled stock 24 -> 28 and ₹920 = ₹100 paid + ₹820 due. Live settlement/reversal proved ₹900 -> ₹700 -> ₹900, exact-event replay, 390x844 geometry, 44px controls and zero runtime/overflow errors. |
| Daily closing and GST sample reconciliation | RPT-001..002 | Not verified |
| 375/390/430/768 mobile matrix | QUAL-003 / all MQA flows | Overview routes for Billing, Products, Inventory, Purchases, Reports, Settings and Sync pass overflow/runtime smoke; Customers has separate multi-width evidence. Full transactional flows remain open. |
| Backup restore proof and rollback rehearsal | SYNC-005 | Not verified |

Supplier settlement/reversal addendum (2026-07-18): dedicated immutable payment and owner-gated reversal events pass focused frontend tests (8/8), backend sync integration (37/37), and live 390px settlement/reversal capture, including exact-event replay, due restoration and zero visual/runtime errors. MQA-PUR-01 is closed for this release scope.

Replenishment and return-ledger addendum (2026-07-18): deterministic 30-day net-sales recommendations now expose their inputs, evidence strength, calculation version, branch stock, open-order coverage and editable quantity; supplier groups cannot be silently combined into one PO. Sale returns now post explicit revenue/tender or gift-liability reversals to the append-only financial ledger. The combined backend suite, 153/154 SQLite integration tests (one expected PostgreSQL-only skip), 682 frontend tests (one skip), typecheck, production build, bundle budget and production-app check pass. This is local proof only and does not replace PostgreSQL concurrency, provider, deployment, backup/restore or human release evidence.

Accounting-integrity addendum (2026-07-22): bill postings now balance cash, UPI, bank, receivables, gift-card redemption/return liability and explicit waiver expense legs; supplier payments and reversals are projected into fixed debit/credit accounts. The owner-only shop control returns integer-paise trial-balance evidence, balanced source groups, coverage, unmapped rows and visible exceptions without inventing balancing entries. Contract coverage is 140 endpoints. This is a ledger control, not statutory-complete accounting: inventory valuation/COGS, purchase principal/AP, operating expenses, GST input/output liability, bank-statement matching, TDS/TCS and statutory statements remain open.

Reporting-authority addendum (2026-07-31): operational tables and locked daily-closing snapshots remain the customer-facing report authority. `FinancialLedger` is an append-only journal and future read-model candidate. The owner/admin reconciliation endpoint compares supported shop-wide current-state KPIs at exact paise precision and refuses cutover evidence on any variance; focused integration passes 11/11, including staff denial, deliberate one-paise drift and cancellation netting. Historical period restatement, location-scoped journal parity and premium 390px report-flow QA remain open.

## Defect thresholds

- Open P0: 0 required. BUG-001 is locally verified and BUG-010 is verified on Railway production. Formal candidate approval still requires the missing CI run URL and sign-offs.
- Open release-scope P1: 0 required unless explicitly accepted by product and engineering with a safe workaround.
- Flaky tests: 0 unexplained. A rerun is evidence of flakiness, not a pass.
- Money/stock/ledger reconciliation variance: exactly 0 paise/units unless a documented rounding rule applies.
- Lost or duplicate offline operations: 0.

## Go/no-go rule

GO requires every automated P0 row green on the exact candidate commit, every applicable manual P0 proof linked, defect thresholds met, recent backup/restore evidence, and named product plus engineering sign-off. Otherwise the decision remains NO-GO.

## Exceptions

No exceptions recorded. An exception must include requirement/bug ID, customer impact, workaround, telemetry, rollback trigger, expiry date and approvals. Exceptions never convert a failed correctness or security proof into green.

## Sign-off

| Role | Name | Decision | Timestamp |
|---|---|---|---|
| Product | — | Pending | — |
| Engineering | — | Pending | — |
| QA/release | — | Pending | — |
| Operations (production only) | — | Pending | — |

## Release record template

```text
Candidate commit/tag:
Gate command outputs / CI URL:
Requirement IDs changed:
Automated tests:
Manual QA flows and screenshots:
Migration/backup/restore evidence:
Open risks and accepted exceptions:
Rollback trigger and owner:
Final decision and signatories:
```
