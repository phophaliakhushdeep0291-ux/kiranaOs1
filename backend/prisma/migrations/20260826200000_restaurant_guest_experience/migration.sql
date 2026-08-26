ALTER TABLE "CustomerOrder" ADD COLUMN "feedbackRating" INTEGER;
ALTER TABLE "CustomerOrder" ADD COLUMN "feedbackComment" TEXT;
ALTER TABLE "CustomerOrder" ADD COLUMN "feedbackAt" DATETIME;

CREATE TABLE "RestaurantGuestRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "tableId" TEXT NOT NULL,
  "tableCode" TEXT NOT NULL,
  "tableName" TEXT NOT NULL,
  "orderId" TEXT,
  "type" TEXT NOT NULL,
  "reason" TEXT,
  "splitMode" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" DATETIME,
  "completedAt" DATETIME,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "RestaurantGuestRequest_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "RestaurantGuestRequest_shopId_status_requestedAt_idx" ON "RestaurantGuestRequest"("shopId", "status", "requestedAt");
CREATE INDEX "RestaurantGuestRequest_shopId_tableId_status_idx" ON "RestaurantGuestRequest"("shopId", "tableId", "status");
