# Restaurant dish stock — 23 September 2026

Status: **fixed and tested locally; rollout and user-screen verification pending**.
Overall release decision remains **NO-GO** under RELEASE_GATE.md.

## Findings and changes

- The Dishes/Products list and billing cards used raw quantities for badges even when `stockTrackingEnabled` was false. Untracked dishes now show “Not counted as stock” in the catalogue, have no out/low badges in billing, and are excluded from stock counters and stock filters. Both desktop and mobile catalogue layouts use the flag. Old negative quantities are preserved as history, not silently set to zero.
- The backend product low-stock filter now excludes untracked dishes. Strict bill stock validation also respects products whose own stock is untracked or handled by a recipe/combo.
- The combo guard now owns the combo's stock movement. It consumes counted components and recipe ingredients, skips untracked component dishes, and aggregates overlapping uses of the same ingredient into one movement. Retries do not consume again.
- Saving a combo disables stock tracking for its assembled meal. Migration 000139 and its SQLite counterpart do the same for existing combos, updating their timestamp for offline sync while preserving historical quantities and counted components.
- Mixed-bill cancellation and restoration now act only on products with matching original stock movements. A bottled drink on the same bill no longer causes fictional dish stock to be restored or deducted. Local cancellations and local/server refunds also respect the dish's tracking flag.
- Existing dish backfills (000124–000126), recipe/add-on consumption and offline dish billing are included in regression coverage.

## Verification

- Restaurant stock + recipe/add-on + shared billing integration: **39 tests pass**, zero failures. Five new scenarios cover strict billing/report filters, mixed cancellation/restoration, dish refunds, combo consumption/replay and migration replay.
- Final combined frontend production gate: **2,953 tests pass, one pre-existing test skipped** across 395 passing files. Typecheck, all 6,276 translation keys, production build and bundle/app gates pass. Checks cover actual billing-card rendering, low-stock classification, offline dish sales, local cancellation/refunds and stock-toggle persistence.
- Six isolated database example files pass: restaurant tables/menu, existing dish migration, table bills, packaged returns, standalone packaged returns and damaged-batch returns.
- Backend production checks and migration-safety pass with zero migration warnings.
- Full backend integration before these restaurant edits: **422 pass, three PostgreSQL-only skips, 45 files**. The 39-test run above verifies the restaurant and shared billing edits; the earlier full-suite result is not presented as a rerun of the final source.

## Rollout conditions

- Apply the pending migrations through the release workflow and deploy the verified candidate; allow tills to sync the updated product flags. No live database was changed by this work.
- A product explicitly marked as counted stock still shows real shortages. Ingredients and bottled goods must remain counted where appropriate; the fix does not clamp negative inventory or blanket-disable a restaurant's stock.
- The user confirmed the affected screen is **Dishes / Products**. Both catalogue layouts, its stock summary and filters have been corrected. The observed localhost previews show sign-in and run from other checkouts, so authenticated verification on the user's app remains pending.
- PostgreSQL runtime proof, operational release evidence, and the furniture/legacy conditions in the release gate remain outstanding. Nothing was pushed or deployed.
