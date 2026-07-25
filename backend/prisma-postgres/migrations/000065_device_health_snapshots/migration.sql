-- Device health monitoring (Diagnostics §4): per-device runtime health snapshots.
-- Time-series; "current health" is the latest row per (shopId, deviceId).
-- overallStatus/healthScore are computed server-side from the raw signals.

CREATE TABLE "DeviceHealthSnapshot" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "userId" TEXT,
  "overallStatus" TEXT NOT NULL DEFAULT 'unknown',
  "healthScore" INTEGER,
  "printerStatus" TEXT,
  "printerName" TEXT,
  "scannerStatus" TEXT,
  "online" BOOLEAN,
  "networkType" TEXT,
  "dbStatus" TEXT,
  "storageUsedMb" DOUBLE PRECISION,
  "storageQuotaMb" DOUBLE PRECISION,
  "appVersion" TEXT,
  "os" TEXT,
  "browser" TEXT,
  "batteryLevel" INTEGER,
  "batteryCharging" BOOLEAN,
  "ramUsedMb" DOUBLE PRECISION,
  "ramLimitMb" DOUBLE PRECISION,
  "cpuPercent" DOUBLE PRECISION,
  "extraJson" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeviceHealthSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeviceHealthSnapshot_shopId_deviceId_createdAt_idx" ON "DeviceHealthSnapshot"("shopId", "deviceId", "createdAt");
CREATE INDEX "DeviceHealthSnapshot_shopId_createdAt_idx" ON "DeviceHealthSnapshot"("shopId", "createdAt");

ALTER TABLE "DeviceHealthSnapshot" ADD CONSTRAINT "DeviceHealthSnapshot_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
