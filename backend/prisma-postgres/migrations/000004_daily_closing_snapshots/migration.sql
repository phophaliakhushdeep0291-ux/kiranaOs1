-- Phase 12: cashier attribution + persisted daily closing snapshots.
-- Cashier attribution is nullable so legacy bills and offline imports remain valid.
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "deviceId" TEXT;

CREATE INDEX IF NOT EXISTS "Bill_shopId_createdByUserId_createdAt_idx" ON "Bill"("shopId", "createdByUserId", "createdAt");

CREATE TABLE "DailyClosingSnapshot" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "storeId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "totalSalesPaise" INTEGER NOT NULL DEFAULT 0,
    "cashReceivedPaise" INTEGER NOT NULL DEFAULT 0,
    "upiReceivedPaise" INTEGER NOT NULL DEFAULT 0,
    "udharGivenPaise" INTEGER NOT NULL DEFAULT 0,
    "oldUdharRecoveredPaise" INTEGER NOT NULL DEFAULT 0,
    "expectedCashPaise" INTEGER NOT NULL DEFAULT 0,
    "totalBills" INTEGER NOT NULL DEFAULT 0,
    "cancelledBills" INTEGER NOT NULL DEFAULT 0,
    "roughBills" INTEGER NOT NULL DEFAULT 0,
    "pendingSyncCount" INTEGER NOT NULL DEFAULT 0,
    "topProductsJson" TEXT NOT NULL DEFAULT '[]',
    "lowStockJson" TEXT NOT NULL DEFAULT '[]',
    "generatedByUserId" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedByUserId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'live',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyClosingSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DailyClosingSnapshot_shopId_date_key" ON "DailyClosingSnapshot"("shopId", "date");
CREATE INDEX IF NOT EXISTS "DailyClosingSnapshot_shopId_date_idx" ON "DailyClosingSnapshot"("shopId", "date");
CREATE INDEX IF NOT EXISTS "DailyClosingSnapshot_shopId_lockedAt_idx" ON "DailyClosingSnapshot"("shopId", "lockedAt");

ALTER TABLE "DailyClosingSnapshot" ADD CONSTRAINT "DailyClosingSnapshot_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
