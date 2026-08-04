-- Size × colour variants for clothing and footwear.
--
-- A variant is a ProductSellingUnit row tagged with its position on the parent's
-- declared axes, not a new table: that row already owns a barcode, a price and
-- its own onHandQty, so billing, scanning and stock keep working with no new
-- join. What it replaces is the shopkeeper hand-typing one Product per size and
-- colour — twenty near-identical rows for one shirt, twenty unrelated lines in
-- every report, and no way to see that L-blue is out while XS sits dead.
--
-- Both columns on ProductSellingUnit are nullable and the Product column carries
-- a DEFAULT, so every existing row reads as "ordinary product" without a backfill.
ALTER TABLE "Product" ADD COLUMN "variantAxesJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "ProductSellingUnit" ADD COLUMN "variantValue1" TEXT;
ALTER TABLE "ProductSellingUnit" ADD COLUMN "variantValue2" TEXT;

-- No new index on purpose. Loading a product's grid is served by the existing
-- ProductSellingUnit_shopId_productId_isActive_idx, and a grid is a few dozen
-- rows at most. Cross-product reporting ("sales by size") runs through BillItem,
-- not this table.
