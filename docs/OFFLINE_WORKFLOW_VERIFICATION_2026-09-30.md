# Offline workflow verification — 30 September 2026

**Follow-up:** [1 October PostgreSQL and two-counter verification](OFFLINE_POSTGRES_TWO_COUNTER_VERIFICATION_2026-10-01.md)
adds the concurrent-write results, full PostgreSQL shop cycle and payment-conflict
wording fix. The results below describe the earlier build.

**Result: the tested core counter cycle works after five fixes. This is local verification, not a production deployment or a claim that every feature works offline.**

Work is on `work/offline-workflow-verification`, based on locally recorded
`origin/main` at `7e0c21f9`. The production frontend build was tested against an
isolated SQLite API using disposable Chrome profiles and synthetic shops. The
main checkout and production data were not used for transaction testing.

## What changed

1. **Offline saves no longer wait for internet.** Sixteen local-action mutation
   hooks and the expense save/delete mutations now explicitly run offline.
   React Query's default previously paused the whole mutation before the local
   database write could start. Online-only API mutations keep their policy.
2. **Deleted expenses stay deleted.** Local deletion markers suppress cached
   server rows. Copies retired during local-to-server ID reconciliation are
   distinguished from actual deletions, so successful sync keeps the live row.
3. **Receiving stock no longer races a price update.** The inventory form waits
   for the purchase write before updating product prices. The previous parallel
   writes could restore the old stock quantity from a stale product snapshot.
4. **Offline returns immediately restore sellable stock.** The return now saves
   product quantities in the same transaction as the refund, movement, audit and
   outbox. It updates both product/inventory caches, converts to base units and
   restores the selected pack. Damaged and untracked items do not gain stock.

5. **Expense summaries disclose their freshness.** Offline, pending and failed
   refresh states show a notice in English/Hindi. Unavailable totals use a dash
   instead of an invented zero, and a server read error cannot hide saved local
   rows. Summary calculations remain server-backed; the list stays usable offline.

The browser harness now verifies PIN/device unlock through the application.
The cold-restart harness also requires its own preview process to bind the
requested port, preventing an unrelated checkout from being tested accidentally.

## Transaction results

These actions used the application forms with Chrome's network disabled.
Database/API reads checked the results; they did not substitute for the UI writes.
Offline acceptance is local: the server can still reject an operation during
sync, in which case the operator must resolve it in Sync Status.

| Workflow | Observed result |
|---|---|
| Credit sale with new customer | ₹200 saved offline; one customer and one debit after sync |
| Partial collection | ₹75 saved offline; ₹125 outstanding immediately, after navigation, after offline reload, and on the server |
| Expense create and edit | ₹200 created, edited to ₹225 while offline; exactly one ₹225 server expense |
| Delete a synced expense | Row disappears offline, remains absent after offline reload, and is deleted on the server |
| Stock receipt with price save | Three units received while offline; stock remains correct after the price write |
| Cash sale | One unit sold for ₹200 offline; quantity drops immediately |
| Linked cash return before sale sync | ₹200 refund and one unit restored offline; linked sale and return reconcile |
| Final inventory | **20 − 1 credit sale + 3 receipt − 1 cash sale + 1 return = 22 units**, locally and on the server |
| Final documents | Exactly two sales and one return; each sale ₹200, return −₹200; queued events reach `SYNCED` |

[Raw transaction evidence](evidence/offline-workflow-2026-09-30/shop-cycle.json)
contains the local snapshots and server reconciliation.

## Restart, security and coverage

The production build passed **53/53 route checks after closing and reopening
Chrome with the network disabled**. Each route also failed an uncached network
probe as expected. Twelve routes correctly displayed an internet requirement;
53 route passes do not mean 53 fully mutable offline features.

The check verified cached products and customer data, online owner-PIN unlock,
offline unlock after device enrollment, rejection of invalid signatures and
missing presence/verification, and interception of the first click after idle
expiry. A counter without enrollment stayed locked offline. WebAuthn used a
Chrome virtual authenticator; physical biometric hardware was not certified.

[Raw restart evidence](evidence/offline-workflow-2026-09-30/cold-restart.json)
records build ID, cache state, route results and screenshot filenames. Complete
screenshots are retained in `frontend/qa-artifacts/offline-final-20260930` and in
the workspace's `offline-verification-evidence-2026-09-30/cold-restart` folder.

| Capability | Current boundary |
|---|---|
| Cash/credit billing, collection, expenses, stock receipt and ordinary return | Browser transaction cycle verified locally |
| Product/customer/supplier/staff local-action hooks | Offline scheduler regression tests; not every management form was exercised end to end |
| Cold offline startup | Requires prior online sign-in, completed app/data caching and enrolled device unlock |
| Offers | Cached reading; management writes require internet |
| Expense summary cards/charts | Server-backed totals clearly disclose offline/update status; missing totals show a dash. They are not live offline aggregates |
| Other cached reports and management screens | Route loading verified; this is not certification of every report or action |
| Provider payments, secure gift-card issuance, connected services | Require connectivity and separate provider proof |
| Printing, scanning, scales and physical biometrics | Physical hardware acceptance remains outstanding |
| Two independent counters and production concurrency | Not rerun as a live multi-device PostgreSQL trial here |

## Automated checks

| Check | Result |
|---|---|
| Frontend `npm run prod:check` | Passed typecheck, i18n, build, bundle/security/app checks; **3,069 tests passed, 1 skipped** |
| Final focused regressions | **37 passed**, including storage-failure rollback; these tests are also included in the final full gate |
| Backend SQLite integration suite | **475 passed, 0 failed, 4 skipped**; skipped cases require PostgreSQL |
| Cold restart and offline security | **53/53 routes passed** |
| Core transaction browser cycle | Passed expenses, credit/cash sales, collection, stock receipt, linked return, reload and server reconciliation |

Return regressions cover persisted quantities overriding stale memory, repeated
lines, gram-to-kilogram conversion, pack stock, damaged/untracked goods, and
rollback when the product write fails. The mutation regression runs the real
QueryClient scheduler with its online state false.

[Validation provenance and hashes](evidence/offline-workflow-2026-09-30/validation.json)
bind the application source and JSON artifacts. These are retained local results,
not a new full production release-certification run.

## Further optimization priorities

1. Implement reconciled local expense aggregates if fully live offline summary
   cards are required. Freshness is now explicit, while the expense list is local-first.
2. Run the outage/reconnect cycle on two counters and a representative low-end
   shop device, measuring scan/search/save latency and stock conflicts.
3. Complete scheduled offsite backup, isolated restore of an approved production
   dump, recovery timing and alert delivery. A successful dump alone is not a
   recovery guarantee.
4. Retain credentialed payment/provider and named hardware acceptance results
   before claiming those integrations are production-ready.

The competitive evidence score was not raised. The prior optimization review's
search benchmark remains a catalogue calculation benchmark, not measured cashier
latency or proof of superiority over other POS products.

## Reproduce safely

Use a disposable QA database and shop; the browser scripts create transactions.
Build with `VITE_API_BASE_URL` pointing to that QA API. The final build was
created in `dist/final-offline-qa`, then copied unchanged to `dist/public`;
the bundle budget was rerun there because that checker uses the default path. Set `CHROME_PATH` for the
local installation and allow the exact frontend origin on the QA API.

```sh
# From frontend, with a matching production preview running:
QA_FULL_OFFLINE_WORKFLOW=true FRONTEND_URL=http://localhost:5174 \
API_URL=http://127.0.0.1:3017/api npm run qa:udhar-ledger-cycle

# Stop the preview first; this script owns its preview port:
QA_OFFLINE_FRONTEND_URL=http://localhost:5174 \
QA_API_URL=http://127.0.0.1:3017/api \
QA_OFFLINE_SKIP_BUILD=true QA_OFFLINE_BUILD_DIR=dist/public \
npm run qa:offline-core-restart
```
