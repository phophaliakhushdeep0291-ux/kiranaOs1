ALTER TABLE "WebhookEndpoint" ADD COLUMN "deletedAt" TIMESTAMP(3);
DROP INDEX "WebhookEndpoint_shopId_enabled_createdAt_idx";
CREATE INDEX "WebhookEndpoint_shopId_deletedAt_enabled_createdAt_idx" ON "WebhookEndpoint"("shopId", "deletedAt", "enabled", "createdAt");
