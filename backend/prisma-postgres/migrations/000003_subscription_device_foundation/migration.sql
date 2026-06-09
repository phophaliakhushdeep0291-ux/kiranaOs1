-- Phase 6: SaaS subscription, plan, payment provider and device foundation

CREATE TABLE "Plan" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "priceMonthlyPaise" INTEGER NOT NULL,
  "priceYearlyPaise" INTEGER NOT NULL,
  "maxDevices" INTEGER NOT NULL,
  "maxStores" INTEGER NOT NULL,
  "maxStaff" INTEGER NOT NULL,
  "featuresJson" TEXT NOT NULL DEFAULT '[]',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Subscription" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "planCode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'trial',
  "provider" TEXT NOT NULL DEFAULT 'manual',
  "providerSubscriptionId" TEXT,
  "currentPeriodStart" TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3),
  "trialEndsAt" TIMESTAMP(3),
  "graceEndsAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentTransaction" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "subscriptionId" TEXT,
  "provider" TEXT NOT NULL DEFAULT 'manual',
  "providerPaymentId" TEXT,
  "amountPaise" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "status" TEXT NOT NULL DEFAULT 'created',
  "paidAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "rawPayloadJson" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentProviderEvent" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "signatureVerified" BOOLEAN NOT NULL DEFAULT false,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentProviderEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Device" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "userId" TEXT,
  "deviceId" TEXT NOT NULL,
  "deviceName" TEXT,
  "platform" TEXT,
  "fingerprintHash" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "activatedAt" TIMESTAMP(3),
  "lastActiveAt" TIMESTAMP(3),
  "removedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeviceLicense" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "planCode" TEXT NOT NULL,
  "featuresJson" TEXT NOT NULL DEFAULT '[]',
  "validUntil" TIMESTAMP(3) NOT NULL,
  "offlineGraceUntil" TIMESTAMP(3) NOT NULL,
  "signatureHash" TEXT,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "DeviceLicense_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");
CREATE UNIQUE INDEX "Subscription_shopId_key" ON "Subscription"("shopId");
CREATE INDEX "Subscription_shopId_status_idx" ON "Subscription"("shopId", "status");
CREATE INDEX "Subscription_planCode_idx" ON "Subscription"("planCode");
CREATE INDEX "PaymentTransaction_shopId_createdAt_idx" ON "PaymentTransaction"("shopId", "createdAt");
CREATE INDEX "PaymentTransaction_subscriptionId_idx" ON "PaymentTransaction"("subscriptionId");
CREATE INDEX "PaymentTransaction_provider_providerPaymentId_idx" ON "PaymentTransaction"("provider", "providerPaymentId");
CREATE UNIQUE INDEX "PaymentProviderEvent_provider_eventId_key" ON "PaymentProviderEvent"("provider", "eventId");
CREATE INDEX "PaymentProviderEvent_provider_eventType_createdAt_idx" ON "PaymentProviderEvent"("provider", "eventType", "createdAt");
CREATE UNIQUE INDEX "Device_shopId_deviceId_key" ON "Device"("shopId", "deviceId");
CREATE INDEX "Device_shopId_status_idx" ON "Device"("shopId", "status");
CREATE INDEX "Device_userId_idx" ON "Device"("userId");
CREATE INDEX "DeviceLicense_shopId_deviceId_idx" ON "DeviceLicense"("shopId", "deviceId");
CREATE INDEX "DeviceLicense_validUntil_idx" ON "DeviceLicense"("validUntil");

ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Device" ADD CONSTRAINT "Device_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeviceLicense" ADD CONSTRAINT "DeviceLicense_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
