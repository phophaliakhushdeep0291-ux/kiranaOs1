-- Add public QR order idempotency without touching existing order rows.
ALTER TABLE "CustomerOrder" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "CustomerOrder_shopId_idempotencyKey_key" ON "CustomerOrder"("shopId", "idempotencyKey");
