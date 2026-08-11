ALTER TABLE "RetailPaymentIntent" ADD COLUMN "checkoutMode" TEXT NOT NULL DEFAULT 'checkout';
ALTER TABLE "RetailPaymentIntent" ADD COLUMN "providerQrCodeId" TEXT;
ALTER TABLE "RetailPaymentIntent" ADD COLUMN "providerQrImageUrl" TEXT;

CREATE UNIQUE INDEX "RetailPaymentIntent_providerQrCodeId_key" ON "RetailPaymentIntent"("providerQrCodeId");
