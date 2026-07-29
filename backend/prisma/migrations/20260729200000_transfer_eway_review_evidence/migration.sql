ALTER TABLE "StockTransfer" ADD COLUMN "eWayReviewStatus" TEXT NOT NULL DEFAULT 'not_required';
ALTER TABLE "StockTransfer" ADD COLUMN "eWayBillNumber" TEXT;
ALTER TABLE "StockTransfer" ADD COLUMN "eWayBillDate" DATETIME;
ALTER TABLE "StockTransfer" ADD COLUMN "eWayReviewReason" TEXT;
ALTER TABLE "StockTransfer" ADD COLUMN "eWayReviewedAt" DATETIME;
ALTER TABLE "StockTransfer" ADD COLUMN "eWayReviewedByUserId" TEXT;

UPDATE "StockTransfer"
SET "eWayReviewStatus" = CASE
  WHEN "eWayReviewRequired" = 1 THEN 'pending'
  ELSE 'not_required'
END;

CREATE UNIQUE INDEX "StockTransfer_shopId_eWayBillNumber_key"
ON "StockTransfer"("shopId", "eWayBillNumber");
CREATE INDEX "StockTransfer_shopId_eWayReviewStatus_createdAt_idx"
ON "StockTransfer"("shopId", "eWayReviewStatus", "createdAt");