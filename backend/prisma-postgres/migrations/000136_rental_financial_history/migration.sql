-- @replay-safe
-- Preserve legacy money as unclassified; new bookings opt into dated accounting.
ALTER TABLE "RentalBooking" ADD COLUMN IF NOT EXISTS "financialVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RentalBooking" ADD COLUMN IF NOT EXISTS "locationId" TEXT;
ALTER TABLE "RentalBooking" ADD COLUMN IF NOT EXISTS "clientRequestId" TEXT;
ALTER TABLE "RentalBooking" ADD COLUMN IF NOT EXISTS "depositRefunded" DOUBLE PRECISION NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS "RentalBooking_shopId_clientRequestId_key" ON "RentalBooking"("shopId", "clientRequestId");
CREATE INDEX IF NOT EXISTS "RentalBooking_shopId_locationId_idx" ON "RentalBooking"("shopId", "locationId");
