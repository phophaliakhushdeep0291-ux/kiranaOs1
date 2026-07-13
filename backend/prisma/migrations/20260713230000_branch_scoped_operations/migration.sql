ALTER TABLE "Bill" ADD COLUMN "locationId" TEXT REFERENCES "StoreLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockLedger" ADD COLUMN "locationId" TEXT REFERENCES "StoreLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseHistory" ADD COLUMN "locationId" TEXT REFERENCES "StoreLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD COLUMN "locationId" TEXT REFERENCES "StoreLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UdharLedger" ADD COLUMN "locationId" TEXT REFERENCES "StoreLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Every legacy tenant gets one durable primary branch. Reuse its earliest
-- existing location when possible; otherwise create a deterministic migration
-- location. Existing operational records are then owned by that branch.
UPDATE "StoreLocation"
SET "isPrimary" = 1, "active" = 1
WHERE "id" IN (
  SELECT MIN(location."id")
  FROM "StoreLocation" location
  GROUP BY location."shopId"
  HAVING SUM(CASE WHEN location."isPrimary" = 1 THEN 1 ELSE 0 END) = 0
);

INSERT INTO "StoreLocation" ("id", "shopId", "code", "name", "isPrimary", "active", "createdAt", "updatedAt")
SELECT 'loc_' || lower(hex(randomblob(12))), shop."id", 'MAIN', 'Main Store', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Shop" shop
WHERE NOT EXISTS (SELECT 1 FROM "StoreLocation" location WHERE location."shopId" = shop."id");

UPDATE "Bill" SET "locationId" = (SELECT "id" FROM "StoreLocation" WHERE "shopId" = "Bill"."shopId" AND "isPrimary" = 1 LIMIT 1) WHERE "locationId" IS NULL;
UPDATE "StockLedger" SET "locationId" = (SELECT "id" FROM "StoreLocation" WHERE "shopId" = "StockLedger"."shopId" AND "isPrimary" = 1 LIMIT 1) WHERE "locationId" IS NULL;
UPDATE "PurchaseHistory" SET "locationId" = (SELECT "id" FROM "StoreLocation" WHERE "shopId" = "PurchaseHistory"."shopId" AND "isPrimary" = 1 LIMIT 1) WHERE "locationId" IS NULL;
UPDATE "Expense" SET "locationId" = (SELECT "id" FROM "StoreLocation" WHERE "shopId" = "Expense"."shopId" AND "isPrimary" = 1 LIMIT 1) WHERE "locationId" IS NULL;
UPDATE "UdharLedger" SET "locationId" = (SELECT "id" FROM "StoreLocation" WHERE "shopId" = "UdharLedger"."shopId" AND "isPrimary" = 1 LIMIT 1) WHERE "locationId" IS NULL;
UPDATE "DailyClosingSnapshot" SET "storeId" = (SELECT "id" FROM "StoreLocation" WHERE "shopId" = "DailyClosingSnapshot"."shopId" AND "isPrimary" = 1 LIMIT 1);

CREATE INDEX "Bill_shopId_locationId_status_createdAt_idx" ON "Bill"("shopId", "locationId", "status", "createdAt");
CREATE INDEX "StockLedger_shopId_locationId_createdAt_idx" ON "StockLedger"("shopId", "locationId", "createdAt");
CREATE INDEX "PurchaseHistory_shopId_locationId_createdAt_idx" ON "PurchaseHistory"("shopId", "locationId", "createdAt");
CREATE INDEX "Expense_shopId_locationId_spentAt_idx" ON "Expense"("shopId", "locationId", "spentAt");
CREATE INDEX "UdharLedger_shopId_locationId_createdAt_idx" ON "UdharLedger"("shopId", "locationId", "createdAt");

DROP INDEX "DailyClosingSnapshot_shopId_date_key";
CREATE UNIQUE INDEX "DailyClosingSnapshot_shopId_storeId_date_key" ON "DailyClosingSnapshot"("shopId", "storeId", "date");
CREATE INDEX "DailyClosingSnapshot_shopId_storeId_date_idx" ON "DailyClosingSnapshot"("shopId", "storeId", "date");
