# Business profile repository architecture

Artha is one POS platform. A shop type is a preset that selects an engine,
capabilities, navigation and optional vertical screens; it is not a separate app.

## Layer ownership

```text
backend/src/
├── engines/catalog.js       reusable engine compositions
├── modules/                 existing shared core and domain implementations
│   ├── auth, shops, devices, subscriptions, audit, sync, backups
│   ├── products, inventory, inventory-lots, bills, customers, suppliers
│   └── ...
└── verticals/
    ├── profile.js           profile contract and capability catalog
    ├── registry.js          the only backend profile registry
    └── <shop-type>/profile.js

frontend/src/features/
├── core/                    shared pages, data, forms and services
└── verticals/
    ├── registry.ts          the only frontend pack registry
    ├── types.ts             pack/route/navigation contracts
    └── <shop-type>/         exclusive screens and its pack.ts manifest
```

The current `backend/src/modules` directory contains both shared infrastructure
and mature domain implementations. Moving hundreds of files merely to rename
folders would add deployment risk without changing boundaries. New code follows
the ownership rules below; existing modules can be migrated domain-by-domain
only when their tests and public imports move in the same change.

The requested `core`, `domains`, `infrastructure` and `shared` directories are
now the public architecture. Their `index.js` files expose the current production
implementations through stable namespaces. Legacy `modules/*` paths remain as
compatibility implementation paths while imports are migrated incrementally.
Because the backend is native ESM JavaScript today, the executable entry files
remain `app.js` and `server.js`; converting extensions alone would not make the
codebase TypeScript and would break the current Node runtime.

## Where code belongs

### Shared core

Authentication, shop context, staff permissions, devices, subscriptions,
payments, expenses, audit, sync, backups, notifications and report plumbing.
Every shop uses these. Shared core must never import a shop vertical.

### Shared domain/engine

Catalog, SKU, stock ledger, purchases, sales, returns, customer and supplier
logic. Variant, batch/expiry and serialized allocation services also belong here
because several shop types can enable each capability.

### Vertical

Only behavior unique to one trade:

- Clothing: rentals and garment-specific exchanges.
- Pharmacy: prescriptions and medicine substitution.
- Auto parts: vehicle-fitment workflows.
- Electronics: exact serial/IMEI warranty workflows.
- Restaurant: tables, KOT and kitchen lifecycle.

A vertical may import shared code. Shared code may not import a vertical, and one
vertical may not import another vertical.

`backend/src/verticals` holds exactly one directory per registered business type
and nothing else, so the directory listing is an honest answer to "what shop types
are there?". Trade-exclusive server code lives inside its own vertical — the cloth
rental service is at `verticals/clothing/rentals/`, not in the shared module pile.

Shared code that needs something only one trade knows takes it through a
registration seam rather than an import: `shared/catalog-availability.js` lets the
clothing pack hide garments booked out for the day from the public catalogue,
without the catalogue ever naming clothing.

## Adding a business type

1. Add the identifier to the backend and frontend business-type catalogs.
2. Create `backend/src/verticals/<type>/profile.js`.
3. Register it exactly once in `backend/src/verticals/registry.js`.
4. Create `frontend/src/features/verticals/<type>/pack.ts`.
5. Register it exactly once in the frontend registry.
6. Add only exclusive routes/screens to the pack; reuse shared capability pages.
7. Add capability middleware to specialized backend routes.
8. Add tenant, capability, transaction and offline-idempotency tests.

Registry tests fail when a profile is missing, duplicated, uses an unknown
capability, or collapses multiple shop types into an implicit fallback.

## Delivery phases

- Phase 1: Kirana and shared retail core.
- Phase 2: Stationery, cosmetics and basic furniture workflows.
- Phase 3: Variant engine for clothing and footwear.
- Phase 4: Electronics serial tracking and auto-part fitment.
- Phase 5: Pharmacy dispensing, batch and expiry validation.
- Phase 6: Restaurant order, table, KOT and recipe inventory engine.

An empty vertical pack means the shop currently uses only shared capabilities;
it is still explicit and has a dedicated extension point for future work.
