ALTER TABLE "ReminderLog" ADD COLUMN "acceptedAt" TIMESTAMP(3);
ALTER TABLE "ReminderLog" ADD COLUMN "deliveredAt" TIMESTAMP(3);
ALTER TABLE "ReminderLog" ADD COLUMN "readAt" TIMESTAMP(3);
ALTER TABLE "ReminderLog" ADD COLUMN "failedAt" TIMESTAMP(3);
ALTER TABLE "ReminderLog" ADD COLUMN "lastStatusAt" TIMESTAMP(3);

-- Before delivery webhooks existed, "sent" meant only provider API acceptance.
UPDATE "ReminderLog"
SET "status" = 'accepted', "acceptedAt" = "sentAt", "lastStatusAt" = "sentAt", "sentAt" = NULL
WHERE "status" = 'sent';

CREATE UNIQUE INDEX "ReminderLog_provider_providerMessageId_key"
ON "ReminderLog"("provider", "providerMessageId");

CREATE TABLE "ReminderDeliveryEvent" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerMessageId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "errorCode" TEXT,
  "eventAt" TIMESTAMP(3) NOT NULL,
  "reminderLogId" TEXT,
  "processedAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReminderDeliveryEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReminderDeliveryEvent_provider_providerMessageId_status_key"
ON "ReminderDeliveryEvent"("provider", "providerMessageId", "status");
CREATE INDEX "ReminderDeliveryEvent_provider_providerMessageId_processedAt_idx"
ON "ReminderDeliveryEvent"("provider", "providerMessageId", "processedAt");
CREATE INDEX "ReminderDeliveryEvent_processedAt_receivedAt_idx"
ON "ReminderDeliveryEvent"("processedAt", "receivedAt");
