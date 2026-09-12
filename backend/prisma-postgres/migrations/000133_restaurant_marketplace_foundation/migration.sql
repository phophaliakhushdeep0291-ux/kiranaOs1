-- @replay-safe
-- Additive transport tables; interrupted deployment can safely retry each statement.
CREATE TABLE IF NOT EXISTS "RestaurantMarketplaceConnection" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "externalOutletId" TEXT NOT NULL,
  "environment" TEXT NOT NULL DEFAULT 'sandbox',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "adapterVersion" TEXT,
  "verificationReference" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RestaurantMarketplaceConnection_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "RestaurantMarketplaceConnection_shopId_provider_locationId_key" ON "RestaurantMarketplaceConnection"("shopId", "provider", "locationId");
CREATE INDEX IF NOT EXISTS "RestaurantMarketplaceConnection_provider_outlet_status_idx" ON "RestaurantMarketplaceConnection"("provider", "environment", "externalOutletId", "status");
CREATE INDEX IF NOT EXISTS "RestaurantMarketplaceConnection_shopId_status_enabled_idx" ON "RestaurantMarketplaceConnection"("shopId", "status", "enabled");
-- Pending requests must not reserve an outlet. Only provider-verified bindings
-- are exclusive, so a different shop cannot receive this outlet's orders.
CREATE UNIQUE INDEX IF NOT EXISTS "RestaurantMarketplaceConnection_verified_outlet_key" ON "RestaurantMarketplaceConnection"("provider", "environment", "externalOutletId") WHERE "status" = 'verified';

CREATE TABLE IF NOT EXISTS "RestaurantMarketplaceOrder" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "externalOrderId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "snapshotJson" TEXT NOT NULL,
  "totalPaise" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'new',
  "providerPayment" TEXT NOT NULL DEFAULT 'unknown',
  "lastProviderEventAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RestaurantMarketplaceOrder_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RestaurantMarketplaceOrder_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "RestaurantMarketplaceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "RestaurantMarketplaceOrder_connectionId_externalOrderId_key" ON "RestaurantMarketplaceOrder"("connectionId", "externalOrderId");
CREATE INDEX IF NOT EXISTS "RestaurantMarketplaceOrder_shopId_status_createdAt_idx" ON "RestaurantMarketplaceOrder"("shopId", "status", "createdAt");

CREATE TABLE IF NOT EXISTS "RestaurantMarketplaceEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "externalOrderId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "result" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RestaurantMarketplaceEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RestaurantMarketplaceEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "RestaurantMarketplaceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "RestaurantMarketplaceEvent_connectionId_eventId_key" ON "RestaurantMarketplaceEvent"("connectionId", "eventId");
CREATE INDEX IF NOT EXISTS "RestaurantMarketplaceEvent_shopId_createdAt_idx" ON "RestaurantMarketplaceEvent"("shopId", "createdAt");

CREATE TABLE IF NOT EXISTS "RestaurantMarketplaceCommand" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "requestJson" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastErrorCode" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RestaurantMarketplaceCommand_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RestaurantMarketplaceCommand_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "RestaurantMarketplaceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RestaurantMarketplaceCommand_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "RestaurantMarketplaceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "RestaurantMarketplaceCommand_orderId_requestKey_key" ON "RestaurantMarketplaceCommand"("orderId", "requestKey");
CREATE INDEX IF NOT EXISTS "RestaurantMarketplaceCommand_shopId_status_createdAt_idx" ON "RestaurantMarketplaceCommand"("shopId", "status", "createdAt");
