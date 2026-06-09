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

New frontend clients must use per-entity cursors.

Server response contains:

```json
{
  "sync": {
    "entityCursors": {
      "products": "...",
      "customers": "...",
      "bills": "...",
      "stockLedger": "...",
      "udharLedger": "..."
    },
    "hasMoreByEntity": {
      "products": false,
      "customers": true,
      "bills": false,
      "stockLedger": false,
      "udharLedger": false
    }
  }
}
```

The next pull should send those cursors back as the `cursors` query JSON. Do not rely only on one global cursor for new clients.


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
8. Sync pull persists entityCursors.
9. Sync push stores returned idMappings for offline-created products/customers/bills.
10. Money inputs are capped to 2 decimal places before sending.
11. Payment verification never sends shopId in body.
```

## Phase 48 financial correction endpoints
- `POST /api/customers/:id/udhar-payment/:ledgerId/reverse` — reverse a wrongly-entered udhar payment. Requires auth, active device, record-payment feature, and owner PIN. Reversal must create a new linked ledger entry instead of deleting history.
