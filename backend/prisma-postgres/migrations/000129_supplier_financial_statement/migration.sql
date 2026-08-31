-- @replay-safe: the supporting index is guarded so an interrupted deployment
-- can replay without freezing Prisma migration recovery on a duplicate object.
CREATE INDEX IF NOT EXISTS "FinancialLedger_shopId_supplierId_businessDate_idx"
ON "FinancialLedger"("shopId", "supplierId", "businessDate");
