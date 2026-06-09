import assert from "node:assert/strict";
import fs from "node:fs";

function read(file) { return fs.readFileSync(file, "utf8"); }
function exists(file) { return fs.existsSync(file); }

for (const file of [
  "scripts/verify-object-storage.js",
  "scripts/verify-export-flow.js",
  "src/modules/jobs/jobs.routes.js",
  "src/modules/jobs/jobs.controller.js",
  "src/lib/metrics.js",
  "src/lib/errorTracking.js",
  "scripts/smoke-test.js",
  "docs/ALERTING_RUNBOOK.md",
  "docs/PRODUCTION_DEPLOYMENT.md",
]) assert(exists(file), `${file} must exist`);

const storageVerify = read("scripts/verify-object-storage.js");
for (const snippet of [
  "storage-healthcheck",
  "putObject",
  "getObject",
  "getSignedDownloadUrl",
  "deleteObject",
  "ALLOW_PRODUCTION_STORAGE_VERIFY",
  "redactSensitive",
]) assert(storageVerify.includes(snippet), `verify-object-storage missing ${snippet}`);
assert(!/console\.(log|error)\([^\n]*(STORAGE_SECRET_ACCESS_KEY|STORAGE_ACCESS_KEY_ID)/.test(storageVerify), "storage verify must not log storage secrets directly");

const exportVerify = read("scripts/verify-export-flow.js");
for (const snippet of [
  "ALLOW_PRODUCTION_EXPORT_VERIFY",
  "EXPORT_VERIFY_SHOP_ID",
  "EXPORT_VERIFY_USER_ID",
  "createReportExportJob",
  "processReportExportJob",
  "readExportFile",
  "deleteExportFile",
]) assert(exportVerify.includes(snippet), `verify-export-flow missing ${snippet}`);

const jobsRoutes = read("src/modules/jobs/jobs.routes.js");
for (const snippet of [
  "/queues/:queueName",
  "/queues/:queueName/failed",
  "/queues/:queueName/pause",
  "/queues/:queueName/resume",
  "requireRole(\"owner\", \"admin\")",
]) assert(jobsRoutes.includes(snippet), `jobs route missing ${snippet}`);

const jobsController = read("src/modules/jobs/jobs.controller.js");
for (const snippet of ["payloadsExposed: false", "QUEUE_ALIASES", "queueDetail", "queueFailed", "pauseQueue", "resumeQueue"]) {
  assert(jobsController.includes(snippet), `jobs controller missing ${snippet}`);
}
assert(!jobsController.includes("job.data"), "failed job endpoints must not expose raw job payloads");

const queue = read("src/lib/queue.js");
for (const snippet of ["getQueueDetail", "pauseQueue", "resumeQueue", "recordQueueStatus", "SAFE_RETRY_QUEUE_SET"]) {
  assert(queue.includes(snippet), `queue service missing ${snippet}`);
}

const metrics = read("src/lib/metrics.js");
for (const snippet of [
  "renderPrometheusMetrics",
  "queue_jobs_waiting",
  "queue_jobs_failed",
  "db_ready_status",
  "redis_ready_status",
  "storage_ready_status",
  "FORBIDDEN_LABELS",
]) assert(metrics.includes(snippet), `metrics missing ${snippet}`);
assert(metrics.includes("shopId") && metrics.includes("userId") && metrics.includes("deviceId"), "metrics must explicitly forbid high-cardinality labels");
assert(!/labels\s*=\s*\{[^}]*shopId/.test(metrics), "metrics must not create labels with shopId");

const errorTracking = read("src/lib/errorTracking.js");
for (const snippet of ["ERROR_TRACKING_ENABLED", "SENTRY_DSN", "captureException", "captureRequestError", "captureWorkerError", "redactSensitive"]) {
  assert(errorTracking.includes(snippet), `error tracking adapter missing ${snippet}`);
}

const app = read("src/app.js");
for (const snippet of ["requireMetricsAccess", "METRICS_REQUIRE_TOKEN", "renderPrometheusMetrics", "recordReadinessStatus", "errorTracking"]) {
  assert(app.includes(snippet), `app missing ${snippet}`);
}

const smoke = read("scripts/smoke-test.js");
for (const snippet of ["ALLOW_PRODUCTION_SMOKE", "SMOKE_METRICS_EXPECTED", "SMOKE_EXPECT_REDIS", "SMOKE_EXPECT_STORAGE", "assertNoSecrets"]) {
  assert(smoke.includes(snippet), `smoke test missing ${snippet}`);
}

const runbook = read("docs/ALERTING_RUNBOOK.md");
for (const snippet of [
  "API down",
  "DB not ready",
  "Redis down",
  "Worker not processing",
  "Export jobs failing",
  "Storage upload",
  "Daily closing",
  "High 5xx",
  "Razorpay webhook",
  "Device license",
]) assert(runbook.includes(snippet), `alerting runbook missing ${snippet}`);

const docs = read("docs/PRODUCTION_DEPLOYMENT.md");
for (const snippet of [
  "npm run storage:verify",
  "npm run export:verify",
  "Sentry",
  "Better Stack",
  "UptimeRobot",
  "Grafana",
  "ALLOW_PRODUCTION_SMOKE",
  "ALERTING_RUNBOOK.md",
]) assert(docs.includes(snippet), `production docs missing ${snippet}`);

const ci = read(".github/workflows/backend-ci.yml");
for (const snippet of ["npm run storage:verify", "actions/upload-artifact", "npm-test.log", "prod-check.log"]) {
  assert(ci.includes(snippet), `CI missing ${snippet}`);
}

const env = read(".env.example");
for (const snippet of [
  "METRICS_REQUIRE_TOKEN",
  "METRICS_TOKEN",
  "ERROR_TRACKING_ENABLED",
  "SENTRY_DSN",
  "SMOKE_METRICS_EXPECTED",
  "ALLOW_PRODUCTION_SMOKE",
  "ALLOW_PRODUCTION_STORAGE_VERIFY",
  "ALLOW_PRODUCTION_EXPORT_VERIFY",
]) assert(env.includes(snippet), `.env.example missing ${snippet}`);

const pkg = JSON.parse(read("package.json"));
assert(pkg.scripts["storage:verify"], "package.json must include storage:verify");
assert(pkg.scripts["export:verify"], "package.json must include export:verify");
assert(pkg.scripts["test:billing"].includes("phase16-monitoring-provider-validation.examples.js"), "Phase 16 tests must be wired into npm test");

console.log("Phase 16 monitoring/provider validation examples passed");
