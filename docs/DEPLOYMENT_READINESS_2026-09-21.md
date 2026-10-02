# Deployment readiness — 21 September 2026

Historical report, superseded by the [22 September report](DEPLOYMENT_READINESS_2026-09-22.md). Its bug numbers predate the 22 September backlog: the rental journal gap it calls BUG-064 is BUG-062 in `BUG_BACKLOG.md`, and the furniture bill/stock handoff it calls BUG-065 is BUG-064 there. The rental journal work it cites on `work/rental-finance-closing` reached `main` in revised form in `ea71a1db`.

Decision: **NO-GO for an unrestricted production release.** Local builds and regression checks pass, and the manufacturing flow has been exercised through returns. The remaining product gaps and external release proofs below are still required; this report does not certify every flow.

## Candidate and environment

Reviewed branch: `work/free-access-launch`, base commit `54912196`. The final working-tree delta makes supplier payment choices explicit and shows net settlement methods in the purchase list, filters and export. The backend cash-closing correction and earlier hardening are already in this commit. This delta introduces no schema migration; the later rental-journal change (addendum below) adds one. Nothing was pushed or deployed by this QA pass.

Local browser: production frontend at `127.0.0.1:5318`, isolated API at `127.0.0.1:5317`, synthetic shops in a dedicated SQLite QA database. Builds use `VITE_API_BASE_URL=http://127.0.0.1:5317/api`; this is a local preview value, not a deployment setting. Backend checks use Node 22.23.2; frontend uses Node 26.1.0 and the existing frozen pnpm 9.15.9 installation. These are working-checkout results, not a fresh-install or PostgreSQL certification.

## Completed corrections and checks

- Supplier cash closing now distinguishes the initial purchase payment from subsequent payments. A ₹20 initial cash payment, later ₹30 cash and ₹40 UPI leave ₹20 on purchase day and ₹30 on the cash settlement day. UPI never enters the cash drawer. A cash reversal affects its own date. Branch filtering, idempotent retries and snapshot invalidation are covered. The new regression failed before the correction (₹90 instead of ₹20) and passes after it.
- Supplier payment selection now uses visible Cash and UPI / bank radio choices. In the browser the previous dropdown twice closed while leaving Cash selected; keyboard selection worked. The narrower UI replacement avoids that observed failure without claiming a browser-wide dropdown defect.
- Purchase payment labels, filtering and CSV data now use net settlement methods. A cash + UPI purchase displays Mixed; a reversed cash payment no longer makes an otherwise UPI purchase appear mixed. The original tender remains unchanged for historical accounting.
- Earlier fixes, included here, prevent excessive credit returns before local writes and on the server, keep return quantities and references coherent after synchronization, preserve pending stock changes during purchase acknowledgements, use the selected local expense date, refresh daily closing snapshots, and allow an audited, retry-safe final rental collection.
- The AI tool concurrency test now proves the concurrency limit and results directly. Its machine-speed assertion failed under a concurrent build despite correct concurrency and was removed; functional assertions remain.

| Local check | Final result | Scope |
|---|---|---|
| Frontend production gate | **2,927 passed, 1 skipped**, 391 passed files + 1 skipped | Final frontend delta; typecheck, 6,185 translation keys, build, bundle budgets, production app check, full tests |
| Full backend suite | **Passed**, exit 0 | `54912196`, including guarded isolated database examples and pre/post tests |
| Backend production gate | **Passed**, exit 0 | Module graph, production readiness, dependency security |
| Full integration suite | **402 passed, 0 failed, 3 skipped**, 44 files | Node 22, isolated SQLite, backend at `54912196` |
| Focused reports + sync | **75 passed, 0 failed, 0 skipped** | Supplier dates/modes/reversal/branch, snapshots and synchronization |
| Hardware bridge | Historical **32/32**, 17 September | Not rerun in this pass; no physical certification |

The three integration skips require PostgreSQL: concurrent whole-order manufacturing returns, the production concurrency suite, and overlapping serializable transactions. They are not passes. The frontend skip is the existing live-API smoke suite, not the manual browser exercise described below.

Final frontend startup is 261.3 kB gzip across five files. The largest shop offline payload is restaurant: 4,475.3 kB raw / 1,260.3 kB gzip across 185 files. Existing budgets pass without changing their limits; offline boot verification covers 32 entries and 178 installed assets. Remaining payload headroom is small.

Superseded runs are not hidden: an intermediate frontend run correctly required lowering the hardcoded-string allowlist after the payment UI edit; an earlier backend attempt hit concurrent Prisma generation; an earlier integration attempt ran while an import was being edited. The retained final summaries identify the completed runs after those conditions were resolved.

## Browser exercise and reconciliation

The table separates the 17–18 September browser sessions from the fresh 21 September purchase retest. API regression coverage reaches all twelve shop types; it does not establish manual completion of every path.

| Shop / area | Browser work completed | Limit / remaining work |
|---|---|---|
| Manufacturing | BOM → production → QC → first 10-pack shipment → invoice ₹200 → second 2-pack shipment → invoice ₹40 → whole-order return. Shipped-order cancellation blocked. Two credit notes total −₹240; raw stock 76, finished stock 24, pack stock 12, lots 20 + 4, net payments 0. | 17–18 September evidence. PostgreSQL concurrency and target-device/deployed checks remain. |
| Kirana | Cash checkout offline, reload, reconnect, exactly one server bill; credit sale ₹40, cash collection ₹20, blocked excessive udhar refund, ₹20 udhar return and ₹20 cash return, outstanding 0 and stock 36. Purchases and settlements; expense date and daily closing ₹80 expected/count match. | Same browser session with hosts stopped, not a cold OS/browser restart. Historical corrupt-return repair and two historical stock conflict records remain visible in the QA fixture. |
| Purchases — 21 September | New unpaid purchase ₹30 adds exactly 3 units (36 → 39), cash ₹10 and UPI ₹20 settle due to 0. Owner-PIN reversal restores due and preserves history. Corrected payment controls and Mixed label verified after reload. Backend net cash paid today is ₹10. | No new sync conflict; the two open stock conflicts are dated 18 September. They were not erased to manufacture a clean dashboard. |
| Pharmacy | Prescription doctor/patient, Schedule H dispensing and mobile register. | Remaining billing, batch expiry, prescription rejection and printer paths need full manual matrix. |
| Restaurant | Table hold → kitchen ticket preparing/ready/served → resume → cash checkout → table free. Offline reload and second sale recover; 2 bills total ₹40, stock 28. | No cold browser restart or target hardware certification. |
| Clothing | Rental booking with ₹100 rent/advance and ₹200 deposit → pickup → return → ₹10 damage fee → final collection. Balance 0, paid ₹110, one settlement audit, stock unchanged. | At the time of this session rental money/deposits were not in the financial journal or cash closing (BUG-064). The addendum below fixes that in code; the browser exercise has not been re-run. |
| Footwear | Size lookup (UK 8 → US 9 / EU 42 / 26.5 cm). | Size-grid receipt, sale and return not manually completed. |
| Auto parts | Vehicle fitment lookup selects compatible in-stock product. | Fitment-to-bill and return not manually completed. |
| Electronics | Serial receipt → service → refurbished return; one serial back on shelf, none in service. | Serial-to-sale/warranty handoff not manually completed. |
| Stationery | School/class/year list, quantity 2 / total ₹200, copy into the next academic year. | Put-on-bill and checkout not manually completed. |
| Furniture | Quote ₹120 → confirmed with ₹40 advance → ready → delivered with ₹80 → installed. | Order still has no linked bill and physical stock remains 20. Invoice handoff/reconciliation is a release gap, not a verified sale. See BUG-065. |
| Cosmetics | Register tester reduces stock 20 → 19, preserves ₹50 cost; discard clears the active tester and retains history. | Sale/replenishment and deeper mobile paths remain. |
| Other / custom | Shared API coverage only. | No dedicated manual vertical session in this pass. |

## Remaining release work

1. Re-verify the rental financial journal in a browser (BUG-064 is fixed in code; see the addendum), decide how bookings made before it are reconciled, and close the furniture bill/stock handoff before releasing those flows. Complete the remaining vertical manual matrix. BUG-047/057 and other previously fixed findings still need their own verification/closure evidence; this report does not silently close them.
2. Run the exact final candidate in supported Node 22 CI with PostgreSQL, Redis, workers and production Docker image. Retain a successful run URL, migration and concurrency evidence. Historical local certification is not proof for this candidate.
3. Verify hosting API URL/origins/secrets and enabled provider configuration in the actual deployment environment. Retain backup export and isolated restore proof, offsite storage evidence and worker heartbeat. Do not infer operational health from a local SQLite pass.
4. Complete physical printer/Windows installer, target-device offline authentication, cold restart and two-device end-to-end checks. Historical narrower sync evidence remains narrower.
5. Record candidate version, exact source identity, named release owner, rollback artifact and approval only after the applicable gates pass.

## Addendum — rental journal (BUG-064), 21 September

After this QA pass the rental journal gap was closed on branch `work/rental-finance-closing`, which also carries the supplier payment delta reviewed above. Every rental money event (booking advance and deposit, return, final collection, and a new owner-PIN refund of a deposit or a cancelled booking's advance) posts dated, balanced, idempotent journal rows, and daily closing adds rental cash, UPI and bank by day and branch. A refundable deposit is never counted as a sale. The change adds migration `000136_rental_financial_history` (PostgreSQL) / `20260921160000_rental_financial_history` (SQLite).

Bookings created before the migration are refused further money events until reconciled, because their original payment method was never recorded; there is no reconciliation path yet.

| Check | Result |
|---|---|
| Rental settlement integration | 6 passed, 0 failed: booking replay, immutable recorded money, daily cash, snapshot staleness, owner-PIN refund including two at once, balanced trial balance, rollback on audit failure, branch isolation, legacy refusal |
| Shop-type flows integration | 12 passed, 0 failed |
| Full backend suite / backend production gate | Passed, exit 0 |
| Frontend production gate | 2,928 passed, 1 skipped |

Not yet re-run for this change: the browser rental exercise and PostgreSQL.

Evidence: [reviewed QA artifacts](evidence/deployment-readiness-2026-09-21/README.md). The [17 September report](DEPLOYMENT_READINESS_2026-09-17.md) is retained as history and is superseded for current local test counts.
