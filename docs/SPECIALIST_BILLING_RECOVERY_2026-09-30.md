# Specialist billing and draft recovery — 30 September 2026

## Counter workflows

- Electronics: choose or scan each serial in Billing; the saved bill, unit status and warranty commit together. Receipts and synced bill lines preserve the serial link, including returns. The register offers a way to reconcile earlier unlinked sales. An omitted serial prompts the cashier rather than stranding an offline or older-client sale; a selected unavailable serial refuses the transaction.
- Pharmacy: recording a prescription can continue directly to Billing with its patient, medicine quantities and attached slip. It remains pending until the bill commits. Replays cannot spend the same refill twice. An incompatible handoff explains the problem without preventing Billing from opening.
- Existing bills are parked before a specialist handoff, and attachments survive draft reload and hold/resume.
- Serial intake and cosmetics tester drafts persist for up to seven days on the same device/session/location. Cancel, successful save and sign-out clear them. An interrupted submission requires checking the register before starting again.

## Failure found and corrected in the walkthrough

The QA catalogue counts Vitamin Tablets in `strip` with no separate packaging row. The prescription handed off correctly, but saving failed with `Unsupported unit "strip"`. Converting between identical non-empty unit labels now preserves the quantity. Different unknown units still fail: the system never assumes how many tablets a strip holds.

## Browser evidence (synthetic local shops only)

The API on port 3007 and production frontend preview on port 5501 were verified to run from this worktree, using `/tmp/bug064-final-browser-test.db`.

- Pharmacy RX-000002 was resumed from the register with its patient and one strip intact. Cash billing saved KOS-2026-000001 for ₹50, moved the slip to Dispensed, and reduced stock from 10 to 9. Independent database inspection found quantity/base quantity 1 and cost ₹30.
- Cosmetics: product QA Rose Lipstick, shade QA Restart Recovery, 90 days, stock checkbox and note survived closing the tab, opening a new one and PIN unlock. The recovered tester saved once and stock moved from 8 to 7; the form cleared.
- The preceding 29 September walkthrough also exercised serial handoff, hold/resume, sale/warranty and return, and serial-intake draft recovery after closing the tab. Those observations predate the latest compatibility improvements; current serial behavior is covered by the integration suite below.

[Prescription after billing](evidence/specialist-billing-2026-09-30/prescription-dispensed.png)
[Tester recovered after reopening](evidence/specialist-billing-2026-09-30/tester-draft-recovered.png)
[Independent database observations](evidence/specialist-billing-2026-09-30/database-checks.json)

## Validation

- Frontend `npm run prod:check`: typecheck, translation parity, production build, bundle/app checks; 3,102 tests passed, one pre-existing skip.
- Specialist integration: 17 passed, including competing counters, atomic rollback, serial return/cancellation, replay and prescription refill limits, and strip-unit sale/return.
- Existing billing integration: 31 passed.
- Sale guards and schedule enforcement: 41 passed; serial/prescription register examples passed.
- Bill list and sync replica shape examples passed. Pack-unit pricing precedence and stock valuation examples passed.
- Billing calculations and PostgreSQL migration safety passed.
- These local database checks use isolated SQLite. PostgreSQL concurrency and the broader release certification must pass in GitHub before merge.

## Limits

This is local counter evidence, not a claim that every business type, printer or production deployment has been retested. Unlinked serial sales still need register reconciliation. Persistent form recovery currently covers serial intake and cosmetics testers; it does not add recovery to every specialist form.
