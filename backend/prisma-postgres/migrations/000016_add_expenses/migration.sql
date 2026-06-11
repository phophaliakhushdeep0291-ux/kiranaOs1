-- CreateTable
CREATE TABLE IF NOT EXISTS "Expense" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "category" TEXT NOT NULL DEFAULT 'general',
    "paymentMode" TEXT NOT NULL DEFAULT 'cash',
    "notes" TEXT,
    "spentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Expense_shopId_idx" ON "Expense"("shopId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Expense_shopId_deletedAt_idx" ON "Expense"("shopId", "deletedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Expense_shopId_spentAt_idx" ON "Expense"("shopId", "spentAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Expense_shopId_updatedAt_id_idx" ON "Expense"("shopId", "updatedAt", "id");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Expense" ADD CONSTRAINT "Expense_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
