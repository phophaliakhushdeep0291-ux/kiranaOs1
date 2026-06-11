-- Expense gains vendor/payee, paid|pending status, recurring schedule and recorded-by
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "vendor" TEXT;
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'paid';
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "recurringInterval" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "nextDueOn" TIMESTAMP(3);
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "recordedBy" TEXT;
