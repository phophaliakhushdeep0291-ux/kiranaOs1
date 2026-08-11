-- @replay-safe: every additive column and index is guarded for interrupted deploy recovery.
ALTER TABLE "RetailPaymentIntent" ADD COLUMN IF NOT EXISTS "checkoutMode" TEXT NOT NULL DEFAULT 'checkout';
ALTER TABLE "RetailPaymentIntent" ADD COLUMN IF NOT EXISTS "providerQrCodeId" TEXT;
ALTER TABLE "RetailPaymentIntent" ADD COLUMN IF NOT EXISTS "providerQrImageUrl" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "RetailPaymentIntent_providerQrCodeId_key" ON "RetailPaymentIntent"("providerQrCodeId");
