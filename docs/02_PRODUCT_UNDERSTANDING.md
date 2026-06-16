# KiranaOS — Phase 2: Product Understanding

## 1. Who Uses KiranaOS

| Persona | Pain today | What KiranaOS gives them |
|---|---|---|
| **Owner (Seth-ji)** | Doesn't know real cash/UPI/udhar at end of day; rewrites khata-book daily | Live dashboard, accurate udhar, locked records |
| **Counter Staff (helper)** | Slow billing; can't read owner's handwriting; no offline | Fast tap-bill UI; works offline; printable bill |
| **Stockist/Helper** | Forgets which sack came from which supplier; no margin idea | Purchases module captures cost; profit shown |
| **Owner's Family (cashier substitute)** | Can't take over without full training | Permission-based login on phone |
| **Multi-shop owner (3+ stores)** | One ledger, multiple shops impossible to reconcile | Shop-scoped data, per-shop dashboard |

## 2. Problems It Solves

1. **No truth about udhar.** Today owner trusts memory or paper diary. KiranaOS keeps an immutable customer ledger — every bill = debit, every repayment = credit, balance = `Σdebits − Σcredits`.
2. **Network is unreliable** in tier-2/3 cities and basements. KiranaOS keeps last 7 days of data on device and queues every write — billing never stops.
3. **No real profit number.** Owner only sees revenue. KiranaOS captures cost at bill-time and computes profit per bill.
4. **Cash vs UPI vs udhar confusion.** Each bill is tagged with payment method; mode-wise totals are derived from the same source as the dashboard.
5. **Account theft by staff.** Cancellations are reversals (audited), not deletions; only owner can revert payments.
6. **Device sharing chaos.** Netflix-style device limit prevents sharing the same plan across 10 phones.

## 3. How Billing Works (canonical flow)

```
[Helper scans/taps products] → cart with item lines (qty × selling_price_paise)
                              → subtotal, discount, tax (later), grand_total
[Choose payment mode]
    ├── CASH        → status=PAID, create Payment(mode=CASH, amount=grand_total)
    ├── UPI         → status=PAID, create Payment(mode=UPI,  amount=grand_total)
    ├── UDHAR       → status=UDHAR, create CustomerLedgerEntry(type=DEBIT, amount=grand_total)
    └── PARTIAL     → status=PARTIAL, create Payment(amount=paid_now) + CustomerLedgerEntry(type=DEBIT, amount=remaining)
[On finalize]
    → InventoryMovement(type=SALE, product_id, qty=-N) for each line
    → AuditLog(action=BILL_CREATED, …)
    → Outbox event (when offline)
```

**Invariants enforced server-side:**
- `paid_amount ≤ grand_total` (no over-pay without advance-payment module)
- Same `(shop_id, idempotency_key)` → returns the existing bill, never creates a duplicate
- Cancellation = create a **reversal bill** + reverse inventory + reverse payment + ledger credit; never delete

## 4. How Udhar Works

Udhar = customer credit. **Single source of truth = `customer_ledger_entries`**.

```
Bill on udhar (₹400)            → entry: customer_id=X, type=DEBIT,  amount=40000 paise, ref=bill:abc
Customer repays ₹250 cash       → entry: customer_id=X, type=CREDIT, amount=25000 paise, ref=payment:xyz
                                  AND  payment: amount=25000, mode=CASH, customer_id=X
Balance for X = Σ DEBIT − Σ CREDIT = 40000 − 25000 = 15000 paise = ₹150
```

- The Customer document caches `outstanding_paise` for fast list view, but it is **derived** on every write inside a transactional update (`update_one` with `$inc` after inserting the entry).
- A nightly `dailyClosingSnapshot` job will fold the day into a snapshot for fast monthly reports.

## 5. How Inventory Changes

Stock is **derived from movements** (`inventory_movements`), with a denormalized `current_stock` cache on `products`.

| Event | Movement type | Δ stock | Source |
|---|---|---|---|
| Bill finalized | `SALE` | −qty | bill_item |
| Purchase received | `PURCHASE` | +qty | purchase_item |
| Damage/loss | `ADJUSTMENT_DOWN` | −qty | staff entry, audited |
| Stock correction | `ADJUSTMENT_UP` | +qty | staff entry, audited |
| Bill cancelled | `REVERSAL_SALE` | +qty | cancellation event |

Each movement records `cost_price_paise_at_time` for accurate profit on reversal.

## 6. How Offline Mode Works

- On login, a `device_license_cache` and `subscription_cache` row is saved in Dexie with `valid_until = now + 7d`.
- The UI **always reads from Dexie first**; the API client writes the operation to Dexie immediately, then enqueues a `sync_outbox` row.
- A background `useSyncEngine` hook drains the outbox:
  - Every 10s when online, immediately on online event
  - Push events in FIFO order, batched by entity type
  - On success, the server returns the canonical record; we update `id_mappings(local_id → server_id)` and replace the local row.
- Even if the device is offline for the full 7 days, billing/customers/payments keep working. After 7 days, the device must re-authenticate online.

## 7. How Sync Works

Two endpoints + cursor:

- `POST /api/sync/push` — body = `[{ client_event_id, entity_type, op, payload, occurred_at }]`. Server applies each event idempotently using `(shop_id, device_id, client_event_id)` as the unique key. Returns canonical records + id-mappings + per-event status.
- `GET  /api/sync/pull?cursor=<server_seq>` — server returns events newer than cursor, scoped to the shop. Client advances cursor on success.

A single `sync_events` collection holds the **server-side log of all mutations** so any device can replay history deterministically. Conflicts (rare — only on profile edits) write to `sync_conflicts` and surface in `/sync` page; financial events are append-only so they never conflict.

## 8. How Reports Are Calculated

ONE truth layer: `backend/modules/reports/queries.py`.

| Metric | Formula |
|---|---|
| Sales | `Σ bill.grand_total WHERE shop_id=S AND status IN (PAID,UDHAR,PARTIAL) AND cancelled=False AND created_at IN [from,to]` |
| Cash collected | `Σ payment.amount WHERE shop_id=S AND mode=CASH AND reversed=False AND created_at IN [from,to]` |
| UPI collected | same with mode=UPI |
| Outstanding udhar | `Σ ledger.amount * sign(type) WHERE shop_id=S` (all-time, not date-bound) |
| Profit | `Σ (qty * (selling_price − cost_price_at_time)) over bill_items WHERE bill.status…` |

Dashboard cards on the frontend call **the same selector** (`selectors.ts::dailyTotals`) that the Reports page calls — proving they cannot disagree.

## 9. Subscriptions & Device Limits (Netflix model)

- `plans` table: { id, name, price_paise, max_devices, max_staff, features[] }
- `shop_subscription`: { shop_id, plan_id, status, valid_until }
- On login attempt:
  - Count active devices for `(shop_id)` where `status=ACTIVE`
  - If `count >= plan.max_devices`: return `409 DEVICE_LIMIT_EXCEEDED { active_devices: [...], device_limit_token: <2-min jwt> }`
  - Client shows picker → user picks a device → `POST /api/devices/revoke` with the token + chosen device_id → login retries → success
- Offline grace: even with no internet, a device stays usable up to `DEVICE_OFFLINE_GRACE_DAYS` from last successful sync.
- Revocation propagates on next sync: revoked device gets 401 with `code=DEVICE_REVOKED` and is locked out.

## 10. What Must Never Break (sacred invariants)

1. **One bill never counts twice.** Enforced by unique index on `(shop_id, idempotency_key)` and `(shop_id, device_id, client_event_id)`.
2. **One payment never counts twice.** Same as above on `payments`.
3. **Udhar balance always equals Σledger.** No mutation of customer.outstanding without a ledger row.
4. **Dashboard == Reports.** Same selector, same filter, same DB.
5. **Cancelled bills don't count in sales/profit.** All read queries filter `cancelled=False`.
6. **Money is always paise (int).** No float anywhere. Helper functions: `to_paise(rupees)`, `format_inr(paise)`.
7. **Backend trusts no client total.** Recomputes grand_total from line items on every write.
8. **Offline writes survive refresh.** Dexie persists across reloads; outbox replays on next boot.
9. **Revoked devices cannot write.** Token jti check + device status check on every API call.
10. **No silent overwrites.** All edits go through audit log.
