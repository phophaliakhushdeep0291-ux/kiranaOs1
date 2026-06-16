# KiranaOS — Phase 1: Environment Plan

## 1. Stack Decision

| Layer | Choice | Why |
|---|---|---|
| Backend | **FastAPI (Python 3.11)** | Async, typed via Pydantic, fits Emergent supervisor; equivalent power to NestJS for our domain |
| Database | **MongoDB** (single source of truth on server) | Platform default; we model financial events as **append-only collections** with **unique indexes** to enforce idempotency (same as Postgres unique constraints) |
| ORM-style | **Pydantic v2 + Motor** + a thin `BaseDocument` with `to_mongo` / `from_mongo` | Avoids `_id`/ObjectId leaks; one place for serialization |
| Frontend | **React 19 + React Router 7 + TypeScript-via-JSX + Vite-style CRA (already provisioned)** | Already wired with shadcn/ui, tailwind, lucide-react |
| Offline DB | **Dexie 4 (IndexedDB)** | Same as in your existing plan; battle-tested |
| Auth | **JWT (HS256) + Device sessions** (refresh-on-login) | Stateless API + stateful device row in Mongo |
| State/Data | **React Query (already installed)** + a custom **`useLiveDexie` hook** | Keeps UI snappy with offline data |
| Tests | **pytest + httpx** (backend), **Playwright via `testing_agent_v3`** (E2E) | Matches platform tooling |
| Logging | Python `logging` + structured JSON | Supervisor captures to `/var/log/supervisor/backend.*.log` |

> Why not Node+Prisma+Postgres as in the uploaded zip?  
> The Emergent container doesn't run Postgres; switching stacks would burn the whole session on infra. Your Node code remains the **reference architecture**; we re-implement the same correctness invariants on the FastAPI/Mongo stack. The contracts (idempotency keys, append-only ledger, paise-only money, outbox/cursor sync) are stack-agnostic.

## 2. Repo Layout

```
/app
├── backend/
│   ├── server.py                 # FastAPI entrypoint
│   ├── core/
│   │   ├── config.py             # env loader
│   │   ├── db.py                 # motor client + indexes bootstrap
│   │   ├── security.py           # JWT, password hashing
│   │   ├── base_model.py         # PyObjectId, BaseDocument
│   │   ├── money.py              # paise helpers
│   │   └── deps.py               # FastAPI dependencies (current_user, current_shop, current_device)
│   ├── modules/
│   │   ├── auth/                 # register, login, refresh, /me
│   │   ├── shops/                # onboarding
│   │   ├── staff/                # users + roles + permissions
│   │   ├── devices/              # device session, limit enforcement
│   │   ├── subscription/         # plans + shop_subscription
│   │   ├── products/             # CRUD + stock cache
│   │   ├── customers/            # CRUD + ledger balance derivation
│   │   ├── bills/                # BillingService (the heart)
│   │   ├── payments/             # PaymentService + reversals
│   │   ├── inventory/            # movement records
│   │   ├── purchases/            # supplier purchases
│   │   ├── expenses/             # operating expenses
│   │   ├── reports/              # one truth layer for dashboard+reports
│   │   ├── sync/                 # push/pull/status/retry/resolve-conflict
│   │   └── audit/                # audit_log writes
│   ├── seed.py                   # demo shop/user/products/customers/bills
│   ├── scripts/
│   │   ├── reset_db.py
│   │   └── migrate_indexes.py
│   └── tests/
│       ├── unit/
│       └── integration/
├── frontend/
│   └── src/
│       ├── lib/
│       │   ├── api.ts            # axios client with interceptors
│       │   ├── db.ts             # Dexie schema
│       │   ├── outbox.ts         # outbox writer + sync engine
│       │   ├── selectors.ts      # SHARED business selectors (one truth)
│       │   └── money.ts          # paise <-> rupee formatting
│       ├── hooks/
│       │   ├── useAuth.ts
│       │   ├── useShop.ts
│       │   ├── useLiveDexie.ts
│       │   └── useSyncEngine.ts
│       ├── pages/
│       │   ├── Login.jsx
│       │   ├── Dashboard.jsx
│       │   ├── Billing.jsx
│       │   ├── BillsHistory.jsx
│       │   ├── Products.jsx
│       │   ├── Inventory.jsx
│       │   ├── Customers.jsx
│       │   ├── CustomerDetail.jsx
│       │   ├── Purchases.jsx
│       │   ├── Expenses.jsx
│       │   ├── Reports.jsx
│       │   ├── SyncStatus.jsx
│       │   ├── Devices.jsx
│       │   ├── Staff.jsx
│       │   ├── Settings.jsx
│       │   └── AuditLog.jsx
│       └── components/
│           ├── ui/               # shadcn (already there)
│           ├── billing/          # cart, item picker, payment modal
│           ├── shell/            # AppShell, MobileNav, TopBar
│           └── status/           # SyncBadge, DeviceBadge, OfflineBanner
└── docs/                         # this folder
```

## 3. Environment Variables

`backend/.env` (existing — DO NOT delete keys):
```
MONGO_URL=mongodb://localhost:27017
DB_NAME=test_database
CORS_ORIGINS=*
# new:
JWT_SECRET=<generated>
JWT_ALG=HS256
ACCESS_TOKEN_TTL_MIN=60
REFRESH_TOKEN_TTL_DAYS=30
DEVICE_OFFLINE_GRACE_DAYS=7
```

`frontend/.env` (existing — DO NOT delete keys):
```
REACT_APP_BACKEND_URL=...
WDS_SOCKET_PORT=443
ENABLE_HEALTH_CHECK=false
```

## 4. Local Dev Scripts (no new servers — supervisor handles services)

| Action | Command |
|---|---|
| Restart backend | `sudo supervisorctl restart backend` |
| Restart frontend | `sudo supervisorctl restart frontend` |
| Reset DB | `python /app/backend/scripts/reset_db.py` |
| Build indexes | `python /app/backend/scripts/migrate_indexes.py` |
| Seed demo data | `python /app/backend/seed.py` |
| Run unit tests | `cd /app/backend && pytest tests/unit -q` |
| Run integration tests | `cd /app/backend && pytest tests/integration -q` |

## 5. Index Bootstrap (replaces SQL migrations for Mongo)

All indexes are declared in `core/db.py::ensure_indexes()` and run on app startup (idempotent). Critical ones:

- `bills`: unique `(shop_id, idempotency_key)`, index `(shop_id, created_at)`, `(shop_id, customer_id, status)`
- `payments`: unique `(shop_id, idempotency_key)`, index `(shop_id, created_at)`
- `customer_ledger_entries`: index `(shop_id, customer_id, created_at)`
- `inventory_movements`: index `(shop_id, product_id, created_at)`
- `sync_events`: unique `(shop_id, device_id, client_event_id)` — the **idempotency wall**
- `id_mappings`: unique `(shop_id, device_id, local_id)`
- `devices`: index `(shop_id, status)`; `(user_id, status)`
- `sessions`: index `(device_id, expires_at)`
- `audit_logs`: index `(shop_id, created_at)`

## 6. Test Setup

- `pytest.ini` with `asyncio_mode = auto`
- A `conftest.py` that:
  - spawns a temporary db namespace per test (`DB_NAME=test_<uuid>`)
  - drops the namespace on teardown
  - exposes `client = httpx.AsyncClient(app=app)` fixture
- Unit tests: pure service functions (no FastAPI)
- Integration tests: HTTP through ASGI — covers all routes
- E2E (frontend): handled by `testing_agent_v3` against the live preview URL

## 7. Acceptance for Phase 1

- [ ] `pytest -q` runs zero tests successfully (env works)
- [ ] `python /app/backend/seed.py` creates: 1 shop, 1 owner user, 1 staff user, 20 products, 10 customers (mix of paid/udhar), 5 bills, 2 payments
- [ ] `GET /api/health` returns `{"status":"ok","db":"ok"}`
- [ ] Frontend boots, shows login, can authenticate against seeded user
- [ ] Indexes verified via `db.bills.getIndexes()` equivalent script
