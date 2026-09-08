# Sync health and offline restart — 8 September 2026

This is verified local working-tree evidence, not production certification or a claim that the full application audit is complete.

## Defects reproduced and corrected

- Both sync-status repair and financial hardening treated a missing local outbox event as proof that a review was resolved. Six regression assertions failed before the fixes. Local-only reviews now require an acknowledgement of their exact operation; a cloud-linked review requires cloud/owner evidence. Matching only a customer, bill, or product ID cannot clear another operation's review.
- Daily Closing ignored `SYNCING` operations and stored reviews. Header counts, closing/report counts, offline confidence and Sync Status now share the same classification. A rejection is one review even when it has both outbox and conflict rows. An outbox-only rejection is visible and retains its payload for review.
- Sync Status previously fetched cloud-only reviews without persisting them. The background owner/admin sync cycle now refreshes a scoped local review cache. All server pages are read; a failed/incomplete list cannot close reviews. Credentials are removed before snapshot persistence. Repeated responses do not emit redundant refresh events.
- Concurrent owner decisions and shop changes are checked before cache writes. The current local rows are read inside the write transaction. Tests cover rollback and an older response attempting to reopen a decision.
- Sync Status paints locally saved state before remote diagnostics, runs independent diagnostics concurrently, and rereads the durable queue after network waits. Superseded page reads cannot replace newer state.

## Verification

- Final full frontend suite: **2,372 passed, 0 failed, 1 skipped**. The skipped test requires the live front-office API. Machine-readable output: `frontend/qa-artifacts/sync-health-final-tests.json`.
- Final TypeScript check passed.
- Production build, bundle budget and production-app checks passed. Build log: `frontend/qa-artifacts/sync-health-build.log`. Initial JavaScript: 846.1 kB raw / 255.2 kB gzip. A subsequent QA production build included the final credential-sanitization change.
- Fresh Chrome profile, installed service worker, full browser shutdown/relaunch, network disabled: **53/53 routes passed** with no tested route bounce, fatal error, stuck route loader, overflow or captured runtime error.
- A cloud-only product review was created in the isolated QA shop. Its background arrival in the header was asserted **without visiting Sync Status online**. After restarting offline, Sync Status and Daily Closing each displayed one review and agreed with the header.
- Local route readiness ranged from **175 to 946 ms** (average 525 ms). Sync Status: 946 ms; Daily Closing: 557 ms; a populated customer account never opened online: 776 ms. These are local test timings, not mobile-network or production performance guarantees.
- Cold-start report and screenshots: `frontend/qa-artifacts/sync-health-isolated-offline-20260908/`. Build ID: `sync-health-isolated-20260908`; report timestamp: `2026-09-08T17:47:06Z`. The Sync Status screenshot was visually inspected.

The browser run used port 3001 and the new SQLite database `backend/prisma/sync-health-test-20260908-6a9e.db`, with a schema-compatible isolated Prisma client and all 33 SQLite change-feed triggers installed. No merchant financial records were changed. An earlier run stopped at the expected counter PIN lock; the harness now enters the known QA PIN through the actual form. Another attempt failed because the shared port-3000 API had stopped; it was not counted as a pass.

## Remaining work

- **High-priority security finding:** `SessionLockGate.tsx` currently releases an already locked counter after a failed PIN request when the browser is offline, the request reports status 0, or it throws `TypeError`. Network loss is not authentication. Replace this with a verified, scoped offline-unlock design and wrong-PIN/network-loss regression coverage; the cold-start test above entered the correct QA PIN and does not certify this policy.
- Confirm cross-device resolution propagation for every mutable and financial conflict type, including cloud resolution while a rejected local outbox event remains.
- Test database-read failures explicitly: several existing status readers still convert read errors into empty arrays; an unreadable queue must not appear healthy.
- Production candidate, PostgreSQL concurrency, real receipt hardware/payment providers, backup custody and long-duration offline field evidence remain required by `RELEASE_GATE.md`.
