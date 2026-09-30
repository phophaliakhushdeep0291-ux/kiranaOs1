-- @replay-safe
ALTER TABLE "BillItem" ADD COLUMN IF NOT EXISTS "trackedUnitId" TEXT;
