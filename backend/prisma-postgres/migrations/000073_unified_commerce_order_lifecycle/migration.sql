-- @replay-safe: every statement below is idempotent (IF NOT EXISTS guards), so if
-- this migration fails mid-transaction the deploy script
-- (scripts/deploy-postgres-migrations.js) can mark it rolled-back and replay it
-- without double-applying. Keep it idempotent if you edit it.
ALTER TABLE "CustomerOrder"
  ADD COLUMN IF NOT EXISTS "sourceChannel" TEXT NOT NULL DEFAULT 'customer_portal',
  ADD COLUMN IF NOT EXISTS "externalOrderId" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS "fulfillmentStatus" TEXT NOT NULL DEFAULT 'unfulfilled';

CREATE INDEX IF NOT EXISTS "CustomerOrder_shopId_sourceChannel_createdAt_idx"
ON "CustomerOrder"("shopId", "sourceChannel", "createdAt");
CREATE INDEX IF NOT EXISTS "CustomerOrder_shopId_fulfillmentStatus_createdAt_idx"
ON "CustomerOrder"("shopId", "fulfillmentStatus", "createdAt");
CREATE INDEX IF NOT EXISTS "CustomerOrder_shopId_paymentStatus_createdAt_idx"
ON "CustomerOrder"("shopId", "paymentStatus", "createdAt");
