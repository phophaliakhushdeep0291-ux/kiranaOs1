-- @replay-safe
ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "feedbackRating" INTEGER;
ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "feedbackComment" TEXT;
ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "feedbackAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "RestaurantGuestRequest" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "tableId" TEXT NOT NULL,
  "tableCode" TEXT NOT NULL,
  "tableName" TEXT NOT NULL,
  "orderId" TEXT,
  "type" TEXT NOT NULL,
  "reason" TEXT,
  "splitMode" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RestaurantGuestRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RestaurantGuestRequest_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "RestaurantGuestRequest_shopId_status_requestedAt_idx" ON "RestaurantGuestRequest"("shopId", "status", "requestedAt");
CREATE INDEX IF NOT EXISTS "RestaurantGuestRequest_shopId_tableId_status_idx" ON "RestaurantGuestRequest"("shopId", "tableId", "status");
