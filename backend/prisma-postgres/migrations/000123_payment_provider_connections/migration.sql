CREATE TABLE "PaymentProviderConnection" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "environment" TEXT NOT NULL DEFAULT 'test',
  "encryptedCredentials" TEXT NOT NULL,
  "keyIdHint" TEXT NOT NULL,
  "webhookSecretConfigured" BOOLEAN NOT NULL DEFAULT false,
  "selected" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'configured',
  "verifiedAt" TIMESTAMP(3),
  "lastVerifiedAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentProviderConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentProviderConnection_shopId_provider_key" ON "PaymentProviderConnection"("shopId", "provider");
CREATE INDEX "PaymentProviderConnection_shopId_selected_status_idx" ON "PaymentProviderConnection"("shopId", "selected", "status");
CREATE UNIQUE INDEX "PaymentProviderConnection_one_selected_per_shop" ON "PaymentProviderConnection"("shopId") WHERE "selected" = true;
ALTER TABLE "PaymentProviderConnection" ADD CONSTRAINT "PaymentProviderConnection_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
