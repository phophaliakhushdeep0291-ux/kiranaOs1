-- @replay-safe: every column and index is guarded for interrupted deploy recovery.
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "whatsappDeliveryState" TEXT NOT NULL DEFAULT 'not_sent';
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "whatsappDeliveryAt" TIMESTAMP(3);
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "whatsappProviderMessageId" TEXT;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "whatsappDeliveryKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Bill_whatsappDeliveryKey_key" ON "Bill"("whatsappDeliveryKey");
