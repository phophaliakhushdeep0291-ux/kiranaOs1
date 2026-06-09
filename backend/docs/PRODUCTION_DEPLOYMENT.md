# KiranaOS Production Deployment Guide

This guide describes how to deploy the API, worker, PostgreSQL migrations, Redis/BullMQ queues, scheduled daily closing, and report export storage.

## 1. Required services

- Node.js 20 runtime
- PostgreSQL 16+
- Redis 7+ if `QUEUES_ENABLED=true`
- Object storage for production report exports when public downloads are enabled; local storage is development-only

## 2. Environment variables

Start from `.env.example` and set real secrets through your hosting provider, not in Git.

Critical variables:

```env
NODE_ENV=production
DATABASE_URL=postgresql://user:password@host:5432/db?schema=public
JWT_SECRET=<long-random-secret>
LICENSE_SIGNING_SECRET=<long-random-secret>
RAZORPAY_ENABLED=false
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
QUEUES_ENABLED=true
REDIS_URL=redis://...
STORAGE_PROVIDER=local
EXPORT_DOWNLOADS_PUBLIC=false
DAILY_CLOSING_TIMEZONE=Asia/Kolkata
DAILY_CLOSING_SCHEDULE_HOUR=2
```

Do not hardcode secrets in Docker images, source code, CI files, or logs.

## 3. Install/build

```bash
npm ci
npm run prisma:generate:postgres
```

## 4. PostgreSQL migrations

For new production databases:

```bash
npm run prisma:deploy:postgres
```

If a database was manually created before Prisma migrations were tracked, baseline carefully and only once:

```bash
npx prisma migrate resolve --schema prisma-postgres/schema.prisma --applied 000001_init
npm run prisma:deploy:postgres
```

Prefer forward migrations. Do not edit old migrations after they have been applied to production.

## 5. API process

```bash
npm start
```

Health checks:

```bash
curl https://your-api.example.com/health/ready
```

`/health/ready` validates the database connection.

## 6. Worker process

Run the worker as a separate process/container:

```bash
npm run worker
```

The worker consumes BullMQ jobs. It does not start the Express server. The API process enqueues jobs but does not consume them by default.

## 7. Daily closing scheduler

Run daily closing at **2 AM Asia/Kolkata**:

```bash
npm run daily-closing:run
```

See `docs/SCHEDULING.md` for cron, PM2, Render, Railway, GitHub Actions, and systemd examples.

## 8. Report export storage

Development uses local storage under `storage/exports/{shopId}/{jobId}.csv`.

Production policy:

- `STORAGE_PROVIDER=local` is acceptable only when files are served through protected backend routes and local disk persistence is reliable.
- For public URLs, use S3/R2/MinIO adapter in a future phase.
- Never expose raw filesystem paths to clients.

## 9. Docker

Build:

```bash
docker build .
```

Run full local stack:

```bash
docker compose up postgres redis api worker
```

The API and worker use the same image with different commands.

## 10. Backups

Recommended:

- Daily PostgreSQL logical backup with `pg_dump`.
- Encrypt backups at rest.
- Test restore monthly.
- Keep report exports temporary; do not treat export files as source of truth.

## 11. Logs and monitoring

Monitor:

- API 5xx rate
- `/health/ready`
- PostgreSQL connection failures
- Redis connection failures
- BullMQ failed jobs
- Daily closing schedule success
- Export job failures
- Razorpay webhook failures

Do not log owner PINs, JWTs, Razorpay secrets, Redis passwords, customer phone numbers, payment tokens, or report file contents.

## 12. Common failure modes

### Prisma binary missing

Run:

```bash
npm ci
npm run prisma:generate:postgres
```

Use Node 20 and do not copy a Prisma client generated on Windows into Linux production.

### Migration drift

Run:

```bash
npx prisma validate --schema prisma-postgres/schema.prisma
npm run prisma:deploy:postgres
```

### Redis down

If `QUEUES_ENABLED=true`, exports and scheduled jobs cannot be queued. Keep API financial operations synchronous and unaffected.

### Worker not running

Queued exports and daily closing jobs remain waiting. Start:

```bash
npm run worker
```

### Daily closing not scheduled

Run manually:

```bash
npm run daily-closing:run
```

Then configure cron/scheduler.

### Export storage unavailable

Export jobs fail safely and are marked failed. Existing bills/payments/stock are not affected.

Note: migration drift must be handled with Prisma validate/deploy checks before release.

Note: worker not running means queued exports and daily closing jobs will remain waiting until `npm run worker` is started.

## Phase 15: Object Storage, Observability, and Smoke Testing

### Export object storage

KiranaOS supports four storage provider modes through `src/lib/objectStorage.js`:

- `STORAGE_PROVIDER=local` for local development and protected backend downloads.
- `STORAGE_PROVIDER=s3` for AWS S3-compatible production storage.
- `STORAGE_PROVIDER=r2` for Cloudflare R2 using an S3-compatible endpoint.
- `STORAGE_PROVIDER=minio` for self-hosted MinIO.

Required common variables:

```env
STORAGE_PROVIDER=local|s3|r2|minio
STORAGE_BUCKET=
STORAGE_REGION=
STORAGE_ENDPOINT=
STORAGE_ACCESS_KEY_ID=
STORAGE_SECRET_ACCESS_KEY=
STORAGE_PUBLIC_BASE_URL=
STORAGE_FORCE_PATH_STYLE=false
EXPORT_DOWNLOADS_PUBLIC=false
EXPORT_SIGNED_URL_TTL_SECONDS=300
```

For S3/R2/MinIO, export files are stored with server-generated keys like `exports/{shopId}/{jobId}.csv`. User-provided filenames are never used as object keys. Storage credentials must come only from environment variables and must never be logged.

### Export download modes

`EXPORT_DOWNLOADS_PUBLIC=false` is the recommended default. The backend verifies authentication and shop ownership, then streams the export file through `GET /api/reports/exports/:jobId/download`.

`EXPORT_DOWNLOADS_PUBLIC=true` should only be used with S3/R2/MinIO. The backend returns a short-lived signed URL using `EXPORT_SIGNED_URL_TTL_SECONDS`, defaulting to 300 seconds. Local storage is blocked as a public download provider in production.

### Queue and worker monitoring

Owner/admin users can inspect safe queue status using:

```http
GET /api/jobs/status
GET /api/jobs/failed
POST /api/jobs/:queueName/:jobId/retry
POST /api/jobs/:queueName/:jobId/discard
```

The response includes queue counts and sanitized failure metadata only. Job payloads, Redis URLs, tokens, PINs, phone numbers, and secrets are never exposed.

### Logs and metrics

The backend writes JSON logs with `type`, `level`, `time`, `requestId`, `userId`, `shopId`, `deviceId`, `method`, `path`, `status`, `durationMs`, `errorCode`, `errorName`, and `message` where available. The logger redacts passwords, PINs, JWTs, refresh tokens, Razorpay secrets, Redis URLs, and storage secrets.

Metrics are available as a lightweight JSON foundation:

```http
GET /api/health/metrics
GET /metrics
```

Metrics use low-cardinality labels only. They must not include `shopId`, `userId`, `deviceId`, customer phone numbers, or tokens.

### Deployment smoke test

After deployment, run:

```bash
SMOKE_BASE_URL=https://api.example.com npm run smoke:test
```

Optional stricter checks:

```bash
SMOKE_EXPECT_WORKER=true SMOKE_EXPECT_REDIS=true SMOKE_EXPECT_STORAGE=true npm run smoke:test
```

The smoke test checks `/api/health`, `/health/ready`, metrics shape, and optionally worker-protected job status behavior. It does not mutate financial data.

### Health and readiness

`/health/ready` checks database readiness, Redis when queues are enabled, and storage health. Database failure returns HTTP 503. Redis/storage failures return a degraded status where appropriate without exposing secrets.

### Alert checklist

Configure alerts for:

- API down or `/health/ready` returning 503.
- Database unavailable or migration drift.
- Redis unavailable while `QUEUES_ENABLED=true`.
- Worker not processing jobs.
- Export jobs failing repeatedly.
- Daily closing snapshots not generated by 2 AM Asia/Kolkata schedule.
- Storage upload/download/delete failures.
- High 5xx error rate.
- Razorpay webhook failures.
- Disk usage if using local dev storage.

### Common failure modes

- Prisma binary missing: run `npm run prisma:generate:postgres` inside the same runtime platform.
- Redis down: API can still serve core POS paths, but queue-backed export/snapshot jobs will be degraded.
- Storage unavailable: export downloads may fail, but financial records remain safe.
- Worker not running: queued jobs will remain waiting; start `npm run worker` as a separate process.

Smoke test quick reference: run npm run smoke:test after deployment.


## Phase 16: Provider Validation and Observability

### Real object storage validation

Run this in staging after configuring `STORAGE_PROVIDER=local|s3|r2|minio`:

```bash
npm run storage:verify
```

For production, explicitly confirm the safe healthcheck write/delete:

```bash
ALLOW_PRODUCTION_STORAGE_VERIFY=true npm run storage:verify
```

The script uploads a tiny `storage-healthcheck/...txt` object, reads it back, generates a signed URL for S3/R2/MinIO, deletes it, and confirms cleanup. It never logs access keys, secret keys, or signed URL query strings.

### Export flow validation

For staging export validation, provide an existing test shop/user only:

```bash
EXPORT_VERIFY_SHOP_ID=<shopId> EXPORT_VERIFY_USER_ID=<userId> npm run export:verify
```

Production export verification is blocked unless `ALLOW_PRODUCTION_EXPORT_VERIFY=true`. The script creates a `ReportExportJob`, generates the CSV through the normal export service, verifies object storage, then cleans the test file/job metadata. It does not create bills, payments, stock changes, or udhar ledger entries.

### Queue monitoring endpoints

Owner/admin users can use:

```text
GET  /api/jobs/status
GET  /api/jobs/failed
GET  /api/jobs/queues/:queueName
GET  /api/jobs/queues/:queueName/failed
POST /api/jobs/queues/:queueName/pause
POST /api/jobs/queues/:queueName/resume
POST /api/jobs/:queueName/:jobId/retry
POST /api/jobs/:queueName/:jobId/discard
```

These endpoints expose counts and sanitized failure metadata only. They do not expose job payloads, Redis URLs, or secrets.

### Metrics

Metrics are lightweight and Prometheus-compatible:

```text
GET /api/health/metrics  # JSON
GET /metrics             # Prometheus text format
```

Set `METRICS_REQUIRE_TOKEN=true` and `METRICS_TOKEN=<secret>` to protect metrics at the app layer. In production, prefer reverse-proxy/IP allowlist protection too. Metric labels intentionally avoid `shopId`, `userId`, `deviceId`, and `customerId`.

### Error tracking

Sentry is supported as an optional adapter stub:

```env
ERROR_TRACKING_ENABLED=true
SENTRY_DSN=...
SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=kiranaos-backend@x.y.z
```

The current adapter sanitizes context and centralizes call sites. To send events to Sentry, install and wire `@sentry/node` inside `src/lib/errorTracking.js`; do not send passwords, PINs, JWTs, payment secrets, storage secrets, or full customer phone numbers.

### Smoke tests

Run against local/staging:

```bash
SMOKE_BASE_URL=https://staging.example.com SMOKE_EXPECT_REDIS=true SMOKE_EXPECT_STORAGE=true npm run smoke:test
```

Production smoke tests are blocked unless:

```bash
ALLOW_PRODUCTION_SMOKE=true SMOKE_BASE_URL=https://api.example.com npm run smoke:test
```

The smoke test checks `/api/health`, `/health/ready`, metrics shape, and optional queue/storage readiness. It does not mutate financial data.

### Alerting options

Use one or more of: UptimeRobot, Better Stack, Grafana/Prometheus, Sentry, Cloud provider alerts, or Render/Railway health checks. See `docs/ALERTING_RUNBOOK.md` for symptoms, checks, safe recovery steps, and what not to do.
