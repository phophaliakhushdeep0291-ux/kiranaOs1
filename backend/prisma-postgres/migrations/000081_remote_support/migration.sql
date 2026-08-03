-- Remote Support: consent-gated remote diagnosis + repair.
-- SupportSession is the owner's grant; DeviceCommand is the server→device queue
-- the devices drain on their existing sync poll.
-- @replay-safe: every object is created IF NOT EXISTS, so an interrupted deploy
-- can replay this migration without error.

CREATE TABLE IF NOT EXISTS "SupportSession" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "grantedByUserId" TEXT,
    "deviceId" TEXT,
    "codeHash" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'diagnose',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "operatorEmail" TEXT,
    "reason" TEXT,
    "redeemedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "commandCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupportSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DeviceCommand" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "sessionId" TEXT,
    "playbookId" TEXT,
    "deviceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "paramsJson" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "issuedByEmail" TEXT,
    "issuedByUserId" TEXT,
    "reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "deliveredAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "resultJson" TEXT,
    "error" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DeviceCommand_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SupportSession_codeHash_key" ON "SupportSession"("codeHash");
CREATE INDEX IF NOT EXISTS "SupportSession_shopId_status_createdAt_idx" ON "SupportSession"("shopId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "SupportSession_status_expiresAt_idx" ON "SupportSession"("status", "expiresAt");

CREATE INDEX IF NOT EXISTS "DeviceCommand_shopId_deviceId_status_createdAt_idx" ON "DeviceCommand"("shopId", "deviceId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "DeviceCommand_shopId_status_createdAt_idx" ON "DeviceCommand"("shopId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "DeviceCommand_sessionId_idx" ON "DeviceCommand"("sessionId");
-- Auto-fix cooldown and failure-streak lookups: "what has this playbook already
-- done to this device recently?" is the guard against a fix loop.
CREATE INDEX IF NOT EXISTS "DeviceCommand_shopId_deviceId_playbookId_createdAt_idx" ON "DeviceCommand"("shopId", "deviceId", "playbookId", "createdAt");

-- Foreign keys are added separately and guarded: ADD CONSTRAINT has no
-- IF NOT EXISTS in PostgreSQL, so a replay would otherwise fail on duplicate_object.
DO $$
BEGIN
  ALTER TABLE "SupportSession"
    ADD CONSTRAINT "SupportSession_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "DeviceCommand"
    ADD CONSTRAINT "DeviceCommand_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "DeviceCommand"
    ADD CONSTRAINT "DeviceCommand_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "SupportSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
