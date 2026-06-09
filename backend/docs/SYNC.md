# KiranaOS Sync Architecture

This document describes the offline-first sync design for KiranaOS: how the frontend outbox, push, pull, and idempotency work together to keep data consistent without requiring a permanent internet connection.

---

## Section 1 — Sync Philosophy

KiranaOS is a cloud SaaS POS designed for Indian kirana stores, where internet connectivity can be intermittent. The system is built around a simple rule:

> **Billing must never stop only because the internet is down.**

Key principles:

1. The frontend can create bills, record udhar, and adjust stock entirely offline using IndexedDB as a local store.
2. The backend is the final source of truth. Every offline action must eventually be replayed through the backend.
3. Local actions are written to an **outbox** (the `PENDING_SYNC_QUEUE` IndexedDB store) and pushed to the backend when connectivity returns.
4. The backend validates every event independently — it does not trust frontend-computed totals.
5. The frontend must never wipe its local IndexedDB cache after reconnecting to the backend. Local data should be merged, not replaced.
6. Sync failures and conflicts must be shown to the user. Silent data loss is unacceptable.
7. The backend processes each sync event idempotently using a per-shop event log (`OfflineSyncEvent`). Replaying an already-synced event returns the cached result safely.

---

## Section 2 — Push Sync

### Endpoint

```
POST /api/sync/push
Authorization: Bearer <token>
X-Shop-Id: <shopId>
```

### Request body

```json
{
  "events": [
    {
      "clientEventId": "uuid-v4",
      "type": "CREATE_BILL",
      "payload": { ... },
      "ownerPin": "1234"
    }
  ]
}
```

- `events[]` is the canonical field name.
- `actions[]` is accepted as a backward-compatible alias and behaves identically.
- `clientEventId` and `eventId` are both accepted and normalized to each other inside the server. Always send `clientEventId`.
- `ownerPin` is only required for owner-gated event types (see Section 6). Omit it from all other events.

### Batch size rules

| Setting | Value |
|---------|-------|
| Recommended frontend batch size | **100 events** |
| Hard backend maximum | **500 events** |
| Error code if exceeded | `SYNC_BATCH_TOO_LARGE` |
| HTTP status if exceeded | 400 |

When the backend returns `SYNC_BATCH_TOO_LARGE`, the frontend must split its outbox into smaller chunks and re-send. Use `Math.ceil(total / 100)` batches.

### Processing rules

- Events are processed **sequentially**, one at a time.
- One failed event does **not** stop the rest of the batch.
- Each event's result appears independently in `data.results[]`.

### Response

```json
{
  "success": true,
  "data": {
    "received": 25,
    "applied": 24,
    "failed": 1,
    "results": [
      {
        "clientEventId": "uuid-v4",
        "eventId": "uuid-v4",
        "type": "CREATE_BILL",
        "status": "synced",
        "success": true,
        "serverId": "clbill123",
        "error": null
      }
    ],
    "summary": {
      "received": 25,
      "synced": 22,
      "duplicates": 2,
      "failed": 1,
      "conflicts": 0,
      "retryable": 1
    },
    "idMappings": {
      "products": { "local-prod-1": "clserverproduct123" },
      "customers": { "local-cust-1": "clservercustomer123" },
      "bills": { "local-bill-1": "clserverbill123" }
    },
    "serverTime": "2026-06-05T17:31:00.000Z"
  },
  "results": [...],
  "summary": { ... },
  "idMappings": { ... },
  "serverTime": "2026-06-05T17:31:00.000Z"
}
```

`data.results` and top-level `results` are the same array (the top-level alias exists for frontend convenience).

### Per-event result statuses

| `status` | `success` | Meaning | Frontend action |
|----------|-----------|---------|-----------------|
| `synced` | `true` | Applied for the first time | Mark local event synced, store `serverId` |
| `duplicate` | `true` | Already synced previously | Treat as success; no re-apply |
| `conflict` | `false` | Business or validation error | Show to user/admin; not retryable |
| `failed` | `false` | Server or permission error | Keep in outbox if `result.retryable=true`; show if `false` |


### localId → serverId mapping

Phase 30 adds a backend `SyncIdMapping` table. When the frontend creates a product, customer, or bill offline, it can send a local ID such as `local-prod-1`, `tmp_customer_abc`, or a UUID. The backend stores the mapping after successful sync and returns it in `data.idMappings` and top-level `idMappings`.

Example flow:

```json
{
  "events": [
    {
      "clientEventId": "evt-product-1",
      "type": "CREATE_PRODUCT",
      "payload": {
        "localProductId": "local-prod-rice",
        "product": { "localId": "local-prod-rice", "name": "Rice", "displayUnit": "kg", "baseUnit": "g", "rateUnit": "kg" }
      }
    },
    {
      "clientEventId": "evt-bill-1",
      "type": "CREATE_BILL",
      "payload": {
        "localBillId": "local-bill-1",
        "bill": {
          "localId": "local-bill-1",
          "items": [{ "localProductId": "local-prod-rice", "productId": "local-prod-rice", "name": "Rice", "quantity": 1, "enteredUnit": "kg", "ratePerRateUnit": 60 }],
          "payments": [{ "mode": "cash", "amount": 60 }]
        }
      }
    }
  ]
}
```

Because events are processed sequentially, the product mapping from the first event is available to the bill event in the same batch. This fixes the common offline-first bug where a bill created offline refers to a local product/customer ID and fails after reconnect.

Frontend rule: after every successful push, merge `idMappings.products`, `idMappings.customers`, and `idMappings.bills` into IndexedDB. Replace local IDs in cached rows/outbox events with returned server IDs where possible. If the frontend loses the response, it can still replay the same event ID; duplicate replay returns cached result and mapping again.

### Duplicate replay (idempotency)

The backend stores every processed event in `OfflineSyncEvent` keyed by `(shopId, eventId)` with a unique constraint. When the same `clientEventId` is pushed again:

- If `status=SYNCED`: returns the cached result with `status: "duplicate"` and `success: true`. No business logic re-runs.
- If another request is currently processing the same event, the backend returns `SYNC_EVENT_IN_PROGRESS` with `retryable=true` instead of applying business logic twice.
- If `status=FAILED` or stale `PROCESSING`: the event can be retried/reclaimed. This covers network failures where the frontend never received the response.
- If `status=CONFLICT`: the event is not retried with the same ID. Fix the payload and queue a new event ID.

The frontend must treat `status: "duplicate"` as success and store the returned `serverId`.

### Sensitive data rules

- `ownerPin` is **never stored** in `OfflineSyncEvent.requestJson` — it is stripped before storage.
- `ownerPin` is **never logged** by the backend logger.
- `ownerPin` is **never returned** in any API response.
- Full event payloads are not logged. Only summary metadata (batch size, counts, duration) appears in logs.

---

## Section 3 — Pull Sync

### Endpoint

```
GET /api/sync/pull?since=<ISO>&cursor=<cursor>&limit=<n>
Authorization: Bearer <token>
X-Shop-Id: <shopId>
```

### Query parameters

| Parameter | Required | Default | Max | Description |
|-----------|----------|---------|-----|-------------|
| `since` | Yes | — | — | ISO 8601 datetime. Only records updated at or after this time are returned. |
| `cursor` | No | — | — | Opaque pagination token from previous response `sync.nextCursor`. |
| `limit` | No | **500** | **1000** | Maximum rows per entity per page. |

### Response

```json
{
  "success": true,
  "data": {
    "syncedAt": "2026-06-05T17:30:00.000Z",
    "products": [...],
    "customers": [...],
    "bills": [...],
    "stockLedger": [...],
    "udharLedger": [...],
    "sync": {
      "hasMore": true,
      "nextCursor": "2026-06-05T17:29:55.000Z|clxyz123",
      "serverTime": "2026-06-05T17:30:01.000Z",
      "limit": 500,
      "returnedCount": 2500
    }
  }
}
```

The five entity arrays (`products`, `customers`, `bills`, `stockLedger`, `udharLedger`) are always present for backward compatibility. `data.sync` is a new additive object that provides pagination metadata.

### Pagination rules

- Each entity array is independently capped at `limit` rows.
- `sync.hasMore` is `true` if **any** entity returned exactly `limit` rows (more pages may exist).
- The frontend must keep pulling with the returned `sync.nextCursor` until `sync.hasMore = false`.
- Passing `cursor` from the previous response resumes from the exact record that was last returned, using keyset pagination on `(updatedAt, id)`.
- Soft-deleted products and customers are included when their `updatedAt` is within the pull window — the frontend should remove or mark them locally.

### Cursor format

```
"ISO_TIMESTAMP|CUID"
e.g. "2026-06-05T17:29:55.000Z|clxyz1234567890"
```

The cursor is opaque to the frontend. Store it exactly as returned and pass it verbatim in the next request. Do not parse or construct it manually.

### Ordering

All entity queries are ordered by `updatedAt ASC, id ASC`. The `id` tie-breaker guarantees that records with the same `updatedAt` timestamp are never skipped across page boundaries.

### What to pull on first launch

On first launch (or after a full cache clear), use `since=1970-01-01T00:00:00.000Z` to pull everything from the beginning. Paginate with `cursor` until `hasMore = false`. This is the only time you should pull from epoch.

---

## Section 4 — Frontend Sync Loop

The recommended sync loop runs on app start and on `online` reconnect events.

```
On app start:
  1. Open IndexedDB and load cached data.
  2. Render UI from local data immediately (do not wait for network).
  3. Check navigator.onLine.

If online:
  4. Push outbox in batches of 100.
     - For each batch response, update local status per event result.
     - synced → mark synced, store serverId.
     - duplicate → mark synced (treat as success).
     - conflict → mark conflict, show in Sync Status UI.
     - failed+retryable → leave in outbox, will retry.
     - failed+non-retryable → mark failed, show to user.
  5. Pull backend changes.
     - Use last known syncedAt as `since`.
     - Paginate with cursor until hasMore = false.
     - Merge received records into IndexedDB (upsert by id).
  6. Update "last synced" display.

If offline:
  7. All billing still works against local IndexedDB.
  8. Every user action adds an event to the outbox (PENDING_SYNC_QUEUE).
  9. Show "X events pending sync" badge.

On reconnect (online event):
  10. Resume from step 4 — push then pull.
  11. Do NOT wipe local data before pulling. Merge, never replace.

UI must always show:
  - Pending sync count (from outbox).
  - Failed sync count.
  - Conflict count.
  - Last successful sync timestamp.
  - Whether data is safe locally (always true for created bills).
```

---

## Section 5 — Error Handling Reference

| Server result | Frontend action |
|--------------|-----------------|
| `status: "synced"` | Mark local event synced. Store `serverId`. Update local bill/product/customer. |
| `status: "duplicate"` | Treat as success. Duplicate replay is safe — no double billing occurred. |
| `status: "failed"`, `retryable: true` | Keep in outbox. Retry on next sync cycle. |
| `status: "failed"`, `retryable: false` | Remove from outbox. Show user: "This action could not be synced." |
| `status: "conflict"` | Remove from outbox. Show in Sync Status UI with reason. May require manual correction. |
| HTTP 400 `SYNC_BATCH_TOO_LARGE` | Split the current batch by 100 and retry each sub-batch. |
| Network timeout / HTTP 5xx | Leave all outbox events in place. Retry when online. Do not count as conflict. |
| HTTP 401 / session expired | Refresh token or redirect to login. Outbox events remain safe locally. |

---

## Section 6 — Owner-Gated Sync Events

The following event types require either an `owner` role JWT or a valid owner PIN passed in the event's `ownerPin` field:

| Event type | Operation |
|------------|-----------|
| `CANCEL_BILL` | Mark an existing bill as cancelled |
| `RESTORE_BILL` | Reverse a cancellation |
| `DELETE_PRODUCT` | Soft-delete a product |
| `RESTORE_PRODUCT` | Restore a soft-deleted product |
| `ADJUST_STOCK` | Correct stock quantity or record damage |

### Rules

1. If the user's JWT contains `role: "owner"`, no PIN is required.
2. If the user is staff, they must collect the owner PIN in the UI before queuing the event, and include it as `ownerPin` in the event payload.
3. The PIN is verified server-side by bcrypt comparison against the owner's stored `pinHash`.
4. `ownerPin` is stripped from `OfflineSyncEvent.requestJson` before storage — it is never persisted.
5. `ownerPin` is never returned in any API response field.
6. `ownerPin` is never written to logs. Only metadata is logged.

If the PIN is wrong, the event returns `status: "failed"`, `code: "PERMISSION_DENIED"`, `retryable: false`. The user must re-enter the correct PIN and re-queue the event.

---

## Section 7 — Backend Safety Rules

The backend enforces these invariants regardless of frontend behavior:

1. **Re-calculates billing.** The backend runs all billing math independently. Frontend-provided subtotals, grandTotal, grossProfit are input hints only. The backend recalculates and stores its own values.
2. **Validates shop ownership.** Every query is scoped by `shopId` derived from the JWT. A synced event cannot touch another shop's data even if it includes a foreign ID.
3. **Validates entity ownership.** Products, customers, and bills referenced in sync events must belong to the same `shopId`.
4. **Idempotency.** `OfflineSyncEvent` has `@@unique([shopId, eventId])`. A duplicate event replay returns the cached result without re-applying business logic.
5. **Does not trust frontend totals.** `waivedAmount > grandTotal` is rejected with `INVALID_WAIVED_AMOUNT`. Payment coverage is validated server-side.
6. **Never hard-deletes financial records.** Bills, ledger entries, and payments are soft-deleted or reversed — never destroyed.
7. **Strips sensitive fields.** `ownerPin` and any key containing "pin" are removed from stored `requestJson` and returned `resultJson`.
8. **Logs metadata only.** Sync logs include batch size, counts, and duration. Full payloads, customer details, and bill items are never logged.
9. **Enforces batch limits.** Requests over 500 events are rejected at the middleware layer before any processing starts.
10. **Paginates pull responses.** Each entity query is capped at `limit` rows (default 500, max 1000). `sync.hasMore` tells the frontend whether more pages exist.

---

## Section 8 — Known Current Limitations

These are honest limitations of the current implementation. They are documented here so teams can plan mitigations before broad production rollout.

1. **Timestamp-based sync, not serverVersion-based.** Pull uses `updatedAt >= since` keyset pagination. This means a record updated between two successive pull requests can be missed if its `updatedAt` falls exactly on the page boundary. The `(updatedAt, id)` keyset cursor mitigates most boundary cases but does not eliminate the theoretical window. A serverVersion-based approach (monotone integer per shop) would close this gap. **ServerVersion sync is planned for a future phase.**

2. **Concurrent duplicate push race condition.** Two simultaneous push requests with the same `clientEventId` can both pass the `findUnique` check before either writes `PROCESSING` status, and both apply business logic. Bills are protected by `@@unique([shopId, billNo])`. Udhar payments and customer creates have no secondary guard. This is low-probability in practice (the frontend sends events from a single queue), but it is a real risk. Fix requires a database-level advisory lock or `SELECT FOR UPDATE` transaction. **Deferred.**

3. **No OfflineSyncEvent cleanup policy.** The `OfflineSyncEvent` table grows indefinitely. `SYNCED` events older than 90 days have no deletion policy yet. A scheduled cleanup job is needed for production stores with years of history. **Design pending.**

4. **Conflict resolution is basic.** Conflicts return `status: "conflict"` with a code and message. There is no server-side conflict resolution endpoint, no SyncConflict table, and no admin dashboard for inspecting/resolving conflicts. **Needs production-grade expansion.**

5. **DB-backed sync integration tests are limited.** The `backend-regression.examples.js` test file requires a live Prisma engine and is currently skipped in the sandbox (Windows Prisma binary on Linux CI). Full DB-backed tests covering sync push + pull end-to-end are not yet in CI. **Should be expanded once CI environment is on Linux.**

6. **localId → serverId mapping now exists for products/customers/bills.** Phase 30 adds `SyncIdMapping` and returns `idMappings` in push responses. The frontend should still store mappings locally immediately, but replaying the same event can recover the mapping safely.

---

## Section 9 — Future Sync Roadmap

These improvements are scoped but not yet implemented.

| Item | Description |
|------|-------------|
| **ServerVersion + SyncChangeLog** | Replace timestamp-based pull with a monotone integer per shop. Every write increments `shopVersion`. Pull uses `WHERE shopVersion > lastKnown`. Eliminates the timestamp boundary race. |
| **SyncCursor table** | Store the last-seen cursor per device per shop server-side. Enables resumable sync without the frontend storing cursor state. |
| **SyncConflict table** | Persist conflicts with full context (event, server state at conflict time, resolution). Powers admin conflict dashboard. |
| **Sync mapping recovery endpoint** | Optional endpoint to query stored `localId → serverId` mappings if the frontend needs manual repair/debug visibility. |
| **Strong bill idempotency key** | Add a `clientBillId` field to `Bill`. Allow the frontend to pass a UUID with every bill create; the server uses it as the idempotency key instead of the `OfflineSyncEvent` event ID. This tightens the duplicate-bill race window. |
| **Device-aware sync** | Track which device last synced what. Enable per-device `SyncCursor`. Required for multi-device shops (owner's phone + cashier tablet). |
| **Subscription-aware sync** | Gate pull/push based on subscription status. Return `SUBSCRIPTION_REQUIRED` on expired plan. |
| **Retry dashboard** | Admin UI showing failed/conflicted sync events per shop, with ability to re-trigger or dismiss. |
| **Conflict resolution endpoint** | `POST /api/sync/conflicts/:id/resolve` — accept or discard a conflict with an audit trail. |
| **Event outbox for analytics** | Publish synced events to an internal analytics pipeline (e.g., bills confirmed, stock adjusted) for reporting without coupling reporting to the sync path. |

---

## Quick Reference

### Push request (minimal)

```js
POST /api/sync/push
{ "events": [
    { "clientEventId": "uuid", "type": "CREATE_BILL", "payload": { bill } }
] }
```

### Pull request (initial)

```js
GET /api/sync/pull?since=1970-01-01T00:00:00.000Z&limit=500
```

### Pull request (paginated)

```js
GET /api/sync/pull?since=<last_since>&cursor=<nextCursor>&limit=500
```

### Supported event types

```
CREATE_BILL     CANCEL_BILL*    RESTORE_BILL*
CREATE_PRODUCT  UPDATE_PRODUCT  DELETE_PRODUCT*  RESTORE_PRODUCT*
ADJUST_STOCK*   CREATE_CUSTOMER UPDATE_CUSTOMER  UDHAR_PAYMENT
```

`*` = owner PIN required for staff users.

---

*Last updated: Phase 30 — June 2026.*
