-- Trade details on a product: the facts one shop type needs and no other has any
-- use for -- a chemist's salt, a garment shop's fabric, a parts shop's OEM
-- number, a book shop's ISBN. One bag of scalars rather than a hundred and
-- thirty mostly-empty columns. See the SQLite twin at
-- prisma/migrations/20260816120000_product_trade_attributes for the full
-- rationale and for where the line between this and a real column sits.
--
-- @replay-safe: the column is additive, guarded and defaulted, so an interrupted
-- deploy can replay this migration without error.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "attributesJson" TEXT NOT NULL DEFAULT '{}';
