-- Cosmetics: tester stock.
--
-- A tester is a unit opened for customers to try, and it will never be sold.
-- Counted as sellable it makes the shelf wrong in three ways at once: the shop
-- thinks it has stock it cannot sell, the missing units surface later as
-- shrinkage that looks like theft, and nobody ever finds out what testers cost —
-- which in this trade is a real line of expenditure hidden inside "loss".
--
-- Opening a tester moves stock out through the ordinary inventory path; this
-- table records where it went and when it is due to be replaced.
--
-- productId is intentionally not a foreign key, consistent with the other trade
-- registers: the record survives a catalogue row being renamed.

CREATE TABLE "TesterUnit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "variant" TEXT,
    "status" TEXT NOT NULL DEFAULT 'in_use',
    "openedOn" DATETIME NOT NULL,
    "expectedDays" INTEGER NOT NULL DEFAULT 90,
    "closedOn" DATETIME,
    "costValue" REAL NOT NULL DEFAULT 0,
    "stockLedgerId" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TesterUnit_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "TesterUnit_shopId_deletedAt_idx" ON "TesterUnit"("shopId", "deletedAt");
-- "What is on the counter, and what needs replacing?"
CREATE INDEX "TesterUnit_shopId_status_openedOn_idx" ON "TesterUnit"("shopId", "status", "openedOn");
CREATE INDEX "TesterUnit_shopId_productId_status_idx" ON "TesterUnit"("shopId", "productId", "status");
