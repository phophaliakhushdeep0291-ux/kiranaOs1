# KiranaOS — Phase 4: Problem Analysis & Risk Table

For each risk: **Cause → Prevention → Backend protection → Frontend protection → Test case**.

---

### R1. Offline bill duplicated after sync
- **Cause:** Client retries push; bill is created on every attempt.
- **Prevention:** Stable `client_event_id` per row (assigned at first local write).
- **Backend:** Unique index `(shop_id, device_id, client_event_id)` + unique `(shop_id, idempotency_key)`. On duplicate-key, return existing record with status `DUPLICATE`.
- **Frontend:** Outbox writes the same `client_event_id` on retry; never regenerates.
- **Test:** `test_sync_push_same_event_10x_creates_one_bill`.

### R2. Same bill pushed multiple times from same device
- **Cause:** UI double-click; tab-duplication; refresh during in-flight POST.
- **Prevention:** Disable submit during request + idempotency key.
- **Backend:** Same as R1.
- **Frontend:** `useMutation` with `isPending`; button disabled; outbox dedupes by `client_event_id` BEFORE push.
- **Test:** `test_double_submit_creates_one_bill`.

### R3. Payment duplicated after retry
- **Cause:** Network timeout; client retries; server already saved.
- **Prevention:** `idempotency_key` on every payment.
- **Backend:** Unique index `(shop_id, idempotency_key)` on `payments`.
- **Frontend:** Same key reused on retry.
- **Test:** `test_payment_idempotent_on_retry`.

### R4. Udhar double counting
- **Cause:** Both a `payment` and a `ledger_entry` created for the same bill twice.
- **Prevention:** Ledger entry creation is part of the same idempotent write that creates the bill; ref'd by bill_id.
- **Backend:** Insert ledger entry inside same handler; unique `(shop_id, ref_type, ref_id, type)` on `customer_ledger_entries` (one DEBIT per bill, one CREDIT per payment).
- **Frontend:** UI never inserts ledger directly; only the bill/payment endpoints do.
- **Test:** `test_ledger_one_debit_per_bill_even_on_retry`.

### R5. Udhar becoming negative incorrectly
- **Cause:** Customer repayment exceeds balance, or reversal applied twice.
- **Prevention:** Server checks `balance + amount ≥ 0` for credits unless `allow_advance=True` flag; reversals are idempotent and reference original payment.
- **Backend:** `PaymentService.record_payment` validates against ledger sum.
- **Frontend:** UI shows current balance; disables submit if would go negative without confirmation.
- **Test:** `test_repayment_more_than_outstanding_blocked`.

### R6. Dashboard mismatch with reports
- **Cause:** Two different queries computed at two different places.
- **Prevention:** ONE selector layer — `reports/queries.py` — used by both `/api/reports/daily` and `/api/dashboard`.
- **Backend:** Dashboard endpoint internally calls the same `daily_totals()`.
- **Frontend:** Both pages call the same API.
- **Test:** `test_dashboard_equals_reports_for_same_date`.

### R7. Cash/UPI double counted
- **Cause:** Counting payments AND bill totals for the same transaction.
- **Prevention:** Mode-wise totals come from `payments` only; sales come from `bills` only.
- **Backend:** Strict separation in selectors.
- **Frontend:** Same.
- **Test:** `test_cash_collected_does_not_double_count_with_sales`.

### R8. Profit showing wrong value
- **Cause:** Using current cost price for old bills.
- **Prevention:** `cost_price_paise_at_time` captured in each `bill_item`.
- **Backend:** Bill creation snapshots cost; profit selector uses snapshot.
- **Frontend:** Cannot edit historical cost.
- **Test:** `test_profit_uses_cost_at_time_not_current`.

### R9. Inventory stock mismatch
- **Cause:** Cache (`products.current_stock`) drifts from movements.
- **Prevention:** Every stock change inserts a movement and atomically `$inc`s the cache.
- **Backend:** `InventoryService.move` is the only write path; nightly job verifies.
- **Frontend:** Reads `current_stock` from API; never sets directly.
- **Test:** `test_stock_cache_equals_sum_of_movements`.

### R10. Multiple devices syncing same data
- **Cause:** Two devices made independent rows referring to same external entity.
- **Prevention:** Each device has its own `client_event_id` space; server keys by `(shop_id, device_id, client_event_id)`, so both writes succeed (distinct events) and the outcome is correct.
- **Backend:** Idempotency keyed on (device_id + client_event_id) only.
- **Frontend:** N/A — works by design.
- **Test:** `test_two_devices_create_two_bills_no_collision`.

### R11. Device revoked while offline
- **Cause:** Owner revoked the device on another phone while this device was offline.
- **Prevention:** On next online sync, backend returns `401 DEVICE_REVOKED`; client wipes Dexie's outbox (after exporting to JSON for owner) and forces logout.
- **Backend:** All endpoints check device status.
- **Frontend:** Detect `DEVICE_REVOKED`, show modal, offer "Export pending events" before clearing.
- **Test:** `test_revoked_device_blocked_on_sync`.

### R12. Subscription expired while offline
- **Cause:** Owner didn't renew; device is offline past grace.
- **Prevention:** `device_license_cache.valid_until` checked in UI for offline grace.
- **Backend:** On reconnect, server returns `403 SUBSCRIPTION_EXPIRED`.
- **Frontend:** Read-only mode + renew CTA.
- **Test:** `test_expired_subscription_blocks_writes`.

### R13. Pull sync returning stale/empty data
- **Cause:** Cursor not advanced atomically with apply.
- **Prevention:** Pull returns `(events, next_cursor)`; client updates cursor only after all events applied to Dexie.
- **Backend:** Pull is a pure read; ordered by server_seq.
- **Frontend:** Atomic Dexie transaction for "apply events + update cursor".
- **Test:** `test_pull_resumes_from_cursor_after_failure`.

### R14. Local pending record not replaced after server sync
- **Cause:** id_mapping not written; UI shows both local + server bill.
- **Prevention:** On successful push, server returns canonical record; client writes `id_mapping` and replaces local row with server row in same Dexie transaction.
- **Backend:** Push response always includes `{local_id, server_id, entity}`.
- **Frontend:** Bill list query uses Dexie unique key — only one row per `id`.
- **Test:** `test_local_pending_replaced_after_sync`.

### R15. Conflict between two devices
- **Cause:** Both devices updated a product price offline.
- **Prevention:** Append-only events have no conflict; profile edits are LWW + audit; risky changes need PIN.
- **Backend:** Compares `updated_at`; if both updates within X seconds and >threshold price change, writes `sync_conflict`.
- **Frontend:** `/sync` page lists conflicts; user picks winner.
- **Test:** `test_product_price_conflict_lands_in_queue`.

### R16. Failed sync halfway
- **Cause:** Server 500 mid-batch.
- **Prevention:** Push is per-event idempotent; partial batches don't corrupt.
- **Backend:** Each event processed independently inside a request; failures returned per-event, not whole-batch.
- **Frontend:** Failed events stay in outbox with exponential backoff.
- **Test:** `test_partial_batch_failure_keeps_others_synced`.

### R17. App refresh losing local changes
- **Cause:** State held in React only.
- **Prevention:** Every write commits to Dexie first.
- **Backend:** N/A.
- **Frontend:** `db.transaction('rw', ...)` before showing success.
- **Test:** Manual via `testing_agent_v3`: bill, refresh, verify still there.

### R18. User creating bill offline for existing customer
- **Cause:** Customer already in Dexie (last pull); bill references customer_id (server id).
- **Prevention:** Bill payload uses customer's server id directly (since customer was pulled).
- **Backend:** Normal flow.
- **Frontend:** Customer picker shows only synced customers, plus a "Create new customer (offline)" option.
- **Test:** `test_offline_bill_for_existing_customer_syncs`.

### R19. User creating customer offline then billing to them
- **Cause:** Customer has only a `local_id`; bill payload would reference unknown id.
- **Prevention:** Outbox pushes customer FIRST (dependency order); server returns server_id; subsequent bill push uses id_mapping to substitute server_id.
- **Backend:** Push request supports `local_id_refs` so server can replace if needed.
- **Frontend:** Sync engine orders entities by dependency.
- **Test:** `test_offline_new_customer_then_bill_syncs_correctly`.

### R20. Cancel bill after sync
- **Cause:** Owner cancels a synced bill.
- **Prevention:** Cancel emits a `BILL_CANCEL` event → server creates a reversal bill + reverses inventory + reverses payment/ledger.
- **Backend:** Idempotent; reversal references original.
- **Frontend:** Cancel goes through outbox like any other event.
- **Test:** `test_cancel_synced_bill_reverses_all_effects`.

### R21. Reverse payment after sync
- **Cause:** Wrong amount; owner clicks reverse.
- **Prevention:** Reversal creates a new payment with `type=REVERSAL`, negative amount-effect; updates ledger.
- **Backend:** Marks original `reversed=True`; creates inverse.
- **Frontend:** Confirmation modal with PIN.
- **Test:** `test_reverse_payment_restores_outstanding`.

### R22. Product cost changes and profit calculation
- **Cause:** Cost updated after a sale.
- **Prevention:** Bill captures cost at time of sale.
- **Backend:** `bill_item.cost_price_paise_at_time` set on creation.
- **Frontend:** Read-only display in bill detail.
- **Test:** `test_profit_unchanged_after_cost_update`.

### R23. Database constraints missing
- **Cause:** Developer forgot index.
- **Prevention:** `ensure_indexes()` on startup; tested.
- **Backend:** `tests/integration/test_indexes.py` verifies all required indexes exist.
- **Frontend:** N/A.
- **Test:** `test_required_indexes_present`.

### R24. Frontend trusting bad local totals
- **Cause:** Client computes grand_total, server stores as-is.
- **Prevention:** Server **always recomputes** subtotal/total from line items.
- **Backend:** `BillingService.create_bill` ignores client `grand_total`, recomputes.
- **Frontend:** Sends only line items.
- **Test:** `test_server_recomputes_total_ignores_client`.

### R25. Backend accepting duplicate financial events
- **Cause:** Missing idempotency on payment, purchase, expense.
- **Prevention:** Every financial collection has `(shop_id, idempotency_key)` unique index.
- **Backend:** All create endpoints accept and require `idempotency_key`.
- **Frontend:** Every write through outbox includes one.
- **Test:** `test_payment_purchase_expense_all_idempotent`.

---

## Summary Heat Map

| Category | # risks | Status |
|---|---|---|
| Idempotency | R1, R2, R3, R10, R25 | All covered by unique indexes + client_event_id |
| Sync | R13, R14, R16, R18, R19 | Cursor + id_mappings + dependency ordering |
| Financial integrity | R4, R5, R7, R8, R22, R24 | Append-only + snapshots + server-recompute |
| Inventory | R9 | Movement table + cache verifier |
| Device/Subscription | R11, R12 | Status checks + offline grace |
| Conflict | R15, R20, R21 | Reversal records + conflict queue |
| Consistency | R6 | Single selector layer |
| Local resilience | R17 | Dexie-first writes |
| Infrastructure | R23 | Index bootstrap on startup |
