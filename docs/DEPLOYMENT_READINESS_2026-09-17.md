# Deployment readiness — 17 September 2026

## Candidate

Branch: `work/deployment-manufacturing-readiness`, based on refreshed `origin/main` at `f6ffc9da` (PR #341). The offline/startup readiness changes from `fd347a3e` and `db10c66e` are now in main and were included in local verification. This candidate adds the manufacturing corrections below. Production deployment is not part of this local review.

Manufacturing is a vertical in main. Its export and partial-dispatch features were already merged. The other verticals were checked through the shared regression suite; manual browser coverage of every trade is not claimed.

## Corrections

- An already shipped order cannot be cancelled when its back-order returns to allocated or packed. The conditional server update checks shipment history, and the UI hides cancellation using that same history.
- Order-list validation accepts `partially_dispatched`.
- Packing documents use pending reservations or the latest dispatched consignment, excluding prior batches and unshipped lines. Invoice dispatch metadata matches its saved bill. Dispatch ordering is deterministic for shipments on the same date.
- A whole-order return creates one credit note per shipment invoice inside one serializable transaction. A failure on any invoice rolls back all credit notes, stock, payments, customer balances and audit entries. Integration deliveries run only after commit. Replays reuse the completed return, and single-invoice identities remain compatible.
- Each invoice uses its own payment or credit settlement. Older consignment invoices are protected from cancellation/return through general billing, just like the latest invoice.
- The deployment guide now names the supervised API/worker runtime used by the Dockerfile.

## Local verification

- Frontend `VITE_API_BASE_URL=/api npm run prod:check`: 373 test files passed, one skipped; 2,780 tests passed, one skipped. Typecheck, 6,104 translation keys, production build, bundle budgets and offline boot coverage passed.
- Full backend `npm test`: passed again after the shared billing changes, including manufacturing, restaurant, vertical architecture/entitlements, accounting, inventory, synchronization and security checks.
- The initial 42-file integration run passed 381 tests with two PostgreSQL-only skips. After adding multi-invoice returns, the full run exposed a Prisma native-engine panic in the general-ledger test under system Node 26 and an incorrect field name in the new test assertion. The assertion was corrected. Both affected files then passed under production Node 22.23.2: 18 tests passed and the new PostgreSQL-only concurrent-return test skipped. The other 40 files passed the later full run.
- Manufacturing coverage includes consumption rollback, QC release, split-batch genealogy, pack stock, partial dispatch, cancellation guards, shipment paperwork, consignment invoices, exports, multi-invoice return rollback/replay, HTTP owner-PIN enforcement, and credit-versus-paid refunds.
- Backend production checks, PostgreSQL schema validation, migration safety, append-only migrations, source parsing, repository hygiene and whitespace checks passed. No schema migration is added.

Frontend dependencies were installed with pinned pnpm 9.15.9 and the frozen lockfile. Local database tests use disposable SQLite databases. Node 22 targeted verification matches production; earlier broad checks used system Node 26.1.0. `/api` was only a build-validation value, not a live backend configuration.

## Release gates

1. Run required CI on the final candidate using Node 22, PostgreSQL and Redis, including the new concurrent manufacturing-return test. The manual certification job also proves the Docker image; normal PR/push jobs skip that image step.
2. Verify the real Vercel API URL, Railway environment, frontend origins, secrets and enabled providers using `npm run prod:preflight` in the hosting environment.
3. Complete backup/restore proof against an isolated target; verify worker health and enabled storage/payment providers.
4. Deploy the exact certified candidate, check `/health/ready`, and smoke-test two-device sync, offline recovery and production → partial shipments → invoices → whole-order return in a designated test shop.
5. Complete target-device printing/offline-auth checks from `PRODUCTION_CHECKLIST.md` and record rollback/version metadata before strict certification.

Docker, PostgreSQL/Redis services, restore-test configuration and live API configuration were unavailable locally. GitHub reported successful Vercel and Railway deployments for the original base commit `71c84944`; that is not proof for this candidate. Historical browser evidence in the earlier readiness reports remains historical; this review did not rerun those browser scenarios or certify a cold browser restart with the frontend host unavailable.

Evidence: `docs/evidence/deployment-readiness-2026-09-17/`.
