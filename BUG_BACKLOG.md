# Bug Backlog

Status: Active  
Last triage: 2026-08-08

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
| BUG-002 | P1 | Verified | RPT-003 | Reporting authority is explicit: operational tables plus locked daily snapshots remain customer-facing truth; `FinancialLedger` is an append-only journal and future read-model candidate. | Owner/admin-only all-time reconciliation exposes exact paise variance and blocks read cutover unless all supported KPIs match. Focused integration proves staff denial, zero parity, intentional 1-paise drift detection, and cancellation netting (11/11 on 2026-07-31). See `CODE_REVIEW_LOGIC_FLAWS.md` item 4. |
| BUG-003 | P2 | New | BILL-004, RPT-002 | Exclusive-GST discount tax-base behavior needs a compliance decision. | Obtain accountant/product ruling, document tax policy, then add fixture parity test. See logic review item 6. |
| BUG-004 | P3 | Verified | SYNC-002 | Offline identity resolution no longer assumes every UUID is client-local. | Client-created records already use explicit `local_`/entity prefixes, so the over-broad UUID heuristic was removed. CUID, UUIDv4, UUIDv7 and ULID server identities now remain eligible for normal lookup/validation instead of being stranded as `SYNC_DEPENDENCY_PENDING`; focused ID-format examples pass on 2026-08-08. |
| BUG-005 | P1 | In progress | BILL-007, HW-001 | The one-click signed-installer source, automatic service, native printer picker/test print, six-character ten-minute single-use pairing, update notice, durable restart journal and simulated failure/retry guards are implemented. `hardware-bridge` passes 12/12 software tests. | Certification is explicitly limited to **TVS RP 3160 Gold** and **Epson TM-T82III**; every other model is unsupported. BUG-005 remains open for both models because clean-Windows and physical normal/paper-out/disconnect/power-off/retry/no-duplicate/drawer artifacts have not been produced in this workspace. Close only the individual model rows after all retained evidence in `hardware-bridge/README.md` is complete; do not treat software simulation as physical certification. |
| BUG-006 | P1 | Verified | INV-006 | Barcode generation/printing and reorder suggestion coverage is established. | Products can generate checksum-valid restricted-circulation EAN-13 codes, print one or all selected price labels with EAN-13/QR fallback, and report blocked print popups. Purchase orders expose deterministic 30-day demand/safety-stock/open-order evidence, supplier-separated editable suggestions, receipt reconciliation, and stock/cost updates. Frontend barcode/label and reorder-transparency coverage passed 15/15 and backend reorder examples passed on 2026-08-08; physical printer certification remains tracked separately by BUG-005. |
| BUG-007 | P1 | Verified | INV-004 | Supplier ledger end-to-end reconciliation evidence is complete. | PO receipt proves partial paid/due allocation, exact stock, weighted-average cost, retry safety and supplier-history uniqueness. Focused 390px settlement/reversal QA proves ₹900 -> ₹700 -> ₹900, owner PIN, immutable history, exact-event replay, 44px controls and zero overflow/runtime errors. |
| BUG-008 | P1 | Verified | SYNC-003 | Conflict handling is certified by entity rather than using one unsafe last-write-wins rule. | Product, customer and supplier snapshots allow owner-audited local/cloud resolution while excluding stock, cost and ledger-derived balances. Bill, payment, Udhar, stock-ledger and purchase conflicts are forced through reversal/compensating-entry workflows and remain open after a rejected overwrite attempt. Event classification now preserves those financial entity types (including `UDHAR_PAYMENT`, which previously looked like a mutable customer conflict). The classifier matrix passes, focused frontend conflict/redaction coverage passes 13/13, and the forced API sync integration passes 45/45 on 2026-08-08. |
| BUG-009 | P1 | New | QUAL-003 | Full live mobile screenshot matrix is not automated or retained for all core pages. | Add Playwright/live QA harness and artifacts for all `MOBILE_UX_PLAN.md` QA IDs. |
| BUG-010 | P0 | Verified | SYNC-005, QUAL-004 | Railway container crashed because `src/modules/backups/backup.service.js` was absent from the Git build. | Root cause: unanchored `backend/.gitignore` entry `backups` hid the source directory. Changed it to `/backups/`, made the service visible to Git, and added deployment/production-check regressions. Railway `/api/health`, `/health`, and `/health/ready` returned HTTP 200 on 2026-07-16; database and storage checks reported `ok`. |
| BUG-011 | P0 | Verified | INV-002, SYNC-002 | A purchase-receipt retry key could alias a changed payload or a different PO, and successful retries duplicated the owner audit event. | Replay compatibility now binds the key to PO, payment, invoice, item quantities/rates and batch dates; mismatch returns `IDEMPOTENCY_KEY_REUSED`. Controller emits audit/webhook only for the first mutation. The branch-aware purchase integration proof passed on 2026-07-18. |
| BUG-012 | P0 | Verified | BILL-006, INV-002, SYNC-002 | An offline owner cancellation reversed local Udhar but left the sale's stock deducted until a later server pull; a repeated local action could append the cancellation correction twice. | Cancellation is now one local transaction across the bill, pooled/per-pack stock, inventory reversal, Udhar correction, audit and stable outbox event, with stable correction identities and an already-cancelled guard. Snake-case server-hydrated Udhar bills are normalized before reversal. Backend billing passes 19/19; the focused cancellation/reconciliation/security set passes 29/29. Live 390px bill #2 remained Cancelled after reload, restored Mohan's Udhar ₹362 -> ₹356, retained the owner reason, removed destructive actions, used 44px controls, and had zero overflow/console errors. |
| BUG-013 | P0 | Verified | SYNC-003, BILL-008 | A rejected owner action could expose the entered owner PIN inside the sync-conflict field diff and technical details. | Conflict snapshots are recursively sanitized before local persistence, cross-device reporting and display; credential keys are omitted while `ownerPinProvided` evidence remains. Focused redaction coverage passes and live Sync Status contains neither the PIN value nor the owner-PIN field. |
| BUG-015 | P1 | Reproduced | ADM-001, SYNC-002 | Three simultaneous logins on a 2-slot plan register only 1 device; one login's interactive transaction times out (`P2028 Transaction already closed`) on `device.create`, then the SQLite query engine panics (`internal error: entered unreachable code`) and every later test in the file fails on the dead engine. | Deterministic across two runs (`device-session-slots.integration.test.js:168`, ~6.0s each). Fails safe — it under-registers, never over-registers past the plan limit — and all five sequential device-slot tests in the same file pass. The in-process shop lock and the PostgreSQL advisory lock both look correct on inspection, so this may be SQLite-only; confirm against PostgreSQL (`npm run test:postgres`) before deciding whether the product path needs a fix. 23/24 integration files pass. |
| BUG-014 | P1 | Verified | QUAL-003 | The shell class refactor left desktop `<aside>`/`<header>` elements without mobile fallback rules, allowing desktop and phone navigation chrome to render together after session unlock. | Explicit max-1023px shell geometry hides desktop chrome and removes desktop margin. Live 390x844 post-unlock proof reports both desktop elements as `display:none`, stable Billing History title, mobile bottom navigation, 390px document width and zero runtime errors. |
| BUG-016 | P0 | Verified | SYNC-005 | Restaurant add-on menus and sold-line choices could be omitted from a complete restore. | `MenuAddonGroup`, `MenuAddonOption`, and `ProductAddonGroup` are classified as restorable shop configuration; `BillItemAddon` restores through `BillItem` as immutable receipt history. The exact backup schema is bumped to `2026-08-08-complete-v3`, and the model-policy plus transactional backup tests guard the classification. |
| BUG-017 | P0 | Verified | SYNC-002, SYNC-003 | A stale offline customer edit could silently overwrite a newer server edit, and one rejected operation could appear as two owner-review conflicts. | Customer updates now carry and exactly compare the synced `baseUpdatedAt`; mismatches retain one authoritative server conflict, reuse that row for legacy client reports, collapse historical duplicates in the UI, cascade linked resolution, preserve ISO timestamps in snapshots and write an owner/device audit. Focused frontend coverage passes 33/33 and the targeted backend two-device integration passes 1/1. Live 390x844 QA showed Device B's stale name beside Device A's cloud name in one customer review card; the authenticated `use_server` decision resolved the only open customer row, produced `SYNC_CONFLICT_RESOLVED`, and left the customer ledger unchanged. |
| BUG-018 | P0 | Verified | SYNC-005, QUAL-004 | Rolling back a restore with its automatic recovery artifact restored business data but erased the audit row for the forward restore. | The serializable restore transaction now carries backup/restore control-plane audit rows forward while rewinding the historical business audit from the artifact. The focused recovery suite passes 4/4: state B returns exactly, both restore actions remain auditable and `dataEpoch` advances twice. The broader encrypted-backup suite passes 8/8. |

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
