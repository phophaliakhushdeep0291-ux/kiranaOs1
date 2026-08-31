-- Server-authenticated immutable creator attribution for new expenses.
-- Legacy rows stay null rather than guessing identity from a non-unique display name.
ALTER TABLE "Expense" ADD COLUMN "recordedByUserId" TEXT;
ALTER TABLE "Expense" ADD COLUMN "recordedByRole" TEXT;
CREATE INDEX "Expense_shopId_recordedByUserId_spentAt_idx" ON "Expense"("shopId", "recordedByUserId", "spentAt");
