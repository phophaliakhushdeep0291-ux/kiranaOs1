# Audit Limitations

Read this before showing the Financial Assurance module to anyone who might mistake
it for an audit. It is a continuous financial-control monitor over data recorded in
KiranaOS. It is **not** a statutory audit, it issues **no** audit opinion, it
performs **no** certification, and it does **not** replace a Chartered Accountant.

The same list is returned by `GET /api/audit/report` and rendered at the bottom of
the Assurance Report page, so a shopkeeper reading the report sees these caveats
with the numbers.

## 1. Coverage is bounded by what was recorded

The engine reads KiranaOS records. Cash, goods or credit that never entered the
system cannot be detected. A sale made entirely off-book produces no finding —
there is nothing inconsistent about a transaction that does not exist. This is the
single most important limitation: **the module detects inconsistency, not absence.**

## 2. Physical cash counts depend on operator declarations

The Daily Closing UI now writes counted cash, opening float, manual cash-in/out,
the calculated variance, user, device, location and revision to
`DailyClosingSnapshot` through the offline outbox. Another device can load that
history, and the assurance engine evaluates `CLOSING_PHYSICAL_CASH_VARIANCE` and
requires a physical count before a day can be locked.

This is still not independent observation: the software cannot see cash that was
never entered, or prove that the operator counted accurately. The engine now
detects shortages recorded by the same authenticated user or device on at least
three distinct business days in a rolling 30-day window. That pattern is an
investigation prompt, not proof that the named person caused the shortage.

## 3. No bank or UPI feed
There is no authorized bank/UPI provider integration. UPI references are
operator-entered strings. The engine can detect the same reference claimed by two
bills (`CLOSING_UPI_REFERENCE_REUSED`); it cannot verify that any reference
corresponds to a real transfer, or that a claimed amount matches the bank.

## 4. Attribution gaps

- **Legacy stock movements may lack actor attribution.** New movements persist an
  immutable `actorUserId` and `actorName` snapshot. `STOCK_FREQUENT_CORRECTIONS`
  includes the authenticated actors it can prove, while retaining an explicit
  attribution-availability flag when older/system rows have no person attached.
- **Legacy/imported expenses may lack a user id.** New online and offline expenses
  store a server-authenticated `recordedByUserId` plus immutable name and role
  snapshots. `EXPENSE_UNATTRIBUTED` now identifies only rows without that trusted
  identity, and `EXPENSE_ACTOR_SCOPE_MISMATCH` detects an invalid/cross-shop actor.
- Bills, purchase receipts and audit-logged actions **do** carry server-assigned
  actor ids; attribution is reliable there.

## 5. Timestamps and offline clock skew

Bill and ledger rows now separate the economic `businessDate` from the
server-assigned `createdAt`. Online actions use server time; offline sync retains
the original client operation time as business date while the durable sync/audit
trail records when the server accepted it. Consequences:

- A bill cannot be backdated through the online path, so
  `BILL_BACKDATED_INTO_LOCKED_DAY` fires only when a sync-event trail proves the
  record arrived after a day was locked. Without that trail the rule stays silent
  rather than guessing.
- Client operation timestamps can be wrong when a device clock is wrong. They are
  bounded and remain paired with server receipt/audit timestamps so late or
  implausible activity can be reviewed rather than silently rewriting history.
- Records that originated offline reduce a finding's confidence by 0.05.

## 6. Pre-ledger history

Rows created before a shop's `StockLedger` / `UdharLedger` / `FinancialLedger`
coverage began cannot be reconciled to movements. The reconciliation rules skip
these cases (no movements ⇒ no claim) instead of reporting the absence of history
as a violation. A shop migrating from paper will therefore see fewer findings on
its oldest data — not because it is cleaner, but because it is unverifiable.

## 7. Baselines need history

Behavioural rules (unusual purchase price, unusually high expense, unusual credit
growth, unusual expense frequency) require a minimum sample: 30 for shop-wide
metrics, 10 per expense category, 5 per product/supplier, 3–4 windows for
growth/frequency. Below that they are skipped and report
`INSUFFICIENT_DATA` — the engine never guesses on thin history. A new shop gets
arithmetic and control checks immediately, but outlier detection only after it has
traded for a while. Baselines are recomputed on demand
(`POST /api/audit/baselines/recompute`) and, when the worker is running, daily.

## 8. Multi-location stock is only partly reconcilable

`Product.stockBaseQty` holds the primary location's residual once secondary
`LocationStock` rows exist. Whole-product reconciliation is therefore reliable only
for single-location shops; `STOCK_BALANCE_LEDGER_MISMATCH` deliberately skips
products with non-zero secondary balances rather than report a false mismatch.

## 9. Supplier-level accounting is per-purchase only

There is no supplier ledger or supplier-payment table; payments are recorded on each
purchase row. Reconciliation is therefore per purchase
(`PURCHASE_DUE_AMOUNT_MISMATCH`). A supplier's overall statement cannot be
reconciled, and "recently changed supplier bank details" is deferred because no
bank-detail fields exist.

## 10. Evidence proves integrity, not authenticity

A checksum shows a submitted reference has not changed since submission. It does
not show the invoice is real, that the goods arrived, or that the person who wrote
an explanation was truthful. Verification is a human judgement recorded by a human;
the module tracks who decided and when.

## 11. AI text is presentation only

The AI layer rephrases deterministic output. It never calculates, decides, closes
or escalates anything. With `AUDIT_AI_PROVIDER=disabled` (the default) the whole
module works and produces deterministic explanations locally. Provider output is
schema-validated and rejected if it contains accusation- or certification-shaped
language. Explanations are stored alongside, never instead of, the score breakdown.

## 12. Findings are prompts, not verdicts

A finding means "these records do not agree with each other, or a control was not
followed". It does not mean theft, fraud or misconduct, and the product's language
is deliberately built around that: "potential inconsistency detected", never "fraud
has occurred". Two rules in particular commonly have innocent explanations:
`STOCK_NEGATIVE_BALANCE` (normal in a kirana shop that sells before recording
purchases) and `UDHAR_AGEING_BEYOND_LIMIT` (long-standing khata is ordinary in this
market).

## 13. Rules with known noise

- `EXPENSE_CATEGORY_INCONSISTENT` is keyword-based and LOW severity; a shop's own
  category naming always wins.
- Any rule can be disabled or re-weighted per shop by the owner.

## 14. Deferred rules

Still deferred because the canonical data cannot support them honestly (details
in `AUDIT_RULE_CATALOG.md` §Deferred): supplier-level payable reconciliation
(D8), changed supplier bank details (D14), and detection of an older record
overwriting a newer canonical version (G12). Idempotency, late ledger activity,
stock/expense attribution and physical/repeated drawer shortages are now covered
by preventive controls or deterministic rules, with legacy rows called out rather
than guessed.

## 15. Operational limitations of this phase

- **Scheduled runs require the jobs infrastructure.** They are registered on the
  shared BullMQ scheduler (`AUDIT_SCHEDULED_RUNS_ENABLED`, default on, every 24 h
  with a 26 h overlapping window), so they only actually run when
  `QUEUES_ENABLED=true`, Redis is reachable and a worker process is running.
  Without a worker, runs are transaction-triggered or manual only. The sweep
  covers shops with activity in the window rather than every shop that ever
  existed, and caps at 200 shops per tick.
- **Transaction-triggered evaluation is durable when queues are enabled.** A
  production deployment with Redis sends each post-commit entity to BullMQ with
  retry/backoff; the assurance worker evaluates it idempotently. If Redis dispatch
  fails, or queues are disabled for a local deployment, the hook falls back to a
  bounded 500-item in-process queue. A process crash inside that fallback window
  can still lose immediate evaluation, so the overlapping scheduled/manual period
  run remains the recovery sweep.
- **The automatic hook is off in the test environment** and can be paused at
  runtime via `setTransactionTriggeredEnabled(false)`. Its writes are a separate
  transaction that can start while other work is in flight; on SQLite (which
  serializes writers) that can briefly block a foreground write. Production runs
  PostgreSQL, where writes to `Audit*` tables do not block writes to canonical
  tables, but this has not been measured under real production load.
- **Period runs are capped** at 2,000 entities per type; the truncation is recorded
  in the run summary rather than hidden.
- **Investigation cases group deterministically, and only over open findings.**
  Grouping is by shared customer, supplier, staff member, locked day or repeated
  rule, over at most 500 open findings. It does not reason about causation, and a
  finding can appear in several proposed groups. Closing a case never closes its
  findings.
- **Evidence file upload is reference-first.** Binary storage works when object
  storage is configured; the primary path in this phase is references and text.

## 16. Not in scope for this phase, by design

Statutory audit certification, CA digital signatures, GST or income-tax filing,
legal opinions, a double-entry accounting rewrite, autonomous record corrections,
bank scraping, employee surveillance, predictive accusations of fraud, black-box
machine learning, cross-client data sharing, and automatic reporting to any
authority. None of these exist in the code.
