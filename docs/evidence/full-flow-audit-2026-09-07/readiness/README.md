# Readiness verification — 8 September 2026

The three targeted implementation gaps are fixed for the flows below. This is local verification, not production certification. Physical payment, printer, and PostgreSQL recovery proof remain outstanding.

## Changes verified

- Customer credit limit, due date, promise-to-pay date, and notes now pass through frontend validation, offline records, sync, API validation, and SQLite/PostgreSQL schemas. Explicit null clears persist. Calendar dates reject invalid days and avoid timezone conversion. Conflict resolution retains these fields. The PostgreSQL migration is additive and replay-safe.
- Mobile date inputs now capture native input events and read values before updating state. Browser testing found dates disappearing after another field changed; after the correction, both dates survived an unrelated edit, save, server sync, and reload. Limit ₹1,500.25 and notes also survived. Clearing all four fields was verified in the server database; the QA customer was returned to its original unset preferences.
- Closing uses each supplier payment's actual date and mode. It subtracts separately recorded payments from the purchase's cumulative paid total before attributing the initial payment. Subsequent payments retain the original purchase payment mode. Dated reversals return money on the reversal date. Equal installments in the same minute remain distinct, while durable local/server aliases deduplicate echoes.
- Sync supplies supplier ledger history with purchase records for a fresh device. Purchase payment history displays restored payments and reversal status. Reversal acknowledgements retain the original payment identity instead of overwriting it with the refund identity.
- Standard file exports now use a shared owner-PIN approval dialog and local audit recording: reports, sales, bills, customers, products, inventory, inventory registers, purchases, expenses, money statement, Advanced selected/local records, tax registers, and Tally XML. The export policy can explicitly disable the PIN requirement; those exports still receive a local audit entry. Missing, rejected, or explicitly invalid PIN verification and audit-write failure stop the approval path.

## Validation

| Check | Result | Evidence |
| --- | --- | --- |
| Full frontend production check | Typecheck, 5,772 translation keys, **2,344 tests passed / 1 skipped**, production build, bundle and app checks passed | `output/readiness-production-final.log` |
| Customers, sync, backups, restore drill | **87 passed / 0 skipped** across four isolated SQLite integration files | `output/readiness-integration-final.log` |
| Final sync regression after identity fix | **59 passed / 0 skipped** | `output/readiness-sync-final.log` |
| Payment checks | Credential encryption, integrity, dynamic QR contracts, provider connections, QR decoding and gift-card reversal tests passed | `output/readiness-payment-check.log` |
| Hardware bridge | **32 passed / 0 skipped**, simulated adapters | `output/readiness-hardware-tests.log` |
| Migration safety | Passed, zero warnings | `output/readiness-migration-safety.log` |
| Customer UI → server → reload → clear | Passed in the dedicated QA shop | `customer-reloaded-360.txt`, `customer-server-clear.json` |
| Mobile export approval | Wrong PIN rejected; approved export callback completed; Advanced displayed “Export downloaded”; local audit entries visible | `export-wrong-pin-360.png`, `advanced-export-result.txt`, `export-audit.txt` |
| Final QA sync snapshot | Zero pending, failed, or unresolved conflicts; device sequence current | `final-sync-status.txt` |

The 360-pixel export rejection screenshot was visually inspected: the dialog, error, inputs, and buttons fit the phone viewport. Prior mobile layout evidence remains in the parent audit. No new full mobile-route matrix was run in this follow-up. The browser did not expose a downloaded CSV file on the inspected Downloads path, so downloaded file bytes are not certified by this follow-up; the approval callback, success UI, and local audit were verified.

Before the local schema update, a consistent SQLite backup was saved to `output/readiness-before-schema-20260907.db`. It contains local business data and is intentionally outside this evidence directory. No destructive restore was run against the live QA/development database. The automated restore test uses an isolated database and also verifies the four new customer fields survive recovery.

## Remaining launch checks

- **PostgreSQL:** the configured local test connection failed password authentication. PostgreSQL migration execution, concurrency and a real `pg_dump`/`pg_restore` drill have not passed. A working disposable PostgreSQL test connection is required. The migration safety check passing does not replace that proof.
- **Actual hardware:** no listening hardware bridge on the configured default port and no standard Windows bridge configuration were found. Physical receipt output, cutter/drawer, scale and customer display still require the merchant's hardware.
- **External payments:** tests exercised fixtures and local provider behavior. No real merchant settlement or physical card-terminal transaction was made. Configured sandbox/merchant equipment is needed for external confirmation.
- **Export scope:** audit entries use the existing local audit mechanism; `AUDIT_LOG_APPEND` is currently classified as a local-only sync operation, so a “synced” local badge does not certify a server audit copy. Protected exports verify the owner's PIN; manager-specific approval is not certified. Receipt/statement printing, removed-device recovery exports, and encrypted backup recovery retain their dedicated flows and were not converted to the standard file-export guard.
- The broader release gate still requires the exact production candidate, Windows clean-install/offline-restart checks, and resolution of remaining feature limitations documented in the parent audit (including recurring expense generation and some secondary form accessibility).

The local app was restarted with the updated API and frontend. This agent did not deploy or create commits. Some earlier changes were committed elsewhere during the session; current follow-up edits remain reviewable in the working tree.
