ALTER TABLE "Bill" ADD COLUMN "businessDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "Bill"
SET "businessDate" = "createdAt";

CREATE INDEX "Bill_shopId_businessDate_idx"
ON "Bill"("shopId", "businessDate");

CREATE INDEX "Bill_shopId_status_businessDate_idx"
ON "Bill"("shopId", "status", "businessDate");

CREATE INDEX "Bill_shopId_locationId_status_businessDate_idx"
ON "Bill"("shopId", "locationId", "status", "businessDate");

ALTER TABLE "UdharLedger" ADD COLUMN "businessDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "UdharLedger"
SET "businessDate" = "createdAt";

CREATE INDEX "UdharLedger_shopId_customerId_businessDate_idx"
ON "UdharLedger"("shopId", "customerId", "businessDate");

CREATE INDEX "UdharLedger_shopId_locationId_businessDate_idx"
ON "UdharLedger"("shopId", "locationId", "businessDate");
