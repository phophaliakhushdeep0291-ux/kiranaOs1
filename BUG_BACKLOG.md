# Bug Backlog

Status: Active  
Last triage: 2026-07-18

## Severity and workflow

- P0: data loss/duplication, wrong money/stock/ledger, cross-tenant/security breach, or core billing unavailable. Blocks all releases and feature work.
- P1: core flow materially broken or unreachable with no safe workaround. Blocks the affected release.
- P2: degraded behavior with a safe workaround.
- P3: polish or low-impact cleanup.

States: `New -> Reproduced -> In progress -> Fixed -> Verified -> Closed`; use `Blocked` only with an owner and next action. Never delete a closed bug; link the fixing commit and regression test.

## Active backlog

| ID | Sev | State | Requirement | Summary | Evidence / next action |
|---|---|---|---|---|---|
| BUG-001 | P0 | Verified | BILL-002, BILL-008 | Frontend billing coupon field typecheck regression reported in the Phase 1 brief. | Frontend typecheck passed and `coupon-atomic-billing.test.ts` passed 3/3 on 2026-07-16; full frontend suite passed 611 tests. Close when the fixing commit is published. |
| BUG-002 | P1 | New | RPT-003 | `FinancialLedger` is written but report ownership/source-of-truth remains architecturally ambiguous. | Decide and document bill-derived versus ledger-derived reporting; add reconciliation tests before switching reads. See `CODE_REVIEW_LOGIC_FLAWS.md` item 4. |
| BUG-003 | P2 | New | BILL-004, RPT-002 | Exclusive-GST discount tax-base behavior needs a compliance decision. | Obtain accountant/product ruling, document tax policy, then add fixture parity test. See logic review item 6. |
| BUG-004 | P3 | New | SYNC-002 | UUID classification assumes server IDs remain CUIDs. | Encode ID-format contract or change resolver before any server UUID migration. See logic review item 10. |
| BUG-005 | P1 | New | BILL-007, HW-001 | Print retry journal and per-device real-hardware certification are not yet proven. | Inventory supported models; run failure/reconnect/paper-out cases and retain artifacts. |
| BUG-006 | P1 | New | INV-006 | Barcode generation/printing and reorder suggestion coverage is not established. | Audit UI/backend, split missing behavior into scoped stories/tests. |
| BUG-007 | P1 | Verified | INV-004 | Supplier ledger end-to-end reconciliation evidence is complete. | PO receipt proves partial paid/due allocation, exact stock, weighted-average cost, retry safety and supplier-history uniqueness. Focused 390px settlement/reversal QA proves ₹900 -> ₹700 -> ₹900, owner PIN, immutable history, exact-event replay, 44px controls and zero overflow/runtime errors. |
| BUG-008 | P1 | New | SYNC-003 | Conflict policies exist but require a complete entity-by-entity certification. | Create matrix for bill, payment, udhar, product, stock, purchase and customer conflicts; test forced conflicts. |
| BUG-009 | P1 | New | QUAL-003 | Full live mobile screenshot matrix is not automated or retained for all core pages. | Add Playwright/live QA harness and artifacts for all `MOBILE_UX_PLAN.md` QA IDs. |
| BUG-010 | P0 | Verified | SYNC-005, QUAL-004 | Railway container crashed because `src/modules/backups/backup.service.js` was absent from the Git build. | Root cause: unanchored `backend/.gitignore` entry `backups` hid the source directory. Changed it to `/backups/`, made the service visible to Git, and added deployment/production-check regressions. Railway `/api/health`, `/health`, and `/health/ready` returned HTTP 200 on 2026-07-16; database and storage checks reported `ok`. |
| BUG-011 | P0 | Verified | INV-002, SYNC-002 | A purchase-receipt retry key could alias a changed payload or a different PO, and successful retries duplicated the owner audit event. | Replay compatibility now binds the key to PO, payment, invoice, item quantities/rates and batch dates; mismatch returns `IDEMPOTENCY_KEY_REUSED`. Controller emits audit/webhook only for the first mutation. The branch-aware purchase integration proof passed on 2026-07-18. |

## Fixed findings awaiting historical closure

The dated resolution table in `CODE_REVIEW_LOGIC_FLAWS.md` reports fixes for report day counts/timezones, subscription grace, shop-header trust, webhook idempotency and udhar double-counting. Before closing them here, link each fixing commit and a passing regression-test run for the release candidate.

## Bug template

```text
ID: BUG-NNN
Severity / state:
Requirement IDs:
Environment and commit:
Preconditions:
Steps to reproduce:
Expected / actual:
Money, stock, ledger, sync or tenant impact:
Evidence (log/screenshot/correlation ID):
Root cause:
Fix commit:
Regression test:
QA flow and verifier:
```

## Triage rules

Triage daily during hardening and beta. A bug affecting money, inventory or offline writes must include backend validation and idempotency analysis. A mobile bug must name viewport and keyboard/nav state. Beta feedback becomes a bug only when reproducible; otherwise log it as a research observation and assign an experiment.
