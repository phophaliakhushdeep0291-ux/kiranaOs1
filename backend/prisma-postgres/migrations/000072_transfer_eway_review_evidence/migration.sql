ALTER TABLE "StockTransfer"
  ADD COLUMN "eWayReviewStatus" TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN "eWayBillNumber" TEXT,
  ADD COLUMN "eWayBillDate" TIMESTAMP(3),
  ADD COLUMN "eWayReviewReason" TEXT,
  ADD COLUMN "eWayReviewedAt" TIMESTAMP(3),
  ADD COLUMN "eWayReviewedByUserId" TEXT;

UPDATE "StockTransfer"
SET "eWayReviewStatus" = CASE
  WHEN "eWayReviewRequired" = true THEN 'pending'
  ELSE 'not_required'
END;

CREATE UNIQUE INDEX "StockTransfer_shopId_eWayBillNumber_key"
ON "StockTransfer"("shopId", "eWayBillNumber");
CREATE INDEX "StockTransfer_shopId_eWayReviewStatus_createdAt_idx"
ON "StockTransfer"("shopId", "eWayReviewStatus", "createdAt");