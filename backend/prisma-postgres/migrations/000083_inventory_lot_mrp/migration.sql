-- Per-batch MRP, so a medicine is capped against the strip in hand. See the
-- SQLite twin at prisma/migrations/20260804180000_inventory_lot_mrp for the full
-- rationale.
--
-- A manufacturer revises the printed price between batches, so the same product
-- sits on the shelf at two MRPs. Billing capped every line against Product.mrp
-- regardless of which batch FEFO dispensed; this lets the batch carry its own
-- ceiling. Nullable, so an untouched lot resolves to Product.mrp exactly as
-- before.
--
-- @replay-safe: both columns are additive and guarded, so an interrupted deploy
-- can replay this migration without error.
ALTER TABLE "InventoryLot" ADD COLUMN IF NOT EXISTS "mrp" DOUBLE PRECISION;
ALTER TABLE "InventoryLot" ADD COLUMN IF NOT EXISTS "mrpPaise" BIGINT;
