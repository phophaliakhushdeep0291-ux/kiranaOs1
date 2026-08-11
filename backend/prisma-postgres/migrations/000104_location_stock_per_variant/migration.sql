-- Per-variant stock per location: "3 blue L at the main shop, 1 at the branch".
-- See the SQLite twin at prisma/migrations/20260812120000_location_stock_per_variant
-- for the full rationale.
--
-- A NULL sellingUnitId is the product-level row (what every existing row is), and
-- the PRIMARY location holds no row at all — its quantity is the product total
-- minus what the branches hold.
--
-- @replay-safe: every statement is guarded, so an interrupted deploy can replay
-- this migration without error.
ALTER TABLE "LocationStock" ADD COLUMN IF NOT EXISTS "sellingUnitId" TEXT;

DO $$
BEGIN
  ALTER TABLE "LocationStock"
    ADD CONSTRAINT "LocationStock_sellingUnitId_fkey"
    FOREIGN KEY ("sellingUnitId") REFERENCES "ProductSellingUnit"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- The old unique admitted one row per (location, product). A location may now hold
-- one row per variant as well, so the variant joins the key.
DROP INDEX IF EXISTS "LocationStock_locationId_productId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "LocationStock_locationId_productId_sellingUnitId_key"
  ON "LocationStock"("locationId", "productId", "sellingUnitId");

-- NULLs are DISTINCT in a unique index, so the index above does NOT stop two
-- product-level rows for the same location and the branch's stock would read
-- double. This partial index is what actually keeps the pooled row unique.
CREATE UNIQUE INDEX IF NOT EXISTS "LocationStock_locationId_productId_pooled_key"
  ON "LocationStock"("locationId", "productId") WHERE "sellingUnitId" IS NULL;

CREATE INDEX IF NOT EXISTS "LocationStock_shopId_sellingUnitId_idx"
  ON "LocationStock"("shopId", "sellingUnitId");
