-- Phase 48: Preserve udhar payment reversal history instead of deleting payment rows.
ALTER TABLE "UdharLedger" ADD COLUMN IF NOT EXISTS "reversedAt" TIMESTAMP(3);
ALTER TABLE "UdharLedger" ADD COLUMN IF NOT EXISTS "reversedReason" TEXT;
ALTER TABLE "UdharLedger" ADD COLUMN IF NOT EXISTS "reversalOfLedgerId" TEXT;
ALTER TABLE "UdharLedger" ADD COLUMN IF NOT EXISTS "reversedByUserId" TEXT;

CREATE INDEX IF NOT EXISTS "UdharLedger_shopId_reversalOfLedgerId_idx" ON "UdharLedger"("shopId", "reversalOfLedgerId");
