# Phase 26 — Operational Proof Suite

This phase adds one practical runner for the checks that must be proven before a real shop rollout.

## Main command

```bash
npm run proof:ops
```

By default, it runs checks that do not need external services:

```text
npm run prod:check
npm run contract:check
npm run razorpay:fixtures
```

It will automatically run extra checks when the required environment is present.

## Live backend proof

Start the API first:

```bash
npm start
```

Then run:

```bash
PROOF_BASE_URL=http://localhost:3000 npm run proof:ops
```

This adds:

```text
npm run contract:smoke
npm run smoke:test
```

Use this after every backend build before connecting the frontend.

## PostgreSQL proof

Run with an isolated destructive test database only:

```bash
POSTGRES_TEST_DATABASE_URL="postgresql://kiranaos:kiranaos@localhost:5432/kiranaos_test?schema=public" npm run proof:ops
```

This adds:

```text
npm run proof:postgres
```

The PostgreSQL proof validates the schema, resets the safe test database, runs integration tests, and includes concurrency tests for stock and udhar.

## Worker proof

Start Redis and the worker:

```bash
npm run worker
```

Then run:

```bash
QUEUES_ENABLED=true REDIS_URL=redis://localhost:6379 PROOF_REQUIRE_WORKER=true npm run proof:ops
```

This adds:

```text
npm run worker:health
```

If no fresh worker heartbeat exists, the proof fails.

## Razorpay fixture proof

`npm run razorpay:fixtures` is offline-only. It does not call Razorpay APIs. It proves:

```text
checkout payment HMAC signature verification
checkout signature tamper rejection
webhook raw-body HMAC signature verification
webhook signature tamper rejection
invalid webhook JSON rejection
```

This does not replace real Razorpay test-mode checkout/webhook testing. It only proves local signature logic is correct and raw-body behavior is not accidentally broken.

## Strict modes

Use these when you want CI/pre-release checks to fail instead of skip:

```bash
PROOF_REQUIRE_LIVE=true npm run proof:ops
PROOF_REQUIRE_POSTGRES=true npm run proof:ops
PROOF_REQUIRE_WORKER=true npm run proof:ops
```

## Final pre-sell command example

```bash
PROOF_BASE_URL=http://localhost:3000 \
POSTGRES_TEST_DATABASE_URL="postgresql://kiranaos:kiranaos@localhost:5432/kiranaos_test?schema=public" \
QUEUES_ENABLED=true \
REDIS_URL=redis://localhost:6379 \
PROOF_REQUIRE_LIVE=true \
PROOF_REQUIRE_POSTGRES=true \
PROOF_REQUIRE_WORKER=true \
npm run proof:ops
```

If this command passes with real PostgreSQL, Redis, worker, and live API running, the backend proof level is much stronger than static tests alone.

---

## Phase 28: disaster recovery proof

Run a real backup/restore drill before selling to real shops:

```bash
DATABASE_URL="postgresql://kiranaos:kiranaos@localhost:5432/kiranaos?schema=public" \
RESTORE_TEST_DATABASE_URL="postgresql://kiranaos:kiranaos@localhost:5432/kiranaos_restore_test?schema=public" \
ALLOW_RESTORE_TEST_DB=true \
npm run proof:dr
```

To force the full proof suite to fail unless the restore drill runs:

```bash
PROOF_REQUIRE_DR=true \
DATABASE_URL="postgresql://.../kiranaos" \
RESTORE_TEST_DATABASE_URL="postgresql://.../kiranaos_restore_test" \
ALLOW_RESTORE_TEST_DB=true \
npm run proof:ops
```

See `docs/DISASTER_RECOVERY.md` for the complete backup/restore runbook.


## Phase 29 release proof

Before a production rollout, prefer `npm run proof:release`. It runs migration safety, release gate, and the operational proof suite. For paid-shop launch, combine it with live PostgreSQL, Redis worker heartbeat, disaster-recovery restore drill, Razorpay test-mode, and frontend-backend E2E checks.
