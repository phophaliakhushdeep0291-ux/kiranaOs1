# Button labels and live offline expense totals — 1 October 2026

## Changes

Inventory Export, Reports Export, and Sales New Sale were inheriting the shared outlined button's brand text colour while setting a solid brand background. Their text and icons now use white. Apply Stock Count and Save Loyalty Rules also have an explicit contrasting foreground. Purchase-line removal and the voice assistant close control now have translated accessible names and tooltips.

Expense cards and charts now aggregate the same unfiltered, merged local ledger as the expense list. Offline create, edit, delete and reload update totals immediately. Category and search filters only affect the list. Totals use integer paise and Indian shop day/month boundaries; deletion markers and retired sync aliases are excluded. A cache read failure shows unavailable totals instead of a false zero. The page fetches one complete branch expense list, so typing and filtering no longer request a new server snapshot on every change.

New expense operations capture the selected branch in both the persisted row and outbox payload. Reconnecting after a branch switch cannot assign the expense to a different branch. Cached branch rows remain separate; legacy rows follow the server's primary-branch convention. Primary-branch identity is cached per shop so it survives an offline restart. If an older row has no branch and primary is not cached, the row remains visible and totals show unavailable until branch ownership can be verified.

Offline summary notices in English and Hindi explain that other counters' updates arrive after reconnecting.

## Verification

- Frontend release gate: 3,191 tests passed, one skipped; typecheck, translation placeholders, production build, bundle budget and production app check passed.
- Isolated SQLite integration: 499 passed, four skipped, no failures.
- Hardware bridge: 32 passed, no failures. This verifies protocols and guards using local test endpoints, not physical equipment.
- Razorpay fixture proof: six signature/body checks passed. This does not verify a live provider account.
- Offsite restore configuration and freshness guards passed. A real offsite production restore remains unverified without storage and isolated-target configuration.
- Full browser shop cycle passed against the updated private QA API and merged release: expense totals 200 → 225 → reload 225 → delete 0 → reload 0, then server reconciliation; credit sale 200 and payment 75 leave 125 due exactly once; receipt, cash sale and return reconcile stock to 22 units.
- Source parsing, repository hygiene, append-only migrations and backend production checks passed.
- Final build `20261001083928` passed 53/53 cold offline restart routes, including lock enforcement and virtual device-unlock validation.
- The preceding PostgreSQL two-counter proof remains recorded in `OFFLINE_POSTGRES_TWO_COUNTER_VERIFICATION_2026-10-01.md`.

## External checks still needed

Actual printers, scanner, scale and biometric hardware are not available to this session. No approved payment-provider sandbox credentials, offsite object-storage destination, or monitoring account are configured in the available environment. Live service readiness was checked read-only: database, Redis, storage and worker were healthy; storage provider was local and Sentry was disabled/unconfigured. These external requirements are not counted as completed software checks.

Evidence: `docs/evidence/button-labels-and-offline-summary-2026-10-01/validation.json` and `shop-cycle.json`. Release/CI/deployment status is recorded separately so these local results remain tied to the tested source.
