ALTER TABLE "Expense" ADD COLUMN "amountPaise" BIGINT;
ALTER TABLE "Expense" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "Expense" ADD COLUMN "clientExpenseId" TEXT;
ALTER TABLE "Expense" ADD COLUMN "sourceDeviceId" TEXT;

UPDATE "Expense"
SET "amountPaise" = ROUND("amount"::numeric * 100)::bigint
WHERE "amountPaise" IS NULL;

CREATE UNIQUE INDEX "Expense_shopId_idempotencyKey_key"
ON "Expense"("shopId", "idempotencyKey");

CREATE UNIQUE INDEX "Expense_shopId_sourceDeviceId_clientExpenseId_key"
ON "Expense"("shopId", "sourceDeviceId", "clientExpenseId");
