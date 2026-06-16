# KiranaOS — PRD (living document)

## Original Problem Statement (summary)
Build **KiranaOS**, a production-grade offline-first POS for Indian kirana stores. Must handle billing, customer udhar/ledger, inventory, purchases, expenses, dashboard, reports, multi-device sync, JWT auth + Netflix-style device limit, subscription enforcement, and audit logs. Single business-truth layer; no scattered financial formulas. Mobile-friendly UI.

## Stack (decided, defaults assumed)
- Backend: FastAPI + Motor + MongoDB (platform default)
- Frontend: React 19 + Dexie 4 (IndexedDB) for offline
- Auth: JWT custom + device sessions
- Payments: deferred — only plan/device enforcement at first
- Demo: rich Indian kirana seed data

## Status as of 2026-02-21
- **Phase 1 (Environment Plan)** ✅ — `/app/docs/01_ENVIRONMENT_PLAN.md`
- **Phase 2 (Product Understanding)** ✅ — `/app/docs/02_PRODUCT_UNDERSTANDING.md`
- **Phase 3 (Architecture)** ✅ — `/app/docs/03_ARCHITECTURE.md`
- **Phase 4 (Risk Table — 25 risks)** ✅ — `/app/docs/04_RISK_TABLE.md`
- **Implementation Roadmap** ✅ — `/app/docs/05_ROADMAP.md`
- **Code:** NOT STARTED — awaiting user confirmation per problem statement instructions.

## Sacred Invariants
1. One bill never counts twice — unique `(shop_id, idempotency_key)` and `(shop_id, device_id, client_event_id)`
2. One payment never counts twice — same
3. Udhar balance = Σ ledger entries (single source of truth)
4. Dashboard == Reports (one selector layer)
5. Cancelled bills excluded everywhere
6. Money is integer paise — no floats
7. Server recomputes totals; ignores client grand_total
8. Offline writes survive refresh via Dexie
9. Revoked devices cannot write
10. No silent overwrites — audit log everywhere

## Personas
- **Owner (Seth-ji)**: dashboards, reports, full permissions
- **Counter Staff**: billing-only role
- **Stockist**: purchases + inventory adjustments
- **Multi-shop Owner**: switches between shops

## Implementation Roadmap (M0–M20)
See `/app/docs/05_ROADMAP.md`. Two-pass strategy: Pass 1 = vertical happy path online (M1–M7, M10–M12, M15). Pass 2 = offline-first + advanced (M8, M9, M13–M14, M16–M20).

## Backlog (P0 / P1 / P2)
**P0 (Pass 1 — blocks first usable build)**
- M1 backend foundation
- M2 auth + shop onboarding
- M3 devices + subscription stub
- M4 products + customers CRUD
- M5 billing + payment + ledger + inventory (financial core)
- M7 reports/dashboard selectors
- M10 frontend foundation (Login, AppShell)
- M11 billing UI
- M12 customers/udhar UI
- M15 dashboard + reports UI

**P1 (Pass 2)**
- M6 purchases + expenses
- M8 sync push/pull backend
- M13 products/inventory UI
- M14 purchases/expenses UI
- M16 device limit UI
- M17 sync status UI

**P2**
- M9 audit log + sync status backend (light during Pass 1, full in Pass 2)
- M18 staff/roles + settings UI
- M19 full test sweep with `testing_agent_v3`
- M20 production hardening (deployment_agent)

## Next Action
**Awaiting user confirmation** (per problem statement Phase 1/2 instructions). On "go", I execute M1–M4 in a single parallel batch.
