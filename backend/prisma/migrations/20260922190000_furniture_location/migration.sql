-- @replay-safe
-- Existing orders belong to the primary location until explicitly repaired.
ALTER TABLE "FurnitureOrder" ADD COLUMN "locationId" TEXT;
CREATE INDEX IF NOT EXISTS "FurnitureOrder_shopId_locationId_idx" ON "FurnitureOrder"("shopId", "locationId");
