# Rollback Plan

Rollback is part of production readiness. Do not deploy without knowing the exact rollback image, database backup file, and migration state.

## Required rollback details

Before deploy, record:

```text
current image:
new image:
rollback image:
package version:
git commit:
backup file:
restore-test result:
release approver:
```

`RELEASE_ROLLBACK_IMAGE` should be set in the release environment when a human approves launch.

## When to rollback

Rollback immediately if any of these happen after deploy:

- `/health/ready` fails repeatedly.
- Login or device activation fails for existing shops.
- Bill creation fails or stock becomes inconsistent.
- Payment verification/webhook processing fails for successful Razorpay payments.
- Redis worker heartbeat is stale and jobs are building up.
- Frontend-backend E2E sync/device/subscription flow breaks.

## Application rollback

1. Stop traffic or enable maintenance mode if available.
2. Redeploy the rollback image.
3. Verify `/health/ready`.
4. Verify Redis worker heartbeat.
5. Run a minimal billing smoke test.
6. Watch payment webhook failures and 5xx logs.

## Database rollback

Database rollback is more dangerous than app rollback. Prefer forward-fix for additive migrations. Use restore only when data/schema corruption is confirmed.

Before database restore:

1. Stop API and worker writes.
2. Preserve the broken database as a forensic backup.
3. Restore from the known backup into a separate restore-test DB first.
4. Run money paise reconciliation.
5. Only then restore production if absolutely required.

## Migration rollback rule

Prisma migrations are forward-only by default. Any destructive migration requires:

- backup before migration,
- restore drill,
- rollback image,
- written approval,
- maintenance window,
- explicit `ALLOW_DESTRUCTIVE_MIGRATION=true` only for the checked migration.
