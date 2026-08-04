-- Size × colour variants for clothing and footwear. See the SQLite twin at
-- prisma/migrations/20260804120000_product_variant_axes for the full rationale.
--
-- A variant is a ProductSellingUnit row tagged with its position on the parent's
-- declared axes, not a new table, so billing, scanning and stock need no new join.
--
-- @replay-safe: every column is additive and guarded, so an interrupted deploy
-- can replay this migration without error.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "variantAxesJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "ProductSellingUnit" ADD COLUMN IF NOT EXISTS "variantValue1" TEXT;
ALTER TABLE "ProductSellingUnit" ADD COLUMN IF NOT EXISTS "variantValue2" TEXT;

-- No new index on purpose: the existing ProductSellingUnit_shopId_productId_isActive_idx
-- already serves the grid load, and a grid is a few dozen rows at most.
