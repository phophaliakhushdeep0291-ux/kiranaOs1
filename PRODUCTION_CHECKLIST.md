# Production Checklist

Status: Mandatory pre-release checklist  
Last updated: 2026-07-16

Complete this checklist for staging and production. Record commands, artifact URLs, operator and timestamp in the release record; do not mark items from memory.

## Scope and traceability

- [ ] Release commit/tag and deployment targets are recorded.
- [ ] Changed behavior cites `PRODUCT_REQUIREMENTS.md` IDs.
- [ ] Each changed requirement links automated tests and QA flows.
- [ ] `BUG_BACKLOG.md` has no open P0 and no release-blocking P1.
- [ ] Database, feature flags, worker and hardware impacts are documented.
- [ ] Unrelated or experimental code is excluded from release scope.

## Reproducible build and automated gate

- [ ] Supported Node version is installed (frontend requires Node 20+).
- [ ] Frontend install uses `pnpm install --frozen-lockfile`.
- [ ] Frontend `pnpm run prod:check` passes.
- [ ] Backend `npm ci` and `npm test` pass.
- [ ] Backend `npm run prod:check` passes.
- [ ] Backend integration tests pass against an isolated database.
- [ ] `npm run migration:safety` passes in `backend`.
- [ ] `npm run release:gate` passes in `backend`.
- [ ] CI release certification is green for the exact commit.

## Migration and data safety

- [ ] SQLite/dev and PostgreSQL schemas are intentionally aligned where required.
- [ ] Production migrations are reviewed for destructive/locking operations.
- [ ] A fresh database migrates and boots successfully.
- [ ] A production-like snapshot migrates successfully with row-count/reconciliation checks.
- [ ] Backup exists before deployment; restore proof is recent and accessible.
- [ ] Rollback behavior is documented, including compatibility with applied migrations.
- [ ] Money, stock, udhar and supplier-ledger reconciliation checks are green.

## Security and privacy

- [ ] Production secret validation rejects placeholders and weak values.
- [ ] No secrets, customer exports, databases or logs with personal data are committed.
- [ ] Tenant isolation, RBAC, owner PIN, session/device limits and rate-limit tests pass.
- [ ] CORS, HTTPS, cookie/token behavior and security headers are verified on staging.
- [ ] Logs redact credentials, tokens and customer-sensitive payloads.
- [ ] Export, backup and object-storage access is least-privileged and expiring where appropriate.

## Core business proofs

- [ ] Cash, split-payment, udhar and GST/estimate bills reconcile to integer paise.
- [ ] Cancel/refund/return reverses bill, stock, payment and ledger exactly once.
- [ ] Purchase receipt changes stock and supplier due exactly once.
- [ ] Offline bill survives reload/restart and syncs once after reconnection.
- [ ] Two-device concurrency test produces no duplicate bill/payment/stock effect.
- [ ] Daily closing matches cash, bank/UPI, udhar and refund activity.
- [ ] GST report matches sampled invoices for configured modes.

## Mobile live QA

- [ ] MQA-BILL-01 passes at 375, 390, 430 and 768 widths.
- [ ] MQA-PROD-01 and MQA-CUST-01 pass at all target widths.
- [ ] MQA-INV-01 and MQA-PUR-01 pass at all target widths.
- [ ] MQA-RPT-01, MQA-SET-01 and MQA-SYNC-01 pass at all target widths.
- [ ] No horizontal scroll, hidden action, bottom-nav overlap or sub-44px primary control remains.
- [ ] Screenshot artifacts correspond to the release commit.

## External systems and operations

- [ ] API health, worker health, queues, Redis, database, storage and email are verified.
- [ ] Razorpay webhook signature, retry and reconciliation pass in target environment when enabled.
- [ ] Certified printer/scanner/payment devices pass the applicable hardware checklist.
- [ ] Alerts exist for API errors, queue lag, webhook failure, backup failure and sync failure rate.
- [ ] Dashboards/runbooks identify the on-call owner and escalation path.
- [ ] Customer support can identify a bill/sync/print incident without exposing secrets.

## Deployment and aftercare

- [ ] Maintenance/risk communication is approved if required.
- [ ] Backup timestamp and rollback owner are recorded immediately before deploy.
- [ ] Migrations finish before incompatible application traffic is served.
- [ ] Staging smoke and production smoke pass using non-destructive test data.
- [ ] Error, latency, sync, payment and worker metrics are watched for the agreed window.
- [ ] Release notes list changes, proof, known risks and rollback trigger.
- [ ] Go/no-go sign-off is recorded in `RELEASE_GATE.md`.
