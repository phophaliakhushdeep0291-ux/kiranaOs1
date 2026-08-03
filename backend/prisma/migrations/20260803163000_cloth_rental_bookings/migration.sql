-- Cloth rental: book a garment out for a run of days.
-- RentalBooking holds stock without moving it, so a booked outfit disappears
-- from the customer-facing catalogue for exactly the days it is promised to
-- someone else and comes back the day after it is returned.

CREATE TABLE "RentalBooking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "bookingNumber" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerAddress" TEXT NOT NULL DEFAULT '',
    "idProofType" TEXT,
    "idProofNumber" TEXT,
    "fromDate" DATETIME NOT NULL,
    "toDate" DATETIME NOT NULL,
    "returnedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'booked',
    "rentAmount" REAL NOT NULL DEFAULT 0,
    "depositAmount" REAL NOT NULL DEFAULT 0,
    "advancePaid" REAL NOT NULL DEFAULT 0,
    "lateFee" REAL NOT NULL DEFAULT 0,
    "damageCharge" REAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RentalBooking_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RentalBooking_shopId_bookingNumber_key" ON "RentalBooking"("shopId", "bookingNumber");
CREATE INDEX "RentalBooking_shopId_deletedAt_idx" ON "RentalBooking"("shopId", "deletedAt");
-- The availability scan: active bookings whose window covers a requested date.
CREATE INDEX "RentalBooking_shopId_status_fromDate_toDate_idx" ON "RentalBooking"("shopId", "status", "fromDate", "toDate");
-- "What is due back today, and what is already overdue?"
CREATE INDEX "RentalBooking_shopId_status_toDate_idx" ON "RentalBooking"("shopId", "status", "toDate");
CREATE INDEX "RentalBooking_shopId_customerPhone_idx" ON "RentalBooking"("shopId", "customerPhone");

-- productId is intentionally not a foreign key: the line records what physically
-- went out of the door and must outlive the product row.
CREATE TABLE "RentalBookingItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookingId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'piece',
    "qty" REAL NOT NULL DEFAULT 1,
    "ratePerDay" REAL NOT NULL DEFAULT 0,
    "amount" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "RentalBookingItem_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "RentalBooking" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "RentalBookingItem_bookingId_idx" ON "RentalBookingItem"("bookingId");
CREATE INDEX "RentalBookingItem_productId_idx" ON "RentalBookingItem"("productId");
