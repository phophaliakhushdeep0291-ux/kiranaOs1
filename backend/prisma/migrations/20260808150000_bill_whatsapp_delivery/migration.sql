ALTER TABLE "Bill" ADD COLUMN "whatsappDeliveryState" TEXT NOT NULL DEFAULT 'not_sent';
ALTER TABLE "Bill" ADD COLUMN "whatsappDeliveryAt" DATETIME;
ALTER TABLE "Bill" ADD COLUMN "whatsappProviderMessageId" TEXT;
ALTER TABLE "Bill" ADD COLUMN "whatsappDeliveryKey" TEXT;
CREATE UNIQUE INDEX "Bill_whatsappDeliveryKey_key" ON "Bill"("whatsappDeliveryKey");
