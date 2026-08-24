ALTER TABLE "StockLedger" ADD COLUMN "actorUserId" TEXT;
ALTER TABLE "StockLedger" ADD COLUMN "actorName" TEXT;

CREATE INDEX "StockLedger_shopId_actorUserId_createdAt_idx"
ON "StockLedger"("shopId", "actorUserId", "createdAt");
