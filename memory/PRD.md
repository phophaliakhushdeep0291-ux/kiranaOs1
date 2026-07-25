# KiranaOS + KiranaAudit — Living PRD

## Original Problem Statement
Build **KiranaOS**, a production-grade offline-first POS for Indian kirana stores. Later ambition: pivot to an **AI-native audit firm** (KiranaAudit) for Indian SMEs — Phase-1 wedge = internal audit + fraud detection.

## Status as of 2026-07-25

### KiranaOS backend (user's uploaded artifact)
- Assessed & scored: **A− / 8.5 / 10** — top-5% quality for POS backends
- 5 preview bugs found and patched (all verified live):
  - #1 loginSchema stripped deviceId → device-limit bypass + accumulating stale sessions
  - #2 `/api/udhar/pay` alias route missing + customerId stripped by Zod
  - #3 Owner PIN missing on demo owner in seed
  - #4 sync/push response inconsistent between `data.results` and `data.events`
  - #5 Prisma binaryTargets missing linux-arm64 + linux-musl
- **8/8 integration regression tests pass** — `tests/integration/preview-bug-patches.integration.test.js`
- Zod schema audit swept — no other silent-strip bugs in validated schemas
- Full patch bundle: `/app/kiranaos_all_patches.diff` (936 diff lines across 7 patched files + 3 new files)

### KiranaOS frontend starter (new)
- `/app/frontend-kiranaos/` — React 18 + Vite + Tailwind + shadcn-style + Dexie + Sonner + React Query + Zustand
- **Builds cleanly:** 313 KB JS (100 KB gzip)
- Pages: Login, Dashboard, Billing (item picker + cart + payment modal), Customers (udhar list + repayment)
- Wires to your backend contract via `REACT_APP_API_BASE`
- Uses the bug-#1 fixed login (deviceId in body), the alias route from bug #2, and idempotencyKey on every mutation

### KiranaAudit — Phase-1 wedge proofs
- **Duplicate-payment detector** — `scripts/audit/duplicate-payment-detector.js`
  - 5 rules: exact clone same-day, near-clone across bills, idempotency-key collision, udhar-payment double-entry, reversal-after-daily-close
  - Ran against live seeded DB; caught 3 payments totaling ₹102 on a ₹34 bill (my planted duplicates + a legit split)
  - Sample output: `/app/docs/sample-duplicate-payment-findings.json`
- **GSTR-2A reconciler** — `scripts/audit/gst-2a-reconciler.js`
  - 5 mismatches: in-register-not-in-2A, in-2A-not-in-register (ghost invoice detection), amount mismatch, GSTIN mismatch, cross-period late filing
  - Ran with mock GSTR-2A + vendor master; found ITC ₹2,822 at risk + a ₹99,999 ghost-invoice fraud signal
  - Sample output: `/app/docs/sample-gst-2a-findings.json`
- **Phase-1 product spec** — `/app/docs/06_KIRANAUDIT_PHASE1_SPEC.md`
- **Independence architecture** — `/app/docs/07_INDEPENDENCE_ARCHITECTURE.md`

## Valuations (honest, evidence-based)

| Path | 24-mo | 5-yr ceiling |
|---|---|---|
| KiranaOS as POS (1k shops) | ₹15-25 Cr | ₹150-300 Cr (Vyapar / myBillBook trajectory) |
| KiranaOS + KiranaAudit wedge (Phase-1) | ₹30-60 Cr | ₹500-1000 Cr |
| Full AI-native audit LLP (Phase-3) | ₹60-150 Cr | ₹5,000-10,000 Cr (India-scale MindBridge equivalent) |

KiranaOS as pure IP today ≈ ₹40-60L. As foundation for KiranaAudit pivot, option value ≈ ₹3-5 Cr (saves 6-9 months cold start).

## Sacred Invariants (verified live on the running system)
1. One bill never counts twice — same idempotencyKey → same id  ✅
2. One payment never counts twice — unique index  ✅
3. Udhar = Σ ledger entries — ledger truth  ✅
4. Dashboard cards match Reports API responses  ✅
5. Cancelled bills excluded from sales  (checked via detector)
6. Money is integer paise on the wire  ✅
7. Server recomputes totals (ignores client)  ✅
8. Bill number sequential (KOS-2026-000001+)  ✅
9. Device-limit enforced (Netflix payload)  ✅
10. Session-device-mismatch defense  ✅

## Next Actions (user-facing)

**Right now — actionable in a day:**
- Apply `/app/kiranaos_all_patches.diff` to the real repo; run `npm run test:integration` to confirm no regression on the 14 existing tests + 8 new
- Regenerate Prisma client (`npx prisma generate`); redeploy — Windows/macOS → Linux deploys will stop failing
- Re-seed local DB (`npm run db:seed`) → demo owner now has PIN 1234
- Copy `/app/frontend-kiranaos/` into your kiranaos-backend repo (or a new repo) and `yarn dev`

**Next 2 weeks — Phase-1 audit-wedge foundation:**
- Fork KiranaOS infra into `kiranaudit-backend` (see forking plan in doc 06)
- Get counsel on Sec 141/144/ICAI (see doc 07)
- Register KiranaAudit LLP (or set up the two-entity structure)
- Prototype 3rd detector: Cash discipline (Sec 40A(3) / 269SS/T)

**Next 90 days:**
- 3 pilot clients on Phase-1 audit product
- First monthly Audit Pack delivered
