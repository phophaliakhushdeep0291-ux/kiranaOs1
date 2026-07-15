ALTER TABLE "Device" ADD COLUMN "lastAppliedServerSeq" INTEGER;
ALTER TABLE "Device" ADD COLUMN "lastSyncAckAt" DATETIME;

CREATE INDEX "Device_shopId_lastSyncAckAt_idx"
ON "Device"("shopId", "lastSyncAckAt");

CREATE INDEX "Device_shopId_lastAppliedServerSeq_idx"
ON "Device"("shopId", "lastAppliedServerSeq");
