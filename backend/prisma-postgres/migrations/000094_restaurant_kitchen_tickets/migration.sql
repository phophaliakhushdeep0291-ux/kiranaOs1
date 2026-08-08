-- Kitchen tickets (KOT) become a shop record instead of a device one — the
-- PostgreSQL twin of prisma/migrations/20260807160000_restaurant_kitchen_tickets.
-- See the SQLite original for the full rationale.
--
-- In short: the kitchen display is a DIFFERENT DEVICE from the till that fires
-- the ticket, and tickets lived in the firing device's IndexedDB, so the screen
-- by the pass showed an empty rail all service. Two more things only the server
-- can do: assign a ticket number without two tills claiming the same one, and
-- hold the full "already fired" tally so a second till does not re-send an
-- order the first one already sent.
--
-- tableId and billId are NOT foreign keys, matching the other trade registers:
-- a table's order is the parked HeldBill on whichever till is taking it, and
-- that id is local to that device.
--
-- @replay-safe: the table and every index are created IF NOT EXISTS and the
-- foreign keys are guarded, so an interrupted deploy can replay this without
-- error.

CREATE TABLE IF NOT EXISTS "KitchenTicket" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "locationId" TEXT,
    -- Per shop, assigned server-side: two tills firing at the same moment would
    -- otherwise both read the same highest number and both claim it.
    "ticketNo" INTEGER NOT NULL,
    "tableId" TEXT NOT NULL,
    -- Copied, not joined: the ticket must still print the name it was fired
    -- under after the table is renamed or taken off the floor plan mid-service.
    "tableName" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    -- new | preparing | ready | served
    "status" TEXT NOT NULL DEFAULT 'new',
    -- KotLine[]: { key, name, qty, unit, note }. A snapshot of what was fired,
    -- never queried line by line, so one column rather than a child table.
    "linesJson" TEXT NOT NULL DEFAULT '[]',
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "servedAt" TIMESTAMP(3),
    -- Durable create idempotency: a retried fire must not put the dish on the
    -- pass twice. Nullable, and NULLs are DISTINCT in a unique index, so
    -- tickets without a key never collide with each other.
    "idempotencyKey" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KitchenTicket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "KitchenTicket_shopId_idempotencyKey_key" ON "KitchenTicket"("shopId", "idempotencyKey");
-- The guard that turns a two-till numbering race into a retry instead of two
-- tickets sharing a number.
CREATE UNIQUE INDEX IF NOT EXISTS "KitchenTicket_shopId_ticketNo_key" ON "KitchenTicket"("shopId", "ticketNo");
CREATE INDEX IF NOT EXISTS "KitchenTicket_shopId_deletedAt_firedAt_idx" ON "KitchenTicket"("shopId", "deletedAt", "firedAt");
-- The kitchen screen's only question: what is still outstanding, oldest first.
CREATE INDEX IF NOT EXISTS "KitchenTicket_shopId_status_firedAt_idx" ON "KitchenTicket"("shopId", "status", "firedAt");
-- The till's question: what has this sitting already sent?
CREATE INDEX IF NOT EXISTS "KitchenTicket_shopId_billId_idx" ON "KitchenTicket"("shopId", "billId");

-- The foreign keys are added separately and guarded: ADD CONSTRAINT has no
-- IF NOT EXISTS in PostgreSQL, so a replay would otherwise fail on duplicate_object.
DO $$
BEGIN
  ALTER TABLE "KitchenTicket"
    ADD CONSTRAINT "KitchenTicket_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "KitchenTicket"
    ADD CONSTRAINT "KitchenTicket_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "StoreLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
