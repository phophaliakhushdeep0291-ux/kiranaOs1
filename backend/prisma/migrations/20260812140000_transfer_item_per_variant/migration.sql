-- Transfers that move a size, not an untyped lump of base units.
--
-- Sending stock between branches moved only the product-level allocation, so a
-- clothing shop could shift "four shirts" to a branch without saying which sizes
-- went. Once per-variant stock existed that stopped being merely vague and became
-- drift: the product-level row moved and the per-size rows stood still.
--
-- Mirrors StockLedger's pairing — sellingUnitId says which row, sellingUnitQty
-- says how many in that row's OWN counts (4 pairs, not 4000 g), while
-- quantityBaseQty stays the base-unit amount that drives tax and value.
ALTER TABLE "StockTransferItem" ADD COLUMN "sellingUnitId" TEXT
  REFERENCES "ProductSellingUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockTransferItem" ADD COLUMN "sellingUnitQty" REAL;

-- One line per product became one line per size, so the size joins the key.
DROP INDEX "StockTransferItem_transferId_productId_key";
CREATE UNIQUE INDEX "StockTransferItem_transferId_productId_sellingUnitId_key"
  ON "StockTransferItem"("transferId", "productId", "sellingUnitId");

-- NULLs are DISTINCT in a unique index, so the index above does NOT stop one
-- transfer carrying the same product twice as a product-level line. This partial
-- index is what actually keeps that unique, exactly as on LocationStock.
CREATE UNIQUE INDEX "StockTransferItem_transferId_productId_pooled_key"
  ON "StockTransferItem"("transferId", "productId") WHERE "sellingUnitId" IS NULL;

CREATE INDEX "StockTransferItem_sellingUnitId_idx" ON "StockTransferItem"("sellingUnitId");
