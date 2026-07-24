-- Diagnostics: own-backend error store (grouped) + user support requests.
-- Errors are persisted here in addition to Sentry so support can diagnose
-- thousands of shops remotely. shopId is nullable because pre-auth crashes and
-- some backend 5xxs carry no tenant; grouping is by a content-hash fingerprint
-- that bakes in the shop scope, so it never collides across tenants.

CREATE TABLE "ErrorGroup" (
  "id" TEXT NOT NULL,
  "shopId" TEXT,
  "fingerprint" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "errorCode" TEXT,
  "sampleMessage" TEXT NOT NULL,
  "sampleStack" TEXT,
  "count" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'open',
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ErrorGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ErrorEvent" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "shopId" TEXT,
  "userId" TEXT,
  "deviceId" TEXT,
  "orgId" TEXT,
  "source" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "stack" TEXT,
  "errorCode" TEXT,
  "endpoint" TEXT,
  "functionName" TEXT,
  "fileName" TEXT,
  "lineNumber" INTEGER,
  "appVersion" TEXT,
  "backendVersion" TEXT,
  "os" TEXT,
  "browser" TEXT,
  "networkStatus" TEXT,
  "onlineMode" BOOLEAN,
  "memoryUsageMb" DOUBLE PRECISION,
  "route" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErrorEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportRequest" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "userId" TEXT,
  "deviceId" TEXT,
  "description" TEXT NOT NULL,
  "page" TEXT,
  "appVersion" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "contextJson" TEXT NOT NULL DEFAULT '{}',
  "screenshotKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ErrorGroup_fingerprint_key" ON "ErrorGroup"("fingerprint");
CREATE INDEX "ErrorGroup_shopId_lastSeenAt_idx" ON "ErrorGroup"("shopId", "lastSeenAt");
CREATE INDEX "ErrorGroup_shopId_status_lastSeenAt_idx" ON "ErrorGroup"("shopId", "status", "lastSeenAt");

CREATE INDEX "ErrorEvent_groupId_createdAt_idx" ON "ErrorEvent"("groupId", "createdAt");
CREATE INDEX "ErrorEvent_shopId_createdAt_idx" ON "ErrorEvent"("shopId", "createdAt");

CREATE INDEX "SupportRequest_shopId_status_createdAt_idx" ON "SupportRequest"("shopId", "status", "createdAt");
CREATE INDEX "SupportRequest_shopId_createdAt_idx" ON "SupportRequest"("shopId", "createdAt");

ALTER TABLE "ErrorGroup" ADD CONSTRAINT "ErrorGroup_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ErrorEvent" ADD CONSTRAINT "ErrorEvent_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ErrorGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ErrorEvent" ADD CONSTRAINT "ErrorEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportRequest" ADD CONSTRAINT "SupportRequest_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
