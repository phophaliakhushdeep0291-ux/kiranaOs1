ALTER TABLE "CustomerOrder" ADD COLUMN "locationId" TEXT;
ALTER TABLE "CustomerOrder" ADD COLUMN "fulfillmentType" TEXT NOT NULL DEFAULT 'delivery';
ALTER TABLE "CustomerOrder" ADD COLUMN "promisedSlot" TEXT;
ALTER TABLE "CustomerOrder" ADD COLUMN "acceptedAt" TIMESTAMP(3);
ALTER TABLE "CustomerOrder" ADD COLUMN "readyAt" TIMESTAMP(3);
ALTER TABLE "CustomerOrder" ADD COLUMN "fulfilledAt" TIMESTAMP(3);
ALTER TABLE "CustomerOrder" ADD COLUMN "rejectedAt" TIMESTAMP(3);
ALTER TABLE "CustomerOrder" ADD COLUMN "cancelledAt" TIMESTAMP(3);

UPDATE "CustomerOrder" AS orders
SET "locationId" = (
  SELECT "id" FROM "StoreLocation"
  WHERE "StoreLocation"."shopId" = orders."shopId"
  ORDER BY "isPrimary" DESC, "createdAt" ASC
  LIMIT 1
)
WHERE orders."locationId" IS NULL;

ALTER TABLE "CustomerOrder"
ADD CONSTRAINT "CustomerOrder_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "StoreLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CustomerOrder_shopId_locationId_status_createdAt_idx"
ON "CustomerOrder"("shopId", "locationId", "status", "createdAt");
