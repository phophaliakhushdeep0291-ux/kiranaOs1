# KiranaOS production stabilization plan

Date: 2026-07-26  
Target branch: `stabilize/kiranaos-v1`  
Scope: production correctness and sell-readiness. The AI audit/review feature is
explicitly deferred to a later review.

## Outcome

KiranaOS may enter a founder-assisted external pilot only when every Pilot Gate
item below is green on the same commit. Public paid onboarding remains blocked
until the Paid Gate is also green and the live evidence is attached to the
release manifest.

## Workstreams

### S1. Tenant and authorization safety

- Scope failed-job list, retry, and discard operations to `job.data.shopId`.
- Do not expose infrastructure-wide queue pause/resume to tenant owners.
- Rate-limit and audit failed Owner PIN attempts; lock the caller out after
  repeated failures.
- Prove both controls with executable regression tests.

Acceptance:

- Shop A cannot discover or mutate Shop B's jobs, including with a guessed ID.
- A normal owner/admin cannot pause or resume a platform-wide queue.
- Five bad Owner PIN attempts trigger a 15-minute lockout; a correct PIN clears
  the failure counter; PIN values never appear in logs.

### S2. CI and frontend delivery

- Keep route-level code splitting.
- Enforce a meaningful initial-download budget and a separate full-application
  growth budget.
- Keep the all-bundle secret scan and largest-chunk limit.
- Record raw and gzip sizes in release evidence.

Acceptance:

- `npm run prod:check` passes without removing a production feature.
- Entry/core payload and every individual route chunk stay below their budgets.
- Full application JS growth is explicitly bounded and reported.

### S3. Idempotent money and stock mutations

- Require durable idempotency identity on direct inventory purchase, damage, and
  correction requests and pass it through to the existing ledger guards.
- Require receipt idempotency for purchase-order receiving.
- Add durable idempotency to expenses before enabling direct/offline retries.
- Keep append-only financial and stock movement records.

Acceptance:

- Replaying the same request returns the original result and changes neither
  stock, supplier due, expense totals, nor ledger totals twice.
- Reusing a key with a materially different payload returns `409`.

### S4. Business dates and report consistency

- Persist the client transaction time/business date for offline bills.
- Calculate date-only expense filters in the configured shop timezone.
- Align cash, refunds, expenses, and net-profit definitions behind shared
  report primitives.
- Flag missing product cost instead of presenting revenue as 100% profit.

Acceptance:

- A bill created offline on day D remains in day D after later synchronization.
- Daily, monthly, GST, payment-mode, and closing reports agree for the same
  transaction set and timezone.
- Reports expose cost coverage and mark estimates when cost is missing.

### S5. Inventory authority and reconciliation

- Treat append-only stock movements plus location stock as the auditable
  authority.
- Ensure purchases, sales, damage, corrections, counts, returns, transfers, and
  purchase edits/deletes all write compensating movements.
- Reconcile product aggregate stock, location stock, ledger totals, and lots.

Acceptance:

- No supported workflow changes stock without a movement.
- Concurrent adjustments cannot silently overwrite a sale or transfer.
- Reconciliation reports zero unexplained drift or emits an actionable repair.

### S6. Release and operational proof

- Run frontend tests/typecheck/build/security checks.
- Run backend examples, SQLite integration, API contract, migration safety, and
  production checks.
- Run PostgreSQL concurrency, backup/restore, Redis worker heartbeat, provider,
  two-device offline, hardware, Railway, and Vercel checks on the exact candidate.

Acceptance:

- Automated gates are green on the exact commit.
- Live/manual evidence is linked in `RELEASE_GATE.md`.
- Product and engineering sign-off name the same commit and deployment URLs.

## Gates

### Pilot Gate

- S1 complete.
- Current CI fully green.
- Business-date and direct mutation idempotency regressions fixed.
- PostgreSQL concurrency, two-device Udhar, and backup/restore proof complete.
- Zero open P0 defects and no unexplained stock or customer-balance drift.

### Paid Gate

- Pilot Gate complete.
- S4 and S5 acceptance criteria complete.
- Monitoring, error tracking, worker alerting, support escalation, data export,
  restore, and rollback rehearsed.
- At least 30 consecutive pilot days without unexplained money, Udhar, or stock
  drift.

## Deferred

- AI audit/review quality, model choice, provider behavior, prompts, and merchant
  UX. Deterministic assurance checks remain in place, but the AI layer is not
  part of this stabilization pass.
