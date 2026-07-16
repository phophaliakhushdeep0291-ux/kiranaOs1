# KiranaOS Backend API Contract v1

This document is the frontend/backend contract for the production-hardening phase. The machine-readable version is in:

```text
contracts/api-contract.v1.json
```

## Mandatory frontend rules

### Authentication

Protected APIs require:

```http
Authorization: Bearer <accessToken>
Content-Type: application/json
```

The access token contains the user and shop context, but the backend refreshes the user role from the database on protected requests. The frontend must not cache role decisions forever. Always update local permission state from `/api/auth/me` or login/refresh responses.

### Device header

Most paid shop APIs require an activated device:

```http
x-device-id: <activatedDeviceId>
```

Do not send protected shop requests without this header. The backend can return:

```text
DEVICE_REQUIRED
DEVICE_NOT_FOUND
DEVICE_REMOVED
DEVICE_BLOCKED
DEVICE_NOT_ACTIVE
```

The activation flow is:

```text
1. POST /api/auth/login
2. POST /api/devices/activate
3. Store returned deviceId locally
4. Send x-device-id on protected APIs
5. GET /api/devices/license when offline license is needed
```

### owner PIN

Risky/destructive actions may require:

```http
x-owner-pin: <4-digit PIN>
```

The PIN can also be sent in `body.ownerPin`, but headers are preferred for frontend consistency. Do not store the PIN permanently.

### Tenant scope

The frontend must not send `shopId` in normal request bodies. Tenant context comes from the authenticated token. In particular, never send `shopId` to payment/subscription activation APIs.

### Money and quantity precision

Money fields must be finite numbers with max two decimal places. Paise fields must be integers. Do not send `NaN`, `Infinity`, scientific notation from UI input, or hidden high-precision values such as `10.999`.

### Sync pull pagination

New frontend clients use the monotonic server sequence protocol. Start with
`GET /api/sync/pull?afterSeq=0&limit=500`, persist `nextServerSeq` before
refreshing the UI, and send that value as the next `afterSeq`.

Server response contains:

```json
{
  "sync": {
    "protocol": "server_sequence_v2",
    "nextServerSeq": "1842",
    "serverVersion": "1901",
    "hasMore": true
  }
}
```

Sequence values are decimal strings because PostgreSQL uses a 64-bit sequence.
The server emits durable tombstones for hard deletes. Legacy clients that omit
`afterSeq` continue to receive `(updatedAt, id)` `entityCursors` during rollout;
new clients must not mix those cursors with `server_sequence_v2`.

After a page has been fully merged (or each conflict has been durably recorded)
and the local cursor has been committed, the client sends:

```text
POST /api/sync/ack       # { "server_seq": "<decimal sequence>" }
GET  /api/sync/devices   # owner/admin fleet lag and freshness view
```

Acknowledgements are device-scoped, monotonic, and cannot claim a sequence that
the shop server has not issued. The fleet response reports every active device's
applied sequence, lag, last acknowledgement, presence, and attention state.

### Durable sync conflict ledger

```text
POST /api/sync/conflicts/report   # idempotent client conflict report
GET  /api/sync/conflicts          # owner/admin cross-device review list
POST /api/sync/resolve-conflict   # optimistic owner/admin decision + audit
```

Conflict snapshots are server-redacted, bounded, tenant-scoped, and never
available to cashier roles. Resolution should send `expected_version` from the
list response so another device cannot silently overwrite the first decision.


### Sync push local ID mapping

Offline-first frontend code may create products, customers, and bills before the backend has assigned server IDs. For those cases, sync push supports local IDs and returns mappings.

Rules:

```text
1. CREATE_PRODUCT may send payload.localProductId or product.localId.
2. CREATE_CUSTOMER may send payload.localCustomerId or customer.localId.
3. CREATE_BILL may send payload.localBillId or bill.localId.
4. Bill items may send localProductId/productLocalId when the product was created offline.
5. Credit bills/udhar bills may send localCustomerId when the customer was created offline.
6. The response includes idMappings.products/customers/bills. Store these in IndexedDB immediately.
7. If a dependency is not synced yet, handle SYNC_DEPENDENCY_PENDING as retryable.
8. If the same event is already processing, handle SYNC_EVENT_IN_PROGRESS as retryable and do not create a new event ID.
```

## Critical endpoint groups

### Public/auth bootstrap

```text
GET  /api/health
GET  /health/ready
GET  /api/plans
GET  /api/subscription/plans
POST /api/auth/register
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
```

### Authenticated but device not required

These are needed before device activation or for payment/subscription bootstrap:

```text
GET    /api/auth/me
POST   /api/auth/pin/set
POST   /api/auth/pin/verify
GET    /api/auth/pin/check
GET    /api/auth/staff
POST   /api/auth/staff
PATCH  /api/auth/staff/:id/role
DELETE /api/auth/staff/:id
POST   /api/auth/change-password
GET    /api/devices
POST   /api/devices/activate
POST   /api/devices/heartbeat
GET    /api/subscription/current
POST   /api/subscription/checkout
POST   /api/subscription/verify-payment
```

### Authenticated and device-required shop APIs

These require both `Authorization` and `x-device-id`:

```text
/api/shops
/api/products
/api/customers
/api/bills
/api/inventory
/api/udhar
/api/suppliers
/api/reports
/api/sync
/api/jobs
/api/reminders
/api/ai
```

### AI audio transcription

`POST /api/ai/transcribe` requires `Authorization`, `x-device-id`, and an active
shop context. It accepts a multipart `audio` or `file` field, a raw supported
audio body, or the documented base64 JSON fallback, up to 25 MB. A successful
response includes `data.transcript`, `data.model`, and `data.provider`.

The server streams the isolated temporary file to the configured Groq or
OpenAI transcription provider and removes it after both successful and failed
requests. The endpoint does not log audio bytes or transcript text.

### Encrypted shop backup artifacts

```text
GET  /api/jobs/backups
POST /api/jobs/backups                 # owner PIN required
GET  /api/jobs/backups/:id/download    # owner PIN required
```

Backup creation captures one transactionally consistent, tenant-scoped logical
snapshot. It is gzip-compressed, encrypted with AES-256-GCM, checksummed with
SHA-256, stored under a server-generated key, and retained for the configured
period. Password/PIN hashes, sessions, device fingerprints, integration-key
hashes, and webhook secrets are intentionally excluded. API responses never
expose the object-storage key. Production creation requires the Redis worker,
non-local object storage, and a base64-encoded 32-byte
`BACKUP_ENCRYPTION_KEY`.

### Razorpay webhook

```text
POST /api/payment-provider/razorpay/webhook
```

This route uses raw request body signature verification. Do not place JSON parser middleware before this route.


### Payment provider operations

`POST /api/payment-provider/razorpay/webhook` is public to Razorpay only and must use raw-body signature verification.

Payment provider admin operations require `Authorization` + `x-device-id` and owner/admin role:

```text
GET /api/payment-provider/events
POST /api/payment-provider/events/:id/retry
POST /api/payment-provider/manual/activate
```

Manual activation stays disabled by default and should not be exposed to normal tenants in production.

## Frontend release gate

Before a frontend build is considered compatible with this backend, verify:

```text
1. Login works.
2. Device activation stores deviceId.
3. Protected APIs include x-device-id.
4. Blocked/removed device error is handled.
5. Subscription expired/payment required errors are handled.
6. Owner PIN modal is used for destructive/sensitive actions.
7. Offline outbox push uses batch size limits.
8. Sync pull persists nextServerSeq and resumes with afterSeq.
9. Sync push stores returned idMappings for offline-created products/customers/bills.
10. Money inputs are capped to 2 decimal places before sending.
11. Payment verification never sends shopId in body.
12. Owner/admin Sync Status merges the server conflict ledger and records resolutions online.
```

## Phase 48 financial correction endpoints
- `POST /api/customers/:id/udhar-payment/:ledgerId/reverse` — reverse a wrongly-entered udhar payment. Requires auth, active device, record-payment feature, and owner PIN. Reversal must create a new linked ledger entry instead of deleting history.
