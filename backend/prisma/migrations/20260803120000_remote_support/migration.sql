-- Remote Support: consent-gated remote diagnosis + repair.
-- SupportSession is the owner's grant; DeviceCommand is the server→device queue
-- the devices drain on their existing sync poll.

CREATE TABLE "SupportSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "grantedByUserId" TEXT,
    "deviceId" TEXT,
    "codeHash" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'diagnose',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "operatorEmail" TEXT,
    "reason" TEXT,
    "redeemedAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "endedAt" DATETIME,
    "commandCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SupportSession_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SupportSession_codeHash_key" ON "SupportSession"("codeHash");
CREATE INDEX "SupportSession_shopId_status_createdAt_idx" ON "SupportSession"("shopId", "status", "createdAt");
CREATE INDEX "SupportSession_status_expiresAt_idx" ON "SupportSession"("status", "expiresAt");

CREATE TABLE "DeviceCommand" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "deliveredAt" DATETIME,
    "completedAt" DATETIME,
    "resultJson" TEXT,
    "error" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DeviceCommand_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DeviceCommand_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SupportSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "DeviceCommand_shopId_deviceId_status_createdAt_idx" ON "DeviceCommand"("shopId", "deviceId", "status", "createdAt");
CREATE INDEX "DeviceCommand_shopId_status_createdAt_idx" ON "DeviceCommand"("shopId", "status", "createdAt");
CREATE INDEX "DeviceCommand_sessionId_idx" ON "DeviceCommand"("sessionId");
-- Auto-fix cooldown and failure-streak lookups: "what has this playbook already
-- done to this device recently?" is the guard against a fix loop.
CREATE INDEX "DeviceCommand_shopId_deviceId_playbookId_createdAt_idx" ON "DeviceCommand"("shopId", "deviceId", "playbookId", "createdAt");
