# Production Launch Gate

Use this as the final pre-sell checklist. The backend is not ready for paid shops until each item is checked in a real staging/prod-like environment.

## Automated gate

Run:

```bash
npm run proof:release
```

Strict live gate:

```bash
PROOF_REQUIRE_LIVE=true \
PROOF_REQUIRE_POSTGRES=true \
PROOF_REQUIRE_WORKER=true \
PROOF_REQUIRE_DR=true \
PROOF_BASE_URL=https://api.example.com \
POSTGRES_TEST_DATABASE_URL="postgresql://.../kiranaos_test?schema=public" \
RESTORE_TEST_DATABASE_URL="postgresql://.../kiranaos_restore_test?schema=public" \
ALLOW_RESTORE_TEST_DB=true \
npm run proof:release
```

## Human gate

- Backup before migration completed.
- Restore drill completed.
- Rollback image recorded.
- `/health/ready` checked after deploy.
- Redis worker heartbeat is fresh.
- Razorpay test-mode checkout/webhook passed.
- Frontend-backend E2E passed with `Authorization` and `x-device-id` headers.
- Offline sync passed with `sync.entityCursors`.
- Staff removal/downgrade old-token behavior passed.
- Stock/udhar concurrency proof passed on PostgreSQL.
- Money paise reconciliation passed.
- Monitoring alerts are enabled for 5xx, payment webhook failure, queue backlog, stale worker, and DB connection problems.

## Go/no-go rule

If any payment, billing, stock, udhar, auth, device, sync, or migration proof fails, do not sell this build to shops. Fix and re-run the full gate.
