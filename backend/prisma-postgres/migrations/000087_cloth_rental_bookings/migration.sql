-- Cloth rental bookings — the PostgreSQL twin of
-- prisma/migrations/20260803163000_cloth_rental_bookings.
--
-- The clothing pack shipped with these two models declared in
-- prisma-postgres/schema.prisma but with no migration behind them, so every
-- /api/rentals call failed against the production database with
-- "relation RentalBooking does not exist" while passing locally on SQLite.
-- This migration is that missing half.
--
-- A booking holds stock without moving it: availability for a window is the
-- owned count minus the qty held by active bookings overlapping that window.
--
-- @replay-safe: every object is created IF NOT EXISTS and every constraint is
-- guarded, so an interrupted deploy can replay this migration without error.

CREATE TABLE IF NOT EXISTS "RentalBooking" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "bookingNumber" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerAddress" TEXT NOT NULL DEFAULT '',
    "idProofType" TEXT,
    "idProofNumber" TEXT,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "returnedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'booked',
    "rentAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "depositAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "advancePaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lateFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "damageCharge" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RentalBooking_pkey" PRIMARY KEY ("id")
);

-- productId is intentionally not a foreign key: the line records what physically
-- went out of the door and must outlive the product row.
CREATE TABLE IF NOT EXISTS "RentalBookingItem" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'piece',
    "qty" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "ratePerDay" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    CONSTRAINT "RentalBookingItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RentalBooking_shopId_bookingNumber_key" ON "RentalBooking"("shopId", "bookingNumber");
CREATE INDEX IF NOT EXISTS "RentalBooking_shopId_deletedAt_idx" ON "RentalBooking"("shopId", "deletedAt");
-- The availability scan: active bookings whose window covers a requested date.
CREATE INDEX IF NOT EXISTS "RentalBooking_shopId_status_fromDate_toDate_idx" ON "RentalBooking"("shopId", "status", "fromDate", "toDate");
-- "What is due back today, and what is already overdue?"
CREATE INDEX IF NOT EXISTS "RentalBooking_shopId_status_toDate_idx" ON "RentalBooking"("shopId", "status", "toDate");
CREATE INDEX IF NOT EXISTS "RentalBooking_shopId_customerPhone_idx" ON "RentalBooking"("shopId", "customerPhone");

CREATE INDEX IF NOT EXISTS "RentalBookingItem_bookingId_idx" ON "RentalBookingItem"("bookingId");
CREATE INDEX IF NOT EXISTS "RentalBookingItem_productId_idx" ON "RentalBookingItem"("productId");

-- Foreign keys are added separately and guarded: ADD CONSTRAINT has no
-- IF NOT EXISTS in PostgreSQL, so a replay would otherwise fail on duplicate_object.
DO $$
BEGIN
  ALTER TABLE "RentalBooking"
    ADD CONSTRAINT "RentalBooking_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "RentalBookingItem"
    ADD CONSTRAINT "RentalBookingItem_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "RentalBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
