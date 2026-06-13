# KiranaOS — Production Decision Log

Concise engineering reasoning and final decisions for the production-hardening pass.

---

## Phase 0 — Repository hygiene & security blockers

### Problem
A sellable build must not ship dev artifacts or secrets, and must refuse to boot in production with weak secrets.

### Root Cause
Audit of the actual repo (not assumptions):
- **No** `.env`, `node_modules`, `dev.db`, or `dist` are tracked, and a secret scan of tracked files found **no** hardcoded keys (`sk-…`, `rzp_live…`, `ghp_…`, AWS keys, private keys).
- Four dev log files **were** tracked (`backend/backend-dev.log`, `backend/backend-dev.err.log`, `frontend/vite-dev.log`, `frontend/vite-dev.err.log`) — committed before `*.log` was added to `.gitignore`; tracked files override `.gitignore`.
- Production env validation **already exists** in `backend/src/config/env.js` (JWT_SECRET ≥32, placeholder rejection, Postgres-required, LICENSE_SIGNING_SECRET required ≥32, OWNER_PIN, Razorpay/metrics/storage gating).
- `backend/.env.example` and `frontend/.env.example` already document the required vars.
- `README_PRODUCTION.md` was missing.

### Possible Solutions
- **Option A — Untrack the stray logs (`git rm --cached`), add the missing prod doc, keep the existing env validation.** Pros: minimal, surgical, no risk to working flows. Cons: none material.
- **Option B — Rewrite `.gitignore` and env validation from scratch.** Pros: "fresh." Cons: would re-introduce risk and churn on already-correct, already-tested code; violates "don't fake/ don't rewrite unnecessarily."

### Final Decision
Option A.

### Why This Is Best
The repo was already ~9/10 on hygiene/security; the honest fix is the small real gap (4 tracked logs + missing doc), not a rewrite. The strong env-boot validation is kept as-is because it already meets the acceptance criteria.

### Files Changed
- Untracked (kept on disk): the 4 `*-dev*.log` files — now covered by `.gitignore:*.log`.
- Added: `README_PRODUCTION.md`.

### Tests / Verification
- `git ls-files | grep -E '\.env$|node_modules/|\.db$|/dist/|\.log$'` → only the 4 logs (now untracked).
- `git grep -E '(sk-…|rzp_live_…|ghp_…|AKIA…|BEGIN … PRIVATE)'` over tracked files → no matches.
- `git check-ignore -v backend/backend-dev.log` → matched by `.gitignore:18:*.log` after untracking.

---

## Phase 1 — Package manager & build reproducibility

### Problem
The frontend declares `packageManager: pnpm@9.15.9` but shipped **both** `package-lock.json` (npm) and `pnpm-lock.yaml`. On a Linux/Vercel build, the wrong lockfile could be used, producing non-reproducible installs.

### Root Cause
A stale `frontend/package-lock.json` (259 KB) was committed alongside the canonical `pnpm-lock.yaml` (156 KB).

### Possible Solutions
- **Option A — Delete `package-lock.json`, keep `pnpm-lock.yaml` as the single source of truth.** Pros: matches the declared `packageManager`; Vercel already honors it; reproducible. Cons: none — local `node_modules` is untouched, only fresh installs are affected.
- **Option B — Switch the project to npm.** Pros: none here. Cons: contradicts the declared `packageManager` and the maintained pnpm lockfile; larger, riskier change.

### Final Decision
Option A — pnpm is the single frontend package manager. Backend remains on npm (documented in `README_PRODUCTION.md`).

### Why This Is Best
Aligns the lockfile with the already-declared toolchain that Vercel uses, removing an ambiguity without touching any application code or the installed dependency tree.

### Files Changed
- Removed: `frontend/package-lock.json`.

### Tests / Verification
- `npx tsc -p tsconfig.json --noEmit` → clean (frontend source untouched).
- Frontend `vitest run` → 319/319 (from this session; unaffected by the lockfile removal).
- Reproducible install command documented: `pnpm install --frozen-lockfile`.

### Remaining (not in this pass)
Wiring the dashboard/reports to read from `FinancialLedger` (slice 3), opening-balance/adjustment ledger posting, `ChangeLog`/`SyncCommand`, and the mobile-UI rebuild are tracked separately and are not security/hygiene blockers.
