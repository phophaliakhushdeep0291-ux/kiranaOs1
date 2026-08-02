import assert from "node:assert/strict";
import fs from "node:fs";

function read(file) { return fs.readFileSync(file, "utf8"); }
function exists(file) { return fs.existsSync(file); }

for (const file of [
  "src/lib/objectStorage.js",
  "src/lib/fileStorage.js",
  "src/lib/logger.js",
  "src/lib/metrics.js",
  "src/modules/jobs/jobs.routes.js",
  "scripts/smoke-test.js",
  "docs/PRODUCTION_DEPLOYMENT.md",
]) assert(exists(file), `${file} must exist`);

const objectStorage = read("src/lib/objectStorage.js");
for (const snippet of [
  "S3Client",
  "PutObjectCommand",
  "GetObjectCommand",
  "DeleteObjectCommand",
  "getSignedUrl",
  "s3",
  "r2",
  "minio",
  "STORAGE_FORCE_PATH_STYLE",
  "EXPORT_SIGNED_URL_TTL_SECONDS",
  "OBJECT_STORAGE_CONFIG_MISSING",
  "PATH_TRAVERSAL_BLOCKED",
  "checkStorageHealth",
]) assert(objectStorage.includes(snippet), `objectStorage missing ${snippet}`);
assert(objectStorage.includes("do not fake cloud upload success"), "cloud upload success must not be faked");
assert(!objectStorage.includes("console.log(env.STORAGE_SECRET_ACCESS_KEY)"), "storage secret must not be logged");

const fileStorage = read("src/lib/fileStorage.js");
for (const snippet of [
  "putObject",
  "getObjectStream",
  "getSignedDownloadUrl",
  "streamExportFile",
  // The key stays server-generated from validated ids; only the extension is
  // now format-driven (csv/pdf/xlsx) rather than hardcoded to .csv.
  "exports/${safeShopId}/${safeJobId}.${exportFormatFor(reportType).extension}",
  "EXPORT_DOWNLOADS_PUBLIC",
]) assert(fileStorage.includes(snippet), `fileStorage missing ${snippet}`);
assert(!fileStorage.includes("${fileName}`"), "storage key must never interpolate a user-supplied filename");
assert(!fileStorage.includes("res.sendFile(job.filePath)"), "download must not expose raw local file path");

const reportExport = read("src/modules/reports/reportExport.service.js");
for (const snippet of ["deleteExportFile", "cleanupExpiredReportExports", "REPORT_EXPORT_JOB_EXPIRED_CLEANED", "recordExportJob"]) {
  assert(reportExport.includes(snippet), `reportExport service missing ${snippet}`);
}

const jobsRoutes = read("src/modules/jobs/jobs.routes.js");
for (const snippet of ["/status", "/failed", "/:queueName/:jobId/retry", "/:queueName/:jobId/discard", "requireRole(\"owner\", \"admin\")"]) {
  assert(jobsRoutes.includes(snippet), `jobs routes missing ${snippet}`);
}

const jobsController = read("src/modules/jobs/jobs.controller.js");
assert(jobsController.includes("payloadsExposed: false"), "failed job endpoint must not expose payloads");

const logger = read("src/lib/logger.js");
for (const snippet of ["redactSensitive", "password", "ownerPin", "token", "JWT", "secret", "[REDACTED]"]) {
  assert(logger.includes(snippet), `logger missing redaction ${snippet}`);
}

const workerUtils = read("src/workers/workerUtils.js");
assert(workerUtils.includes("sanitizeJobPayload"), "worker logs must sanitize payload");
assert(workerUtils.includes("[REDACTED]"), "worker logs must redact sensitive values");

const metrics = read("src/lib/metrics.js");
for (const snippet of [
  "http_requests_total",
  "http_request_duration_ms",
  "http_errors_total",
  "sync_push_total",
  "sync_pull_total",
  "report_export_jobs_total",
  "worker_jobs_processed_total",
  "storage_errors_total",
]) assert(metrics.includes(snippet), `metrics missing ${snippet}`);
assert(metrics.includes("Labels intentionally exclude shopId/userId/deviceId"), "metrics must avoid high-cardinality labels");

const app = read("src/app.js");
for (const snippet of ["/api/health/metrics", "/metrics", "checkStorageHealth", "checks.storage", "checks.redis"]) {
  assert(app.includes(snippet), `app missing health/metrics ${snippet}`);
}

const smoke = read("scripts/smoke-test.js");
for (const snippet of ["SMOKE_BASE_URL", "/api/health", "/health/ready", "SMOKE_EXPECT_REDIS", "SMOKE_EXPECT_STORAGE"]) {
  assert(smoke.includes(snippet), `smoke test missing ${snippet}`);
}

const docs = read("docs/PRODUCTION_DEPLOYMENT.md");
for (const snippet of ["S3", "Cloudflare R2", "MinIO", "signed URL", "Alert checklist", "Smoke test", "GET /api/jobs/failed"]) {
  assert(docs.includes(snippet), `production docs missing ${snippet}`);
}

const ci = read(".github/workflows/backend-ci.yml");
for (const snippet of ["actions/upload-artifact", "npm-test.log", "prod-check.log"]) {
  assert(ci.includes(snippet), `CI must preserve logs/artifacts: ${snippet}`);
}

const env = read(".env.example");
for (const snippet of ["STORAGE_FORCE_PATH_STYLE", "EXPORT_SIGNED_URL_TTL_SECONDS", "METRICS_ENABLED", "SMOKE_BASE_URL"]) {
  assert(env.includes(snippet), `.env.example missing ${snippet}`);
}

console.log("Phase 15 object storage and observability examples passed");
