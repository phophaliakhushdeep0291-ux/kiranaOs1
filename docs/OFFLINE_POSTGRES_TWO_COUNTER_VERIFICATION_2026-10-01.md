# Offline PostgreSQL and two-counter verification — 1 October 2026

**The tested core shop workflow and two independent counter profiles passed on
an isolated PostgreSQL 18.4 API. Competing collections preserve the rejected
payment for owner review and cannot over-credit the customer.**

This continues the [30 September implementation and offline report](OFFLINE_WORKFLOW_VERIFICATION_2026-09-30.md).
The work remains on `work/offline-workflow-verification`, following application
commit `1e22abc8`. All transactions used disposable shops and private local QA
databases. These results do not certify a deployed release or physical devices.

## What changed

The payment conflict screen previously replaced an excess-payment rejection
with “Payment backup needs one more retry.” Retrying cannot accept an ₹80
collection when only ₹20 remains due. It now explains that the payment exceeds
the amount still due and directs the operator to review the account and payments
recorded on other counters. English and Hindi translations are included.

The new `npm run qa:offline-two-counter` script uses two disposable Chrome
profiles with separate device identities and IndexedDB databases. It exercises
the cashier forms, document reloads, real application enrollment/unlock with
virtual WebAuthn hardware, staggered reconnects, repeated sync and a competing
collection. Read-only API and IndexedDB inspections verify the result. Setup
calls provision the synthetic shop, product and starting customer balance.

## Observed transaction results

| Scenario | Result |
|---|---|
| Same shop, independent counters | Two registered device identities; no shared browser storage |
| Start | Both counters cache 20 units and ₹1,000 customer debt |
| Both offline | Uncached network requests fail on each counter |
| Counter A | One ₹200 cash sale and ₹75 collection; local stock 19, debt ₹925 |
| Counter B | One ₹200 cash sale and ₹125 collection; local stock 19, debt ₹875 |
| Offline document reload | Each counter retains its own sale, collection, quantities and queued events |
| B reconnects first | Server stock 19 and debt ₹875; offline A retains its pending work |
| A reconnects, B catches up | **Both counters and server converge to 18 units and ₹800 debt** |
| Repeated sync | Exactly two sales totalling ₹400 and two collections of ₹75 and ₹125 |
| Another outage and reload | Both counters retain the reconciled 18 units and ₹800 balance |
| Two ₹80 collections against ₹100 debt | One accepted; server debt stays ₹20; the other remains `CONFLICT`, visible as “Correction required” after reload |

The final browser run also asserts the readable excess-payment explanation.
The competing collection is intentionally left for owner review in the
disposable shop: resolving a real receipt requires an appropriate accounting
decision, and a sync retry does not change the outstanding amount.

[Two-counter JSON evidence](evidence/offline-workflow-2026-10-01/two-counter-postgres.json)
records ten passed checkpoints. Screenshots and logs are retained in the
workspace evidence folder.

The complete single-counter workflow was separately rerun on PostgreSQL using
the final build: a ₹200 credit sale, ₹75 collection, ₹200→₹225 expense edit and
deletion, three-unit stock receipt with price save, ₹200 cash sale and linked
₹200 return before sale sync. Stock reconciled as **20 − 1 + 3 − 1 + 1 = 22**;
the server held exactly two sales and one return. The collection left ₹125 due
locally, after offline reload, and on the server.

[Full shop-cycle JSON evidence](evidence/offline-workflow-2026-10-01/shop-cycle-postgres.json)
contains the local and server snapshots.

## Automated validation

| Check | Result |
|---|---|
| PostgreSQL integration suite | **472 passed, 0 failed, 9 skipped**, across 52 integration files |
| Concurrent sales | Both sale effects recorded once; stock reconciliation preserves oversold quantities |
| Concurrent collections | Cannot over-decrement the customer balance |
| Concurrent whole-order returns | Refund and stock restoration apply once |
| Serializable write conflict | Losing transaction reruns; both increments are retained |
| Stock-money migration | Missing paise values filled; replay remains safe |
| Final frontend release gate | Typecheck, i18n, build, app/security checks passed; **3,073 tests passed, 1 skipped** |
| Conflict explanation regressions | Nine tests passed, included in the full frontend gate |
| Final build bundle check | Passed after copying the final build unchanged to the checker's default output directory |
| Two-counter browser workflow | Ten checkpoints passed on the final build and PostgreSQL |
| Full shop-cycle browser workflow | Passed on the final build and PostgreSQL |
| Rupee/paise consistency | Read-only check passed for the PostgreSQL browser-test transactions |

The nine PostgreSQL skips are eight SQLite-specific audit-failure injection
cases and one SQLite-specific combo migration proof. They are not skipped
concurrency cases. The earlier SQLite run separately passed 475 tests and
skipped its four PostgreSQL-only cases.

Build ID: `20260930194328`. The prior 53-route cold restart/security evidence
belongs to the 30 September build; it was not rerun after this wording change.
The final browser proofs above include document reloads during actual outages.

[PostgreSQL suite summary](evidence/offline-workflow-2026-10-01/postgres-integration.json)
and [source/artifact hashes](evidence/offline-workflow-2026-10-01/validation.json)
retain the scope and provenance.

## Remaining acceptance work

- Physical counter hardware, printers, scanners, scales and low-end device latency.
- Simultaneous browser reconnect under a larger fleet/load profile; this browser
  proof reconnects in stages, while concurrent writes are covered by API tests.
- Credentialed payment/provider workflows, scheduled offsite backup, production
  restore timing and alert delivery.
- Fully local expense summary aggregates, if those cards must update live offline.

The comparison score remains unchanged. Successful local transactions do not
establish superiority over other POS products or production-scale performance.

## Reproduce

Use only disposable QA databases. Point the production frontend build at its QA
API before starting the preview. Device limits and ownership remain enforced.

```sh
# backend: the URL must identify an isolated *_test or *_ci database
POSTGRES_TEST_DATABASE_URL=<isolated-test-url> \
ALLOW_POSTGRES_TEST_DB=true REQUIRE_POSTGRES_TEST_DB=true FORCE_DB_TESTS=true \
npm run test:postgres

# frontend: matching final build and private API already running
FRONTEND_URL=http://localhost:5174 API_URL=http://127.0.0.1:3017/api \
QA_DATABASE_ENGINE=postgresql-18.4 npm run qa:offline-two-counter

QA_FULL_OFFLINE_WORKFLOW=true FRONTEND_URL=http://localhost:5174 \
API_URL=http://127.0.0.1:3017/api npm run qa:udhar-ledger-cycle
```

Set `CHROME_PATH` when necessary. The two-counter script defaults to the macOS
Chrome path on macOS; the existing shop-cycle script requires that path explicitly
outside its Windows default. PostgreSQL binaries were installed only in a
temporary QA directory, with no new application dependency.
