# KiranaOS Frontend — Starter

Drop-in React + Vite frontend for your Node/Express KiranaOS backend.

## Setup

```bash
cd frontend-kiranaos
cp .env.example .env
# edit .env to point at your backend
yarn install
yarn dev
```

## What's in this starter

Talks to your backend using the exact contract we verified live in the preview:

- `POST /api/auth/login` with `deviceId` + `deviceName` + `platform` in body (fixes preview bug #1)
- `POST /api/devices/activate` immediately after login
- `X-Device-Id` header + `Authorization: Bearer <token>` on every subsequent request
- `POST /api/bills/confirm` with client-generated `idempotencyKey` (uuid v4) — retry-safe
- `POST /api/udhar/pay` (uses the alias route added in preview bug #2)
- `GET /api/reports/sales-summary` + `GET /api/reports/payment-modes` for the dashboard cards (the "one truth" invariant)

## Pages included (Phase-1 vertical slice)

- `/login` — mobile + password, generates persistent deviceId in localStorage
- `/` — Dashboard with today's cards (sales / cash / UPI / udhar / profit)
- `/billing` — item picker + cart + payment modal, submits to `/api/bills/confirm` with idempotency
- `/customers` — udhar list + detail (repayment through `/api/udhar/pay`)

## Not yet included (deferred to Phase-2 build)

- Full Dexie offline outbox + sync engine (~2 weeks)
- Products/Inventory/Purchases/Expenses/Reports/SyncStatus/Devices/Staff/Settings/AuditLog pages
- Bill printing (Thermal 58mm + A4)

The `src/lib/db.ts` (Dexie) and `src/lib/outbox.ts` scaffolding is there for you to extend when you add offline.

## Data-testids

Every interactive element has a `data-testid` — the same taxonomy used by our regression tests, so you can plug this into Playwright immediately.
