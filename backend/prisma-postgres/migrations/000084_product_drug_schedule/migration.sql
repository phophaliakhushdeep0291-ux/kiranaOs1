-- Which drug schedule a medicine falls under, so a Schedule H sale can be
-- refused without a prescription instead of merely recorded next to one. See the
-- SQLite twin at prisma/migrations/20260804233000_product_drug_schedule for the
-- full rationale.
--
-- Values: h | h1 | x | otc. Null means "not a scheduled drug" — every product in
-- every non-pharmacy shop, and every medicine nobody has classified yet. That is
-- what makes this additive: an unclassified catalogue behaves exactly as before,
-- and a shop opts in one product at a time by marking it.
--
-- @replay-safe: the column and the index are both additive and guarded, so an
-- interrupted deploy can replay this migration without error.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "drugSchedule" TEXT;

CREATE INDEX IF NOT EXISTS "Product_shopId_drugSchedule_idx" ON "Product"("shopId", "drugSchedule");
