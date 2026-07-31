-- @replay-safe: every statement below is idempotent (IF NOT EXISTS guards), so if
-- this migration fails mid-transaction the deploy script
-- (scripts/deploy-postgres-migrations.js) can mark it rolled-back and replay it
-- without double-applying. Keep it idempotent if you edit it.
ALTER TABLE "StockTransfer"
  ADD COLUMN IF NOT EXISTS "eWayReviewStatus" TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS "eWayBillNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "eWayBillDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "eWayReviewReason" TEXT,
  ADD COLUMN IF NOT EXISTS "eWayReviewedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "eWayReviewedByUserId" TEXT;

UPDATE "StockTransfer"
SET "eWayReviewStatus" = CASE
  WHEN "eWayReviewRequired" = true THEN 'pending'
  ELSE 'not_required'
END;

CREATE UNIQUE INDEX IF NOT EXISTS "StockTransfer_shopId_eWayBillNumber_key"
ON "StockTransfer"("shopId", "eWayBillNumber");
CREATE INDEX IF NOT EXISTS "StockTransfer_shopId_eWayReviewStatus_createdAt_idx"
ON "StockTransfer"("shopId", "eWayReviewStatus", "createdAt");
