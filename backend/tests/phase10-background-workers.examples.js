import assert from "assert";
import fs from "fs";

function read(file) { return fs.readFileSync(file, "utf8"); }
function exists(file) { return fs.existsSync(file); }

const packageJson = JSON.parse(read("package.json"));
const envSource = read("src/config/env.js");
const redisSource = read("src/lib/redis.js");
const queueSource = read("src/lib/queue.js");
const queueNames = read("src/workers/queueNames.js");
const workerIndex = read("src/workers/index.js");
const workerUtils = read("src/workers/workerUtils.js");
const reportsWorker = read("src/workers/reports.worker.js");
const reminderWorker = read("src/workers/reminder.worker.js");
const syncCleanupWorker = read("src/workers/syncCleanup.worker.js");
const backupWorker = read("src/workers/backup.worker.js");
const exportsWorker = read("src/workers/exports.worker.js");
const appSource = read("src/app.js");
const productionCheck = read("scripts/production-check.js");

for (const file of [
  "src/lib/redis.js",
  "src/lib/queue.js",
  "src/workers/index.js",
  "src/workers/queues.js",
  "src/workers/queueNames.js",
  "src/workers/workerUtils.js",
  "src/workers/reminder.worker.js",
  "src/workers/reports.worker.js",
  "src/workers/exports.worker.js",
  "src/workers/backup.worker.js",
  "src/workers/syncCleanup.worker.js",
  "src/modules/jobs/jobs.routes.js",
]) {
  assert(exists(file), `${file} must exist`);
}

for (const snippet of ["REDIS_URL", "QUEUES_ENABLED", "WORKER_CONCURRENCY", "JOB_RETENTION_DAYS", "REDIS_URL is required in production when QUEUES_ENABLED=true"]) {
  assert(envSource.includes(snippet), `env.js must include ${snippet}`);
}

for (const snippet of ["getRedisClient", "isRedisEnabled", "maskRedisUrl", "redis_error", "redis_disabled"]) {
  assert(redisSource.includes(snippet), `redis.js missing ${snippet}`);
}
assert(!redisSource.includes("console.log(env.REDIS_URL)"), "Redis URL must not be logged raw");

for (const snippet of ["addJob", "getQueueStatus", "isQueueEnabled", "closeQueues", "JOB_QUEUE_DISABLED", "attempts: 3", "backoff", "removeOnComplete", "removeOnFail"]) {
  assert(queueSource.includes(snippet), `queue.js missing ${snippet}`);
}

for (const snippet of ["reminderQueue", "reportsQueue", "exportsQueue", "backupQueue", "syncCleanupQueue", "GENERATE_DAILY_CLOSING", "GENERATE_CSV_EXPORT", "GENERATE_REPORT_PDF", "SEND_WHATSAPP_REMINDER", "CLEANUP_SYNC_EVENTS", "ARCHIVE_OLD_SYNC_EVENTS"]) {
  assert(queueNames.includes(snippet), `queueNames.js missing ${snippet}`);
}

assert(packageJson.scripts.worker === "node src/workers/index.js", "npm run worker must start worker entry point");
assert(packageJson.scripts["worker:dev"], "worker:dev script should exist");
assert(packageJson.dependencies.bullmq, "bullmq dependency must be declared");
assert(packageJson.dependencies.ioredis, "ioredis dependency must be declared");

assert(!workerIndex.includes("from \"../app.js\"") && !workerIndex.includes("from \"../server.js\""), "worker must not import Express app/server");
for (const snippet of ["worker_startup", "worker_disabled", "SIGINT", "SIGTERM", "closeQueues", "closeRedis", "WORKER_CONCURRENCY"]) {
  assert(workerIndex.includes(snippet), `worker index missing ${snippet}`);
}

for (const snippet of ["job_start", "job_success", "job_failure", "sanitizeJobPayload", "[REDACTED]"]) {
  assert(workerUtils.includes(snippet), `workerUtils.js missing ${snippet}`);
}
for (const forbidden of ["ownerPin", "password", "token"]) {
  assert(!workerUtils.includes(`payload.${forbidden}`), `job logs must not directly log payload.${forbidden}`);
}

assert(reportsWorker.includes("GENERATE_DAILY_CLOSING"), "daily closing job must be registered");
assert(reportsWorker.includes("dailyClosingSnapshot.service.js") || reportsWorker.includes("DailyClosingSnapshot"), "daily closing worker should use persisted snapshot service when available");
assert(exportsWorker.includes("GENERATE_CSV_EXPORT") && exportsWorker.includes("GENERATE_REPORT_PDF"), "export job skeletons must exist");
assert(exportsWorker.includes("NOT_IMPLEMENTED"), "export jobs should return clear placeholder status");
assert(reminderWorker.includes("WHATSAPP_PROVIDER_NOT_CONFIGURED"), "reminder job must not fake WhatsApp success");
assert(reminderWorker.includes("whatsapp_reminders"), "reminder job should respect feature gate");
assert(syncCleanupWorker.includes("dryRun"), "sync cleanup must default to dry run");
assert(syncCleanupWorker.includes("payload.dryRun === false && payload.confirm === true"), "sync cleanup writes must require explicit confirmation");
assert(syncCleanupWorker.includes("90, 90, 3650"), "sync cleanup must enforce a minimum 90-day idempotency window");
assert(syncCleanupWorker.includes('status: "synced"'), "sync cleanup may delete only successful sync events");
assert(syncCleanupWorker.includes('status: { in: ["resolved", "dismissed"] }'), "sync cleanup may delete only closed conflict records");
assert(syncCleanupWorker.includes("Failed, processing, and conflict rows remain recoverable indefinitely"), "sync cleanup must preserve recoverable events");
assert(syncCleanupWorker.includes("Open conflict snapshots are never removed by retention"), "sync cleanup must preserve open conflicts");
assert(syncCleanupWorker.includes("take: limit"), "sync cleanup must use bounded batches");
assert(backupWorker.includes("RUN_SHOP_BACKUP") && backupWorker.includes("RUN_DATABASE_BACKUP"), "backup job skeletons must exist");
assert(backupWorker.includes("No DB credentials are stored in payloads"), "backup job must avoid DB credentials in payload");

assert(appSource.includes("/api/jobs"), "job status route must be registered");
assert(read("src/modules/jobs/jobs.routes.js").includes("requireRole(\"owner\", \"admin\")"), "job status route must be owner/admin protected");

for (const snippet of ["src/lib/redis.js", "src/lib/queue.js", "src/workers/index.js", "npm run worker", "REDIS_URL is required in production", "phase10-background-workers.examples.js"]) {
  assert(productionCheck.includes(snippet), `production check missing Phase 10 snippet: ${snippet}`);
}

for (const file of ["src/modules/bills/bills.service.js", "src/modules/inventory/inventory.service.js", "src/modules/udhar/udhar.service.js", "src/modules/payment-provider/paymentProvider.service.js"]) {
  const source = read(file);
  assert(!source.includes("CONFIRM_BILL") || !source.includes("addJob("), `${file} must not enqueue bill confirmation`);
  assert(!source.includes("DEDUCT_STOCK") || !source.includes("addJob("), `${file} must not enqueue stock deduction`);
  assert(!source.includes("VERIFY_PAYMENT") || !source.includes("addJob("), `${file} must not enqueue payment verification`);
}

assert(packageJson.scripts["test:billing"].includes("phase10-background-workers.examples.js"), "Phase 10 test must be wired into npm test");

console.log("Phase 10 background worker infrastructure examples passed");
