-- Expense gains vendor/payee, paid|pending status, recurring schedule and recorded-by
ALTER TABLE "Expense" ADD COLUMN "vendor" TEXT;
ALTER TABLE "Expense" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'paid';
ALTER TABLE "Expense" ADD COLUMN "recurringInterval" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "Expense" ADD COLUMN "nextDueOn" DATETIME;
ALTER TABLE "Expense" ADD COLUMN "recordedBy" TEXT;
