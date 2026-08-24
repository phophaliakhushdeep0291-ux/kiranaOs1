-- Explicit accounting periods support owner-audited close and reopen controls.
--
-- @replay-safe: table and indexes are guarded so an interrupted deployment can
-- replay this additive migration without duplicate-object failures.
CREATE TABLE IF NOT EXISTS "AccountingPeriod" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "closedAt" TIMESTAMP(3),
  "closedByUserId" TEXT,
  "closeReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountingPeriod_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccountingPeriod_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "AccountingPeriod_shopId_startsAt_endsAt_key"
  ON "AccountingPeriod"("shopId", "startsAt", "endsAt");
CREATE INDEX IF NOT EXISTS "AccountingPeriod_shopId_status_startsAt_endsAt_idx"
  ON "AccountingPeriod"("shopId", "status", "startsAt", "endsAt");
