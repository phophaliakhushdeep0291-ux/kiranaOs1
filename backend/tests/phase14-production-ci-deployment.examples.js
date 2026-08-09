import assert from "assert";
import fs from "fs";

function read(file) { return fs.readFileSync(file, "utf8"); }
function exists(file) { return fs.existsSync(file); }

for (const file of [
  ".github/workflows/backend-ci.yml",
  "Dockerfile",
  "docker-compose.yml",
  "docs/SCHEDULING.md",
  "docs/PRODUCTION_DEPLOYMENT.md",
  "src/lib/objectStorage.js",
  "src/lib/fileStorage.js",
  "scripts/verify-worker-runtime.js",
  "src/workers/exports.worker.js",
  "src/workers/queueNames.js",
  "src/modules/reports/reportExport.service.js",
  "scripts/production-check.js",
]) {
  assert(exists(file), `${file} must exist for Phase 14`);
}

const ci = read(".github/workflows/backend-ci.yml");
for (const snippet of [
  "postgres:",
  "redis:",
  "node-version: 20",
  "npm ci",
  "npm run prisma:generate",
  "npm run prisma:generate:postgres",
  "npx prisma validate",
  "npm run prisma:deploy:postgres",
  "npm run test:db",
  "npm test",
  "npm run worker:verify",
  "npm run prod:check",
  "docker build .",
]) {
  assert(ci.includes(snippet), `CI workflow must include ${snippet}`);
}
assert(!ci.includes("RAZORPAY_KEY_SECRET=rz") && !ci.includes("prod-secret"), "CI must not contain production secrets");

const dockerfile = read("Dockerfile");
for (const snippet of ["npm ci", "npm run prisma:generate:postgres", "/health/ready", "npm run deploy:migrate:postgres", "npm start"]) {
  assert(dockerfile.includes(snippet), `Dockerfile must include ${snippet}`);
}
assert(!dockerfile.includes("JWT_SECRET=") && !dockerfile.includes("RAZORPAY_KEY_" + "SECRET="), "Dockerfile must not bake secrets");

const compose = read("docker-compose.yml");
for (const snippet of ["api:", "worker:", "postgres:", "redis:", "redis://redis:6379", "/health/ready", "npm", "worker"]) {
  assert(compose.includes(snippet), `docker-compose must include ${snippet}`);
}

const objectStorage = read("src/lib/objectStorage.js");
for (const snippet of [
  "STORAGE_PROVIDER",
  "local",
  "s3",
  "r2",
  "minio",
  "PATH_TRAVERSAL_BLOCKED",
  "LOCAL_STORAGE_NOT_PUBLIC_PRODUCTION_SAFE",
  "OBJECT_STORAGE_PROVIDER_NOT_IMPLEMENTED",
  "[REDACTED]",
]) {
  assert(objectStorage.includes(snippet), `objectStorage.js missing ${snippet}`);
}
assert(!objectStorage.includes("console.log(env.STORAGE_SECRET_ACCESS_KEY)"), "storage secret must not be logged");

const fileStorage = read("src/lib/fileStorage.js");
for (const snippet of ["putObject", "getObject", "deleteObject", "buildExportStorageKey", "PATH_TRAVERSAL_BLOCKED"]) {
  assert(fileStorage.includes(snippet), `fileStorage.js must use object storage safely: ${snippet}`);
}

const queueNames = read("src/workers/queueNames.js");
for (const snippet of ["CLEANUP_EXPIRED_EXPORTS", "WORKER_HEALTHCHECK", "GENERATE_DAILY_CLOSING", "GENERATE_REPORT_EXPORT"]) {
  assert(queueNames.includes(snippet), `queueNames missing ${snippet}`);
}

const exportsWorker = read("src/workers/exports.worker.js");
for (const snippet of ["CLEANUP_EXPIRED_EXPORTS", "cleanupExpiredReportExports", "does not delete ReportExportJob records", "never touches POS financial records"]) {
  assert(exportsWorker.includes(snippet), `exports.worker.js missing cleanup safety: ${snippet}`);
}
assert(!exportsWorker.includes("CONFIRM_BILL") && !exportsWorker.includes("DEDUCT_STOCK"), "export worker must not process financial mutations");

const reportExportService = read("src/modules/reports/reportExport.service.js");
for (const snippet of ["cleanupExpiredReportExports", "deleteExportFile", "expiresAt", "REPORT_EXPORT_JOB_EXPIRED_CLEANED"]) {
  assert(reportExportService.includes(snippet), `reportExport.service.js missing cleanup behavior: ${snippet}`);
}
assert(!reportExportService.includes("params.ownerPin") && !reportExportService.includes("params.password"), "export params must not store sensitive fields");

const verifyWorker = read("scripts/verify-worker-runtime.js");
for (const snippet of ["WORKER_HEALTHCHECK", "QueueEvents", "Worker", "worker_verify_success", "worker_verify_skipped"]) {
  assert(verifyWorker.includes(snippet), `worker verification missing ${snippet}`);
}
assert(!verifyWorker.includes("ownerPin") && !verifyWorker.includes("password"), "worker verification must not enqueue secrets");

const scheduling = read("docs/SCHEDULING.md");
for (const snippet of ["2 AM Asia/Kolkata", "npm run daily-closing:run", "cron", "PM2", "Render", "Railway", "GitHub Actions", "systemd", "does not overwrite locked snapshots"]) {
  assert(scheduling.includes(snippet), `scheduling docs missing ${snippet}`);
}

const deploymentDocs = read("docs/PRODUCTION_DEPLOYMENT.md");
for (const snippet of ["Environment variables", "PostgreSQL", "Prisma", "Redis", "npm run worker", "daily-closing", "Export storage", "Health checks", "Backup", "Prisma binary missing", "migration drift", "Redis down", "worker not running"]) {
  assert(deploymentDocs.includes(snippet), `deployment docs missing ${snippet}`);
}

const envExample = read(".env.example");
for (const key of ["STORAGE_PROVIDER", "STORAGE_BUCKET", "STORAGE_REGION", "STORAGE_ENDPOINT", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY", "STORAGE_PUBLIC_BASE_URL", "EXPORT_DOWNLOADS_PUBLIC"]) {
  assert(new RegExp(`^${key}=`, "m").test(envExample), `.env.example missing ${key}`);
}

const envSource = read("src/config/env.js");
for (const snippet of ["STORAGE_PROVIDER", "EXPORT_DOWNLOADS_PUBLIC", "STORAGE_PROVIDER=local is not production-safe", "STORAGE_BUCKET", "STORAGE_SECRET_ACCESS_KEY"]) {
  assert(envSource.includes(snippet), `env.js missing ${snippet}`);
}

const packageJson = JSON.parse(read("package.json"));
assert(packageJson.scripts["worker:verify"] === "node scripts/verify-worker-runtime.js", "worker:verify script must exist");
// The image proof moved behind a wrapper so CI can reuse buildx layers between
// runs. Pinning the old literal `docker build .` made this assertion fail from
// the moment that landed. Pin the wrapper instead, and assert the wrapper still
// performs a real build — a cache-only script would leave the image proof
// proving nothing.
assert(packageJson.scripts["docker:build"] === "node scripts/docker-build.js", "docker:build must run the image-proof wrapper");
const dockerBuild = read("scripts/docker-build.js");
assert(dockerBuild.includes('docker(["build", "."])'), "the image proof must still run a real docker build");
assert(packageJson.scripts["test:billing"].includes("phase14-production-ci-deployment.examples.js"), "Phase 14 test must be wired into npm test");

const productionCheck = read("scripts/production-check.js");
for (const snippet of ["backend-ci.yml", "objectStorage.js", "worker:verify", "CLEANUP_EXPIRED_EXPORTS", "PRODUCTION_DEPLOYMENT.md", "SCHEDULING.md"]) {
  assert(productionCheck.includes(snippet), `production-check missing ${snippet}`);
}

const workerIndex = read("src/workers/index.js");
assert(!workerIndex.includes("../app.js") && !workerIndex.includes("../server.js"), "worker runtime must not import/start Express server");

console.log("Phase 14 production CI/deployment examples passed");
