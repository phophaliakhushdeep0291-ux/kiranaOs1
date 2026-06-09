import fs from "fs";
import assert from "assert";

function read(file) { return fs.readFileSync(file, "utf8"); }
const packageJson = JSON.parse(read("package.json"));
const heartbeat = read("src/lib/workerHeartbeat.js");
const queue = read("src/lib/queue.js");
const workerIndex = read("src/workers/index.js");
const metrics = read("src/lib/metrics.js");
const jobsRoutes = read("src/modules/jobs/jobs.routes.js");
const jobsController = read("src/modules/jobs/jobs.controller.js");
const envSource = read("src/config/env.js");
const envExample = read(".env.example");
const workerHealthScript = read("scripts/check-worker-health.js");
const docs = read("docs/WORKER_OPERATIONS.md");
const prodCheck = read("scripts/production-check.js");

for (const snippet of [
  "recordWorkerHeartbeat",
  "startWorkerHeartbeat",
  "getWorkerHeartbeats",
  "WORKER_HEARTBEAT_INTERVAL_MS",
  "WORKER_STALE_AFTER_MS",
  "HEARTBEAT_PREFIX",
  "sanitizeWorkerRecord",
  "lastSeenAt",
  "fresh",
]) {
  assert.ok(heartbeat.includes(snippet), `workerHeartbeat.js missing ${snippet}`);
}

for (const forbidden of ["ownerPin", "password", "token", "secret", "authorization", "signature", "mobile", "email", "payloadJson"]) {
  assert.ok(!new RegExp(`res\\.json[\\s\\S]{0,300}${forbidden}`, "i").test(heartbeat), `heartbeat API data must not expose ${forbidden}`);
}

for (const snippet of ["workerHeartbeat", "getWorkerHeartbeats", "recordWorkerReadinessStatus"]) {
  assert.ok(queue.includes(snippet), `queue.js missing ${snippet}`);
}

for (const snippet of ["startWorkerHeartbeat", "heartbeatController", "workerInstanceId", "heartbeatStaleAfterMs", "heartbeatController?.stop"]) {
  assert.ok(workerIndex.includes(snippet), `workers/index.js missing ${snippet}`);
}

for (const snippet of ["worker_ready_status", "worker_heartbeat_age_ms", "recordWorkerReadinessStatus"]) {
  assert.ok(metrics.includes(snippet), `metrics.js missing ${snippet}`);
}
assert.ok(!metrics.includes("shopId") || metrics.includes("FORBIDDEN_LABELS"), "metrics must continue avoiding tenant-specific labels");

assert.ok(jobsRoutes.includes('/workers'), "jobs routes must expose /workers readiness endpoint");
assert.ok(jobsRoutes.includes('requireRole("owner", "admin")'), "worker readiness endpoint must remain owner/admin protected by router middleware");
assert.ok(jobsController.includes("workerHealth"), "jobs controller must implement workerHealth");
assert.ok(jobsController.includes("payloadsExposed: false"), "worker health response must explicitly avoid payload exposure");

for (const snippet of ["WORKER_INSTANCE_ID", "WORKER_HEARTBEAT_INTERVAL_MS", "WORKER_STALE_AFTER_MS"]) {
  assert.ok(envSource.includes(snippet), `env.js missing ${snippet}`);
  assert.ok(envExample.includes(snippet), `.env.example missing ${snippet}`);
}

for (const snippet of ["WORKER_HEARTBEAT_STALE_OR_MISSING", "worker_health_passed", "worker_health_failed", "closeRedis", "closeQueues"]) {
  assert.ok(workerHealthScript.includes(snippet), `check-worker-health.js missing ${snippet}`);
}
assert.ok(packageJson.scripts["worker:health"].includes("scripts/check-worker-health.js"), "package.json missing worker:health script");
assert.ok(packageJson.scripts["test:billing"].includes("phase23-worker-health-readiness.examples.js"), "Phase 23 test must be wired into npm test");

for (const snippet of ["GET /api/jobs/workers", "npm run worker:health", "worker_ready_status", "worker_heartbeat_age_ms", "core financial operations must never be moved to background jobs"]) {
  assert.ok(docs.includes(snippet), `WORKER_OPERATIONS.md missing ${snippet}`);
}
assert.ok(prodCheck.includes("Phase 23"), "production-check must include Phase 23 checks");

console.log("Phase 23 worker health readiness examples passed");
