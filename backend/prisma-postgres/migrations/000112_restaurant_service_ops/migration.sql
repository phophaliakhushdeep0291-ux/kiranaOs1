-- Restaurant service operations: who is booked in, who is rostered on, and the
-- self-order terminal by the door. See the SQLite twin at
-- prisma/migrations/20260819140000_restaurant_service_ops for the full rationale.
--
-- The short version: a table cannot be promised to two parties at once and a
-- person cannot be rostered in two places at once. Both are interval overlaps,
-- which no unique index can express, so both are enforced in the service and
-- tested there rather than pretended at in SQL.
--
-- Foreign keys are declared inline rather than as trailing ALTER TABLE statements,
-- matching 000108: inside CREATE TABLE IF NOT EXISTS they are skipped wholesale on
-- a replay instead of failing on a constraint that already exists.
--
-- @replay-safe: every statement is guarded, so an interrupted deploy can replay
-- this migration without error.
CREATE TABLE IF NOT EXISTS "TableReservation" (
  "id" TEXT PRIMARY KEY, "shopId" TEXT NOT NULL, "locationId" TEXT, "tableId" TEXT,
  "guestName" TEXT NOT NULL, "guestPhone" TEXT, "partySize" INTEGER NOT NULL DEFAULT 2,
  "reservedFor" TIMESTAMP(3) NOT NULL, "durationMinutes" INTEGER NOT NULL DEFAULT 90,
  "status" TEXT NOT NULL DEFAULT 'booked', "source" TEXT NOT NULL DEFAULT 'phone',
  "note" TEXT, "seatedAt" TIMESTAMP(3), "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TableReservation_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TableReservation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TableReservation_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "RestaurantTable"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "StaffShift" (
  "id" TEXT PRIMARY KEY, "shopId" TEXT NOT NULL, "locationId" TEXT, "userId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3) NOT NULL, "position" TEXT,
  "status" TEXT NOT NULL DEFAULT 'scheduled', "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StaffShift_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StaffShift_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "StaffShift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "KioskTerminal" (
  "id" TEXT PRIMARY KEY, "shopId" TEXT NOT NULL, "locationId" TEXT,
  "code" TEXT NOT NULL, "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true, "requirePrepay" BOOLEAN NOT NULL DEFAULT false,
  "lastSeenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KioskTerminal_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KioskTerminal_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "TableReservation_shopId_reservedFor_idx" ON "TableReservation"("shopId", "reservedFor");
CREATE INDEX IF NOT EXISTS "TableReservation_shopId_status_reservedFor_idx" ON "TableReservation"("shopId", "status", "reservedFor");
CREATE INDEX IF NOT EXISTS "TableReservation_shopId_tableId_reservedFor_idx" ON "TableReservation"("shopId", "tableId", "reservedFor");
CREATE INDEX IF NOT EXISTS "TableReservation_shopId_updatedAt_id_idx" ON "TableReservation"("shopId", "updatedAt", "id");

CREATE INDEX IF NOT EXISTS "StaffShift_shopId_startsAt_idx" ON "StaffShift"("shopId", "startsAt");
CREATE INDEX IF NOT EXISTS "StaffShift_shopId_userId_startsAt_idx" ON "StaffShift"("shopId", "userId", "startsAt");
CREATE INDEX IF NOT EXISTS "StaffShift_shopId_updatedAt_id_idx" ON "StaffShift"("shopId", "updatedAt", "id");

CREATE INDEX IF NOT EXISTS "KioskTerminal_shopId_active_idx" ON "KioskTerminal"("shopId", "active");
CREATE INDEX IF NOT EXISTS "KioskTerminal_shopId_updatedAt_id_idx" ON "KioskTerminal"("shopId", "updatedAt", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "KioskTerminal_shopId_code_key" ON "KioskTerminal"("shopId", "code");
