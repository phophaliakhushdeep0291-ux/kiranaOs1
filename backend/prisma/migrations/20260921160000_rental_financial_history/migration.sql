-- Preserve legacy money as unclassified; new bookings opt into dated accounting.
ALTER TABLE "RentalBooking" ADD COLUMN "financialVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RentalBooking" ADD COLUMN "locationId" TEXT;
ALTER TABLE "RentalBooking" ADD COLUMN "clientRequestId" TEXT;
ALTER TABLE "RentalBooking" ADD COLUMN "depositRefunded" DOUBLE PRECISION NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "RentalBooking_shopId_clientRequestId_key" ON "RentalBooking"("shopId", "clientRequestId");
CREATE INDEX "RentalBooking_shopId_locationId_idx" ON "RentalBooking"("shopId", "locationId");
