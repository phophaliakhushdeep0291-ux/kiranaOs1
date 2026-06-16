# KiranaOS — Phase 3: Architecture

## 1. High-level Topology

```
┌───────────────────────────────────────────────────────────────────────┐
│                            React 19 + Dexie                          │
│  Pages ── useLiveDexie ── Dexie (IndexedDB) ── outbox.ts             │
│                                            ▲                          │
│                                            │ axios (interceptors)     │
│                                            ▼                          │
│  selectors.ts (SHARED business truth) ── api.ts                       │
└────────────────────────────────────────────┬──────────────────────────┘
                                             │ HTTPS, JWT bearer + X-Device-Id
                                             ▼
┌───────────────────────────────────────────────────────────────────────┐
│                       FastAPI (server.py)                             │
│   middleware: cors → auth → device → subscription                     │
│   modules/{auth,shops,staff,devices,subscription,products,customers,  │
│            bills,payments,inventory,purchases,expenses,reports,       │
│            sync,audit}                                                │
│   core/{db, security, base_model, money, deps}                        │
└────────────────────────────────────────────┬──────────────────────────┘
                                             │ Motor (async)
                                             ▼
                                ┌────────────────────────┐
                                │      MongoDB           │
                                │  append-only ledger    │
                                │  unique idempotency    │
                                └────────────────────────┘
```

## 2. Backend Module Architecture

Each module follows the same skeleton:

```
modules/<name>/
  __init__.py
  models.py        # Pydantic + BaseDocument
  router.py        # FastAPI APIRouter
  service.py       # pure business logic (testable without HTTP)
  repository.py    # Motor calls only, returns Pydantic
  events.py        # event payload schemas for sync
```

### Service contracts (Phase 3 scope)

| Service | Key methods |
|---|---|
| `AuthService` | `register_owner_and_shop`, `login`, `refresh`, `logout`, `me` |
| `DeviceAuthService` | `register_device`, `list_active`, `revoke`, `evict_for_login`, `check_alive` |
| `SubscriptionService` | `current_for_shop`, `is_within_limits`, `enforce_on_request` |
| `BillingService` | `create_bill(idempotency_key, payload)`, `cancel_bill(bill_id, reason)`, `get_bill`, `list_bills(filters)` |
| `PaymentService` | `record_payment(idempotency_key, payload)`, `reverse_payment(payment_id, reason)` |
| `CustomerLedgerService` | `debit(customer_id, amount, ref)`, `credit(customer_id, amount, ref)`, `balance(customer_id)`, `entries(customer_id)` |
| `InventoryService` | `move(product_id, qty, type, ref)`, `current_stock(product_id)`, `recompute(product_id)` |
| `PurchaseService` | `create_purchase`, `list_purchases` |
| `ExpenseService` | `create_expense`, `list_expenses` |
| `SyncService` | `push(events[])`, `pull(cursor)`, `status()`, `retry(event_id)`, `resolve_conflict(id, choice)` |
| `DashboardReportService` | `daily_totals(date)`, `range_totals(from,to)`, `customer_balances()`, `top_products(from,to)` |
| `AuditLogService` | `log(actor, action, entity_type, entity_id, before, after)` |
| `StaffPermissionService` | `can(user_id, permission)`, `list_roles`, `assign_role` |

### Critical patterns

- **No service calls FastAPI primitives.** Services take plain Python objects; routers translate HTTP↔service.
- **Repositories never return raw dicts.** Always `Model.from_mongo(doc)` or `list[Model]`.
- **Transactions** simulated via Mongo replica-set transactions if available, or otherwise via the **append-only-then-rollback-by-compensating-write** pattern; financial writes order: insert idempotency-protected event FIRST, then derived updates.

## 3. Frontend Module Architecture

```
src/
  lib/
    api.ts          → axios client; injects Authorization + X-Device-Id; refresh-on-401
    db.ts           → Dexie schema with all local tables
    outbox.ts       → enqueue/drain/retry; exposes sync state observable
    selectors.ts    → THE only place that computes sales, cash, UPI, udhar, profit
    money.ts        → paise/rupee formatting (₹1,234.56)
    permissions.ts  → can(user, perm)
  hooks/
    useAuth, useShop, useLiveDexie, useSyncEngine, useDeviceStatus
  pages/            → thin pages, call selectors, never compute totals themselves
  components/
    billing/        → cart, item-picker, payment-modal
    shell/          → AppShell, MobileNav (bottom-tab on mobile)
    status/         → SyncBadge (pending/synced/failed/conflict), OfflineBanner, DeviceBadge
```

### Frontend invariants

- **Pages never call axios directly** — only `api.ts` wrappers, which always write to Dexie first.
- **Pages never compute totals** — they read from `selectors.ts`.
- **Mobile-first**: bottom-tab nav under 768px; side-drawer above.
- Every page shows a `SyncBadge` for items that have a pending state.

## 4. Database Schema (MongoDB collections)

> All collections include `shop_id` (string UUID) and `created_at` (ISO string). Money is `*_paise` integer. Booleans use real bools.

### `users`
`{ id, email, name, phone, password_hash, role, status, created_at }`

### `shops`
`{ id, owner_user_id, name, address, gstin, currency, created_at }`

### `staff_members`  (join: shop ↔ user with role)
`{ id, shop_id, user_id, role, permissions[], status, created_at }`

### `roles`  (system + custom)
`{ id, shop_id|null, name, permissions[] }`

### `devices`
`{ id, shop_id, user_id, name, platform, last_seen_at, status (ACTIVE|REVOKED|EXPIRED), created_at }`

### `sessions`
`{ id, device_id, user_id, shop_id, jti, refresh_jti, expires_at, refresh_expires_at, revoked_at|null }`

### `plans`
`{ id, code, name, price_paise, max_devices, max_staff, features[] }`

### `shop_subscriptions`
`{ id, shop_id, plan_id, status (TRIAL|ACTIVE|EXPIRED|CANCELLED), started_at, valid_until }`

### `products`
`{ id, shop_id, name, sku, barcode, unit, selling_price_paise, cost_price_paise, current_stock, low_stock_alert, hsn, gst_rate, status, created_at }`

### `customers`
`{ id, shop_id, name, phone, address, outstanding_paise (denormalized cache), created_at }`

### `bills`  *(append-only; cancellation creates a reversal bill)*
```
{
  id, shop_id, bill_no, customer_id|null, idempotency_key, device_id, client_event_id,
  items: [{ product_id, name_snapshot, qty, unit_price_paise, cost_price_paise_at_time, line_total_paise }],
  subtotal_paise, discount_paise, tax_paise, grand_total_paise,
  paid_amount_paise, payment_mode (CASH|UPI|UDHAR|PARTIAL|MIXED),
  status (PAID|UDHAR|PARTIAL),
  cancelled (bool), cancelled_at, cancelled_by, reversed_by_bill_id,
  created_by_user_id, created_at
}
```
**Unique index:** `(shop_id, idempotency_key)`

### `bill_items` — embedded in bills (simpler queries; small N per bill)

### `payments`
```
{
  id, shop_id, customer_id|null, bill_id|null, idempotency_key, device_id,
  amount_paise, mode (CASH|UPI|OTHER),
  type (BILL_PAYMENT|CUSTOMER_REPAYMENT|REVERSAL),
  reversed (bool), reversed_by_payment_id, reversed_at,
  created_by_user_id, created_at
}
```
**Unique index:** `(shop_id, idempotency_key)`

### `customer_ledger_entries`  *(append-only)*
```
{
  id, shop_id, customer_id, type (DEBIT|CREDIT),
  amount_paise, ref_type (BILL|PAYMENT|REVERSAL), ref_id,
  created_at
}
```

### `inventory_movements`  *(append-only)*
```
{
  id, shop_id, product_id, type (SALE|PURCHASE|ADJUSTMENT_UP|ADJUSTMENT_DOWN|REVERSAL_SALE|REVERSAL_PURCHASE),
  qty (signed; negative for outflow), unit_cost_paise_at_time, ref_type, ref_id, created_at, created_by_user_id
}
```

### `purchases` + `purchase_items` (embedded)
`{ id, shop_id, supplier_name, invoice_no, items: [...], total_paise, paid_paise, status, created_at }`

### `expenses`
`{ id, shop_id, category, amount_paise, note, paid_via (CASH|UPI), created_at, created_by_user_id }`

### `sync_events`  *(append-only server log)*
```
{
  id (server_seq), shop_id, device_id, client_event_id,
  entity_type, op (CREATE|UPDATE|CANCEL|REVERSE),
  payload, result (server entity snapshot), applied_at
}
```
**Unique index:** `(shop_id, device_id, client_event_id)` — the idempotency wall

### `sync_conflicts`
`{ id, shop_id, entity_type, entity_id, server_version, client_version, status (OPEN|RESOLVED), resolution, created_at }`

### `id_mappings`
`{ id, shop_id, device_id, local_id, server_id, entity_type, created_at }`

### `audit_logs`
`{ id, shop_id, actor_user_id, device_id, action, entity_type, entity_id, before, after, created_at }`

### `daily_closing_snapshots`
`{ id, shop_id, date, sales_paise, cash_paise, upi_paise, udhar_paise, profit_paise, bills_count, created_at }`

## 5. Offline IndexedDB Schema (Dexie)

```ts
db.version(1).stores({
  products:         'id, shop_id, name, status',
  customers:        'id, shop_id, name, phone',
  bills:            'id, shop_id, created_at, customer_id, sync_status, [shop_id+created_at]',
  payments:         'id, shop_id, bill_id, customer_id, sync_status, created_at',
  ledger_entries:   'id, shop_id, customer_id, created_at',
  inventory_movements: 'id, shop_id, product_id, created_at',
  purchases:        'id, shop_id, created_at',
  expenses:         'id, shop_id, created_at',
  sync_outbox:      'client_event_id, status, attempts, next_retry_at, created_at',
  sync_cursor:      'shop_id',
  sync_conflicts:   'id, status',
  id_mappings:      '[local_id+entity_type], server_id',
  local_audit_logs: 'id, created_at',
  device_license:   'shop_id',  // one row: { valid_until, plan_code }
  meta:             'key'
});
```

Every row that mirrors a server entity has `local_id` and `sync_status ∈ {PENDING|SYNCED|FAILED|CONFLICT}`.

## 6. Sync Architecture

```
[UI write] → outbox.enqueue(event) → Dexie.<entity>.put(localRow)
                                  ↓
                              UI live-updates from Dexie
                                  ↓
[useSyncEngine] every 10s or onOnline:
   1. drain outbox (FIFO, by entity dependency order: customers → products → bills → payments → ...)
   2. POST /api/sync/push  [events...]
   3. For each response.event:
        if status=APPLIED  → mark outbox SYNCED, write id_mapping, replace local row with server snapshot
        if status=DUPLICATE → mark SYNCED (server already has it)
        if status=CONFLICT → write to sync_conflicts, mark CONFLICT
        if status=ERROR    → mark FAILED, exponential backoff
   4. GET  /api/sync/pull?cursor=<server_seq>
   5. Apply each server event to Dexie (skip if local_id already in id_mappings)
   6. Advance cursor
```

**Dependency order on push** ensures a bill is never pushed before the customer it references.

## 7. Idempotency Design

Three layers of protection:

1. **Client event id** (UUID v4) generated when the row is first created locally. Replays use the same id.
2. **Idempotency key** on `bills`/`payments` = `${client_event_id}` so the entity-level unique index also catches retries.
3. **Server unique indexes** on `(shop_id, device_id, client_event_id)` and `(shop_id, idempotency_key)`. On duplicate-key error the server returns the *existing* record with status=DUPLICATE.

## 8. Conflict Handling

| Entity | Strategy |
|---|---|
| `bills`, `payments`, `ledger_entries`, `inventory_movements` | **Append-only** — no conflicts possible by design |
| `products` | Last-write-wins by `updated_at`; both versions recorded in `audit_logs`; >₹50 price drop creates a `sync_conflict` flagged for owner |
| `customers` | Same as products; phone change goes to conflict queue |
| `subscription`/`devices` | Server-authoritative; client overwrites local cache |

Dangerous edits (price drop > 30%, customer phone change) require an **owner PIN** before sync resolves.

## 9. Financial Ledger Design

**Single source of truth = `customer_ledger_entries`**. Customer's `outstanding_paise` is a cache only.

When inserting a debit/credit entry, server runs both writes atomically (transaction if available, else compensating delete on cache update failure):

```python
async def debit(shop_id, customer_id, amount_paise, ref):
    entry = LedgerEntry(... type=DEBIT, amount=amount_paise, ref=ref)
    await db.customer_ledger_entries.insert_one(entry.to_mongo())
    await db.customers.update_one(
        {"_id": customer_id, "shop_id": shop_id},
        {"$inc": {"outstanding_paise": amount_paise}}
    )
```

A nightly verifier recomputes `outstanding_paise = Σ entries` and emails diff alerts.

## 10. Inventory Movement Design

`current_stock` on `products` is a cache. Source of truth = `inventory_movements`.

```
current_stock = Σ inventory_movements.qty WHERE product_id=P AND shop_id=S
```

Recompute job runs on demand for any product flagged in `audit_logs` with `manual_correction`.

## 11. Reporting Design

`reports/queries.py` exposes:
- `daily_totals(shop_id, date)` → `{sales, cash, upi, udhar_today, profit, bills_count}`
- `range_totals(shop_id, from, to)` → same shape
- `customer_balances(shop_id)` → `[{customer_id, name, outstanding_paise}]`
- `top_products(shop_id, from, to, limit)`
- `payment_method_breakdown(shop_id, from, to)`

Dashboard cards and Reports page **both import the same functions** via API endpoint `/api/reports/daily` and `/api/reports/range`.

## 12. Device & Session Design

- Login issues access token (60min) + refresh token (30d) + creates/refreshes a `device` row.
- `X-Device-Id` header required on every authenticated request. Mismatch with token's `device_id` claim → 401.
- Periodic heartbeat `POST /api/devices/heartbeat` updates `last_seen_at`.
- Eviction: token gets a `jti`; on revoke we add jti to `revoked_tokens` (TTL = token expiry). Middleware checks.

## 13. Subscription Enforcement

Middleware `enforce_subscription` runs after auth:
- Load `shop_subscription`. If `status != ACTIVE` or `valid_until < now`:
  - Allow read-only endpoints (so the user can still see their data)
  - Block writes with `403 SUBSCRIPTION_EXPIRED`
- Offline grace: client checks `device_license_cache.valid_until > now` for the same logic.

## 14. Audit Log Design

Every write service call ends with `AuditLogService.log(...)`. The audit collection has the full before/after for forensic value. Read endpoint `/api/audit?from&to&action` returns paginated history.

## 15. Error Handling Design

All API errors follow:
```json
{ "error_code": "DEVICE_LIMIT_EXCEEDED", "message": "...", "details": {...} }
```

Error codes used in UI logic (not just messages):
`AUTH_INVALID`, `TOKEN_EXPIRED`, `DEVICE_REVOKED`, `DEVICE_LIMIT_EXCEEDED`, `SUBSCRIPTION_EXPIRED`, `PERMISSION_DENIED`, `IDEMPOTENT_DUPLICATE`, `VALIDATION_FAILED`, `STOCK_INSUFFICIENT` (warn-only), `BUYER_PAID_EXCEEDS_TOTAL`, `SYNC_CONFLICT`.

## 16. Testing Strategy

| Layer | Tooling | Coverage target |
|---|---|---|
| Unit (services) | pytest | every public method, every invariant |
| Integration (HTTP) | pytest + httpx | every endpoint, happy + sad path |
| Sync replay tests | pytest | push-same-event-10× scenario |
| Frontend smoke | `testing_agent_v3` | login, bill, udhar, sync flow on preview URL |
| Load (later) | k6 | 100 bills/min single shop |
