# KiranaOS Backend E2E Production Proof Checklist

This checklist is for proving the backend with the real frontend, PostgreSQL, Redis/BullMQ, and Razorpay test mode.

## Required environment

```text
NODE_ENV=production-like staging
PostgreSQL database
Redis server when QUEUES_ENABLED=true
Razorpay test mode credentials
Real frontend origin in ALLOWED_ORIGINS
METRICS_REQUIRE_TOKEN=true
ALLOW_MANUAL_SUBSCRIPTION_ACTIVATION=false
```

## Flow 1 — owner onboarding

```text
1. Register shop owner.
2. Login owner.
3. Set owner PIN.
4. Activate device.
5. Verify /api/auth/me.
6. Verify /api/devices/license with x-device-id.
```

Expected: all protected shop APIs fail without `x-device-id` and pass with the activated device.

## Flow 2 — billing and stock correctness

```text
1. Create product with stock.
2. Create customer.
3. Confirm cash bill.
4. Confirm udhar bill.
5. Cancel bill using owner PIN.
6. Verify product stock ledger.
7. Verify customer khata/udhar balance.
```

Expected: no negative stock, no floating precision drift in totals, audit logs created for sensitive actions.

## Flow 3 — offline-first sync

```text
1. Use app offline and create products/customers/bills locally.
2. Reconnect internet.
3. POST /api/sync/push in chunks.
4. GET /api/sync/pull with returned entityCursors.
5. Refresh UI from server state.
6. Repeat with two devices.
```

Expected: no duplicate bills, no skipped products/customers, and no cross-device missing data.

## Flow 4 — subscription/payment

```text
1. Create checkout.
2. Complete Razorpay test payment.
3. Verify payment from frontend.
4. Receive Razorpay webhook.
5. Check /api/subscription/current.
6. Trigger duplicate webhook.
7. Trigger failed/stuck webhook retry from /api/payment-provider/events/:id/retry.
```

Expected: entitlement activates once only; duplicate webhooks do not double-activate; failed events are visible and retryable.

## Flow 5 — worker proof

```text
1. Start API process.
2. Start worker process.
3. Run npm run worker:health.
4. Create export/report job.
5. Verify /api/jobs/status and /api/jobs/workers.
6. Stop worker.
7. Confirm stale heartbeat/alert path.
```

Expected: API readiness does not falsely imply worker readiness when queues are enabled.

## Flow 6 — staff/session security

```text
1. Invite staff.
2. Login staff.
3. Use staff token on allowed APIs.
4. Downgrade/change staff role.
5. Reuse old access token.
6. Disable staff.
7. Attempt refresh/reuse old tokens.
```

Expected: old token permissions follow current DB role; disabled staff is blocked immediately.

## Production launch rule

Do not launch paid shops until all six flows pass against PostgreSQL and the real frontend build.
