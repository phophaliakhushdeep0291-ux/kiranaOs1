CREATE TABLE "IntegrationApiKey" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopesJson" TEXT NOT NULL DEFAULT '[]',
    "createdByUserId" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IntegrationApiKey_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "IntegrationApiKey_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "IntegrationApiKey_keyHash_key" ON "IntegrationApiKey"("keyHash");
CREATE INDEX "IntegrationApiKey_shopId_revokedAt_createdAt_idx" ON "IntegrationApiKey"("shopId", "revokedAt", "createdAt");

CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "eventsJson" TEXT NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WebhookEndpoint_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WebhookEndpoint_shopId_enabled_createdAt_idx" ON "WebhookEndpoint"("shopId", "enabled", "createdAt");

CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "httpStatus" INTEGER,
    "durationMs" INTEGER,
    "responseSnippet" TEXT,
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WebhookDelivery_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WebhookDelivery_endpointId_eventId_key" ON "WebhookDelivery"("endpointId", "eventId");
CREATE INDEX "WebhookDelivery_shopId_createdAt_idx" ON "WebhookDelivery"("shopId", "createdAt");
CREATE INDEX "WebhookDelivery_endpointId_status_createdAt_idx" ON "WebhookDelivery"("endpointId", "status", "createdAt");
