-- @replay-safe
-- Tax registration and invoice snapshots for the opt-in UAE cash pilot.
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "vatRegistered" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "taxRegistrationNumber" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "taxRegistrationNumber" TEXT;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "sellerTaxRegistrationNumber" TEXT;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "buyerTaxRegistrationNumber" TEXT;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "taxDocumentType" TEXT;
ALTER TABLE "BillItem" ADD COLUMN IF NOT EXISTS "taxCategory" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "taxCategory" TEXT;
