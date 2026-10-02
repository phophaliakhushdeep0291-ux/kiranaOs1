# Offline expense refresh race fixes — 2 October 2026

A late expense list response could overwrite a local edit or resurrect a local deletion between the caller’s cache read and its snapshot transaction. A completed sync or overlapping refresh could also replace newer data despite both rows having version one. A shop switch during the request could relabel the previous shop’s expenses.

Expense refresh now captures the shop before its first await and checks it before fetching, caching and returning. Snapshot insertion protects current pending work and aliases inside the transaction. Captured row revisions protect newer synced rows from both deletion and replacement. Other snapshot callers retain their existing behaviour.

Regression tests first reproduced the failures, then passed after the changes: pending/syncing/failed/conflict/local-only edits; pending and synced deletions; aliases; completed sync; overlapping version-one refreshes; date-window moves; ordinary server updates; and shop changes.

The previous post-merge CI failure was a PostgreSQL deadlock in test cleanup (`shop.deleteMany`), with failure type `hookFailed`. Cleanup now recreates and retries only aborted PostgreSQL reset transactions, at most three attempts. Persistent failures and unrelated database errors still fail. Seven retry tests passed. Production business transaction code is unchanged.

The full isolated SQLite integration run passed 499 tests with four skips and zero failures. Focused expense/isolation suites passed 42 tests. Backend production, source parse and repository hygiene checks passed. Final frontend release gate passed 3,217 tests with one skip; typecheck, translations, build, bundle budget and production app checks passed. Hosted release results are recorded separately in the workspace evidence.

The existing 53-route cold-restart and shop-cycle results are earlier evidence, not fresh browser runs for this change. Browser access was previously blocked by URL policy; no alternate browser was used. Live hardware, payment-provider, offsite storage and monitoring acceptance still require the equipment/accounts previously requested.
