-- Data-preserving rollout of registered device slots and device-bound sessions.
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "deviceRecordId" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "deviceSessionVersion" INTEGER;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "tokenFamily" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "lastUsedAt" TIMESTAMP(3);

ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "deviceType" TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "operatingSystem" TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "browser" TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "userAgent" TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "appVersion" TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "isTrusted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "lastSyncAt" TIMESTAMP(3);
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "lastIpAddress" TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP(3);
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "revokedByUserId" TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "revokeReason" TEXT;

UPDATE "Device"
SET "status" = 'revoked',
    "revokedAt" = COALESCE("removedAt", CURRENT_TIMESTAMP),
    "revokeReason" = COALESCE("revokeReason", 'legacy_device_removed')
WHERE "status" = 'removed';

INSERT INTO "Device" (
  "id", "shopId", "userId", "deviceId", "deviceName", "platform", "status",
  "activatedAt", "lastActiveAt", "lastLoginAt", "lastSeenAt", "sessionVersion",
  "createdAt", "updatedAt"
)
SELECT
  'legacy_' || md5(random()::text || clock_timestamp()::text || s."id"),
  s."shopId", s."userId", s."deviceId", 'Existing registered device', 'web',
  'active', s."createdAt", s."createdAt", s."createdAt", s."createdAt", 1,
  s."createdAt", CURRENT_TIMESTAMP
FROM "Session" s
WHERE s."deviceId" IS NOT NULL
ON CONFLICT ("shopId", "deviceId") DO NOTHING;

UPDATE "Session" s
SET "deviceRecordId" = d."id",
    "deviceSessionVersion" = d."sessionVersion",
    "tokenFamily" = COALESCE(s."tokenFamily", s."id"),
    "lastUsedAt" = COALESCE(s."lastUsedAt", s."createdAt")
FROM "Device" d
WHERE s."deviceId" IS NOT NULL
  AND d."shopId" = s."shopId"
  AND d."deviceId" = s."deviceId";

CREATE TABLE IF NOT EXISTS "DeviceReplacementChallenge" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "newDeviceId" TEXT NOT NULL,
  "deviceJson" TEXT NOT NULL DEFAULT '{}',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeviceReplacementChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeviceReplacementChallenge_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DeviceReplacementChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

DO $$ BEGIN
  ALTER TABLE "Session" ADD CONSTRAINT "Session_deviceRecordId_fkey"
    FOREIGN KEY ("deviceRecordId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "Session_deviceRecordId_revokedAt_idx" ON "Session"("deviceRecordId", "revokedAt");
CREATE INDEX IF NOT EXISTS "Session_tokenFamily_idx" ON "Session"("tokenFamily");
CREATE INDEX IF NOT EXISTS "Device_shopId_lastSeenAt_idx" ON "Device"("shopId", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "DeviceReplacementChallenge_shopId_expiresAt_idx" ON "DeviceReplacementChallenge"("shopId", "expiresAt");
CREATE INDEX IF NOT EXISTS "DeviceReplacementChallenge_userId_consumedAt_idx" ON "DeviceReplacementChallenge"("userId", "consumedAt");
