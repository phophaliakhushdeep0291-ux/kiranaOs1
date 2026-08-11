-- Transfers that move a size, not an untyped lump of base units. See the SQLite
-- twin at prisma/migrations/20260812140000_transfer_item_per_variant.
--
-- sellingUnitId says which row, sellingUnitQty says how many in that row's OWN
-- counts, while quantityBaseQty stays the base-unit amount driving tax and value.
--
-- @replay-safe: every statement is guarded, so an interrupted deploy can replay
-- this migration without error.
ALTER TABLE "StockTransferItem" ADD COLUMN IF NOT EXISTS "sellingUnitId" TEXT;
ALTER TABLE "StockTransferItem" ADD COLUMN IF NOT EXISTS "sellingUnitQty" DOUBLE PRECISION;

DO $$
BEGIN
  ALTER TABLE "StockTransferItem"
    ADD CONSTRAINT "StockTransferItem_sellingUnitId_fkey"
    FOREIGN KEY ("sellingUnitId") REFERENCES "ProductSellingUnit"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- One line per product became one line per size, so the size joins the key.
DROP INDEX IF EXISTS "StockTransferItem_transferId_productId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "StockTransferItem_transferId_productId_sellingUnitId_key"
  ON "StockTransferItem"("transferId", "productId", "sellingUnitId");

-- NULLs are DISTINCT in a unique index, so the index above does NOT stop one
-- transfer carrying the same product twice as a product-level line.
CREATE UNIQUE INDEX IF NOT EXISTS "StockTransferItem_transferId_productId_pooled_key"
  ON "StockTransferItem"("transferId", "productId") WHERE "sellingUnitId" IS NULL;

CREATE INDEX IF NOT EXISTS "StockTransferItem_sellingUnitId_idx"
  ON "StockTransferItem"("sellingUnitId");
