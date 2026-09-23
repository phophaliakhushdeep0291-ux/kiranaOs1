# Furniture accounting verification — 23 September 2026

Release decision: **NO-GO**. This is local verification of the working candidate, not deployment approval.

## Changes

- Refunds preserve the original receipt and append a negative, dated receipt in the original tender. Partial refunds are limited to the remaining receipt amount. Owner PIN, reason, expected balance and request identity are required. Fully refunded open orders can be cancelled; financial history cannot be deleted.
- Payment method/reference corrections atomically append a reversal and replacement. Cash, UPI and bank journal totals, closing figures and order balances use the resulting net amounts. Retry mismatches and stale balances are rejected.
- General customer credit collections can be explicitly linked to the delivered order's matching invoice. Linking is owner-PIN protected, audited and limited to the same customer/branch and the remaining invoice credit. It creates no new money movement. Reversing a collection restores the order's balance. This workflow allocates whole receipts; it does not split one receipt among several orders.
- Daily Closing in the frontend, printed closing output, Cash & Payments, snapshot staleness and bank/UPI reconciliation now include furniture events. Bank matching excludes advance applications and the invoice's repeated tender, and requires matching the original receipt.
- Delivery requires the same branch and refuses receipts/adjustments dated after the bill. Advance application uses the bill's business date. Older receipts without matching financial history cannot be refunded, supplemented or applied automatically.
- Product-specific order lookups respect branch scope. Order caches and queries are keyed by location. List and summary queries no longer silently stop at 500 orders.
- Migration 000138 adds immutable adjustment metadata; 000137 adds branch identity. The unshipped schema relation from the previous pass was removed to agree with the additive location migration, following the existing rental location model.

## Verification

- Full backend integration before the restaurant changes: 45 files, 422 passing tests, three PostgreSQL-only skips, no failures. The two newly added furniture cases were then run separately.
- Final furniture and bank reconciliation integration: 19 tests pass across two files (16 furniture cases and three bank cases).
- Frontend production gate before the restaurant changes: typecheck, 6,276 translation keys, build, bundle/app checks and 2,948 tests pass; one pre-existing test skipped. The subsequent restaurant report records the final combined frontend gate.
- Both Prisma schemas validate. An isolated SQLite upgrade smoke preserved a historical ₹120 receipt while adding branch and adjustment metadata. The new fields default to an ordinary receipt, without inventing its missing financial history.
- Backend production and migration-safety checks pass. General ledger, furniture, report aggregation and closing atomicity example tests pass in isolated databases.
- Authenticated browser checks for the newly added dialogs are pending. Local previews currently show sign-in.

## Remaining conditions

- Legacy furniture and rental financial reconciliation needs a reviewed opening-history workflow and evidence for historical receipts. Historical delivered orders without invoices are still flagged and unchanged.
- Furniture invoice creation and delivery linking remain separate transactions. An unlinked invoice can temporarily duplicate an order advance in reports until the order is linked; an atomic order-invoice workflow remains a release requirement.
- Customer collections that span multiple orders need an explicit split-allocation workflow. Current linking accepts a whole receipt only.
- PostgreSQL runtime/migration/concurrency proof, authenticated browser verification of the new controls, clean candidate CI, backup/restore evidence, physical printer certification and required release sign-off remain outstanding.
- Neither PostgreSQL tools nor Docker is available on this workstation. Both Prisma schemas validate; schema validation is not PostgreSQL runtime proof.
- No production data was migrated and nothing was deployed.
