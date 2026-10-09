-- @replay-safe
-- A shop binds to one accounting company; existing send history is retained.
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "tallyCompanyGuid" TEXT;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "tallyCompanyName" TEXT;
