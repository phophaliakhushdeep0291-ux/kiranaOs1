# KiranaOS Backend Contract

This repository is the frontend package. Do **not** treat frontend checks as security enforcement. The backend must independently authenticate, authorize, validate, scope, audit, and reconcile every request described below.

## 1. Backend security requirements

### 1.1 Authentication and session

- Every protected endpoint must require a valid authenticated session.
- The authenticated context must include at least:
  - `user_id`
  - `tenant_id`
  - `store_id`
  - `device_id` when the request comes from a licensed device
  - `role`
  - active subscription/device/license state
- The backend must never trust `tenant_id`, `store_id`, `user_id`, or `device_id` only because the frontend sent them in a payload. Payload values may be used for reconciliation/debugging, but authorization must come from the authenticated server-side context.

### 1.2 Owner PIN enforcement

Frontend Owner PIN checks are only a local UX/offline guard. Backend must enforce Owner PIN again for sensitive operations.

Backend must require and verify Owner PIN for at least:

- bill cancellation
- payment reversal
- stock correction
- large discount approval
- selling below minimum price approval
- report/data export
- staff permission change
- customer delete/restore when policy requires approval
- product delete/restore when policy requires approval
- supplier delete/restore when policy requires approval
- restore of financial records
- device removal or license-sensitive device actions
- any destructive/financial sync operation marked as sensitive

Required behavior:

- Reject missing/invalid Owner PIN with `403`.
- Never store the raw PIN.
- Audit whether PIN was required and whether approval passed.
- Store the reason/comment if required for the action.
- Do not accept a frontend-only `ownerPinConfirmed: true` flag as proof.

### 1.3 Staff role permissions

Backend must enforce staff permissions for every endpoint and sync operation. UI hiding is not enough.

Examples:

- Staff without billing permission cannot create/cancel bills.
- Staff without payment permission cannot record/reverse payments.
- Staff without product permission cannot create/update/delete products.
- Staff without stock permission cannot adjust inventory.
- Staff without report permission cannot view/export reports.
- Staff cannot change staff permissions unless explicitly allowed and Owner PIN approved.

Recommended error shape:

```json
{
  "code": "PERMISSION_DENIED",
  "message": "You do not have permission to perform this action.",
  "required_permission": "billing.cancel"
}
```

### 1.4 Subscription plan enforcement

Backend must enforce subscription/plan rules. Frontend plan gating is not authoritative.

Backend must block operations not allowed by the current plan, including:

- cloud sync after subscription expiry
- premium actions after expiry
- staff login below the required plan
- WhatsApp reminders below the required plan
- device limits above the plan limit
- Growth/Pro-only features from Starter plan

Expired subscription behavior:

- Old data should remain viewable when policy allows.
- New premium/cloud operations must be blocked after expiry.
- Offline grace, if supported, must be validated by backend on the next sync and must not silently convert blocked actions into server success.

Recommended error shape:

```json
{
  "code": "SUBSCRIPTION_REQUIRED",
  "message": "Your subscription does not allow this action.",
  "required_plan": "pro"
}
```

### 1.5 Device limit and device license enforcement

Backend must enforce device registration and plan device limits.

Required behavior:

- Validate `device_id` for sync and premium device-scoped actions.
- Reject unknown/revoked devices.
- Reject new device activation when the plan limit is reached.
- Record audit logs for device add/remove/revoke.
- Do not rely on a frontend cached device license for backend authorization.

Recommended error shape:

```json
{
  "code": "DEVICE_LIMIT_REACHED",
  "message": "Device limit reached for this plan.",
  "allowed_devices": 2,
  "active_devices": 2
}
```

### 1.6 Tenant/store isolation

Backend must enforce tenant/store isolation on every read and write.

Required behavior:

- All rows must belong to one `tenant_id` and one `store_id`, unless explicitly global/admin-only.
- Reads must filter by authenticated `tenant_id` and `store_id`.
- Writes must assign `tenant_id` and `store_id` from authenticated context, not trust client payload values.
- Sync push/pull must accept and return only data owned by the current tenant/store.
- Reports and daily closing must calculate only current tenant/store data.
- Recycle bin must show only current tenant/store soft-deleted data.
- Audit logs must be tenant/store scoped.

### 1.7 Sync ownership

Backend must verify that every sync operation belongs to the authenticated tenant/store/device/user.

Required checks:

- `op_id` and `idempotency_key` must be unique per tenant/store/device or another documented safe scope.
- `entity_id`/`local_id` mappings must not cross tenant/store boundaries.
- A device cannot push operations for another store unless the authenticated account has explicit access.
- Pull cursor must be scoped to tenant/store/device or authenticated account context.
- Backend must not accept ownership changes from client payload unless the operation explicitly supports transfer and is authorized.

### 1.8 Audit logging

Backend must record server-side audit logs for all sensitive and important actions, including actions received through sync.

Audit log fields should include:

```json
{
  "id": "audit_server_id",
  "tenant_id": "tenant_id",
  "store_id": "store_id",
  "device_id": "device_id",
  "user_id": "user_id",
  "action": "payment.reverse",
  "entity_type": "payment",
  "entity_id": "payment_id",
  "reason": "Owner approved reversal",
  "owner_pin_required": true,
  "owner_pin_confirmed": true,
  "before": {},
  "after": {},
  "metadata": {},
  "created_at": "2026-06-07T00:00:00.000Z"
}
```

Rules:

- Store no raw Owner PIN.
- Failed authorization attempts should also be auditable where appropriate.
- Audit logs synced from frontend must be treated as client audit evidence, not the only server audit record.
- Server should create its own authoritative audit entry for sensitive backend-accepted operations.

### 1.9 Destructive action authorization

Backend must treat destructive and financial changes as high-risk.

Required behavior:

- Re-check role/permission/subscription/device/tenant-store scope.
- Require Owner PIN when policy requires it.
- Require reason when policy requires it.
- Create audit log whether the action succeeds or fails authorization, according to audit policy.
- Use soft-delete for business records unless explicitly safe to purge.

### 1.10 No hard delete for financial records

Backend must never hard-delete financial records through normal app actions.

No hard delete for:

- bills
- bill items
- payments
- customer ledger entries
- inventory movements created by sale/purchase/damage/correction
- audit logs
- sync outbox/server sync events/conflict history where needed for reconciliation

Required behavior:

- Use `deleted_at`, `cancelled_at`, `status`, or reversal/correction entries.
- Bill cancellation must append reversal/correction records as needed.
- Payment reversal must mark/reverse, not delete the original payment.
- Ledger must remain append-only except safe metadata updates already designed.

## 2. AI proxy endpoints

Frontend must not call Groq/OpenAI directly and must not expose AI API keys in the browser bundle. Backend owns all AI provider credentials.

### 2.1 POST `/api/ai/app-command`

Purpose: parse a global app command into a safe intent.

Request:

```json
{
  "commandText": "open billing",
  "context": {
    "route": "/billing",
    "tenant_id": "tenant_id",
    "store_id": "store_id",
    "languageContext": ["Hindi", "Hinglish", "English", "local kirana names"]
  }
}
```

Response:

```json
{
  "intent": "navigate",
  "confidence": 0.92,
  "action_preview": "Open Billing page",
  "data": {
    "route": "/billing"
  },
  "requires_confirmation": false,
  "requires_owner_pin": false
}
```

### 2.2 POST `/api/ai/product-aliases`

Request:

```json
{
  "name": "chini",
  "category": "grocery",
  "languageContext": ["Hindi", "Hinglish", "English", "local kirana names"]
}
```

Expected response:

```json
{
  "aliases": ["sugar", "chini", "cheeni", "shakar", "sakar", "चीनी", "शक्कर"]
}
```

Rules:

- Backend must dedupe aliases before returning.
- Backend must return only strings that are safe to display.
- Frontend has local fallback dictionary if this endpoint fails.

### 2.3 POST `/api/ai/voice-billing-parse`

Purpose: parse billing speech into a draft only. Backend must not create the final bill from this endpoint.

Request:

```json
{
  "transcript": "Ramesh ke naam 2 kilo chini 45 rupay kilo, 500 udhar",
  "context": {
    "route": "/billing",
    "knownProducts": [],
    "knownCustomers": []
  }
}
```

Response:

```json
{
  "intent": "billing_draft",
  "confidence": 0.9,
  "customer": {
    "name": "Ramesh"
  },
  "items": [
    {
      "name": "chini",
      "quantity": 2,
      "unit": "kg",
      "rate": 45
    }
  ],
  "payment": {
    "mode": "credit",
    "cash": 0,
    "upi": 0,
    "udhar": 500
  },
  "requires_confirmation": true
}
```

### 2.4 POST `/api/ai/form-fill`

Purpose: parse voice/text into form draft fields for product/customer/inventory/payment forms.

Request:

```json
{
  "form": "product",
  "text": "add product chini cost 40 selling 45 alias sugar cheeni चीनी",
  "languageContext": ["Hindi", "Hinglish", "English", "local kirana names"]
}
```

Response:

```json
{
  "form": "product",
  "confidence": 0.88,
  "fields": {
    "name": "chini",
    "costPrice": 40,
    "sellingPrice": 45,
    "aliases": ["sugar", "cheeni", "चीनी"]
  },
  "action_preview": "Fill product draft for chini",
  "requires_confirmation": true,
  "requires_owner_pin": false
}
```

## 3. Sync contract

### 3.1 POST `/sync/push`

Frontend sends pending local operations in batches. Backend must process each operation independently and return per-operation results. Partial failure is allowed; all failed operations must be reported without deleting local data.

Request:

```json
{
  "device_id": "device_id",
  "cursor": "optional_cursor",
  "operations": [
    {
      "op_id": "op_local_1",
      "clientEventId": "op_local_1",
      "idempotency_key": "bill:create:tenant:store:local_bill_id",
      "operation_type": "CREATE_BILL",
      "entity_type": "bill",
      "entity_id": "local_bill_id",
      "tenant_id": "tenant_id",
      "store_id": "store_id",
      "device_id": "device_id",
      "client_created_at": "2026-06-07T00:00:00.000Z",
      "payload": {}
    }
  ]
}
```

Backend response:

```json
{
  "results": [
    {
      "op_id": "op_local_1",
      "status": "SYNCED",
      "entity_type": "bill",
      "local_id": "local_bill_id",
      "server_id": "server_bill_id",
      "server_record": {
        "id": "server_bill_id"
      },
      "id_mappings": [
        { "entity_type": "bill", "local_id": "local_bill_id", "server_id": "server_bill_id" },
        { "entity_type": "payment", "local_id": "local_payment_id", "server_id": "server_payment_id" }
      ]
    }
  ],
  "next_cursor": "server_cursor_123"
}
```

Rules:

- Backend must return a result for every accepted operation.
- `status` should be one of `SYNCED`, `FAILED`, `CONFLICT`, or `DUPLICATE`.
- Duplicate idempotency must return the same server entity/mapping as the original successful operation.
- Failed operations must not be treated as success.
- Backend must not ask frontend to delete local data after failure.
- Backend must enforce tenant/store ownership for each operation.

### 3.2 Sync idempotency

For each operation:

- `idempotency_key` is required.
- Repeating the same `idempotency_key` must be safe.
- If the operation already succeeded, return the same successful result and server IDs.
- If the same key is reused with materially different payload, return `CONFLICT` or `FAILED` with a clear code.

Recommended duplicate response:

```json
{
  "op_id": "op_retry_1",
  "status": "DUPLICATE",
  "entity_type": "bill",
  "local_id": "local_bill_id",
  "server_id": "server_bill_id",
  "server_record": { "id": "server_bill_id" },
  "id_mappings": [
    { "entity_type": "bill", "local_id": "local_bill_id", "server_id": "server_bill_id" }
  ]
}
```

### 3.3 Sync failure response

Recommended failed result:

```json
{
  "op_id": "op_local_1",
  "status": "FAILED",
  "entity_type": "bill",
  "local_id": "local_bill_id",
  "error": "VALIDATION_ERROR",
  "error_message": "Paid amount cannot exceed bill total."
}
```

Frontend behavior expected:

- Mark operation `FAILED`.
- Preserve local bill/payment/customer/product data.
- Show failed sync status.
- Retry with the same `idempotency_key`.

### 3.4 Conflict response

Backend must return structured conflicts when both local and server changed the same entity or when ownership/version checks fail.

Recommended conflict result:

```json
{
  "op_id": "op_local_1",
  "status": "CONFLICT",
  "entity_type": "customer",
  "local_id": "customer_local_1",
  "server_id": "customer_server_1",
  "conflict": {
    "code": "VERSION_CONFLICT",
    "message": "Customer was modified on another device.",
    "local_record": {},
    "server_record": {},
    "base_version": 10,
    "server_version": 12,
    "resolution_required": true
  }
}
```

Frontend stores conflicts in `sync_conflicts` and should not overwrite unsynced local changes silently.

### 3.5 GET `/sync/pull`

Request:

```http
GET /sync/pull?cursor=server_cursor_123
```

Response:

```json
{
  "changes": [
    {
      "change_id": "change_1",
      "entity_type": "product",
      "entity_id": "product_server_1",
      "operation_type": "UPSERT",
      "server_version": 124,
      "entity": {
        "id": "product_server_1",
        "name": "chini",
        "tenant_id": "tenant_id",
        "store_id": "store_id"
      }
    }
  ],
  "next_cursor": "server_cursor_124",
  "server_version": 124
}
```

Rules:

- Return only current tenant/store changes.
- Include tombstones/soft-delete state for deleted/restored records.
- Do not return data from other stores.
- Include enough version/update metadata for conflict detection.

### 3.6 POST `/sync/retry`

If implemented, this endpoint should trigger backend-side retry/diagnostic state only. Frontend local retry still reuses the original local outbox operation and `idempotency_key`.

### 3.7 POST `/sync/resolve-conflict`

Request:

```json
{
  "conflict_id": "conflict_1",
  "resolution": "use_local",
  "merged_payload": {}
}
```

Response should return updated sync status and/or the resolved server record. Backend must verify the user may resolve conflicts for the entity and tenant/store.

## 4. Operation-specific contracts

### 4.1 CREATE_BILL

Backend must create the bill and all related records atomically:

- bill
- bill items
- payments
- customer ledger entries
- inventory movements
- audit logs/server audit record
- id mappings for all local child IDs

Success response must include:

```json
{
  "op_id": "op_bill_1",
  "status": "SYNCED",
  "entity_type": "bill",
  "local_id": "local_bill_id",
  "server_id": "server_bill_id",
  "server_record": {
    "id": "server_bill_id"
  },
  "id_mappings": [
    { "entity_type": "bill", "local_id": "local_bill_id", "server_id": "server_bill_id" },
    { "entity_type": "bill_item", "local_id": "local_item_id", "server_id": "server_item_id" },
    { "entity_type": "payment", "local_id": "local_payment_id", "server_id": "server_payment_id" },
    { "entity_type": "ledger_entry", "local_id": "local_ledger_id", "server_id": "server_ledger_id" },
    { "entity_type": "inventory_movement", "local_id": "local_stock_id", "server_id": "server_stock_id" }
  ]
}
```

Backend validations:

- Paid amount cannot exceed total unless advance payment is explicitly allowed.
- Udhar/credit bill requires a customer.
- Discount cannot exceed subtotal.
- Below-minimum selling requires Owner PIN when policy requires it.
- Large discount requires Owner PIN when policy requires it.
- Product/customer references must belong to current tenant/store.
- Inventory negative-stock policy must be enforced.

### 4.2 RECORD_PAYMENT

Backend must record payment atomically:

- payment row
- customer ledger entry
- customer denormalized balance/trust score update if used
- audit log/server audit record

Expected result:

```json
{
  "op_id": "op_payment_1",
  "status": "SYNCED",
  "entity_type": "payment",
  "local_id": "local_payment_id",
  "server_id": "server_payment_id",
  "server_record": {
    "id": "server_payment_id",
    "customer_id": "server_customer_id",
    "amount": 500,
    "mode": "cash"
  },
  "id_mappings": [
    { "entity_type": "payment", "local_id": "local_payment_id", "server_id": "server_payment_id" },
    { "entity_type": "ledger_entry", "local_id": "local_ledger_id", "server_id": "server_ledger_id" }
  ]
}
```

### 4.3 REVERSE_PAYMENT

Backend must not delete the original payment.

Required behavior:

- Original payment remains unchanged or is marked `reversed`.
- A correction ledger entry is appended.
- Customer balance is adjusted.
- Server audit log is created.
- Operation is idempotent.

Expected result:

```json
{
  "op_id": "op_reverse_payment_1",
  "status": "SYNCED",
  "entity_type": "payment",
  "local_id": "local_payment_id",
  "server_id": "server_payment_id",
  "server_record": {
    "id": "server_payment_id",
    "reversed": true,
    "reversed_at": "2026-06-07T00:00:00.000Z"
  },
  "id_mappings": [
    { "entity_type": "ledger_entry", "local_id": "local_correction_ledger_id", "server_id": "server_correction_ledger_id" }
  ]
}
```

Owner PIN and reason should be required according to policy.

### 4.4 Customer delete soft-delete contract

Customer delete must be soft-delete only.

Required behavior:

- Set `deleted_at` and/or `status: "deleted"`.
- Do not delete bills, payments, or ledger entries.
- Require Owner PIN when policy requires it.
- Audit the action.
- Return the updated customer record.

Expected result:

```json
{
  "op_id": "op_customer_delete_1",
  "status": "SYNCED",
  "entity_type": "customer",
  "local_id": "local_customer_id",
  "server_id": "server_customer_id",
  "server_record": {
    "id": "server_customer_id",
    "deleted_at": "2026-06-07T00:00:00.000Z"
  }
}
```

### 4.5 Product/supplier/bill restore contracts

Restore operations must:

- clear `deleted_at` or restore active status
- preserve historical financial/inventory rows
- create audit log
- return updated server record
- be tenant/store scoped

### 4.6 Audit log sync contract

Frontend may sync local audit logs as `AUDIT_LOG_APPEND`.

Request operation payload example:

```json
{
  "op_id": "op_audit_1",
  "idempotency_key": "audit-log:tenant:store:local_audit_id",
  "operation_type": "AUDIT_LOG_APPEND",
  "entity_type": "audit_log",
  "entity_id": "local_audit_id",
  "payload": {
    "auditLogId": "local_audit_id",
    "auditLog": {
      "id": "local_audit_id",
      "tenant_id": "tenant_id",
      "store_id": "store_id",
      "device_id": "device_id",
      "user_id": "user_id",
      "action": "voice_command",
      "entity_type": "voice_command",
      "entity_id": "voice_command_id",
      "reason": "Voice command processed",
      "metadata": {
        "command_text": "add product chini",
        "parsed_intent": "product_draft",
        "action_preview": "Open product form and fill draft",
        "user_confirmed": false,
        "action_result": "draft_created"
      },
      "created_at": "2026-06-07T00:00:00.000Z"
    }
  }
}
```

Success response:

```json
{
  "op_id": "op_audit_1",
  "status": "SYNCED",
  "entity_type": "audit_log",
  "local_id": "local_audit_id",
  "server_id": "server_audit_id",
  "server_record": {
    "id": "server_audit_id"
  }
}
```

Rules:

- Do not store raw PIN values.
- Treat frontend audit logs as client-originated evidence.
- Server should still create authoritative server audit logs for sensitive backend operations.

## 5. Required common response shapes

### 5.1 Success envelope

For non-sync API endpoints, either return the entity directly or use a stable envelope:

```json
{
  "success": true,
  "data": {},
  "message": "Saved"
}
```

### 5.2 Error envelope

```json
{
  "success": false,
  "code": "VALIDATION_ERROR",
  "message": "Human readable message",
  "details": {}
}
```

Recommended status codes:

- `400` validation error
- `401` unauthenticated
- `403` unauthorized/permission/plan/device/PIN failure
- `404` not found in current tenant/store scope
- `409` conflict/idempotency payload mismatch/version conflict
- `422` business rule violation
- `429` rate limit
- `500` unexpected server error

## 6. Frontend expectations summary

Frontend expects backend to:

- enforce owner PIN, staff permissions, subscription plan, device limit, tenant/store isolation, and destructive action authorization
- return per-operation sync push results
- preserve idempotency by `idempotency_key`
- return stable local-to-server `id_mappings`, especially for `CREATE_BILL`
- return conflicts in structured `CONFLICT` results
- never report failed backend writes as success
- never require frontend to delete local data after sync failure
- soft-delete financial/customer/product/supplier records when policy requires history preservation
- expose AI only through backend proxy endpoints
- avoid hard delete for financial records

## 7. Backend implementation note

This frontend repo does not include backend server code. This document is the contract the backend must satisfy. Do not implement backend behavior inside the frontend to replace server-side enforcement.
