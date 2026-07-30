-- AlterTable
-- Idempotent on purpose. If this migration ever fails mid-transaction the
-- deploy script resolves it as rolled-back and replays it, so it has to be safe
-- against a database that already has the column. The plain ADD COLUMN form
-- left a permanently failed migration record, and `prisma migrate deploy` then
-- refuses to run anything (P3009) — which stops the container from booting at
-- all. 000052_purchase_returns is written the same way for the same reason.
ALTER TABLE "AuditFinding" ADD COLUMN IF NOT EXISTS "discrepancyPaise" BIGINT;

