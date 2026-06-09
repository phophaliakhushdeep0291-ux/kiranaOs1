#!/usr/bin/env node
process.env.DATABASE_URL ||= "file:./prisma/dev.db";
process.env.JWT_SECRET ||= "export-verify-jwt-secret-32-characters-minimum";
process.env.NODE_ENV ||= "development";

const { env } = await import("../src/config/env.js");
const { redactSensitive } = await import("../src/lib/logger.js");

function log(payload) {
  console.log(JSON.stringify(redactSensitive(payload)));
}

async function cleanup(db, job) {
  if (job?.filePath) await globalThis.__kiranaExportVerifyDeleteExportFile?.(job.filePath).catch(() => null);
  if (job?.id) {
    await db.reportExportJob.update({
      where: { id: job.id },
      data: { status: "cancelled", filePath: null, fileUrl: null, error: "Export verification cleanup" },
    }).catch(() => null);
  }
}

async function main() {
  if (env.NODE_ENV === "production" && process.env.ALLOW_PRODUCTION_EXPORT_VERIFY !== "true") {
    throw new Error("Refusing production export verification unless ALLOW_PRODUCTION_EXPORT_VERIFY=true");
  }

  const shopId = process.env.EXPORT_VERIFY_SHOP_ID;
  const userId = process.env.EXPORT_VERIFY_USER_ID;
  const reportType = process.env.EXPORT_VERIFY_REPORT_TYPE || "daily_closing_csv";
  const date = process.env.EXPORT_VERIFY_DATE || new Date().toISOString().slice(0, 10);

  if (!shopId || !userId) {
    log({
      type: "export_verify_skipped",
      reason: "EXPORT_VERIFY_SHOP_ID and EXPORT_VERIFY_USER_ID are required for direct staging validation",
      suggestedCommand: "EXPORT_VERIFY_SHOP_ID=<shopId> EXPORT_VERIFY_USER_ID=<userId> npm run export:verify",
    });
    return;
  }

  let db;
  let job;
  try {
    db = (await import("../src/db.js")).default;
    const { createReportExportJob, processReportExportJob, getReportExportJob, getReportExportJobForDownload } = await import("../src/modules/reports/reportExport.service.js");
    const { readExportFile, deleteExportFile } = await import("../src/lib/fileStorage.js");
    globalThis.__kiranaExportVerifyDeleteExportFile = deleteExportFile;
    log({ type: "export_verify_start", shopId, userId, reportType, date });
    job = await createReportExportJob(shopId, userId, reportType, { date, from: date, to: date });
    const result = await processReportExportJob(job.id);
    const dbJob = await getReportExportJobForDownload(shopId, job.id);
    if (dbJob.status !== "completed") throw new Error(`Export job not completed: ${dbJob.status}`);
    const file = await readExportFile(dbJob.filePath);
    if (!Buffer.isBuffer(file)) throw new Error("Export file read did not return a buffer");
    const safeJob = await getReportExportJob(shopId, job.id);
    if (env.EXPORT_DOWNLOADS_PUBLIC && env.STORAGE_PROVIDER !== "local" && !safeJob.fileUrl) {
      throw new Error("Expected signed/public download mode metadata to be present");
    }
    log({ type: "export_verify_completed", jobId: job.id, reportType, sizeBytes: dbJob.sizeBytes, processResult: result.status });
  } finally {
    if (job && db) await cleanup(db, { ...(await db.reportExportJob.findUnique({ where: { id: job.id } }).catch(() => null)), id: job.id });
    await db?.$disconnect?.().catch(() => null);
  }
}

main().catch(async (error) => {
  console.error(JSON.stringify(redactSensitive({ type: "export_verify_failed", errorCode: error.code, message: error.message })));
  process.exit(1);
});
