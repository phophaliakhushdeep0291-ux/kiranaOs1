# Payment Webhook Operations — Phase 22

Phase 22 makes Razorpay/payment webhook handling observable and retry-safe.

## Why this exists

Payment providers retry webhooks, and production servers can fail after storing an event but before completing subscription activation/refund reconciliation. Without event processing state, a duplicate webhook can be ignored forever even though the original attempt never finished.

## Event states

`PaymentProviderEvent.processingStatus` uses these values:

- `received` — stored, not yet attempted.
- `processing` — currently being processed by the backend.
- `processed` — successfully handled.
- `ignored` — valid event but not relevant to subscription payment state.
- `failed` — processing threw an error and the event can be retried.
- `duplicate` — reserved for future use; duplicate attempts are currently audited without rewriting the original event state.

## Operational routes

Authenticated owner/admin routes:

```http
GET /api/payment-provider/events?status=failed&limit=50
POST /api/payment-provider/events/:id/retry
```

The event list intentionally does not expose raw webhook payloads. It returns operational fields such as event id, event type, attempts, status, error, and timestamps.

## Runbook

1. Check failed events:

```bash
curl -H "Authorization: Bearer <token>" \
  "https://<api-host>/api/payment-provider/events?status=failed&limit=50"
```

2. Inspect payment/audit logs for the same `eventId`.
3. Fix the root cause if it is configuration-related.
4. Retry once:

```bash
curl -X POST -H "Authorization: Bearer <token>" \
  "https://<api-host>/api/payment-provider/events/<event_db_id>/retry"
```

5. If retry fails again, do not manually activate a plan from tenant-facing APIs. Use a trusted internal admin flow after checking Razorpay order/payment amount, currency, transaction id, and shop id.

## Production checks

Before launch, verify all of these with real PostgreSQL:

```bash
npm run prisma:deploy:postgres
npm run test:integration
```

Then run one real Razorpay test-mode checkout and verify:

- webhook event is created with `processingStatus=processed`;
- duplicate webhook does not extend subscription twice;
- failed webhook becomes visible as `processingStatus=failed`;
- manual retry updates the event to `processed` only after successful handling.
