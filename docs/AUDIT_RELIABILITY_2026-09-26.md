# Financial Assurance reliability — 26 September 2026

Workspace: `audit-reliability-wt`, branch `work/audit-reliability`.
Base: `1d487d8c`. Engine: `assurance-engine-1.2.0`.

## Customer behavior changed

- A failed rule preserves the previous finding, score, evidence requirements and review history. Disabling a previously active rule does not mark its underlying financial condition corrected.
- A previously corrected condition reopens the same finding with one explicit history event when it returns.
- Evaluation, finding, finding rules, evidence requirements and status history commit together. A failed write rolls them all back; PostgreSQL serialization conflicts use the repository retry helper.
- Failed rules and truncated collection make a run partial. Exactly 2,000 records do not falsely imply truncation; collection requests one extra record to establish that more exist.
- Configuration read failure finishes the run as failed instead of abandoning it as running.
- Failed post-commit evaluations reject their BullMQ jobs so configured retries and failed-job monitoring can work.
- Scheduled sweeps and baseline refreshes page through all selected shops. The existing `shopLimit` input now controls page size, rather than silently excluding later shops. Discovery covers each supported record family.
- Scheduled collection includes recent changes and late-recorded expenses, plus payments on old bills. Manual runs keep their existing date-selection semantics. Queue retries anchor tenant discovery and collection to the job timestamp.
- Scheduled work finishes the other shops before rejecting a job with failed or partial results.
- Report coverage counts distinct `(entity type, entity id)` records, including healthy records. Separate evaluation-attempt counts retain repeat-run activity.
- Run screens, completion messages and printable reports explain incomplete coverage in English and Hindi. Incomplete evaluations show a warning instead of presenting their partial score as a completed assessment. Report categories use translated labels.

## Verification

Final checks completed on 27 September 2026. All integration checks used disposable databases, and browser QA used a separate synthetic shop. No live customer records were changed.

- Frontend release gate: `VITE_API_BASE_URL=/api npm run prod:check` — typecheck, all 6,387 translation keys, production build, bundle budget and production app checks passed; 398 test files and 2,991 tests passed. The existing opt-in live API smoke suite was skipped (one file, one test).
- Backend assurance integration: engine (30), API (12), cases/scheduler (6), reliability/fault injection (9) — **57 passed, zero failed, zero skipped**. The runner's backend regression examples also passed.
- Backend `npm run prod:check` passed: application module graph, production configuration checks and dependency security regression checks.
- Money-integrity, pack/rate/unit and AI-grounding examples passed. The AI-grounding scenario accepted zero provider-authored claims and enforced its schema and confidence cap.
- Final browser report: correct distinct-record totals and incomplete-run warning, translated area labels, no console errors and no horizontal overflow at 1,280px.

Reproduce the integration check from `backend` with `FORCE_DB_TESTS=true npm run test:integration -- assurance-engine.integration.test.js assurance-api.integration.test.js assurance-cases.integration.test.js assurance-reliability.integration.test.js`. Its local HTTP test server requires permission to bind localhost. The frontend gate requires an API base URL; `/api` is used for this same-origin preview.

An earlier frontend attempt timed out starting a Vitest worker during heavy machine load. The final full gate exited successfully. A sandboxed integration attempt was blocked from binding localhost; rerunning with that permission executed all 57 checks successfully.

Browser scenario: a deliberately broken rule produced a partial run and displayed its failure count. A normal retry found the seeded inconsistent bill, and a second retry created no duplicate finding. The report showed one distinct record across three runs, while retaining the earlier incomplete-run warning. No browser console errors were observed during this scenario.

Reproducible preview: `scripts/qa/assurance-preview.mjs`. It asserts a dedicated test database path before resetting that database. Local screenshots are under the ignored `qa-artifacts/audit-reliability/` directory, following the repository's artifact convention. Its login and PIN belong only to the disposable test shop.

## Remaining release requirements

This work improves the existing financial-control product; it is not a completed paid-release certification.

1. Run this exact candidate against PostgreSQL and Redis/BullMQ, including concurrent evaluation/review, worker restart, exhausted retry monitoring, migration deployment, and recovery after outage. Local SQLite integration is not proof of PostgreSQL behavior.
2. Verify scheduled load at the intended customer count. Tenant discovery now pages correctly, but per-entity context reads and a full multi-tenant sweep still need production-scale timing.
3. Add resumable record pagination for shops exceeding per-source collection limits. Such runs now explicitly report partial coverage; retrying the same broad date range does not remove that limit. A shorter period is a workaround, not a guarantee if one day itself exceeds the cap.
4. Add durable catch-up checkpoints for outages longer than the configured lookback. A 26-hour lookback does not cover arbitrarily long worker outages, and the in-process fallback can still lose work on process termination.
5. Review rule coverage and false positives on representative shop histories with an accountant or experienced reviewer. Money identified for investigation is not confirmed loss. The report only sees records in KiranaOS.
6. Confirm operational ownership: alerts for failed/partial runs, support procedures, backup/restore proof, retention policy and customer onboarding. Existing environment switches and Redis workers must actually be enabled in the deployment.
7. Historical evaluations retain the pre-existing same-run upsert model. These changes make multi-table persistence atomic; they do not introduce a new immutable canonical-data snapshot system or database-level append-only protection against privileged administrators.

No pricing, advertising claim, production deployment or paid-release approval is implied by these local checks.
