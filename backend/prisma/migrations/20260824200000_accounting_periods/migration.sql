CREATE TABLE "AccountingPeriod" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "startsAt" DATETIME NOT NULL,
  "endsAt" DATETIME NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "closedAt" DATETIME,
  "closedByUserId" TEXT,
  "closeReason" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AccountingPeriod_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AccountingPeriod_shopId_startsAt_endsAt_key"
  ON "AccountingPeriod"("shopId", "startsAt", "endsAt");
CREATE INDEX "AccountingPeriod_shopId_status_startsAt_endsAt_idx"
  ON "AccountingPeriod"("shopId", "status", "startsAt", "endsAt");
