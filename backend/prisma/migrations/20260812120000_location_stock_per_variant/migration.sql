-- Per-variant stock per location: "3 blue L at the main shop, 1 at the branch".
--
-- Until now a variant's count (ProductSellingUnit.onHandQty) was a single global
-- number, so a two-branch clothing shop could say how many L-Blue shirts it owned
-- but not where any of them were.
--
-- The shape mirrors base units exactly, so there is one rule to learn rather than
-- two: a NULL sellingUnitId is the product-level row (what every existing row is,
-- and what every pooled product keeps using), and the PRIMARY location holds no
-- row at all — its quantity is the product total minus what the branches hold.
ALTER TABLE "LocationStock" ADD COLUMN "sellingUnitId" TEXT
  REFERENCES "ProductSellingUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The old unique admitted one row per (location, product). A location may now
-- hold one row per variant as well, so the variant joins the key.
DROP INDEX "LocationStock_locationId_productId_key";
CREATE UNIQUE INDEX "LocationStock_locationId_productId_sellingUnitId_key"
  ON "LocationStock"("locationId", "productId", "sellingUnitId");

-- NULLs are DISTINCT in a unique index, so the index above does NOT stop two
-- product-level rows for the same location — it would happily hold both and the
-- branch's stock would read double. This partial index is what actually keeps the
-- pooled row unique, and it is the reason the column can stay nullable with a real
-- foreign key instead of resorting to a sentinel value.
CREATE UNIQUE INDEX "LocationStock_locationId_productId_pooled_key"
  ON "LocationStock"("locationId", "productId") WHERE "sellingUnitId" IS NULL;

-- "Where are the L-Blue shirts?" — the read behind the per-variant location view.
CREATE INDEX "LocationStock_shopId_sellingUnitId_idx" ON "LocationStock"("shopId", "sellingUnitId");
