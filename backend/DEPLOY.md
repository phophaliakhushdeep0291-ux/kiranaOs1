# KiranaOS Backend — Production / Beta Deployment Guide

KiranaOS backend is ready for a controlled production beta after the hardening work in this repository. It is **not** a finished enterprise production system yet: money is still stored as Float with centralized `round2()` helpers, offline sync needs real-world conflict testing, and you still need monitoring, backups, and regular DB restore drills.

## Recommended production commands

Use PostgreSQL in production:

```bash
npm ci
npm run deploy:migrate:postgres
npm start
```

`npm run deploy:migrate:postgres` is the production migration helper. It runs
`npx prisma migrate deploy --schema prisma-postgres/schema.prisma`, then
`npx prisma generate --schema prisma-postgres/schema.prisma`, then
`node scripts/verify-product-schema.js`. This preserves existing production data
and fails fast if the deployed database is still missing Product columns such as
`isLooseItem`.

If you need to run the lower-level steps manually, use
`npm run prisma:deploy:postgres`, `npm run prisma:generate:postgres`, and then
`npm run verify:product-schema` in that order.

For local SQLite development only:

```bash
npm ci
npm run prisma:push
npm run prisma:generate
npm test
npm run dev
```

## Required environment variables

Copy `.env.example` to `.env` and change production secrets:

```bash
cp .env.example .env
```

Important production values:

```env
NODE_ENV=production
PORT=3000
DATABASE_URL="postgresql://kiranaos:STRONG_PASSWORD@postgres:5432/kiranaos?schema=public"
POSTGRES_DATABASE_URL="postgresql://kiranaos:STRONG_PASSWORD@postgres:5432/kiranaos?schema=public"
JWT_SECRET="replace-with-a-long-random-secret"
JWT_EXPIRES_IN="15m"
ALLOWED_ORIGINS="https://yourdomain.com"
LOG_LEVEL="info"
```

Generate a strong JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Security status

Current backend security controls:

- Helmet is installed and enabled in `src/app.js`.
- API, auth, and AI rate limiting are enabled.
- CORS uses configured allowed origins.
- Production error responses hide stack traces and include `requestId`.
- Request logs are structured JSON and include request IDs.
- Sessions/refresh/logout are implemented with hashed refresh token storage.
- `/api/auth/me` returns the current DB-backed user/shop context.
- Export routes require owner role or owner PIN.
- Product delete, product restore, permanent delete, and recycle-bin empty require owner role or owner PIN.
- Inventory correction and damage require owner role or owner PIN.
- Bill cancel/restore routes require owner role or owner PIN.
- Successful owner PIN verification is audited as `OWNER_PIN_VERIFIED`; the PIN itself is never logged.

## Audit trail status

Central `AuditLog` exists and currently records sensitive actions including:

- `BILL_CANCELLED`
- `PRODUCT_DELETED`
- `PRODUCT_RESTORED`
- `PRODUCT_PERMANENTLY_DELETED`
- `PRODUCT_RECYCLE_BIN_EMPTIED`
- `STOCK_CORRECTED`
- `STOCK_DAMAGED`
- `DATA_EXPORTED`
- `OWNER_PIN_VERIFIED`
- `OFFLINE_SYNC_CONFLICT`

Audit logging failure should not block the main business request.

## Offline sync status

Offline sync is improved and supports per-event results, idempotency via `OfflineSyncEvent`, conflict status, and owner-PIN checks for risky synced actions such as product restore/delete and stock adjustment.

Still required before broad production rollout:

- long-running real-world conflict testing,
- multi-device offline/online race testing,
- operational dashboard for failed/conflicted sync events.

## Money status

Current money implementation:

- database fields remain Float,
- calculations are centralized through helpers in `src/utils/money.js`,
- `round2()`, `sumMoney()`, `addMoney()`, `subtractMoney()`, `multiplyMoney()`, and `moneyEquals()` reduce floating drift.

Future production target:

- migrate money columns to integer paise or Decimal,
- follow `docs/MONEY_MIGRATION.md`,
- test existing production data before changing schema.

## Docker Compose deployment

```bash
cp .env.example .env
# Edit .env values, especially JWT_SECRET and PostgreSQL credentials.
docker compose up --build -d
```

The Docker setup includes:

- API container,
- PostgreSQL 16 container,
- health checks,
- persistent Postgres volume.

Health endpoints:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/health
curl http://localhost:3000/health/ready
```

## PostgreSQL backup

Manual backup:

```bash
DATABASE_URL="postgresql://kiranaos:STRONG_PASSWORD@localhost:5432/kiranaos_prod" \
BACKUP_DIR="./backups" \
./scripts/backup-postgres.sh
```

Suggested cron:

```cron
0 2 * * * cd /opt/kiranaos-backend && DATABASE_URL="postgresql://..." BACKUP_DIR="/opt/kiranaos-backups" ./scripts/backup-postgres.sh
```

Remaining production work:

- automate backup retention,
- test restore regularly,
- add external monitoring/error tracking,
- ship logs to a real log store.

## Observability

The API emits JSON logs for startup, shutdown, HTTP requests, and unhandled errors.

- Basic liveness: `GET /health`
- Database readiness: `GET /health/ready`
- API health: `GET /api/health`
- Request correlation: `X-Request-Id` header on all responses
- Log level: `LOG_LEVEL=silent|error|warn|info|debug`

For real production, ship logs to a central log system and add external monitoring/error tracking.

## Production verification

Before deployment or packaging, run:

```bash
npm ci
npm run deploy:migrate:postgres
npm test
node scripts/production-check.js
```

For local SQLite verification:

```bash
npm ci
npm run prisma:push
npm run prisma:generate
npm test
node scripts/production-check.js
```

Do not ship these files/directories:

```text
node_modules
.env
prisma/dev.db
prisma/dev.db-journal
dev.db
dev.db-journal
uploads
logs
*.zip
```

`node scripts/production-check.js` verifies these are ignored/excluded.

## Phase 28 — Backup/restore disaster recovery drill

Before selling to real shops, prove that PostgreSQL backups can be restored:

```bash
DATABASE_URL="postgresql://kiranaos:kiranaos@localhost:5432/kiranaos?schema=public" \
RESTORE_TEST_DATABASE_URL="postgresql://kiranaos:kiranaos@localhost:5432/kiranaos_restore_test?schema=public" \
ALLOW_RESTORE_TEST_DB=true \
npm run proof:dr
```

For strict final proof, include:

```bash
PROOF_REQUIRE_DR=true npm run proof:ops
```

Never point `RESTORE_TEST_DATABASE_URL` at the production database.


## Phase 29 release gate

Before deploying to paid shops, run `npm run proof:release`. This includes migration safety and release gate checks. Record a rollback image, create a backup before migration, run a restore drill, verify `/health/ready`, verify Redis worker heartbeat, run Razorpay test-mode checkout/webhook, and complete frontend-backend E2E sync/device/subscription testing.

## Scaling & operations (PgBouncer, sizing, monitoring, load tests)

### 1. Connection pooling — PgBouncer / managed pooler

Prisma opens its own pool per instance; without a pooler, 3-4 backend instances
can exhaust a small Postgres (`max_connections` is often 20-100 on managed tiers).

- `prisma-postgres/schema.prisma` now has `directUrl`. Wire two env vars:
  - `DATABASE_URL` → the **pooled** endpoint, with `?pgbouncer=true&connection_limit=10`
    (`pgbouncer=true` disables prepared statements, required for transaction pooling;
    `connection_limit` caps Prisma's own pool per instance).
  - `DIRECT_DATABASE_URL` → the **direct** Postgres endpoint (migrations only).
- No pooler yet? Leave `DIRECT_DATABASE_URL` unset — the Docker CMD falls back to
  `DATABASE_URL`, nothing changes.
- Provider quick map: Supabase → pooled port `6543` (direct `5432`); Neon → the
  `-pooler` host vs the plain host; Railway/Render → run the PgBouncer
  plugin/sidecar in transaction mode (`pool_mode = transaction`).
- Sizing rule of thumb: `connection_limit × instances ≤ PgBouncer default_pool_size`,
  and `default_pool_size ≤ Postgres max_connections − 10` (keep headroom for
  migrations and psql).

### 2. Server sizing

One Node process per container/instance; scale horizontally behind the platform LB.
The HTTP server is tuned for LBs (`keepAliveTimeout 65s > LB idle 60s`,
`requestTimeout 30s`) and gzips JSON (`compression`).

| Stage | Shops (≈) | Instance | Postgres |
| --- | --- | --- | --- |
| Pilot | 1–25 | 1× 0.5 vCPU / 512MB | shared 1GB |
| Early | 25–250 | 2× 1 vCPU / 1GB | 2 vCPU / 4GB + PgBouncer |
| Growth | 250–2000 | 3-4× 2 vCPU / 2GB + worker instance | 4 vCPU / 8GB + PgBouncer + read replica for reports |

Sync is the load driver (each device polls + pushes); bills are small writes.
CPU saturating before DB → add instances. DB connections saturating → PgBouncer
first, bigger DB second.

### 3. Monitoring

Already built in: `/health` (liveness), `/health/ready` (DB/Redis/storage checks),
`/metrics` (Prometheus), JSON logs with `requestId`, Sentry support.

Hook it up (one-time, ~30 min):
1. **Uptime**: point UptimeRobot/BetterStack at `GET /health/ready`, alert on
   non-200 for >2 min. This alone catches most outages.
2. **Errors**: set `ERROR_TRACKING_ENABLED=true` + `SENTRY_DSN` (free Sentry tier
   is fine). Releases tag via `SENTRY_RELEASE`.
3. **Metrics**: set `METRICS_ENABLED=true`, `METRICS_REQUIRE_TOKEN=true`,
   `METRICS_TOKEN=<random>`; scrape with `ops/prometheus.yml` (Grafana Cloud free
   tier or self-hosted) and load `ops/alerts.yml` — alerts are matched to the
   metric names this backend actually exports.

### 4. Load testing

`loadtest/loadtest.js` (autocannon) hits health + authed products/customers/bills
list endpoints, prints req/s + p50/p95/p99, and fails non-zero when budgets are
exceeded (defaults: p95 ≤ 800ms, errors ≤ 1%).

```bash
npm run loadtest:smoke   # 5s × 10 connections per scenario
npm run loadtest         # 10s × 25 connections per scenario
# Against a remote target with an existing login:
LOADTEST_BASE_URL=https://api.example.com LOADTEST_MOBILE=98xxxxxx PASSWORD=... npm run loadtest
```

Raise limiter env on the TARGET during a test run (`API_RATE_LIMIT_MAX=1000000`)
or you measure the rate limiter, not the app. Never load-test production with
writes during shop hours; the suite is read-only by default.
