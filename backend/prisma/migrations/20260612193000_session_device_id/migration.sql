-- Track which browser/device owns a refresh session so logout releases a concurrent device slot.
ALTER TABLE "Session" ADD COLUMN "deviceId" TEXT;

CREATE INDEX IF NOT EXISTS "Session_shopId_deviceId_revokedAt_idx"
    ON "Session"("shopId", "deviceId", "revokedAt");
