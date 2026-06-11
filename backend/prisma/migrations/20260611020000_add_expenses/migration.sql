-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount" REAL NOT NULL DEFAULT 0,
    "category" TEXT NOT NULL DEFAULT 'general',
    "paymentMode" TEXT NOT NULL DEFAULT 'cash',
    "notes" TEXT,
    "spentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Expense_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Expense_shopId_idx" ON "Expense"("shopId");

-- CreateIndex
CREATE INDEX "Expense_shopId_deletedAt_idx" ON "Expense"("shopId", "deletedAt");

-- CreateIndex
CREATE INDEX "Expense_shopId_spentAt_idx" ON "Expense"("shopId", "spentAt");

-- CreateIndex
CREATE INDEX "Expense_shopId_updatedAt_id_idx" ON "Expense"("shopId", "updatedAt", "id");
