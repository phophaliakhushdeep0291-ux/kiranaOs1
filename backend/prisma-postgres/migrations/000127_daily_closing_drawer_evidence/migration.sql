-- @replay-safe: columns are independently guarded for interrupted production deploys.
ALTER TABLE "DailyClosingSnapshot" ADD COLUMN IF NOT EXISTS "openingCashPaise" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DailyClosingSnapshot" ADD COLUMN IF NOT EXISTS "manualCashInPaise" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DailyClosingSnapshot" ADD COLUMN IF NOT EXISTS "manualCashOutPaise" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DailyClosingSnapshot" ADD COLUMN IF NOT EXISTS "drawerExpectedCashPaise" INTEGER;
ALTER TABLE "DailyClosingSnapshot" ADD COLUMN IF NOT EXISTS "countedCashPaise" INTEGER;
ALTER TABLE "DailyClosingSnapshot" ADD COLUMN IF NOT EXISTS "cashVariancePaise" INTEGER;
ALTER TABLE "DailyClosingSnapshot" ADD COLUMN IF NOT EXISTS "cashCountedAt" TIMESTAMP(3);
ALTER TABLE "DailyClosingSnapshot" ADD COLUMN IF NOT EXISTS "cashCountedByUserId" TEXT;
ALTER TABLE "DailyClosingSnapshot" ADD COLUMN IF NOT EXISTS "cashCountedByDeviceId" TEXT;
ALTER TABLE "DailyClosingSnapshot" ADD COLUMN IF NOT EXISTS "cashCountRevision" INTEGER NOT NULL DEFAULT 0;
