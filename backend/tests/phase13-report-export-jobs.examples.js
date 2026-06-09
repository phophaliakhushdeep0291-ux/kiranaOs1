import assert from "assert";
import fs from "fs";

function read(file) { return fs.readFileSync(file, "utf8"); }
function exists(file) { return fs.existsSync(file); }

for (const file of [
  "prisma/schema.prisma",
  "prisma-postgres/schema.prisma",
  "prisma-postgres/migrations/000005_report_export_jobs/migration.sql",
  "src/modules/reports/reportExport.service.js",
  "src/modules/reports/reports.routes.js",
  "src/modules/reports/reports.controller.js",
  "src/modules/reports/reports.schema.js",
  "src/workers/exports.worker.js",
  "src/workers/queueNames.js",
  "src/lib/fileStorage.js",
  "scripts/run-daily-closing.js",
]) {
  assert(exists(file), `${file} must exist for Phase 13`);
}

const sqliteSchema = read("prisma/schema.prisma");
const pgSchema = read("prisma-postgres/schema.prisma");
const migration = read("prisma-postgres/migrations/000005_report_export_jobs/migration.sql");
const exportService = read("src/modules/reports/reportExport.service.js");
const reportRoutes = read("src/modules/reports/reports.routes.js");
const reportController = read("src/modules/reports/reports.controller.js");
const reportSchema = read("src/modules/reports/reports.schema.js");
const exportsWorker = read("src/workers/exports.worker.js");
const queueNames = read("src/workers/queueNames.js");
const fileStorage = read("src/lib/fileStorage.js");
const snapshotService = read("src/modules/reports/dailyClosingSnapshot.service.js");
const dailyClosingScript = read("scripts/run-daily-closing.js");
const productionCheck = read("scripts/production-check.js");
const packageJson = JSON.parse(read("package.json"));

for (const schema of [sqliteSchema, pgSchema]) {
  assert(schema.includes("model ReportExportJob"), "ReportExportJob model must exist");
  for (const field of ["shopId", "requestedByUserId", "reportType", "status", "paramsJson", "fileName", "filePath", "fileUrl", "mimeType", "sizeBytes", "expiresAt"]) {
    assert(schema.includes(field), `ReportExportJob must include ${field}`);
  }
  assert(schema.includes("@@index([shopId, status, createdAt])"), "ReportExportJob status index must exist");
  assert(schema.includes("@@index([shopId, reportType, createdAt])"), "ReportExportJob report type index must exist");
  assert(schema.includes("@@index([requestedByUserId, createdAt])"), "ReportExportJob user index must exist");
  assert(schema.includes("@@index([expiresAt])"), "ReportExportJob expiry index must exist");
}

assert(migration.includes('CREATE TABLE "ReportExportJob"'), "PostgreSQL migration must create ReportExportJob");
assert(migration.includes('ReportExportJob_shopId_status_createdAt_idx'), "Migration must include status index");
assert(migration.includes('ReportExportJob_requestedByUserId_fkey'), "Migration must include requestedBy FK");

for (const fn of [
  "createReportExportJob",
  "getReportExportJob",
  "listReportExportJobs",
  "markReportExportProcessing",
  "markReportExportCompleted",
  "markReportExportFailed",
  "cancelReportExportJob",
  "processReportExportJob",
]) {
  assert(exportService.includes(`export async function ${fn}`), `reportExport.service.js missing ${fn}`);
}
assert(exportService.includes("sanitizeExportParams"), "Export params must be sanitized before storage");
assert(exportService.includes("REPORT_EXPORT_JOB_CREATED"), "Export create audit action must exist");
assert(exportService.includes("REPORT_EXPORT_JOB_STARTED"), "Export started audit action must exist");
assert(exportService.includes("REPORT_EXPORT_JOB_COMPLETED"), "Export completed audit action must exist");
assert(exportService.includes("REPORT_EXPORT_JOB_FAILED"), "Export failed audit action must exist");
assert(exportService.includes("REPORT_EXPORT_JOB_CANCELLED"), "Export cancel audit action must exist");
for (const sensitive of ["ownerPin", "password", "token", "secret"]) {
  assert(!exportService.includes(`params.${sensitive}`), `Export service must not store params.${sensitive}`);
}

for (const route of ["/exports", "/exports/:jobId", "/exports/:jobId/download", "/exports/:jobId/cancel"]) {
  assert(reportRoutes.includes(route), `reports.routes.js missing ${route}`);
}
assert(reportRoutes.includes('router.post("/exports", requireRole("owner", "admin"), requireOwnerPin'), "Export creation must require owner/admin and owner PIN");
assert(reportRoutes.includes('router.post("/exports/:jobId/cancel", requireRole("owner", "admin"), requireOwnerPin'), "Export cancel must require owner/admin and owner PIN");
assert(reportSchema.includes("exportReportSchema") && reportSchema.includes("exportListSchema"), "Export schemas must exist");
for (const handler of ["createReportExportJob", "listReportExportJobs", "getReportExportJob", "cancelReportExportJob", "downloadReportExportJob"]) {
  assert(reportController.includes(`export async function ${handler}`), `Controller missing ${handler}`);
}
assert(reportController.includes("readExportFile"), "Download handler must stream protected file through backend");

assert(queueNames.includes("GENERATE_REPORT_EXPORT"), "Queue names must include GENERATE_REPORT_EXPORT");
assert(exportsWorker.includes("GENERATE_REPORT_EXPORT"), "Export worker must handle persistent export jobs");
assert(exportsWorker.includes("processReportExportJob"), "Export worker must call report export processor");
assert(!exportsWorker.includes("console.log(csv") && !exportsWorker.includes("console.log(report"), "Export worker must not log report contents");

for (const snippet of ["buildExportFilePath", "PATH_TRAVERSAL_BLOCKED", "path.resolve", "storage", "exports", "writeExportFile", "readExportFile", "validateReportType"]) {
  assert(fileStorage.includes(snippet), `fileStorage.js missing ${snippet}`);
}
assert(!fileStorage.includes("userProvidedFileName"), "File storage must not use user-provided filename directly");

assert(packageJson.scripts["daily-closing:run"] === "node scripts/run-daily-closing.js", "daily-closing:run script must exist");
for (const snippet of ["GENERATE_DAILY_CLOSING", "DAILY_CLOSING_SCHEDULED", "generateDailyClosingSnapshot", "isQueueEnabled", "Asia/Kolkata"]) {
  assert(dailyClosingScript.includes(snippet), `Daily closing script missing ${snippet}`);
}

assert(snapshotService.includes("getSnapshotStaleness"), "Snapshot staleness helper must exist");
assert(snapshotService.includes("Records changed after snapshot generation"), "Snapshot stale warning reason must exist");
assert(snapshotService.includes("overrideRefreshDailyClosingSnapshot"), "Locked snapshot override service must exist");
assert(snapshotService.includes("SNAPSHOT_OVERRIDE_REASON_REQUIRED"), "Override must require reason");
assert(reportRoutes.includes("/daily-closing/:date/override-refresh"), "Override refresh route must exist");
assert(reportRoutes.includes("overrideDailyClosingSnapshotSchema"), "Override route must validate reason body");
assert(reportController.includes("DAILY_CLOSING_SNAPSHOT_OVERRIDE_REFRESHED"), "Override refresh audit action must exist");

for (const snippet of [
  "ReportExportJob model must exist",
  "reportExport.service.js",
  "fileStorage.js",
  "run-daily-closing.js",
  "getSnapshotStaleness",
  "phase13-report-export-jobs.examples.js",
]) {
  assert(productionCheck.includes(snippet), `production-check missing Phase 13 snippet: ${snippet}`);
}
assert(packageJson.scripts["test:billing"].includes("phase13-report-export-jobs.examples.js"), "Phase 13 test must be wired into npm test");

console.log("Phase 13 report export jobs examples passed");
