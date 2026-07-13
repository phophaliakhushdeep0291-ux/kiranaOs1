ALTER TABLE "Bill" ADD COLUMN "locationId" TEXT;
ALTER TABLE "StockLedger" ADD COLUMN "locationId" TEXT;
ALTER TABLE "PurchaseHistory" ADD COLUMN "locationId" TEXT;
ALTER TABLE "Expense" ADD COLUMN "locationId" TEXT;
ALTER TABLE "UdharLedger" ADD COLUMN "locationId" TEXT;

UPDATE "StoreLocation" location
SET "isPrimary" = TRUE, "active" = TRUE
WHERE location."id" IN (
  SELECT DISTINCT ON (candidate."shopId") candidate."id"
  FROM "StoreLocation" candidate
  WHERE NOT EXISTS (
    SELECT 1 FROM "StoreLocation" primary_location
    WHERE primary_location."shopId" = candidate."shopId" AND primary_location."isPrimary" = TRUE
  )
  ORDER BY candidate."shopId", candidate."createdAt", candidate."id"
);

INSERT INTO "StoreLocation" ("id", "shopId", "code", "name", "isPrimary", "active", "createdAt", "updatedAt")
SELECT 'loc_' || md5(random()::text || clock_timestamp()::text || shop."id"), shop."id", 'MAIN', 'Main Store', TRUE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Shop" shop
WHERE NOT EXISTS (SELECT 1 FROM "StoreLocation" location WHERE location."shopId" = shop."id");

UPDATE "Bill" AS target SET "locationId" = location."id" FROM "StoreLocation" location WHERE target."shopId" = location."shopId" AND location."isPrimary" = TRUE AND target."locationId" IS NULL;
UPDATE "StockLedger" AS target SET "locationId" = location."id" FROM "StoreLocation" location WHERE target."shopId" = location."shopId" AND location."isPrimary" = TRUE AND target."locationId" IS NULL;
UPDATE "PurchaseHistory" AS target SET "locationId" = location."id" FROM "StoreLocation" location WHERE target."shopId" = location."shopId" AND location."isPrimary" = TRUE AND target."locationId" IS NULL;
UPDATE "Expense" AS target SET "locationId" = location."id" FROM "StoreLocation" location WHERE target."shopId" = location."shopId" AND location."isPrimary" = TRUE AND target."locationId" IS NULL;
UPDATE "UdharLedger" AS target SET "locationId" = location."id" FROM "StoreLocation" location WHERE target."shopId" = location."shopId" AND location."isPrimary" = TRUE AND target."locationId" IS NULL;
UPDATE "DailyClosingSnapshot" AS target SET "storeId" = location."id" FROM "StoreLocation" location WHERE target."shopId" = location."shopId" AND location."isPrimary" = TRUE;

ALTER TABLE "Bill" ADD CONSTRAINT "Bill_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseHistory" ADD CONSTRAINT "PurchaseHistory_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UdharLedger" ADD CONSTRAINT "UdharLedger_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DailyClosingSnapshot" ADD CONSTRAINT "DailyClosingSnapshot_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "StoreLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Bill_shopId_locationId_status_createdAt_idx" ON "Bill"("shopId", "locationId", "status", "createdAt");
CREATE INDEX "StockLedger_shopId_locationId_createdAt_idx" ON "StockLedger"("shopId", "locationId", "createdAt");
CREATE INDEX "PurchaseHistory_shopId_locationId_createdAt_idx" ON "PurchaseHistory"("shopId", "locationId", "createdAt");
CREATE INDEX "Expense_shopId_locationId_spentAt_idx" ON "Expense"("shopId", "locationId", "spentAt");
CREATE INDEX "UdharLedger_shopId_locationId_createdAt_idx" ON "UdharLedger"("shopId", "locationId", "createdAt");

DROP INDEX "DailyClosingSnapshot_shopId_date_key";
CREATE UNIQUE INDEX "DailyClosingSnapshot_shopId_storeId_date_key" ON "DailyClosingSnapshot"("shopId", "storeId", "date");
CREATE INDEX "DailyClosingSnapshot_shopId_storeId_date_idx" ON "DailyClosingSnapshot"("shopId", "storeId", "date");
