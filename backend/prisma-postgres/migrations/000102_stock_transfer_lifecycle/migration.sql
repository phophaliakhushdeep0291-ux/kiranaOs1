ALTER TABLE "StockTransfer" ADD COLUMN "fulfillmentMode" TEXT NOT NULL DEFAULT 'instant';
ALTER TABLE "StockTransfer" ADD COLUMN "approvedByUserId" TEXT;
ALTER TABLE "StockTransfer" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "StockTransfer" ADD COLUMN "dispatchedAt" TIMESTAMP(3);
ALTER TABLE "StockTransfer" ADD COLUMN "expectedArrivalDate" TIMESTAMP(3);
ALTER TABLE "StockTransfer" ADD COLUMN "carrierName" TEXT;
ALTER TABLE "StockTransfer" ADD COLUMN "trackingNumber" TEXT;
ALTER TABLE "StockTransfer" ADD COLUMN "receivedByUserId" TEXT;
ALTER TABLE "StockTransfer" ADD COLUMN "lastReceivedAt" TIMESTAMP(3);
ALTER TABLE "StockTransfer" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "StockTransfer" ADD COLUMN "cancelledByUserId" TEXT;
ALTER TABLE "StockTransfer" ADD COLUMN "cancelReason" TEXT;

ALTER TABLE "StockTransferItem" ADD COLUMN "receivedBaseQty" DOUBLE PRECISION NOT NULL DEFAULT 0;

UPDATE "StockTransferItem"
SET "receivedBaseQty" = "quantityBaseQty"
WHERE "transferId" IN (SELECT "id" FROM "StockTransfer" WHERE "status" = 'completed');

UPDATE "StockTransfer"
SET "approvedAt" = COALESCE("completedAt", "createdAt"),
    "dispatchedAt" = COALESCE("completedAt", "createdAt"),
    "lastReceivedAt" = COALESCE("completedAt", "createdAt")
WHERE "status" = 'completed';
