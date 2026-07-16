ALTER TABLE "ReminderLog" ADD COLUMN "acceptedAt" DATETIME;
ALTER TABLE "ReminderLog" ADD COLUMN "deliveredAt" DATETIME;
ALTER TABLE "ReminderLog" ADD COLUMN "readAt" DATETIME;
ALTER TABLE "ReminderLog" ADD COLUMN "failedAt" DATETIME;
ALTER TABLE "ReminderLog" ADD COLUMN "lastStatusAt" DATETIME;

-- Before delivery webhooks existed, "sent" meant only provider API acceptance.
UPDATE "ReminderLog"
SET "status" = 'accepted', "acceptedAt" = "sentAt", "lastStatusAt" = "sentAt", "sentAt" = NULL
WHERE "status" = 'sent';

CREATE UNIQUE INDEX "ReminderLog_provider_providerMessageId_key"
ON "ReminderLog"("provider", "providerMessageId");

CREATE TABLE "ReminderDeliveryEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "providerMessageId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "errorCode" TEXT,
  "eventAt" DATETIME NOT NULL,
  "reminderLogId" TEXT,
  "processedAt" DATETIME,
  "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ReminderDeliveryEvent_provider_providerMessageId_status_key"
ON "ReminderDeliveryEvent"("provider", "providerMessageId", "status");
CREATE INDEX "ReminderDeliveryEvent_provider_providerMessageId_processedAt_idx"
ON "ReminderDeliveryEvent"("provider", "providerMessageId", "processedAt");
CREATE INDEX "ReminderDeliveryEvent_processedAt_receivedAt_idx"
ON "ReminderDeliveryEvent"("processedAt", "receivedAt");
