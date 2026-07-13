ALTER TABLE "CustomerOrder" ADD COLUMN "locationId" TEXT;
ALTER TABLE "CustomerOrder" ADD COLUMN "fulfillmentType" TEXT NOT NULL DEFAULT 'delivery';
ALTER TABLE "CustomerOrder" ADD COLUMN "promisedSlot" TEXT;
ALTER TABLE "CustomerOrder" ADD COLUMN "acceptedAt" DATETIME;
ALTER TABLE "CustomerOrder" ADD COLUMN "readyAt" DATETIME;
ALTER TABLE "CustomerOrder" ADD COLUMN "fulfilledAt" DATETIME;
ALTER TABLE "CustomerOrder" ADD COLUMN "rejectedAt" DATETIME;
ALTER TABLE "CustomerOrder" ADD COLUMN "cancelledAt" DATETIME;

UPDATE "CustomerOrder"
SET "locationId" = (
  SELECT "id" FROM "StoreLocation"
  WHERE "StoreLocation"."shopId" = "CustomerOrder"."shopId"
  ORDER BY "isPrimary" DESC, "createdAt" ASC
  LIMIT 1
)
WHERE "locationId" IS NULL;

CREATE INDEX "CustomerOrder_shopId_locationId_status_createdAt_idx"
ON "CustomerOrder"("shopId", "locationId", "status", "createdAt");
