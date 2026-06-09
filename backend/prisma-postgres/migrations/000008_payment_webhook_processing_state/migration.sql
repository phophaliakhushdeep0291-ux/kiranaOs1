-- Phase 22: make Razorpay/payment webhook processing observable and retry-safe.
-- Existing rows are backfilled as processed only when processedAt is present; otherwise they remain received.
ALTER TABLE "PaymentProviderEvent" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
ALTER TABLE "PaymentProviderEvent" ADD COLUMN IF NOT EXISTS "processingStatus" TEXT NOT NULL DEFAULT 'received';
ALTER TABLE "PaymentProviderEvent" ADD COLUMN IF NOT EXISTS "processingAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PaymentProviderEvent" ADD COLUMN IF NOT EXISTS "processingError" TEXT;
ALTER TABLE "PaymentProviderEvent" ADD COLUMN IF NOT EXISTS "processedResultJson" TEXT;
ALTER TABLE "PaymentProviderEvent" ADD COLUMN IF NOT EXISTS "lastAttemptAt" TIMESTAMP(3);

UPDATE "PaymentProviderEvent"
SET "processingStatus" = 'processed'
WHERE "processedAt" IS NOT NULL AND "processingStatus" = 'received';

CREATE INDEX IF NOT EXISTS "PaymentProviderEvent_shopId_createdAt_idx" ON "PaymentProviderEvent"("shopId", "createdAt");
CREATE INDEX IF NOT EXISTS "PaymentProviderEvent_processingStatus_createdAt_idx" ON "PaymentProviderEvent"("processingStatus", "createdAt");
