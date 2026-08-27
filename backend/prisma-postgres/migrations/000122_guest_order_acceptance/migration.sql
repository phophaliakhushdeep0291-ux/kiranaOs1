-- @replay-safe: this additive column is guarded so an interrupted deployment
-- can replay without trying to add the same column twice.
ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "acceptanceKey" TEXT;
