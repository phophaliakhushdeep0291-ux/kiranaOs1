-- Phase 17: WhatsApp/notification reminder templates and logs.
CREATE TABLE "ReminderTemplate" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'whatsapp',
  "templateText" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReminderTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReminderLog" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'whatsapp',
  "templateId" TEXT,
  "message" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "provider" TEXT NOT NULL DEFAULT 'disabled',
  "providerMessageId" TEXT,
  "error" TEXT,
  "sentAt" TIMESTAMP(3),
  "requestedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReminderLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ReminderTemplate_shopId_active_idx" ON "ReminderTemplate"("shopId", "active");
CREATE INDEX IF NOT EXISTS "ReminderTemplate_shopId_channel_idx" ON "ReminderTemplate"("shopId", "channel");
CREATE INDEX IF NOT EXISTS "ReminderTemplate_shopId_deletedAt_idx" ON "ReminderTemplate"("shopId", "deletedAt");

CREATE INDEX IF NOT EXISTS "ReminderLog_shopId_customerId_createdAt_idx" ON "ReminderLog"("shopId", "customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "ReminderLog_shopId_status_createdAt_idx" ON "ReminderLog"("shopId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "ReminderLog_shopId_channel_createdAt_idx" ON "ReminderLog"("shopId", "channel", "createdAt");

ALTER TABLE "ReminderTemplate" ADD CONSTRAINT "ReminderTemplate_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReminderLog" ADD CONSTRAINT "ReminderLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReminderLog" ADD CONSTRAINT "ReminderLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
