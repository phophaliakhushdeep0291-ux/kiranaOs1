# Release Gate

Current decision: **NO-GO — candidate/external/manual evidence incomplete**
Gate owner: Release owner  
Last evaluated: 2026-08-10

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
| Frontend typecheck | `cd frontend && npm run typecheck` | Local working tree passed 2026-08-10 |
| Frontend tests | `cd frontend && npm run test` | Local working tree passed 2026-08-10: 1,344 passed, 1 skipped across 215 passed files and 1 skipped file |
| Hardware bridge software/installer contract | `cd hardware-bridge && npm test` plus PowerShell parser | Local working tree passed 2026-08-10: 15/15 software tests and `windows/build-installer.ps1` syntax. Native .NET setup compilation, signed workflow artifact, clean-Windows install and physical printer runs remain external evidence. |
| Frontend production build/security | `cd frontend && npm run build && npm run security:check` | Local working tree passed 2026-08-10: startup 850.1 kB raw / 254.1 kB gzip across 5 files; total JavaScript 3,959.5 kB raw / 1,159.6 kB gzip; largest offline shop payload restaurant 2,421.8 kB raw / 723.5 kB gzip across 111 files; fixed bundle budgets and production-app checks passed. Translation parity passes for 1,091 keys across 6 modules. Vite still reports that the remote-support dynamic imports of `sync-engine` and `cloud-hydration` cannot split those already-static modules; the measured bundles remain inside the enforced budgets. |
| Backend tests | `cd backend && npm test` | Full local working-tree suite passed 2026-08-10, including the guarded isolated database pretest/posttest, billing, money, sync, tenant, compliance, provider-contract, vertical, restaurant and per-pack stock groups. |
| Backend production check | `cd backend && npm run prod:check` | Local working tree passed 2026-08-10 after packaging and current-plan checks |
| Integration tests | Isolated DB run, including billing/sync/tenant paths | Current isolated SQLite matrix passed 28/28 files on 2026-08-10; only the explicitly PostgreSQL-only production-concurrency test was skipped. This includes billing 20/20, restaurant 3/3, sync 45/45, device slots 14/14, reports 12/12, owner/RBAC 14/14 and tenant isolation 5/5. |
| Migration safety | `cd backend && npm run migration:safety` | Local working tree passed 2026-08-10 with 0 warnings |
| Existing release gate | `cd backend && npm run release:gate` | Local working tree passed 2026-08-10; human approval warning remains |
| CI certification | `.github/workflows/release-certification.yml` run URL | Candidate run URL not recorded. Run #316 (2026-08-09) was refused by GitHub before it started — "recent account payments have failed or your spending limit needs to be increased" — so no certification evidence exists for the current commit. Merge runs now defer the Docker image proof to the weekly and manual runs (`RELEASE_CERT_SKIP_IMAGE`), where it is recorded as a skip with its reason; strict certification still requires the image, so a release cannot be certified without one. |
| Local certification (interim, not a substitute for CI) | `cd backend && npm run release:certify:local` | `local-passed` on 2026-08-09 at commit `eaaf0105`: 12 passed, 0 failed, 0 blocked, 9 skipped, 322s. Evidence: `docs/evidence/local-release-certification-latest.json`. Working tree was dirty. The 9 skips are every proof needing infrastructure this machine has none of — PostgreSQL (server is up but the `kiranaos` role fails password auth), Redis/worker, Docker image, live API smoke, cloud object storage, and the restore drill — so this run does **not** stand in for the CI certification. |

Any failure is red. Skips require a written exception below; P0 financial, migration, tenant or offline safety checks cannot be waived.

## Manual P0 gate

| Proof | Requirement/QA | Status |
|---|---|---|
| Cash, split, udhar and GST/estimate checkout | BILL-001..004 / MQA-BILL-01 | Locally verified. Live 390px cash and ₹20 cash + ₹30 UPI split bills persist, sync and appear once with distinct payment modes; a separate estimate uses the EST series and remains separated in history. The dedicated Udhar run rejected walk-in credit, committed a named customer's ₹675/₹0-paid bill while the backend was unavailable, reconciled it to KOS-2026-000003, and retained the ₹590 Large plus ₹85 add-on snapshot. Server proof after a repeated sync shows one bill, one ₹675 ledger debit, zero payment rows and ₹675 outstanding. Exact inclusive-GST accounting is covered by the RPT-001..002 release fixture. |
| Cancel/refund/return exact reversal | BILL-006 | Verified. A mixed cash/UPI/Udhar bill is denied with the wrong PIN, then cancellation restores stock, clears Udhar, nets every financial leg to 0 paise, persists the reason/audit and stays exact-once on retry (backend billing 19/19). Offline cancellation applies bill, pooled/per-pack stock, inventory, Udhar, audit and stable outbox changes in one transaction. Live 390px bill #2 stayed Cancelled after reload, reversed Udhar ₹362 -> ₹356, retained the reason, removed destructive actions, used 44px controls and had zero overflow/console errors. |
| Receipt preview, print and share | BILL-007 / MQA-BILL-01, MQA-SET-01 | Software path partially verified. Live 390x844 QA rendered the 80mm receipt, proved GST/previous-Udhar toggle updates, recorded one downloaded receipt as Saved and one browser print as Dialog opened, and launched duplicate print without mutating the cancelled bill. A restaurant bill detail retained `Large` and `Finish your plate: Smoked mozzarella +₹85` in a full-width phone card; duplicate-receipt normalization is regression-tested. Printer and bill/share actions measure 44px; the restaurant document and item card measure 390/390 and 346/346 with no horizontal scroll. No external WhatsApp/email was sent. Real thermal-printer failure/retry and per-model certification remain open, so BILL-007/HW-001 are not closed. |
| Offline bill survives reload and syncs once | SYNC-001..002 / MQA-SYNC-01 | Verified for cash and Udhar. The 390px Udhar run saved `PENDING-B87FA9` locally with the backend unavailable, exposed one actionable failed backup after reconnect, then reconciled to KOS-2026-000003. A repeated force sync uploaded 0 changes; the server still held exactly one bill, one ₹675 debit, no payment row and ₹675 outstanding. Sync Status ended at 0 pending/failed/conflicts and sequence lag 0. Full operating-system airplane-mode toggle proof remains open. |
| Two-device duplicate/conflict proof | SYNC-002..003 | Verified for mutable customer conflicts. At 390x844, Devices A and B edited the same synced customer while offline; A synced first, B retained its stale local value, and Sync Status showed exactly one customer review card with the local/cloud diff and ISO timestamps. The owner-authenticated `use_server` decision resolved that single durable row, wrote `SYNC_CONFLICT_RESOLVED`, and left zero open customer conflicts; historical UI recovery also proved Device B converged to the cloud value. Focused frontend coverage passes 33/33 and the targeted backend two-device integration passes 1/1. One unrelated historical bill conflict remains open because immutable financial records require reversal/correction, not overwrite. |
| Purchase receipt and supplier/stock reconciliation | INV-002..004 / MQA-PUR-01 | Verified. Backend proofs cover partial due, weighted cost, exact stock/lots, audit uniqueness and strict replay identity. Live 390px create/receive reconciled stock 24 -> 28 and ₹920 = ₹100 paid + ₹820 due. Live settlement/reversal proved ₹900 -> ₹700 -> ₹900, exact-event replay, 390x844 geometry, 44px controls and zero runtime/overflow errors. |
| Daily closing and GST sample reconciliation | RPT-001..002 | Verified for the release sample. A ₹236 inclusive-GST invoice + ₹50 estimate − ₹118 refund reconciles to ₹168 closing sales; mixed tender, ₹20 udhar recovery and ₹10 cash expense reconcile to ₹22 expected drawer cash. Persisted snapshot equals live closing. GST excludes the estimate and nets to ₹100 taxable + ₹18 tax, exactly matching invoice + credit note. Focused integration passes 12/12. |
| 375/390/430/768 mobile matrix | QUAL-003 / all MQA flows | Overview routes for Billing, Products, Inventory, Purchases, Reports, Settings and Sync pass overflow/runtime smoke; Customers has separate multi-width evidence. Premium Reports and Daily Closing layouts pass all four target widths. Restaurant add-on configuration, ₹675 checkout and final bill detail pass all four widths with no overflow or sub-44px active controls. The Udhar variant is additionally proven at 390x844 through local save, recovery, synced history and final detail; its detail is 390/390 with zero sub-44px controls. The Sync Status audit found and source-fixed one separate 36px refresh action, whose post-fix live recapture remains open. Retained artifacts: `docs/evidence/mobile-restaurant-addon/` and `docs/evidence/mobile-udhar/`. Other core transactional flows and the other three Udhar widths remain open. |
| Backup restore proof and rollback rehearsal | SYNC-005 | Local tenant-logical path verified. A deterministic 12-month shop (216 bills, 18 purchases, 10 udhar recoveries) was encrypted, all restorable rows were destroyed, and 1,781 records across 77 tables were restored in 0.616s with 0 paise and 0 stock-unit variance. Corruption/tamper refusal, one-paise/one-unit drift detection, stale-device rejection and recovery-artifact rollback are green; forward and rollback restores both remain audited. Production PostgreSQL/object-storage restore evidence and the automated daily backup needed for a <=24h RPO remain open, so this row does not make the candidate GO. |

Supplier settlement/reversal addendum (2026-07-18): dedicated immutable payment and owner-gated reversal events pass focused frontend tests (8/8), backend sync integration (37/37), and live 390px settlement/reversal capture, including exact-event replay, due restoration and zero visual/runtime errors. MQA-PUR-01 is closed for this release scope.

Replenishment and return-ledger addendum (2026-07-18): deterministic 30-day net-sales recommendations now expose their inputs, evidence strength, calculation version, branch stock, open-order coverage and editable quantity; supplier groups cannot be silently combined into one PO. Sale returns now post explicit revenue/tender or gift-liability reversals to the append-only financial ledger. The combined backend suite, 153/154 SQLite integration tests (one expected PostgreSQL-only skip), 682 frontend tests (one skip), typecheck, production build, bundle budget and production-app check pass. This is local proof only and does not replace PostgreSQL concurrency, provider, deployment, backup/restore or human release evidence.

Accounting-integrity addendum (2026-07-22): bill postings now balance cash, UPI, bank, receivables, gift-card redemption/return liability and explicit waiver expense legs; supplier payments and reversals are projected into fixed debit/credit accounts. The owner-only shop control returns integer-paise trial-balance evidence, balanced source groups, coverage, unmapped rows and visible exceptions without inventing balancing entries. Contract coverage is 140 endpoints. This is a ledger control, not statutory-complete accounting: inventory valuation/COGS, purchase principal/AP, operating expenses, GST input/output liability, bank-statement matching, TDS/TCS and statutory statements remain open.

Reporting-authority addendum (2026-07-31): operational tables and locked daily-closing snapshots remain the customer-facing report authority. `FinancialLedger` is an append-only journal and future read-model candidate. The owner/admin reconciliation endpoint compares supported shop-wide current-state KPIs at exact paise precision and refuses cutover evidence on any variance; focused integration passes 11/11, including staff denial, deliberate one-paise drift and cancellation netting. Premium Reports and Daily Closing phone layouts pass live 375/390/430/768 geometry checks with zero overflow; focused frontend closing coverage passes 28/28 and typecheck passes. Historical period restatement and location-scoped journal parity remain open.

Closing/GST addendum (2026-07-31): one API-driven release fixture now ties the immutable invoice and refund lines to the live Daily Closing, persisted snapshot and GST report. Exact paise checks cover cash/UPI/bank/credit, old-udhar cash recovery, cash expense, estimate inclusion in operational sales, estimate exclusion from GST, and intrastate CGST/SGST netting. Focused report integration passes 12/12. This closes the release sample only; BUG-003's exclusive-GST discount policy still requires the documented accountant/product ruling.

Offline bill identity addendum (2026-07-31): live same-content repeat-sale QA exposed a repair heuristic that could merge a new pending bill into an earlier server bill when both were created inside the same five-minute window. The repair now requires matching durable client identity whenever both sides carry one; the content/time heuristic is legacy-only. The regression test preserves both distinct bills and the pending outbox row. Focused frontend sync suites pass 39/39, backend sync integration passes 40/40, and live 390px proof shows consecutive KOS-2026-000005 cash and KOS-2026-000006 split bills both synced and visible with zero horizontal overflow. Conflict resolution also ignores empty wrapper snapshots before selecting plain local/server entity data; mutable customer resolution and immutable financial blocking now pass in the same 40/40 suite.

Cancellation-integrity addendum (2026-08-01): BILL-006 evidence ties authorization, persisted reason/audit, stock, mixed cash/UPI/Udhar and append-only financial effects into one release fixture. Backend billing passes 19/19 with exact zero-paise/unit netting and retry idempotency. Offline cancellation commits the optimistic bill, pooled/per-pack stock, inventory reversal, Udhar correction, audit and stable outbox event together; stable correction identities and an already-cancelled guard prevent duplicate reversal. Server-hydrated snake-case money/customer fields are normalized. The focused cancellation/reconciliation/security set passes 29/29 and typecheck passes. Live 390px bill #2 stayed Cancelled after reload, reversed Mohan's Udhar ₹362 -> ₹356, retained `Mobile QA verified cancellation`, removed edit/add/return/cancel actions, showed correct cloud identity, used 44px controls and had zero horizontal overflow or console errors. Sync conflict snapshots are also recursively sanitized so owner PIN values cannot appear in field diffs or technical details. The intentionally failed pre-PIN QA attempt remains a visible conflict-recovery item and does not invalidate the successful configured-PIN proof.

Customer-conflict addendum (2026-08-08): stale mutable edits now use the exact synced record timestamp as an optimistic version guard. One rejected operation owns one durable server conflict even when an older client reports it again; historical duplicate cards are collapsed, linked rows resolve together, and Date/BigInt snapshots remain JSON-safe. The targeted backend two-device integration passes 1/1 and focused frontend sync/customer coverage passes 33/33. Live 390x844 QA forced `Mohan Live Device A` versus `Mohan Live Device B`, displayed one customer decision with valid ISO cloud timestamps, resolved the authoritative row through the owner-authenticated endpoint and recorded the owner/device audit. The demo customer was restored to `Mohan Lal Verma`; its ₹356 ledger balance did not change. The final fresh post-resolution browser reload could not be recaptured because the new QA browser window retained a blocked connection-error page, so the gate relies on the captured pre-resolution phone UI, the earlier live in-UI recovery/convergence, and fresh HTTP/database/audit evidence rather than claiming a second post-resolution screenshot.

Tenant-restore addendum (2026-08-08): the add-on-aware logical snapshot covers 77 tables. The current-schema year drill restored 1,781 records in 0.616s and reconciled ₹77,672.00 sales, ₹6,830.97 GST, every tender, customer balance, supplier due and product stock at zero variance. The detector independently fails on one paise and one stock unit. Focused integration passes 4/4 for truncated/tampered artifacts, stale-device replay prevention and full recovery-artifact rollback, while the encrypted-backup suite passes 8/8. The rollback test exposed and fixed loss of the first restore audit; control-plane backup/restore audits now survive subsequent restores. This proves the local tenant-logical path only. Strict production certification still needs a managed PostgreSQL restore target, cloud object storage, worker/queue evidence and an actual daily backup schedule/provider policy.

Restaurant portion/add-on addendum (2026-08-08): a retail-pack MRP ceiling was incorrectly applied to recipe portions, changing a configured ₹590 Large price to ₹588 and a ₹85 add-on total from the expected ₹675 to ₹673. Frontend and backend pricing now exempt portions unless that portion has its own explicit maximum. Focused unit coverage, the 3/3 database integration and live checkout prove ₹590 + ₹85 = ₹675; the database proof also reconciles 1.4 dish units, 0.56 recipe units and 0.1 add-on ingredient units. Final bill detail and duplicate-receipt data retain the variation and add-on snapshot. Live QA first changed the phone detail from an internally scrolling table to a full-width card, then the 375px checkout exposed and closed BUG-021's sub-44px controls. Add-on configuration, checkout and final detail now pass the complete 375/390/430/768 matrix with no document/internal overflow and no measured sub-44px active control. Evidence and geometry are retained in `docs/evidence/mobile-restaurant-addon/`. This closes BUG-019, BUG-020 and BUG-021 locally, but it is not candidate CI or broader transactional-flow evidence.

Hardware-bridge addendum (2026-08-08): print idempotency now binds each job id to the exact SHA-256 receipt/control payload, rejects concurrent or restarted same-id/different-content reuse, clamps malformed legacy progress and fails unbound legacy rows closed with operator-safe recovery text. Creating a pairing code rotates the long device token. The signed-installer source now verifies the pinned WinSW digest, requires installer/package/health version parity, removes inherited ProgramData ACLs, stops and refreshes an existing service during upgrades, and retains its unsigned-build refusal. The dependency-free bridge suite passes 15/15 and release PowerShell syntax passes. This is software evidence only: no signed candidate artifact was produced here, the native setup app was not rebuilt because the local .NET SDK is absent, and neither supported printer has a clean-Windows or physical failure/retry certification run. BUG-005 and HW-001 remain open.

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

Single-bill WhatsApp sharing is a Starter feature with durable `not_sent`,
`opened_share_sheet`, `sent_via_api`, and `failed` states. Offline intents replay
idempotently on reconnect. Bulk automated reminders remain Business-only. A
live external-provider send remains an environment/credential release proof and
must not be inferred from a successful deep-link handoff.
