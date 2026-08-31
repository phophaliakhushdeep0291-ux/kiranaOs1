-- @replay-safe: nullable attribution columns preserve legacy rows without inventing an actor.
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "recordedByUserId" TEXT;
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "recordedByRole" TEXT;
CREATE INDEX IF NOT EXISTS "Expense_shopId_recordedByUserId_spentAt_idx" ON "Expense"("shopId", "recordedByUserId", "spentAt");
