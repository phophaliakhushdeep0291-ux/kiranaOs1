# KiranaOS — Production Deployment Guide

Offline-first POS SaaS for kirana/general stores. React + IndexedDB frontend, Node/Express/Prisma backend, **SQLite for dev/test, PostgreSQL for production**.

This document covers a **safe** production deploy. Do not skip the secret and backup steps.

---

## 1. Secrets & environment

**No real secrets live in this repository.** Every required variable is documented in:

- `backend/.env.example`
- `frontend/.env.example`

Create the real `.env` files only in your hosting provider's environment settings (Railway / Vercel) — never commit them (they are git-ignored).

### Backend production env (enforced at boot)

`backend/src/config/env.js` **refuses to start in production** if any of these are weak or missing:

| Variable | Requirement in production |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | ≥ 32 chars, not a known placeholder |
| `LICENSE_SIGNING_SECRET` | required, ≥ 32 chars, not a placeholder |
| `DATABASE_URL` | must be a PostgreSQL URL |
| `DIRECT_DATABASE_URL` | direct (non-pooled) URL for migrations; falls back to `DATABASE_URL` |
| `ALLOWED_ORIGINS` | comma-separated frontend origin(s), for example `https://pos.example.com` |
| `OWNER_PIN_REQUIRED` | `true` |
| `RAZORPAY_*` | required only if `RAZORPAY_ENABLED=true` |
| `STORAGE_*` | required only if exports/uploads are enabled |

Generate strong secrets with: `openssl rand -base64 48`.

---

## 2. Backend deploy (Railway, Docker)

The backend `Dockerfile` runs migrations automatically on every boot — you do **not** run them by hand:

```sh
prisma migrate deploy --schema prisma-postgres/schema.prisma   # applies pending migrations (idempotent)
  && prisma generate --schema prisma-postgres/schema.prisma
  && node scripts/verify-product-schema.js                      # fails boot if schema is incomplete
  && npm start
```

Steps:
1. **Back up the production Postgres** (Railway snapshot). This is your instant undo.
2. Set the env vars above in Railway.
3. Deploy the production branch (`main`). Watch the logs for `product_schema_check ... "passed"` and the server start.
4. If the migrate step fails, the container will not boot — check the deploy logs (this is intentional: never serve on a half-migrated schema).

Migrations are **additive and data-preserving** (nullable columns, `CREATE ... IF NOT EXISTS`, NULL-distinct unique indexes), so they are safe to apply to existing data.

---

## 3. Frontend deploy (Vercel)

- Production branch is `main`; Vercel builds **Production** on merge to `main` and **Preview** on any other branch.
- Set `VITE_API_BASE_URL` to your Railway backend URL (per-environment if you use a staging backend).
- Package manager is **pnpm** (`packageManager` field in `frontend/package.json`); there is a single `pnpm-lock.yaml`.

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
pnpm run test
```

---

## 4. Post-deploy (one-time)

Reconcile udhar balances after migrating (via a Railway one-off shell):

```sh
node scripts/repair-udhar-balances.js            # all shops
node scripts/repair-udhar-balances.js --shopId=<id>
```

---

## 5. Verification

```bash
# Backend
cd backend && npm install && npm test && node scripts/run-integration-tests.js
npx prisma validate --schema prisma-postgres/schema.prisma

# Frontend
cd frontend && pnpm install --frozen-lockfile && pnpm run typecheck && pnpm run build && pnpm run test
```

Smoke test on the live site: log in on 2 devices → 3rd device shows the device-limit screen; create a cash bill on one device → it appears on the others; create an udhar bill → balances match on both; attempt overpayment → rejected.

---

## 6. Rollback

Both Railway and Vercel support one-click rollback to the previous deployment. Because migrations are additive (old code ignores the new columns/tables), **roll back code only — you do not need to roll back the database.**
