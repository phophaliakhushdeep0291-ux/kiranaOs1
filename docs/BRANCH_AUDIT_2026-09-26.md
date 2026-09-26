# Branch audit — 26 September 2026

The requested areas were checked in order: manufacturing, auto parts,
furniture/CI, then free access. The confirmed missing work was the auto-parts
follow-up left in a detached checkout. Its scoped fixes are now integrated into
`work/branch-audit-20260926`, based on main commit
`1d487d8c62704d713e19fd635447d4bfd0704223`.

This is local verification. The audit changes have not been deployed. Passing CI
on the base commit does not certify the new changes.

## Branch findings

Counts compare fetched `origin/main` with each source at review time. They count
commits, including merges, rather than independent fixes.

| Area | Reviewed source | Finding |
| --- | --- | --- |
| Manufacturing | `origin/work/deployment-manufacturing-readiness`, `9dc7ee64` | Fully merged; 115 commits behind, none unique. Current-main production, dispatch, invoice and return tests pass. |
| Auto parts | Detached `autoparts-review-wt`, `8a706116` | 38 behind, two unique broad checkpoint commits. Current-name, branch-stock, permission, cache and durable billing-handoff fixes were missing from main. Integrated their scoped changes and tests. |
| Furniture/CI | `work/furniture-invoice-final` and local `work/ci-certification-360-fix`, `0715dbd2` | Fully included in main; 34 behind. The local CI branch's ahead/behind warning reflects differing history; its commits are already on main. |
| Furniture legacy | `work/furniture-legacy-reconcile`, `3188fa92` | Merged as PR #366; five behind. Receipt-history reconciliation and historical invoice workflows exist and pass tests. Actual shop records still need review. |
| Free access | `work/free-access-launch`, `b3ed2b15`; `work/free-access-presale`, `4d82c917` | Launch is 38 behind with one broad checkpoint; presale is fully merged and 26 behind. Free-access subscription, licence and frontend tests match main. The launch checkout lacks later furniture, pack-cost and other fixes and should not replace main. |

## Auto-parts fixes recovered

- Fitment/reference reads use current catalogue names. Alternate links report
  stock only when the selected branch holds an active catalogue item.
- Server-supplied inventory access controls editing. Staff without it can search
  but cannot add/remove records. Branch changes clear results; delayed responses
  cannot restore a previous branch's results.
- Successful mutations invalidate cached fitments. Late responses and failed
  cache writes cannot resurrect removed claims in the current tab.
- Part Finder saves its billing request before navigating and reports failure.
  Billing saves the receiving draft and consumes the request in one transaction,
  preserving both on failure. Counter clicks and recovered requests share pack,
  quantity and manual-price handling.
- A saved product category survives transient empty select events, and category
  validation is visible.

The scoped patch in
`autoparts-review-wt/docs/evidence/autoparts-handoff-2026-09-24/` was integrated
without copying the outdated checkout over main. The patch omitted the matching
`part-fitment.examples.js` stock assertion update. The full backend gate caught
that omission, and the update was recovered from the same checkout.

Before applying the implementation, added regressions reproduced two failing
backend scenarios and three failing frontend cache cases on main. All pass after
integration.

## Verification of this local candidate

| Check | Result |
| --- | --- |
| Manufacturing integration | 25 passed; one PostgreSQL-only concurrent-return case skipped locally |
| Manufacturing frontend | 75 passed |
| Auto-parts integrity and all twelve trade workflows | 19 passed, none skipped |
| Targeted handoff, cache, barcode and quantity tests | 68 passed |
| Furniture delivery, invoice, historical reconciliation, rentals and bank reconciliation | 49 passed, none skipped |
| Free-access backend examples | Passed, including expiry and resumption of paid enforcement |
| Free-access frontend | 14 passed |
| Full frontend `npm run prod:check` | Typecheck, translations, build, bundle/application checks passed; 3,011 tests passed, one existing skip |
| Full backend `npm test` | Passed after the stock assertion update |
| Backend `npm run prod:check` | Passed |
| Migration safety | Passed, zero warnings |
| `git diff --check` | Passed |

Commands used Node 22.23.2, independent dependency copies and disposable databases.
The frontend build used a local test API address and is not a deployment artifact.
An initial integration attempt was blocked by sandbox localhost permissions; the
authorized rerun passed. An initial build refused a missing API address; the full
frontend gate then passed with the explicit local address.

Browser verification used this checkout's build on port 5500 and API on port 5371
with a new synthetic parts shop. OEM lookup handed one ₹100 part to Billing, and
reload retained exactly one item at ₹100. Later SKU lookup displayed 20 in stock
at ₹100. A fixture-only mistake initially stored primary stock twice; correcting
the fixture to the primary-stock model restored the expected display without
changing application code.

The second browser handoff and final screenshot were not completed: automatic
approval review exhausted its usage allowance before keyboard activation could
run, then the browser connection became unavailable. Repeat handoff, interruption,
concurrent recovery and storage-failure scenarios passed automated tests. No sale
or payment was completed in the browser test shop.

Source/log hashes and results are in
[verification.json](evidence/branch-audit-2026-09-26/verification.json).
Full logs are retained locally in `backend/release-artifacts/branch-audit-20260926/`.

## Existing CI evidence and remaining release work

[Main's certification](https://github.com/phophaliakhushdeep0291-ux/kiranaOs1/actions/runs/36227797645)
passed 20 stages with zero failures on the base commit. All PostgreSQL
manufacturing scenarios passed, including concurrent returns. PostgreSQL, Redis
worker runtime and six backup/restore cases passed; restore compared 147 tables.
See [base-main-ci.json](evidence/branch-audit-2026-09-26/base-main-ci.json).

Six stages were explicitly skipped: release approval metadata, deployed worker
heartbeat, live API contract, live workflow smoke, cloud storage and Docker image
build. Earlier branch-specific Docker evidence does not certify a later image.

Remaining work before a deployment decision:

1. Certify the integrated audit commit in CI, including PostgreSQL, and build its
   intended production image.
2. Verify live frontend/API versions, worker heartbeat, storage and authenticated
   test-shop smoke checks on the intended deployment.
3. Review actual historical furniture records through the owner-approved repair
   workflow. No existing shop record was repaired in this review. Older rental
   bookings still require an agreed financial reconciliation path.
4. Complete physical printer/device checks and record the release owner's approval
   and rollback details required by the release process.

September 22–23 reports remain historical evidence; statements there that
furniture invoice/reconciliation code is absent no longer describe main.
