# KiranaOS Backend

Production-ready backend for Indian kirana shop management. Node.js + Express + Prisma + SQLite (dev) / PostgreSQL (prod).

---

## 📁 Folder Structure

```
kiranaos-backend/
├── prisma/
│   ├── schema.prisma          # All 12 DB models
│   └── seed.js                # Demo shop + products + customer
├── src/
│   ├── server.js              # Entry point
│   ├── app.js                 # Express app, routes, middleware
│   ├── db.js                  # Prisma client singleton
│   ├── config/
│   │   └── env.js             # Validated env vars (Zod)
│   ├── middleware/
│   │   ├── auth.js            # JWT verify + requireRole
│   │   ├── error.js           # Global error handler + AppError
│   │   ├── validate.js        # Zod body/query validation middleware
│   │   └── permissions.js     # Shop isolation guard
│   ├── modules/
│   │   ├── auth/              # Register, login, /me
│   │   ├── shops/             # Get + update shop info
│   │   ├── products/          # CRUD + soft delete + search
│   │   ├── customers/         # CRUD + khata + udhar payment
│   │   ├── bills/             # Confirm (transactional) + cancel (transactional)
│   │   ├── inventory/         # Purchase, damage, correction, ledger
│   │   ├── udhar/             # Ledger + summary
│   │   ├── suppliers/         # CRUD + best price analysis
│   │   ├── reports/           # P&L, monthly, top products, payment summary
│   │   ├── sync/              # Pull since timestamp, push offline (Phase 2)
│   │   └── ai/                # OpenAI parse-command + permission engine + logs
│   └── utils/
│       ├── units.js           # kg↔g, ltr↔ml conversion helpers
│       ├── money.js           # round2, weighted average cost
│       ├── dates.js           # daily/weekly/monthly/yearly date ranges
│       └── billNumber.js      # KOS-YYYY-NNNN sequential generator
└── package.json
```

---

## ⚡ Quick Start

### 1. Install

```bash
cd kiranaos-backend
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — set JWT_SECRET at minimum
```

For local dev, leave `DATABASE_URL="file:./dev.db"` (SQLite).

### 3. Run DB migration

```bash
npm run db:push
# OR for migration history:
npm run db:migrate
```

### 4. Seed demo data

```bash
npm run db:seed
```

This creates:
- Shop: **Sharma General Store**
- Login mobile: **9800000001** / password: **demo1234**
- 10 products (sugar, rice, atta, oil, dal, salt, milk, biscuit, soap, tea)
- 1 udhar customer (Mohan Lal, ₹350 outstanding)
- 1 supplier (Agarwal Whole Sale)

### 5. Start server

```bash
npm run dev       # dev with auto-restart
npm start         # production
```

Server runs at `http://localhost:3000`

---

## 🧪 Testing APIs

### Health check
```bash
curl http://localhost:3000/api/health
```

### Register new shop
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "shopName": "My Kirana Store",
    "ownerName": "Suresh Kumar",
    "city": "Jaipur",
    "address": "Bani Park, Jaipur 302016",
    "mobile": "9712345678",
    "password": "mypassword"
  }'
```

### Login (use demo credentials)
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "mobile": "9800000001", "password": "demo1234" }'
```

Copy the `token` from the response. Use it as `Authorization: Bearer <token>` for all other requests.

### Get products
```bash
curl http://localhost:3000/api/products \
  -H "Authorization: Bearer <token>"
```

### Confirm a bill
```bash
curl -X POST http://localhost:3000/api/bills/confirm \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "billType": "normal_sale",
    "customerName": "Walk-in",
    "items": [
      {
        "productId": "prod-001",
        "name": "Shakkar (Sugar)",
        "quantity": 2,
        "enteredUnit": "kg",
        "ratePerRateUnit": 45,
        "gstRate": 5
      }
    ],
    "discount": 0,
    "payments": [
      { "mode": "cash", "amount": 94.5 }
    ]
  }'
```

### Get P&L report (daily)
```bash
curl "http://localhost:3000/api/reports/pnl?range=daily" \
  -H "Authorization: Bearer <token>"
```

### Add stock (purchase)
```bash
curl -X POST http://localhost:3000/api/inventory/purchase \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "productId": "prod-001",
    "supplierName": "Agarwal Whole Sale",
    "quantity": 50,
    "enteredUnit": "kg",
    "billAmount": 2000,
    "updateCost": true
  }'
```

### AI parse command
```bash
curl -X POST http://localhost:3000/api/ai/parse-command \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "Mohan ka bill banao shakkar 2 kilo 200 cash baki udhar",
    "context": { "currentCart": [] }
  }'
```

### Sync pull (frontend cache refresh)
```bash
curl "http://localhost:3000/api/sync/pull?since=2026-01-01T00:00:00.000Z" \
  -H "Authorization: Bearer <token>"
```

---

## 🔌 How Frontend Connects

### Authentication
All requests need `Authorization: Bearer <jwt_token>` header.
Store the token in `localStorage` after login.

### Shop isolation
The `shopId` is embedded in the JWT payload. Backend extracts it automatically.
No need to pass shopId explicitly in request bodies.

### Caching strategy
```
Frontend (IndexedDB)           Backend (SQLite/PostgreSQL)
─────────────────────          ─────────────────────────────
Last 30 days bills      ←──→   Full bill history (forever)
Current product list    ←──→   Full product + delete history
Current customer list   ←──→   Full customer history
Last 30 days stock      ←──→   Full stock ledger
Last 30 days udhar      ←──→   Full udhar history
User settings/layout           Reports > 30 days
```

**Sync flow:**
1. On app open → `GET /api/sync/pull?since=<lastSyncTime>`
2. After every bill → immediately sync
3. If offline → queue action in IndexedDB → sync when back online

### Response format
All responses follow this structure:
```json
{ "success": true, "data": { ... } }
{ "success": false, "error": "Human readable error", "details": {} }
```

---

## 🤖 AI Command Flow

```
User speaks
    ↓
Browser Web Speech API (or Whisper later)
    ↓
POST /api/ai/parse-command  { transcript, context }
    ↓
OpenAI GPT-4o parses Hindi/Hinglish → structured JSON command
    ↓
Permission engine checks intent level:
    safe      → execute immediately
    confirm   → show confirmation dialog
    owner_pin → require PIN
    blocked   → reject + log
    ↓
Frontend executor runs the action
    ↓
POST /api/ai/log-action  { transcript, parsedAction, status }
```

---

## 🚀 Production Checklist

| Item | Status |
|------|--------|
| Switch to PostgreSQL | Change `provider` in schema.prisma |
| Set strong JWT_SECRET | Use 32+ random chars |
| Add OPENAI_API_KEY | For AI features |
| Rate limiting | express-rate-limit already installed |
| Owner PIN for cancel/delete | Bcrypt PIN in User.pinHash |
| Multi-shop analytics | Queries work across shops by design |
| AI audio transcription | Operational OpenAI/Groq provider path with 25 MB upload limit and guaranteed temp-file cleanup |
| Push offline sync | `/api/sync/push` stub ready |
| HTTPS | Use nginx/Caddy reverse proxy |
| Backups | PostgreSQL automated backups |

---

## 📦 Switching to PostgreSQL

1. Update `.env`:
   ```
   DATABASE_URL="postgresql://user:pass@host:5432/kiranaos"
   ```

2. Update `prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```

3. Run migration:
   ```bash
   npm run db:migrate
   ```

Everything else stays the same — Prisma handles the SQL dialect difference.

## Prisma CLI note

This project is pinned to Prisma 5.14.0 because the current schema uses the Prisma 5 datasource format:

```prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
```

Always install dependencies first, then run Prisma through the local project scripts:

```bash
npm install
npm run prisma:push
npm run prisma:generate
```

Do not run `npx prisma` before `npm install`, because npm may download the latest Prisma CLI, which can be incompatible with this Prisma 5 schema.


## Step 9 frontend-backend connection layer

This backend-focused zip now includes UI-agnostic browser modules under `public/js/`:

- `api-client.js` — token-aware fetch wrapper with JSON handling, query params, and owner PIN header support.
- `backend-modules.js` — module-by-module API helpers for auth, products, customers, bills, inventory, reports, udhar, suppliers, shop, and sync.
- `frontend-integration-example.js` — example only; it does not run automatically.

These files do not change the current UI. Import them into the real frontend page when you want to replace one localStorage function at a time.

Minimal frontend usage:

```js
import { backend, hydrateFrontendCache, confirmBillOnlineFirst } from './js/backend-modules.js';

await backend.auth.login({ mobile, password });
await hydrateFrontendCache();
const result = await confirmBillOnlineFirst(billPayload);
```

For owner-protected actions, pass `ownerPin`:

```js
await backend.products.delete(productId, { ownerPin: '1234' });
await backend.inventory.correction(payload, { ownerPin: '1234' });
```

---

## Step 10: AI transcription + strict command schema

Added backend-only AI endpoints. The AI never directly edits the database or runs frontend actions. It only returns a restricted command object; the frontend executor must preview/confirm/run the command according to the returned `permissionLevel`.

### Environment

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
# Optional Groq-first transcription path
GROQ_API_KEY=gsk_...
GROQ_TRANSCRIBE_MODEL=whisper-large-v3-turbo
```

### Transcribe audio

```http
POST /api/ai/transcribe
Authorization: Bearer <token>
Content-Type: multipart/form-data

field: audio or file
```

Response:

```json
{
  "success": true,
  "data": {
    "transcript": "Mohan ka bill banao shakkar 2 kilo",
    "model": "gpt-4o-mini-transcribe",
    "provider": "openai"
  }
}
```

### Parse command with strict schema

```http
POST /api/ai/parse-command
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "transcript": "Mohan ka bill banao shakkar 2 kilo",
  "context": {
    "currentCart": [],
    "currentCustomer": null
  }
}
```

The command parser uses a strict JSON schema with these permission levels:

- `safe`: frontend may execute directly.
- `confirm`: frontend must ask user confirmation.
- `owner_pin`: frontend must ask owner PIN before execution.
- `blocked`: frontend must not execute.

Allowed AI intents are limited to KiranaOS actions such as `ADD_ITEMS`, `SET_PAYMENT`, `CONFIRM_BILL`, `CANCEL_BILL`, `ADJUST_STOCK`, and `DELETE_PRODUCT`. Unknown/direct-code/destructive requests are blocked as `UNKNOWN`.

## Step 11 Automated Tests

Step 11 adds broader automated regression coverage without changing app behavior.

Run the full suite after `npm install`, `.env` setup, and `npm run prisma:push`:

```bash
npm run test:billing
```

Additional focused commands:

```bash
npm run test:regression
npm run test:frontend-checklist
```

The database regression test creates temporary shops, products, bills, customers, stock ledger entries, udhar ledger entries, and sync events. It verifies normal sale stock deduction, grams/ml billing totals, estimate no-side-effect behavior, discount/waived profit calculation, buyer-paid validation, cancel bill stock/udhar reversal, cross-shop blocking, report filtering, and duplicate offline sync idempotency. It cleans up its temporary records after completion.

Frontend UI changes are not included in Step 11. The required frontend manual checklist is stored at `tests/frontend-manual-checklist.md`.


---

## Step 12: Production / Deployment Readiness

### Exact scripts

```bash
npm run dev                # local development
npm start                  # production start
npm run prisma:generate    # generate Prisma client
npm run prisma:migrate     # safely align the local SQLite schema
npm run prisma:deploy      # production PostgreSQL migration deploy
npm run seed               # seed demo data
npm test                   # run all automated checks
npm run prod:check         # verify deployment files / no forbidden local files
```

### Local SQLite development

Keep this in `.env`:

```env
DATABASE_URL="file:./dev.db"
NODE_ENV=development
JWT_SECRET="change-this-to-a-strong-32-char-secret"
ALLOWED_ORIGINS=http://localhost:5500,http://127.0.0.1:5500,http://localhost:3000
```

Then run:

```bash
npm install
npm run prisma:push
npm run prisma:generate
npm test
npm run dev
```

### Production PostgreSQL deployment

Use PostgreSQL in production. Set:

```env
DATABASE_URL="postgresql://kiranaos:STRONG_PASSWORD@postgres:5432/kiranaos_prod?schema=public"
NODE_ENV=production
JWT_SECRET="generate-a-strong-32-byte-secret"
ALLOWED_ORIGINS=https://yourdomain.com
```

Then run migrations in production with:

```bash
npm run prisma:generate:postgres
npm run prisma:deploy
npm start
```

### Docker deployment

```bash
cp .env.example .env
# edit .env first

docker compose up --build -d
```

Health checks:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/health
```

### Production safety included

- `Dockerfile`
- `docker-compose.yml` with PostgreSQL
- `.dockerignore` excluding `node_modules`, `.env`, and SQLite dev DB files
- `/health` and `/api/health` endpoints
- Request logging middleware
- Security headers middleware
- API/auth/AI rate limiting
- PostgreSQL backup script: `scripts/backup-postgres.sh`
- Production packaging check: `npm run prod:check`

### Backup example

On a server with `pg_dump` installed:

```bash
DATABASE_URL="postgresql://kiranaos:STRONG_PASSWORD@localhost:5432/kiranaos_prod" \
BACKUP_DIR="./backups" \
./scripts/backup-postgres.sh
```

### Error monitoring

For MVP, server errors are logged as JSON to stdout/stderr so Docker/PM2/cloud logs can collect them. Later, add Sentry or OpenTelemetry without changing business logic.

### PostgreSQL migration files

Step 12 keeps local SQLite untouched in:

```text
prisma/schema.prisma
```

Production PostgreSQL uses a separate schema and migration folder:

```text
prisma-postgres/schema.prisma
prisma-postgres/migrations/000001_init/migration.sql
```

Use these production commands only with a PostgreSQL `DATABASE_URL`:

```bash
npm run prisma:generate:postgres
npm run prisma:deploy:postgres
```

The default SQLite commands are still available for local dev:

```bash
npm run prisma:push
npm run prisma:generate
```

## Step 8 Money Safety

Money calculations should use `src/utils/money.js` helpers instead of raw floating-point sums/comparisons. The current database still stores rupee values as `Float` for compatibility, but backend calculations now use paise-safe helpers such as `sumMoney()`, `addMoney()`, `subtractMoney()`, `multiplyMoney()`, and `moneyEquals()`.

See `docs/MONEY_MIGRATION.md` for the future integer-paise migration plan.


## Step 9 Observability

Production observability includes request IDs, JSON request logs, production-safe error responses, configurable rate-limit responses, and a database-backed readiness endpoint.

Useful endpoints:

```text
GET /api/health     # basic liveness
GET /health         # container liveness
GET /health/ready   # database readiness check
```

Every response gets an `X-Request-Id` header. Clients may send `X-Request-Id` to preserve a request ID across frontend/backend logs.

## DB-backed integration tests

Phase 5 integration tests run against an isolated SQLite database only. Set `TEST_DATABASE_URL` when needed; by default the scripts use `file:./prisma/test.db` and copy that value into `DATABASE_URL` for the Prisma test process.

```bash
npm run setup:test-db
npm run test:db
npm run test:integration
```

The integration setup refuses non-SQLite URLs and dev/prod-looking DB names, so it will not touch the production database. In a sandbox where the Prisma Linux query engine cannot be downloaded, the setup/test runner reports a skip; in CI or with `FORCE_DB_TESTS=true`, that same condition fails.

## Phase 6 SaaS Foundation

KiranaOS now includes backend-owned SaaS foundation models and routes for plans, subscriptions, feature gates, devices and payment-provider abstraction.

Routes added:

- `GET /api/plans`
- `GET /api/subscription/current`
- `POST /api/subscription/manual-activate`
- `POST /api/subscription/change-plan`
- `POST /api/subscription/cancel`
- `POST /api/subscription/extend-grace`
- `GET /api/devices`
- `POST /api/devices/activate`
- `DELETE /api/devices/:deviceId`
- `POST /api/devices/heartbeat`
- `GET /api/devices/license`
- `POST /api/payment-provider/razorpay/webhook`

Payment notes:

- Razorpay is prepared as a provider skeleton only.
- Subscriptions are not activated from frontend-only payment success.
- Card/UPI credentials are never stored.
- Manual activation creates a `PaymentTransaction` and updates the subscription.

Device notes:

- Backend remains final authority for device limits.
- Device licenses are currently a foundation structure for offline UX.
- Set `ENABLE_DEVICE_LICENSE_SIGNING=true` and `LICENSE_SIGNING_SECRET` before enabling signed licenses in production.

## Phase 10 Background Workers

KiranaOS supports optional Redis + BullMQ background workers for non-critical asynchronous jobs. Core financial operations such as bill confirmation, stock deduction, payment creation, udhar ledger updates, owner PIN verification, and Razorpay verification remain synchronous and transactional.

Environment:

```env
REDIS_URL=
QUEUES_ENABLED=false
WORKER_CONCURRENCY=3
JOB_RETENTION_DAYS=7
```

Local development can run without Redis. When queues are disabled, `addJob()` returns `JOB_QUEUE_DISABLED` instead of crashing. In production, if `QUEUES_ENABLED=true`, `REDIS_URL` is required.

Start the worker separately from the web server:

```bash
npm run worker
```

The web server does not process jobs automatically. The worker process consumes reminder, reports, exports, backup, and sync cleanup queues.

Current jobs:

- `GENERATE_DAILY_CLOSING` computes a live daily closing snapshot placeholder without adding a new snapshot model yet.
- `GENERATE_CSV_EXPORT` and `GENERATE_REPORT_PDF` are safe export skeletons.
- `SEND_WHATSAPP_REMINDER` does not fake success; it fails/skips when provider config is missing.
- `CLEANUP_SYNC_EVENTS` and `ARCHIVE_OLD_SYNC_EVENTS` are conservative dry-run placeholders and never delete open conflicts.
- `RUN_SHOP_BACKUP` and `RUN_DATABASE_BACKUP` are architecture placeholders only.

Owner/admin queue status is available at:

```http
GET /api/jobs/status
```

The response includes queue counts when Redis is configured and never exposes Redis URLs, secrets, or job payloads.

## Phase 11 Reports & Daily Closing

KiranaOS now exposes shopkeeper-focused reports under `/api/reports`:

- `GET /api/reports/daily-closing?date=YYYY-MM-DD` — live daily closing with sales, cash, UPI, udhar given, old udhar recovered, expected cash, top products, low-stock items, and pending sync count.
- `GET /api/reports/sales-summary?range=today|7d|30d&from=&to=` — sales summary with daily breakdown and plan-based range limits.
- `GET /api/reports/payment-modes?from=&to=` — cash/UPI/credit/mixed-payment summary without double counting partial payments.
- `GET /api/reports/udhar-ageing` — pending udhar buckets and masked customer phone numbers.
- `GET /api/reports/top-products?from=&to=&limit=20` — owner-only product ranking with profit fields protected.
- `GET /api/reports/inventory-health` — low-stock, dead-stock, fast/slow-moving, negative stock, and owner-only inventory cost estimate.
- `GET /api/reports/staff-sales?from=&to=` — owner/admin route; currently documents that bill cashier attribution requires a future `createdByUserId` field.

Reports are computed from authoritative backend tables, exclude cancelled and estimate bills from active sales totals, and keep export routes protected by owner PIN. The Phase 10 `GENERATE_DAILY_CLOSING` worker now calls the same daily closing generator, but no `DailyClosingSnapshot` table is added yet.

## Phase 12 reports: DailyClosingSnapshot + cashier attribution

Phase 12 adds nullable `Bill.createdByUserId` and `Bill.deviceId` for cashier/device attribution without breaking legacy bills. New daily closing snapshot routes persist one snapshot per shop/date, support locked snapshots, and keep live reports as the source of truth until a snapshot is explicitly generated or locked.

- `GET /api/reports/daily-closing?date=YYYY-MM-DD&source=live|snapshot`
- `POST /api/reports/daily-closing/snapshot`
- `POST /api/reports/daily-closing/:date/lock`

The BullMQ `GENERATE_DAILY_CLOSING` job now calls the persisted snapshot service and does not mutate billing, payments, stock, or udhar ledgers.

## Phase 13: Report export jobs and scheduled daily closing

Phase 13 adds persistent `ReportExportJob` tracking for async report exports, protected export job routes, safe local export file storage for development, and a `daily-closing:run` script for scheduled DailyClosingSnapshot generation.

Key commands:

```bash
npm run worker
npm run daily-closing:run
npm run daily-closing:run -- --shopId=<shopId> --date=2026-06-05
```

Export files are written under `storage/exports/<shopId>/<jobId>.csv` in development and are only downloadable through authenticated, shop-scoped report export routes. Do not expose raw filesystem paths publicly. Production storage should be moved to S3/R2/MinIO behind the same `ReportExportJob` metadata model.

Locked daily closing snapshots are not overwritten by scheduled jobs. If later records make a snapshot stale, `source=snapshot` responses include staleness metadata. Owner/admin users can use the override-refresh route with a reason and the existing sensitive-action gate.

---

## Production deployment

Production uses PostgreSQL, separate API and worker processes, Redis/BullMQ for non-critical jobs, and protected report export storage.

Key commands:

```bash
npm ci
npm run prisma:generate:postgres
npm run prisma:deploy:postgres
npm start
npm run worker
npm run daily-closing:run
npm run prod:check
```

Deployment docs:

- `docs/PRODUCTION_DEPLOYMENT.md` — production env, PostgreSQL migrations, API/worker commands, Docker, storage, monitoring, failure modes.
- `docs/SCHEDULING.md` — daily closing scheduler options for cron, PM2, Render, Railway, GitHub Actions, and systemd at 2 AM Asia/Kolkata.

CI is defined in `.github/workflows/backend-ci.yml` and runs with PostgreSQL + Redis services, Prisma generate/validate, PostgreSQL migration deploy, DB integration tests, static tests, worker verification, production check, and Docker build.

### Phase 15 production hardening

Production export storage now supports local dev storage plus S3/R2/MinIO-compatible adapters, protected backend downloads, optional short-lived signed URLs, safe queue monitoring, structured redacted logs, lightweight metrics, and a deployment smoke test. See `docs/PRODUCTION_DEPLOYMENT.md` for storage, metrics, alerting, and smoke-test details.


## Phase 16 monitoring

Provider validation and alerting docs are in `docs/PRODUCTION_DEPLOYMENT.md` and `docs/ALERTING_RUNBOOK.md`. Useful commands: `npm run storage:verify`, `npm run export:verify`, `npm run worker:verify`, and `npm run smoke:test`.

## Phase 17: WhatsApp Udhar Reminders and Delivery Receipts

KiranaOS now includes a Pro-plan WhatsApp reminder backend foundation under `/api/reminders`:

- shop-scoped reminder templates and reminder logs
- one-click udhar reminder requests
- short customer statement reminder requests
- BullMQ `SEND_WHATSAPP_REMINDER` worker integration
- anti-spam cooldown via `REMINDER_COOLDOWN_HOURS`
- live Meta, Twilio, Gupshup, and Interakt provider adapters
- signed, idempotent sent/delivered/read/failed callbacks with out-of-order protection
- a pending callback ledger that closes provider-response race conditions

The default provider is `WHATSAPP_PROVIDER=disabled`. In disabled mode the backend never marks a reminder as accepted or delivered. When enabled, provider API success is recorded only as `accepted`; `sent`, `delivered`, and `read` require a verified callback. See `docs/WHATSAPP_DELIVERY.md` for provider setup and staging proof.

## Phase 28 — Disaster recovery proof

Create a PostgreSQL backup:

```bash
DATABASE_URL="postgresql://.../kiranaos" BACKUP_DIR="./backups" npm run backup:postgres
```

Run a safe restore drill against a separate restore-test database:

```bash
DATABASE_URL="postgresql://.../kiranaos" \
RESTORE_TEST_DATABASE_URL="postgresql://.../kiranaos_restore_test" \
ALLOW_RESTORE_TEST_DB=true \
npm run proof:dr
```

Use `PROOF_REQUIRE_DR=true npm run proof:ops` during final production proof. Read `docs/DISASTER_RECOVERY.md` before running restore commands.


## Release gate

Use `npm run proof:release` before a real rollout. It combines migration safety, release documentation checks, and operational proof. For pre-sell validation, also run PostgreSQL proof, restore drill, Redis worker heartbeat, Razorpay test-mode, and frontend-backend E2E testing.
