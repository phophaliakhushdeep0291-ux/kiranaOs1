# KiranaOS — how it fits together

The map a second engineer needs on day one: the shape of the system, the four
models that explain most of the code, and the traps that have actually cost time.

Topic documents live in `docs/`; process documents (`RELEASE_GATE.md`,
`PRODUCTION_CHECKLIST.md`, `BUG_BACKLOG.md`) are at the root. This file is the
thing that was missing — the entry point that says where to start looking.

## The shape

| Piece | Stack | What it is |
|---|---|---|
| `frontend/` | React 18, Vite 6, wouter, Dexie, react-query, Tailwind 4 | The till. Offline-first PWA — it runs a full shop with no network. |
| `backend/` | Express 4, Prisma 5, BullMQ, zod | Multi-tenant API. SQLite locally (`backend/prisma/dev.db`), Postgres in production. |
| `hardware-bridge/` | dependency-free Node, Windows service | Printer and drawer access. Binds `127.0.0.1` only, per-device bearer token, signed installer. |
| `catalog/` | CSV | Source for the 560-item starter catalogue a new shop can load in one click. |

Roughly 38 backend modules, 44 frontend core feature areas, 12 vertical packs,
133 Prisma models. All of the backend modules are **generic** — there is no
per-vertical backend module; trade features live inside `products`, `inventory`,
`orders` and friends.

## The four models that explain most of the code

Understand these and the rest reads easily. Get them wrong and you will write a
bug that passes every test.

### 1. Offline-first is the default, not a fallback

A write goes to IndexedDB **first**, then to an outbox, then to the server. The
UI reports success on the local write. The server can still refuse it later.

```
user action → local-actions.ts → IndexedDB (products, bills, …) 
                               → sync_outbox row
                               → push → server accepts … or CONFLICTs
```

Two consequences worth holding on to:

- **"Saved" does not mean "the server has it."** A rejection lands in
  `sync_outbox` as `CONFLICT` and a row in `sync_conflicts`, surfaced on
  `/sync-status`. Until someone resolves it, the device and the server disagree.
  If you add a server-side rule, add the matching guard in the form, or the shop
  is told the thing worked and finds out hours later.
- **The device mints its own ids.** A locally created product is
  `product_<uuid>`; the server accepts it under its own id and echoes the
  device's back as `clientProductId`. That field is the ONLY link between the
  two rows — anything that dedupes products must match on it (see `mergeProducts`
  in `features/core/products/queries.ts`).

### 2. Money is paise, and storage is not yet exact

Arithmetic routes through paise helpers. **Storage does not**: most money columns
are still `Float`, with shadow `BigInt` columns on only a handful. It is fine in
practice — a double holds 2-decimal rupee values far past any shop's turnover —
but a raw `SUM()` in SQL bypasses the helpers, and no audit-grade claim survives
it. Finishing that migration is a known, deliberate piece of open work.

### 3. Packaging: one product, several sizes

A product sells in several packagings (`ProductSellingUnit`) under one of two
stock models on `Product.packagingMode`:

- **`pooled`** — every size draws on one base-unit pool. Loose rice: a 1 kg and a
  5 kg bag come out of the same sack.
- **`per_pack`** — each size carries its own `onHandQty`. The product total must
  equal `sum(onHandQty × conversionToBase)` or the server refuses the save.

Rules that are easy to violate:

- MRP **and cost** scale per pack. `Product.mrp` describes the DEFAULT pack only;
  a bigger size's ceiling is `mrp × (pack conversion ÷ default conversion)`.
- Switching between the two modes must **convert** the counts, not relabel them
  (`convertPackagingMode`).
- A counted pack holding stock cannot be removed — the server compares against
  the SAVED quantity, so zeroing and removing in one save is refused too. It
  genuinely takes two saves.

### 4. Verticals are a merge, not a module

A trade's navigation comes from three places that must agree: the shared `NAV`,
the pack's `pack.ts`, and `navConfig`. Every defect found auditing all twelve
trades was a silent-failure seam in that merge — an anchor that did not match, a
mistyped group name, a label collision. When adding a trade feature, check all
three.

## Things that will bite you

**i18n is enforced, in three ways.** English is the key catalogue — a missing
Hindi key fails typecheck. A hardcoded user-visible string fails
`i18n-hardcoded-strings`, and its allowlist is a **ratchet**: a listed file is a
ceiling, not a pass, and translating means lowering the number in the same
change. Hindi is the default language and its dictionary is split so first paint
blocks only on the shell and billing halves.

**The startup bundle has a hard gate at 300 kB gzip**, and
`scripts/check-bundle-size.mjs` carries a long record of what was tried and
rejected on measurement. Read it before optimising; several obvious ideas
(recharts chunking, per-vertical chunks, lowering `experimentalMinChunkSize`)
were measured and made things worse.

**Tests passing is not the feature working.** The suites are large and green, and
the bugs that reached a shop were all found by driving the real screen or probing
a parser directly with what a shopkeeper would actually say. When you finish a
feature, use it.

## Running it locally

```bash
cd backend  && npm run dev     # :3000, reads backend/.env
cd frontend && npm run dev     # :5173
```

- The API's `ALLOWED_ORIGINS` trusts only 5173, 5174, 5500 and 51977, and it does
  **not** reload `.env` — pick a port from that list rather than editing the
  allowlist.
- A new shop boots in **Hindi**. Set `localStorage['kirana-os:ui-language:v1']`
  to `en` if you are matching English labels.
- Never clear IndexedDB to "reset" a session — the device licence lives there and
  the app will wipe every session on next boot.
- Working alongside another session? Use `node scripts/new-worktree.mjs <name>`.
  Two sessions in one checkout share one index and one branch, and they collide.

**Before believing anything you see in a browser, check which tree the port is
actually served from.** A stale dev server from another worktree is the most
expensive way to be wrong.

## Where the gates are

| Gate | Command |
|---|---|
| Frontend | `cd frontend && npm run prod:check` (typecheck, i18n, tests, build, bundle) |
| Backend | `cd backend && npm test` and `npm run prod:check` |
| Migrations | `cd backend && npm run migration:safety` |
| Release certification | `cd backend && npm run release:certify:local` |

`RELEASE_GATE.md` records the current decision and why. The local certification
skips the proofs that need infrastructure this machine does not have —
PostgreSQL, Redis, Docker, live smoke, object storage, the restore drill — so it
is evidence, not a substitute for CI.
