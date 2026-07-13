ALTER TABLE "Payment" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'confirmed';
ALTER TABLE "Payment" ADD COLUMN "provider" TEXT;
ALTER TABLE "Payment" ADD COLUMN "providerReference" TEXT;
ALTER TABLE "Payment" ADD COLUMN "confirmationSource" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "Payment" ADD COLUMN "confirmedAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN "retailPaymentIntentId" TEXT;

CREATE TABLE "RetailPaymentIntent" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'razorpay',
  "providerOrderId" TEXT,
  "providerPaymentId" TEXT,
  "amountPaise" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "status" TEXT NOT NULL DEFAULT 'creating',
  "createdByUserId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "confirmationSource" TEXT,
  "consumedAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RetailPaymentIntent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Payment_retailPaymentIntentId_key" ON "Payment"("retailPaymentIntentId");
CREATE UNIQUE INDEX "RetailPaymentIntent_providerOrderId_key" ON "RetailPaymentIntent"("providerOrderId");
CREATE UNIQUE INDEX "RetailPaymentIntent_providerPaymentId_key" ON "RetailPaymentIntent"("providerPaymentId");
CREATE INDEX "RetailPaymentIntent_shopId_locationId_status_createdAt_idx" ON "RetailPaymentIntent"("shopId", "locationId", "status", "createdAt");
CREATE INDEX "RetailPaymentIntent_status_expiresAt_idx" ON "RetailPaymentIntent"("status", "expiresAt");
ALTER TABLE "RetailPaymentIntent" ADD CONSTRAINT "RetailPaymentIntent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RetailPaymentIntent" ADD CONSTRAINT "RetailPaymentIntent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_retailPaymentIntentId_fkey" FOREIGN KEY ("retailPaymentIntentId") REFERENCES "RetailPaymentIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
