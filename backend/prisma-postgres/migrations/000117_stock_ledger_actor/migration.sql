-- @replay-safe: immutable actor attribution is additive and every statement
-- is guarded so an interrupted deploy can safely resume.
ALTER TABLE "StockLedger" ADD COLUMN IF NOT EXISTS "actorUserId" TEXT;
ALTER TABLE "StockLedger" ADD COLUMN IF NOT EXISTS "actorName" TEXT;

CREATE INDEX IF NOT EXISTS "StockLedger_shopId_actorUserId_createdAt_idx"
ON "StockLedger"("shopId", "actorUserId", "createdAt");
