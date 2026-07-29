ALTER TABLE "CustomerOrder"
  ADD COLUMN "sourceChannel" TEXT NOT NULL DEFAULT 'customer_portal',
  ADD COLUMN "externalOrderId" TEXT,
  ADD COLUMN "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid',
  ADD COLUMN "fulfillmentStatus" TEXT NOT NULL DEFAULT 'unfulfilled';

CREATE INDEX "CustomerOrder_shopId_sourceChannel_createdAt_idx"
ON "CustomerOrder"("shopId", "sourceChannel", "createdAt");
CREATE INDEX "CustomerOrder_shopId_fulfillmentStatus_createdAt_idx"
ON "CustomerOrder"("shopId", "fulfillmentStatus", "createdAt");
CREATE INDEX "CustomerOrder_shopId_paymentStatus_createdAt_idx"
ON "CustomerOrder"("shopId", "paymentStatus", "createdAt");