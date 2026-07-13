ALTER TABLE "WebhookEndpoint" ADD COLUMN "deletedAt" DATETIME;
DROP INDEX "WebhookEndpoint_shopId_enabled_createdAt_idx";
CREATE INDEX "WebhookEndpoint_shopId_deletedAt_enabled_createdAt_idx" ON "WebhookEndpoint"("shopId", "deletedAt", "enabled", "createdAt");
