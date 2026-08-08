-- Kitchen tickets (KOT) become a shop record instead of a device one.
--
-- The kitchen display is a DIFFERENT DEVICE from the till. A waiter fires a
-- ticket on the counter tablet; the screen that has to cook it is by the pass.
-- Tickets lived in the firing device's own IndexedDB, so those two never met
-- and the kitchen screen showed an empty rail all service. The guest-order
-- strip on that same screen was already server-backed, so one page mixed
-- server-side guest orders with device-local staff tickets.
--
-- Two things the till also could not do alone, both fixed by the server owning
-- the record:
--
-- 1. NUMBERING. `nextTicketNo` took the highest number it could see. Two tills
--    firing at the same moment both saw the same highest number and both
--    claimed it, so the kitchen got two different tickets called #14. The
--    number is assigned here now, under a unique index that makes the collision
--    an error to retry rather than a duplicate to serve.
--
-- 2. "ALREADY FIRED". `pendingKotLines` subtracts fired quantities from the
--    cart so a waiter adding one more naan sends one, not seven. That tally is
--    only correct if every ticket for the sitting is visible; a second till
--    could not see the first one's and would re-send the whole order.
--
-- tableId and billId are NOT foreign keys, matching the other trade registers.
-- A table's order is the parked HeldBill on whichever till is taking it, and
-- that id is local to that device — the server only groups by it. It also lets
-- a ticket outlive the sitting, which is what a kitchen record is for.

CREATE TABLE "KitchenTicket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "locationId" TEXT,
    -- Per shop, assigned here. See note 1 above.
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
    "firedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "servedAt" DATETIME,
    -- Durable create idempotency: a retried fire must not put the dish on the
    -- pass twice. Nullable, and NULLs are DISTINCT in a unique index, so
    -- tickets without a key never collide with each other.
    "idempotencyKey" TEXT,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KitchenTicket_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KitchenTicket_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "KitchenTicket_shopId_idempotencyKey_key" ON "KitchenTicket"("shopId", "idempotencyKey");
-- The guard that turns a two-till numbering race into a retry instead of two
-- tickets sharing a number.
CREATE UNIQUE INDEX "KitchenTicket_shopId_ticketNo_key" ON "KitchenTicket"("shopId", "ticketNo");
CREATE INDEX "KitchenTicket_shopId_deletedAt_firedAt_idx" ON "KitchenTicket"("shopId", "deletedAt", "firedAt");
-- The kitchen screen's only question: what is still outstanding, oldest first.
CREATE INDEX "KitchenTicket_shopId_status_firedAt_idx" ON "KitchenTicket"("shopId", "status", "firedAt");
-- The till's question: what has this sitting already sent?
CREATE INDEX "KitchenTicket_shopId_billId_idx" ON "KitchenTicket"("shopId", "billId");
