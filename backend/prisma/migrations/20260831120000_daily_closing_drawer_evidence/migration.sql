-- Persist physical till evidence that was previously trapped in one browser.
-- SQLite ADD COLUMN is safe here because every column is nullable or has a constant default.
ALTER TABLE "DailyClosingSnapshot" ADD COLUMN "openingCashPaise" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DailyClosingSnapshot" ADD COLUMN "manualCashInPaise" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DailyClosingSnapshot" ADD COLUMN "manualCashOutPaise" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DailyClosingSnapshot" ADD COLUMN "drawerExpectedCashPaise" INTEGER;
ALTER TABLE "DailyClosingSnapshot" ADD COLUMN "countedCashPaise" INTEGER;
ALTER TABLE "DailyClosingSnapshot" ADD COLUMN "cashVariancePaise" INTEGER;
ALTER TABLE "DailyClosingSnapshot" ADD COLUMN "cashCountedAt" DATETIME;
ALTER TABLE "DailyClosingSnapshot" ADD COLUMN "cashCountedByUserId" TEXT;
ALTER TABLE "DailyClosingSnapshot" ADD COLUMN "cashCountedByDeviceId" TEXT;
ALTER TABLE "DailyClosingSnapshot" ADD COLUMN "cashCountRevision" INTEGER NOT NULL DEFAULT 0;
