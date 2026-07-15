ALTER TABLE "Device" ADD COLUMN "lastAppliedServerSeq" BIGINT;

ALTER TABLE "Device" ADD COLUMN "lastSyncAckAt" TIMESTAMP(3);

CREATE INDEX "Device_shopId_lastSyncAckAt_idx"
ON "Device"("shopId", "lastSyncAckAt");

CREATE INDEX "Device_shopId_lastAppliedServerSeq_idx"
ON "Device"("shopId", "lastAppliedServerSeq");
