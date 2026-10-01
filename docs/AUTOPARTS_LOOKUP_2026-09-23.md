# Auto-parts verification — 23 September 2026

The rebuilt local preview was tested through an isolated synthetic shop. No production data, live payment provider, external sharing or deployment was used.

## Changes

- Vehicle lookup validates integer years from 1900 through 2100, searches current product names/SKUs/OEM attributes and uses stock at the selected branch. Model-specific variants and recorded-number lookup are preserved from the earlier staged changes.
- The search screen binds results to the submitted query, clears previous results before a new request, clears stale vehicle matches after changes, connects field labels, validates fitment years before saving and resets entry dialogs after success.
- Cached fitment results explicitly say stock and prices require reconnection. Offline register filters are preserved. The register can display entries beyond the initial 40.
- Recorded part numbers can be removed with confirmation. Fitment/reference creation, update and removal now commit with mandatory actor/device audit history. Bulk saves are atomic, duplicate replays are safe, and conflicting edits are rejected. Deleted catalogue products no longer inflate mapped-part counts.
- A misplaced Hindi tax-review translation block from another workspace change was moved into its dictionary without changing the wording, allowing the shared build to pass.

## Verification

- Frontend production check passed: type checks, 18 translation modules, production build, bundle/application checks, **2,960 tests passed, 1 skipped** (396 passing files, 1 skipped).
- Backend production/module/dependency checks and fitment examples passed.
- Isolated integration checks: **17 passed** across five auto-parts integrity scenarios and all twelve trade workflows. Covers concurrent duplicate requests, duplicate edits, atomic bulk rollback on audit failure, reference update/removal rollback, shop isolation, deleted-product counts, OEM lookup, invalid years, branch stock and repeat-safe returns. PostgreSQL execution is not claimed.
- Browser: OEM attribute lookup, SKU picker, fitment creation, invalid-year rejection, 2014 exclusion/2015 inclusion for a 2015–2020 diesel fitment, clean form reopening, alternative-number creation, handoff to billing, ₹100 cash sale, original-invoice return with owner PIN and already-returned quantity protection.
- Independent database reconciliation: stock **20 → 19 → 20**, one ₹100 sale and one −₹100 linked return, net cash **₹0**. Browser-created fitment removal and recreation retained actor/device audit entries.
- Connection-loss check: the cached vehicle match remained available and showed **“Reconnect to check current stock and prices.”** The QA API was then restored. Final browser lookup showed the original OEM number with 20 units at ₹100 after the equivalent reference was removed. The removal audit and unchanged stock were independently verified.

Evidence and full check logs are in [the evidence directory](evidence/autoparts-2026-09-23/). The preview runs at http://127.0.0.1:5318/fitment using `/private/tmp/autoparts-qa-20260923/qa-test.db`.

## Release limits

This verifies the listed auto-parts flows locally. It does not certify every app workflow or a clean production candidate. Existing release gates still require exact-candidate CI, PostgreSQL migration/concurrency proof, infrastructure and restore checks. Offline SKU/OEM lookup remains connection-dependent; cached vehicle lookup uses stored fitment claims. The shared working tree contains unrelated ongoing changes and is not deployed.
