# KiranaOS Backend — Production / Beta Deployment Guide

KiranaOS backend is ready for a controlled production beta after the hardening work in this repository. It is **not** a finished enterprise production system yet: money is still stored as Float with centralized `round2()` helpers, offline sync needs real-world conflict testing, and you still need monitoring, backups, and regular DB restore drills.

## Recommended production commands

Use PostgreSQL in production:

```bash
npm ci
npm run prisma:deploy:postgres
npm run prisma:generate:postgres
npm start
```

`npm run deploy:migrate:postgres` is the single deployment helper for hosts
that need one command. It runs `npx prisma migrate deploy --schema
prisma-postgres/schema.prisma` and then `npx prisma generate --schema
prisma-postgres/schema.prisma`, preserving existing production data.

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
npm run prisma:deploy:postgres
npm run prisma:generate:postgres
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
