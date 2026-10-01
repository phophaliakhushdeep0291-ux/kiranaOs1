-- @replay-safe
-- Legacy rows remain version 0: historical cash/deposits require owner reconciliation.
ALTER TABLE "RentalBooking" ADD COLUMN "financialVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RentalBooking" ADD COLUMN "locationId" TEXT;
ALTER TABLE "RentalBooking" ADD COLUMN "clientRequestId" TEXT;
ALTER TABLE "RentalBooking" ADD COLUMN "depositRefunded" REAL NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS "RentalBooking_shopId_clientRequestId_key" ON "RentalBooking"("shopId", "clientRequestId");
CREATE INDEX IF NOT EXISTS "RentalBooking_shopId_locationId_idx" ON "RentalBooking"("shopId", "locationId");
