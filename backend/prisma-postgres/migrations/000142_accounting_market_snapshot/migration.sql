-- @replay-safe
-- All previously supported ledgers were INR/GST. Free-text profile labels are
-- deliberately not consulted; this adds identity, not currency conversion.
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "countryCode" TEXT NOT NULL DEFAULT 'IN';
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "currencyCode" TEXT NOT NULL DEFAULT 'INR';
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "accountingTimeZone" TEXT NOT NULL DEFAULT 'Asia/Kolkata';
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "taxRegime" TEXT NOT NULL DEFAULT 'GST';
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "countryCode" TEXT NOT NULL DEFAULT 'IN';
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "currencyCode" TEXT NOT NULL DEFAULT 'INR';
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "accountingTimeZone" TEXT NOT NULL DEFAULT 'Asia/Kolkata';
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "taxRegime" TEXT NOT NULL DEFAULT 'GST';
