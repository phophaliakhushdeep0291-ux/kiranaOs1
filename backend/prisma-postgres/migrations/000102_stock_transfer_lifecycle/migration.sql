-- @replay-safe: every added column is guarded and both backfills are idempotent.
ALTER TABLE "StockTransfer" ADD COLUMN IF NOT EXISTS "fulfillmentMode" TEXT NOT NULL DEFAULT 'instant';
ALTER TABLE "StockTransfer" ADD COLUMN IF NOT EXISTS "approvedByUserId" TEXT;
ALTER TABLE "StockTransfer" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "StockTransfer" ADD COLUMN IF NOT EXISTS "dispatchedAt" TIMESTAMP(3);
ALTER TABLE "StockTransfer" ADD COLUMN IF NOT EXISTS "expectedArrivalDate" TIMESTAMP(3);
ALTER TABLE "StockTransfer" ADD COLUMN IF NOT EXISTS "carrierName" TEXT;
ALTER TABLE "StockTransfer" ADD COLUMN IF NOT EXISTS "trackingNumber" TEXT;
ALTER TABLE "StockTransfer" ADD COLUMN IF NOT EXISTS "receivedByUserId" TEXT;
ALTER TABLE "StockTransfer" ADD COLUMN IF NOT EXISTS "lastReceivedAt" TIMESTAMP(3);
ALTER TABLE "StockTransfer" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);
ALTER TABLE "StockTransfer" ADD COLUMN IF NOT EXISTS "cancelledByUserId" TEXT;
ALTER TABLE "StockTransfer" ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;

ALTER TABLE "StockTransferItem" ADD COLUMN IF NOT EXISTS "receivedBaseQty" DOUBLE PRECISION NOT NULL DEFAULT 0;

UPDATE "StockTransferItem"
SET "receivedBaseQty" = "quantityBaseQty"
WHERE "transferId" IN (SELECT "id" FROM "StockTransfer" WHERE "status" = 'completed');

UPDATE "StockTransfer"
SET "approvedAt" = COALESCE("completedAt", "createdAt"),
    "dispatchedAt" = COALESCE("completedAt", "createdAt"),
    "lastReceivedAt" = COALESCE("completedAt", "createdAt")
WHERE "status" = 'completed';
