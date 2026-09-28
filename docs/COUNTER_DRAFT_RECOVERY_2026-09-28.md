# Counter draft recovery — 28–29 September 2026

## Problem and change

The shopkeeper walkthrough reproduced a cosmetics entry disappearing when the
counter locked. The lock gate deliberately unmounts the protected page. Local
component state in the tester and serial-unit forms was consequently discarded.

The tester-opening, serial-registration and serial-sale forms now keep their
values and open state in an opt-in memory store scoped to the backend login
session and active branch. The existing lock gate and PIN checks are unchanged.
The forms remain unmounted while locked. No draft fields or credentials are
written to persistent browser storage by this change.

Cancel discards the entry. A successful request clears it; a failed request
retains it. Pending submissions survive page unmounts and prevent duplicate
requests or editing the submitted values. Sign-out/new login clears the cache,
while normal token rotation preserves it. A late response from a previous login
cannot clear a new session's entry.

The tester form previously retained its last successful values, and the serial
sale form retained buyer details when closed through Cancel. Both now start
fresh after completion or cancellation. The serial-registration toast now says
units were registered, rather than claiming that inventory was increased.

A browser duplicate-serial test exposed another issue: the failure toast read
`data.message`, although the API client already normalizes the server error to
`Error.message`. Tester and serial-register failures now show that explanation
with a translated fallback for unknown errors. The repeated test identified
`QA-SERIAL-001` as already recorded against `QA Handset` and retained the draft.

## Scope and limits

This recovery covers counter locking and in-app navigation in the same loaded
tab. Refreshing/restarting the page, closing the tab or signing out discards
these drafts. Durable recovery already used by manufacturing is separate.
These changes do not add server-side idempotency or resolve an ambiguous result
when a page is refreshed while its request is in flight.

Electronics and prescription register actions still require separate ordinary
billing. In particular, the current electronics UI accepts a manually entered
bill reference; it does not atomically assign a serial during checkout. A fully
linked workflow still needs tenant/branch validation, sale-line quantity limits,
returns and offline-sync handling. This patch does not claim that integration.
Physical printer/scanner and real payment settlement checks, and the original
production furniture repair requiring owner evidence, remain outstanding.

## Verification

- Isolated worktree `work/counter-draft-recovery`, based on `acffc6dd`.
- Frontend port 5501 and API port 3007 serve this worktree. Browser activity uses
  synthetic QA shops in `/tmp/bug064-final-browser-test.db`.
- Seven draft-store regressions cover unmount/recovery, session/branch/form
  isolation, normal token rotation versus new login, cancellation, pending
  submission protection, failed-save retry and late responses after sign-out.
- Tester browser proof: a filled product, shade `QA Lock Recovery`, 60-day
  duration, stock checkbox and note survived the real idle lock and PIN unlock.
  The recovered entry saved once; stock moved from 9 to 8. Reopening after save
  was empty; cancelling a second draft also left the next entry empty.
- Serial browser proof: an existing serial was rejected with HTTP 409 and the
  entered code remained. Two replacement codes survived navigation to Home and
  back, saved once, and produced the toast `2 units registered`. Product stock
  remained 10. Both successful-save and Cancel paths reopened empty.
- Serial sale browser proof: cancelling an entry with a bill reference and
  synthetic buyer details left the next unit's sale form empty. No serial sale
  or real customer transaction was recorded in this pass.
- Full frontend production gate: 3,043 tests passed with one existing skip;
  typecheck, translation parity, production build, bundle and app checks passed.
  Final log: `/tmp/counter-draft-final-gate.log`.
- An earlier development-server run was invalidated by source-triggered full
  reloads. The successful idle-lock run used the fixed production preview.
- The original 15-minute cosmetics idle setting was shortened to the supported
  five-minute setting for QA. Auto-lock and PIN enforcement remained enabled.

## Evidence

- [Draft before lock](evidence/counter-drafts-2026-09-28/tester-before-lock.png)
- [Counter locked](evidence/counter-drafts-2026-09-28/tester-locked.png)
- [Same entry after PIN unlock](evidence/counter-drafts-2026-09-28/tester-after-unlock.png)
- [Recovered fields](evidence/counter-drafts-2026-09-28/tester-after-unlock.txt)
- [Duplicate serial and retained draft](evidence/counter-drafts-2026-09-28/serial-duplicate-error.png)
- [Duplicate error text](evidence/counter-drafts-2026-09-28/serial-duplicate-error.txt)
- [Independent database checks](evidence/counter-drafts-2026-09-28/server-verification.json)
