-- @replay-safe: both additive columns are guarded, so interrupted deploys can replay.
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "dataEpoch" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "dataEpoch" INTEGER NOT NULL DEFAULT 0;
