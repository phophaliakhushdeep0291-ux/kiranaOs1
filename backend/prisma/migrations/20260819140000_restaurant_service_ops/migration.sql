-- Restaurant service operations: the three things a floor runs on that the POS
-- could not yet answer -- who is booked in, who is rostered on, and the self-order
-- terminal by the door.
--
-- TableReservation: the floor is the scarce resource, so the rule that matters is
-- that two parties are never promised the same table at the same time. That is an
-- interval overlap, which no unique index can express, so it is enforced in the
-- service and tested there. tableId is nullable because a phone booking usually
-- has a time and a party size before anyone picks a table, and refusing to record
-- it until then would push the host back to paper.
--
-- StaffShift: the schedule a manager publishes, not a timeclock. Hours actually
-- worked are a different question and deriving them from a roster would be
-- fiction. Overlapping shifts for one person are refused, for the same reason two
-- parties cannot hold one table.
--
-- KioskTerminal: the same storefront the table QR already serves, minus the table.
-- Nothing about the menu, stock or order path is duplicated for it.
-- CreateTable
CREATE TABLE "TableReservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "locationId" TEXT,
    "tableId" TEXT,
    "guestName" TEXT NOT NULL,
    "guestPhone" TEXT,
    "partySize" INTEGER NOT NULL DEFAULT 2,
    "reservedFor" DATETIME NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 90,
    "status" TEXT NOT NULL DEFAULT 'booked',
    "source" TEXT NOT NULL DEFAULT 'phone',
    "note" TEXT,
    "seatedAt" DATETIME,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TableReservation_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TableReservation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TableReservation_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "RestaurantTable" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StaffShift" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "locationId" TEXT,
    "userId" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "position" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StaffShift_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StaffShift_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StaffShift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KioskTerminal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "locationId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "requirePrepay" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KioskTerminal_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KioskTerminal_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TableReservation_shopId_reservedFor_idx" ON "TableReservation"("shopId", "reservedFor");

-- CreateIndex
CREATE INDEX "TableReservation_shopId_status_reservedFor_idx" ON "TableReservation"("shopId", "status", "reservedFor");

-- CreateIndex
CREATE INDEX "TableReservation_shopId_tableId_reservedFor_idx" ON "TableReservation"("shopId", "tableId", "reservedFor");

-- CreateIndex
CREATE INDEX "TableReservation_shopId_updatedAt_id_idx" ON "TableReservation"("shopId", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "StaffShift_shopId_startsAt_idx" ON "StaffShift"("shopId", "startsAt");

-- CreateIndex
CREATE INDEX "StaffShift_shopId_userId_startsAt_idx" ON "StaffShift"("shopId", "userId", "startsAt");

-- CreateIndex
CREATE INDEX "StaffShift_shopId_updatedAt_id_idx" ON "StaffShift"("shopId", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "KioskTerminal_shopId_active_idx" ON "KioskTerminal"("shopId", "active");

-- CreateIndex
CREATE INDEX "KioskTerminal_shopId_updatedAt_id_idx" ON "KioskTerminal"("shopId", "updatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "KioskTerminal_shopId_code_key" ON "KioskTerminal"("shopId", "code");

