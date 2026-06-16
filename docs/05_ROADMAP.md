# KiranaOS — Implementation Roadmap

This is the **execution order**. Each milestone has a clear definition of done. Phases 1–4 are documents (done). Phases 5+ are code.

## Milestone Table

| # | Milestone | Scope | Acceptance |
|---|---|---|---|
| **M0** | Planning docs (this PR) | `/app/docs/*` | All 5 docs delivered; user confirms |
| **M1** | Backend foundation | server.py shell, core/, ensure_indexes, health, JWT, error envelope | `GET /api/health` ok; indexes present; tests scaffold runs |
| **M2** | Auth + Shop onboarding | `/api/auth/register-owner`, `/api/auth/login`, `/api/auth/me`, refresh, shop autocreate | Owner can register and get a token tied to a shop |
| **M3** | Devices + Subscription | device session on login, device limit, `/api/devices`, plans seed | Beyond-limit login returns 409 with active devices list |
| **M4** | Products + Customers | CRUD endpoints + indexes | Owner can add product/customer and list them |
| **M5** | Billing + Payment + Ledger + Inventory | the financial core, idempotency-protected | Bill (cash/UPI/udhar/partial) creates correct ledger + inventory rows; cancel reverses |
| **M6** | Purchases + Expenses | CRUD + stock movement on purchase | Stock increases after purchase |
| **M7** | Reports/Dashboard | one selector layer | `/api/reports/daily` matches `/api/dashboard/today` |
| **M8** | Sync push/pull backend | `/api/sync/*` endpoints | Push 10× same event → one bill; pull resumes from cursor |
| **M9** | Audit log + Sync status backend | `/api/audit`, `/api/sync/status` | Every write produces audit entry |
| **M10** | Frontend foundation | Dexie schema, api.ts, selectors.ts, AppShell, Login | Login persists; reload restores session |
| **M11** | Billing UI + offline outbox | item picker, cart, payment modal, outbox engine | Bill offline → reload → still visible; goes online → syncs |
| **M12** | Customers/Udhar UI | list + detail + ledger view + repayment modal | Udhar balance matches server |
| **M13** | Products/Inventory UI | list + edit + stock view | Adjustments audited |
| **M14** | Purchases/Expenses UI | forms + lists | Cost flows into product cost |
| **M15** | Dashboard + Reports UI | cards + table + date range picker | Dashboard cards equal Reports table row |
| **M16** | Device limit UI | active device picker on 409 | User can evict and login |
| **M17** | Sync Status + Audit Log UI | live counters, retry button | Failed events show up; retry works |
| **M18** | Staff/Roles + Settings UI | invite staff, permissions matrix | Staff can be limited to billing only |
| **M19** | Tests sweep | unit + integration + `testing_agent_v3` | All critical tests pass |
| **M20** | Production hardening | indexes, secrets, env doc, CORS, rate-limit | `deployment_agent` reports pass |

## Two-Pass Strategy (recommended for "first finish")

Because the platform thrives on demonstrating end-to-end value fast, we will execute in **two passes**:

### Pass 1: Vertical slice through the happy path (M1 → M11 → M12 → M15)
Goal: a user can register, add products/customers, create a paid + an udhar bill, see it on dashboard, repay udhar — **all online**. Skip offline for this pass.

After Pass 1 we call `testing_agent_v3`, fix critical issues, and **finish** so the user gets a "wow" moment.

### Pass 2: Offline-first + advanced features (M8, M13, M14, M16, M17, M18, M19, M20)
Goal: Dexie outbox, sync engine, device limit picker, audit log UI, staff/roles, production hardening. Each milestone gets its own `testing_agent_v3` run.

## Definition of Done (per milestone)

For every backend milestone:
1. Service has at least one unit test
2. Router has at least one integration test
3. Indexes (if any new collection) added to `ensure_indexes`
4. Audit logging on every write
5. No `print()` — only logger
6. All money is paise (int)

For every frontend milestone:
1. Pages use shared selectors, never inline math
2. Mobile layout verified at 375px
3. Empty state, loading state, error state all present
4. `data-testid` on every interactive element
5. No raw axios calls outside `lib/api.ts`

## Time Budget (rough)

| Pass | Time |
|---|---|
| Pass 1 (M1–M7 + M10–M12 + M15) | 60–70% of effort |
| Pass 2 (M8, M9, M13–M14, M16–M20) | 30–40% |

## What I'll Do Next (awaiting confirmation)

When you say "go", I will execute **M1 + M2 + M3 + M4** in one shot via parallel file creation:
1. `backend/server.py` rewrite with module routing
2. `backend/core/*` (db, security, base_model, money, deps)
3. `backend/modules/auth/*`, `shops/*`, `devices/*`, `subscription/*`
4. `backend/modules/products/*`, `customers/*` (CRUD only)
5. `backend/seed.py` with the rich Indian kirana demo data
6. Frontend: skeleton `lib/`, `hooks/`, AppShell, Login, Dashboard placeholder
7. Restart backend, run a curl-based smoke test to prove auth + product creation

Then I'll progress through M5 (the billing core), call `testing_agent_v3`, and iterate.

**Please confirm by saying any of these:**
- *"go"* / *"proceed"* / *"build it"* → I start coding M1–M4 immediately
- *"change X"* → tell me what to tweak in the plan
- *"plan only, stop here"* → I stop, leave docs as deliverable
