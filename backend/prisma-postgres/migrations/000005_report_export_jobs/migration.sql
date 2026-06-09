-- Phase 13: persistent report export jobs for async CSV/PDF export tracking.
CREATE TABLE "ReportExportJob" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "reportType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "paramsJson" TEXT NOT NULL DEFAULT '{}',
  "fileName" TEXT,
  "filePath" TEXT,
  "fileUrl" TEXT,
  "mimeType" TEXT,
  "sizeBytes" INTEGER,
  "error" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReportExportJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ReportExportJob_shopId_status_createdAt_idx" ON "ReportExportJob"("shopId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "ReportExportJob_shopId_reportType_createdAt_idx" ON "ReportExportJob"("shopId", "reportType", "createdAt");
CREATE INDEX IF NOT EXISTS "ReportExportJob_requestedByUserId_createdAt_idx" ON "ReportExportJob"("requestedByUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "ReportExportJob_expiresAt_idx" ON "ReportExportJob"("expiresAt");

ALTER TABLE "ReportExportJob" ADD CONSTRAINT "ReportExportJob_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportExportJob" ADD CONSTRAINT "ReportExportJob_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
