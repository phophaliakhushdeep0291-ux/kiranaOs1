-- Extend the existing device registry without deleting or resetting production data.
ALTER TABLE "Session" ADD COLUMN "deviceRecordId" TEXT;
ALTER TABLE "Session" ADD COLUMN "deviceSessionVersion" INTEGER;
ALTER TABLE "Session" ADD COLUMN "tokenFamily" TEXT;
ALTER TABLE "Session" ADD COLUMN "lastUsedAt" DATETIME;

ALTER TABLE "Device" ADD COLUMN "deviceType" TEXT;
ALTER TABLE "Device" ADD COLUMN "operatingSystem" TEXT;
ALTER TABLE "Device" ADD COLUMN "browser" TEXT;
ALTER TABLE "Device" ADD COLUMN "userAgent" TEXT;
ALTER TABLE "Device" ADD COLUMN "appVersion" TEXT;
ALTER TABLE "Device" ADD COLUMN "isTrusted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Device" ADD COLUMN "lastLoginAt" DATETIME;
ALTER TABLE "Device" ADD COLUMN "lastSeenAt" DATETIME;
ALTER TABLE "Device" ADD COLUMN "lastSyncAt" DATETIME;
ALTER TABLE "Device" ADD COLUMN "lastIpAddress" TEXT;
ALTER TABLE "Device" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Device" ADD COLUMN "revokedAt" DATETIME;
ALTER TABLE "Device" ADD COLUMN "revokedByUserId" TEXT;
ALTER TABLE "Device" ADD COLUMN "revokeReason" TEXT;

UPDATE "Device"
SET "status" = 'revoked',
    "revokedAt" = COALESCE("removedAt", CURRENT_TIMESTAMP),
    "revokeReason" = COALESCE("revokeReason", 'legacy_device_removed')
WHERE "status" = 'removed';

-- Preserve legacy authenticated installations by creating registry rows for
-- session device ids that pre-date the device-bound token rollout.
INSERT OR IGNORE INTO "Device" (
  "id", "shopId", "userId", "deviceId", "deviceName", "platform", "status",
  "activatedAt", "lastActiveAt", "lastLoginAt", "lastSeenAt", "sessionVersion",
  "createdAt", "updatedAt"
)
SELECT
  'legacy_' || lower(hex(randomblob(16))), s."shopId", s."userId", s."deviceId",
  'Existing registered device', 'web', 'active', s."createdAt", s."createdAt",
  s."createdAt", s."createdAt", 1, s."createdAt", CURRENT_TIMESTAMP
FROM "Session" s
WHERE s."deviceId" IS NOT NULL;

UPDATE "Session"
SET "deviceRecordId" = (
      SELECT d."id" FROM "Device" d
      WHERE d."shopId" = "Session"."shopId" AND d."deviceId" = "Session"."deviceId"
      LIMIT 1
    ),
    "deviceSessionVersion" = 1,
    "tokenFamily" = "id",
    "lastUsedAt" = "createdAt"
WHERE "deviceId" IS NOT NULL;

CREATE TABLE "DeviceReplacementChallenge" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "newDeviceId" TEXT NOT NULL,
  "deviceJson" TEXT NOT NULL DEFAULT '{}',
  "expiresAt" DATETIME NOT NULL,
  "consumedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeviceReplacementChallenge_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DeviceReplacementChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "Session_deviceRecordId_revokedAt_idx" ON "Session"("deviceRecordId", "revokedAt");
CREATE INDEX "Session_tokenFamily_idx" ON "Session"("tokenFamily");
CREATE INDEX "Device_shopId_lastSeenAt_idx" ON "Device"("shopId", "lastSeenAt");
CREATE INDEX "DeviceReplacementChallenge_shopId_expiresAt_idx" ON "DeviceReplacementChallenge"("shopId", "expiresAt");
CREATE INDEX "DeviceReplacementChallenge_userId_consumedAt_idx" ON "DeviceReplacementChallenge"("userId", "consumedAt");
