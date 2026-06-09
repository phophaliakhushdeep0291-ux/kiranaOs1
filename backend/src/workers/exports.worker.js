import { cleanupExpiredReportExports, processReportExportJob } from "../modules/reports/reportExport.service.js";
import { JOB_NAMES } from "./queueNames.js";

export async function handleExportsJob(job) {
  switch (job.name) {
    case JOB_NAMES.GENERATE_REPORT_EXPORT:
      return processPersistentReportExport(job.data);
    case JOB_NAMES.CLEANUP_EXPIRED_EXPORTS:
      return cleanupExpiredExports(job.data);
    case JOB_NAMES.GENERATE_CSV_EXPORT:
    case JOB_NAMES.GENERATE_REPORT_PDF:
      return createExportPlaceholder(job.name, job.data);
    default: {
      const error = new Error(`Unknown exports job: ${job.name}`);
      error.code = "UNKNOWN_EXPORTS_JOB";
      throw error;
    }
  }
}

async function processPersistentReportExport(payload = {}) {
  const { exportJobId, shopId, userId } = payload;
  if (!exportJobId || !shopId || !userId) {
    const error = new Error("exportJobId, shopId, and userId are required for GENERATE_REPORT_EXPORT");
    error.code = "INVALID_REPORT_EXPORT_JOB_PAYLOAD";
    throw error;
  }
  // Phase 13: worker loads the tenant-scoped ReportExportJob by id and writes
  // generated CSV to safe local storage. It never logs report contents and does
  // not perform billing/payment/stock mutations.
  return processReportExportJob(exportJobId);
}

async function cleanupExpiredExports(payload = {}) {
  // Phase 14: cleanup only export files/metadata for expired completed exports.
  // It does not delete ReportExportJob records and never touches POS financial records.
  return cleanupExpiredReportExports({ limit: payload.limit ?? 100 });
}

function createExportPlaceholder(jobName, payload = {}) {
  if (!payload.shopId || !payload.userId) {
    const error = new Error("shopId and userId are required for export jobs");
    error.code = "INVALID_EXPORT_JOB_PAYLOAD";
    throw error;
  }
  return {
    status: "NOT_IMPLEMENTED",
    queued: true,
    jobName,
    reason: "Use GENERATE_REPORT_EXPORT with ReportExportJob persistence for Phase 13 async exports.",
  };
}
