# Worker Operations Runbook

Phase 23 makes background worker readiness visible. Queues being enabled is not enough for production: at least one live worker process must also be running and sending a fresh Redis heartbeat.

## Required production setup

For a single Railway service, use the supervised runtime. With
`QUEUES_ENABLED=true` it starts the API and worker as separate child processes
and restarts the whole container if either one stops:

```bash
npm run start:runtime
```

`PROCESS_ROLE=auto` is the default. To scale them separately later, deploy the
same image twice with `PROCESS_ROLE=api` on the web service and
`PROCESS_ROLE=worker` on the worker service. `npm run worker` remains useful for
local development and direct worker-only operation.

Use the same `REDIS_URL`, `DATABASE_URL`, and secrets for both processes. Set:

```env
QUEUES_ENABLED=true
PROCESS_ROLE=auto
REDIS_URL=redis://...
WORKER_CONCURRENCY=3
WORKER_HEARTBEAT_INTERVAL_MS=30000
WORKER_STALE_AFTER_MS=90000
```

`WORKER_STALE_AFTER_MS` must be greater than the heartbeat interval. The backend defaults are 30 seconds interval and 90 seconds stale window.

## Health checks

Owner/admin API:

```http
GET /api/jobs/status
GET /api/jobs/workers
```

CLI checks:

```bash
npm run worker:verify
npm run worker:health
```

`worker:verify` enqueues and processes a harmless `WORKER_HEALTHCHECK` job on the sync-cleanup queue. `worker:health` checks Redis heartbeat freshness and fails if no fresh worker heartbeat exists.

## What to alert on

Alert when:

- `workerHeartbeat.healthy=false` while `queuesEnabled=true`.
- queue `waiting` or `delayed` count keeps increasing.
- queue `failed` count increases.
- Redis status is not ready/connect.
- `worker_ready_status` metric is `0` in production.
- `worker_heartbeat_age_ms` is near or above `WORKER_STALE_AFTER_MS`.

## Safe failed-job operations

Use these only after checking the failure reason:

```http
GET /api/jobs/failed
GET /api/jobs/queues/:queueName/failed
POST /api/jobs/:queueName/:jobId/retry
POST /api/jobs/:queueName/:jobId/discard
```

Failed-job responses intentionally do not expose raw payloads, PINs, passwords, tokens, signatures, or customer contact data.

## Important limitation

Do not move core financial operations to background jobs. Bill confirmation, stock deduction, payment verification, and udhar balance changes must stay synchronous/idempotent. Workers are for reminders, reports, exports, backups, and cleanup jobs only.

Production rule: core financial operations must never be moved to background jobs.
