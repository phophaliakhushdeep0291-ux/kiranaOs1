# Release Runbook

This backend should not be released to real shops only because static tests pass. A release must prove code, migration, worker, payment, backup, restore, and frontend contract behavior.

## Required release command

Run this before every release candidate:

```bash
npm run proof:release
```

For a serious staging/pre-sell gate, run it with live services:

```bash
PROOF_BASE_URL=http://localhost:3000 \
POSTGRES_TEST_DATABASE_URL="postgresql://kiranaos:kiranaos@localhost:5432/kiranaos_test?schema=public" \
RESTORE_TEST_DATABASE_URL="postgresql://kiranaos:kiranaos@localhost:5432/kiranaos_restore_test?schema=public" \
ALLOW_RESTORE_TEST_DB=true \
QUEUES_ENABLED=true \
REDIS_URL=redis://localhost:6379 \
PROOF_REQUIRE_LIVE=true \
PROOF_REQUIRE_POSTGRES=true \
PROOF_REQUIRE_WORKER=true \
PROOF_REQUIRE_DR=true \
npm run proof:release
```

## Release checklist

1. Create a backup before migration using `npm run backup:postgres`.
2. Prove restore drill using `npm run proof:dr`.
3. Run PostgreSQL proof using `npm run proof:postgres`.
4. Run Redis worker heartbeat proof using `npm run worker:health` while the worker is running.
5. Run Razorpay test-mode checkout and webhook testing. The offline fixture proof is `npm run razorpay:fixtures`, but live Razorpay test-mode must also be performed before selling.
6. Run frontend-backend E2E using `docs/E2E_PRODUCTION_PROOF.md`.
7. Confirm `/health/ready` passes after deployment.
8. Confirm queue backlog, payment webhook failures, and 5xx error alerts are active.
9. Record rollback image before deploy.
10. Record release approver and launch time.

## Deployment order

1. Deploy to staging first.
2. Run `npm run proof:release` against staging.
3. Create production backup.
4. Run restore drill against restore-test database.
5. Deploy migrations.
6. Deploy API image.
7. Deploy worker image.
8. Verify `/health/ready`.
9. Verify worker heartbeat.
10. Verify a small billing/sync/payment smoke flow.

## Hard rule

Never skip backup before migration. Never release without a restore drill. A backup that cannot be restored is not a backup.
