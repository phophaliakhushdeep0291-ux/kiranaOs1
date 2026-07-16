# Release Gate

Current decision: **NO-GO — baseline evidence not yet recorded**  
Gate owner: Release owner  
Last evaluated: 2026-07-16

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
| Frontend typecheck | `cd frontend && pnpm run typecheck` | Not run for candidate |
| Frontend tests | `cd frontend && pnpm run test` | Not run for candidate |
| Frontend production build/security | `cd frontend && pnpm run build && pnpm run security:check` | Not run for candidate |
| Backend tests | `cd backend && npm test` | Not run for candidate |
| Backend production check | `cd backend && npm run prod:check` | Not run for candidate |
| Integration tests | Isolated DB run, including billing/sync/tenant paths | Not run for candidate |
| Migration safety | `cd backend && npm run migration:safety` | Not run for candidate |
| Existing release gate | `cd backend && npm run release:gate` | Not run for candidate |
| CI certification | `.github/workflows/release-certification.yml` run URL | Not run for candidate |

Any failure is red. Skips require a written exception below; P0 financial, migration, tenant or offline safety checks cannot be waived.

## Manual P0 gate

| Proof | Requirement/QA | Status |
|---|---|---|
| Cash, split, udhar and GST/estimate checkout | BILL-001..004 / MQA-BILL-01 | Not verified |
| Cancel/refund/return exact reversal | BILL-006 | Not verified |
| Offline bill survives reload and syncs once | SYNC-001..002 / MQA-SYNC-01 | Not verified |
| Two-device duplicate/conflict proof | SYNC-002..003 | Not verified |
| Purchase receipt and supplier/stock reconciliation | INV-002..004 / MQA-PUR-01 | Not verified |
| Daily closing and GST sample reconciliation | RPT-001..002 | Not verified |
| 375/390/430/768 mobile matrix | QUAL-003 / all MQA flows | Not verified |
| Backup restore proof and rollback rehearsal | SYNC-005 | Not verified |

## Defect thresholds

- Open P0: 0 required. Current backlog: BUG-001 is P0/in progress; gate is red.
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
