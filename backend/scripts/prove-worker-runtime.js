import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

process.env.DATABASE_URL ||= "file:./prisma/test.db";
process.env.JWT_SECRET ||= "worker-proof-jwt-secret-32-characters-minimum";
process.env.LICENSE_SIGNING_SECRET ||= "worker-proof-license-secret-32-characters-minimum";
process.env.NODE_ENV ||= "test";

const startedAt = new Date();
const repositoryRoot = path.resolve(process.cwd(), "..");
const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
const reportPath = path.resolve(
  process.env.WORKER_PROOF_REPORT_PATH ||
    path.join(process.cwd(), "release-artifacts", `redis-worker-production-proof-${stamp}.json`)
);
const latestReportPath = path.join(path.dirname(reportPath), "redis-worker-production-proof-latest.json");

function readGitValue(args) {
  const result = spawnSync("git", args, { cwd: repositoryRoot, encoding: "utf8", shell: false });
  return result.status === 0 ? String(result.stdout || "").trim() || null : null;
}

function readGitLines(args) {
  return String(readGitValue(args) || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function backendSourceFingerprint() {
  const hash = crypto.createHash("sha256");
  hash.update(readGitValue(["rev-parse", "HEAD"]) || "unknown-commit");
  const diff = spawnSync("git", ["diff", "--binary", "HEAD", "--", "backend"], {
    cwd: repositoryRoot,
    encoding: null,
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (diff.status !== 0) throw new Error("Could not fingerprint backend source diff");
  hash.update(diff.stdout || Buffer.alloc(0));
  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard", "-z", "--", "backend"], {
    cwd: repositoryRoot,
    encoding: null,
    shell: false,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (untracked.status !== 0) throw new Error("Could not fingerprint untracked backend source");
  for (const relativePath of String(untracked.stdout || "").split("\0").filter(Boolean).sort()) {
    hash.update(`\0${relativePath}\0`);
    hash.update(fs.readFileSync(path.join(repositoryRoot, relativePath)));
  }
  return hash.digest("hex");
}

const backendSourceFingerprintAtStart = backendSourceFingerprint();

function redisServerVersion(info = "") {
  return String(info).match(/(?:^|\r?\n)redis_version:([^\r\n]+)/)?.[1]?.trim() || "unknown";
}

function writeReport({ status, redisVersion = null, heartbeatBefore = null, heartbeatAfter = null, job = null, failure = null }) {
  const completedAt = new Date();
  const report = {
    schemaVersion: 1,
    type: "kiranaos_redis_worker_production_proof",
    status,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    repository: {
      commit: readGitValue(["rev-parse", "HEAD"]),
      branch: readGitValue(["branch", "--show-current"]),
      dirty: Boolean(readGitValue(["status", "--porcelain"])),
      backendDirty: Boolean(readGitValue(["status", "--porcelain", "--", "backend"])),
      dirtyPaths: readGitLines(["status", "--porcelain"]).map((line) => line.slice(3)).sort(),
      backendSourceFingerprintSha256: backendSourceFingerprintAtStart,
      backendSourceStable: backendSourceFingerprintAtStart === backendSourceFingerprint(),
    },
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    redis: {
      configured: Boolean(process.env.REDIS_URL),
      serverVersion: redisVersion,
      urlRetained: false,
    },
    databaseProvider: /^postgres(?:ql)?:\/\//i.test(process.env.DATABASE_URL || "") ? "postgresql" : "sqlite",
    heartbeatBefore,
    heartbeatAfter,
    job,
    failure,
    limitations: [
      "This proves a real Redis-compatible server and a separately running KiranaOS worker on the tested source snapshot.",
      "A local runtime proof is not evidence of multi-node failover, managed Redis durability, or deployed production uptime.",
    ],
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  fs.writeFileSync(reportPath, serialized, "utf8");
  if (latestReportPath !== reportPath) fs.writeFileSync(latestReportPath, serialized, "utf8");
  return report;
}

let queueEvents;
let proofJob;
let redisVersion = null;
let heartbeatBefore = null;
let heartbeatAfter = null;
let jobEvidence = null;

async function closeRuntime() {
  const [{ closeRedis }, { closeQueues }] = await Promise.all([
    import("../src/lib/redis.js"),
    import("../src/lib/queue.js"),
  ]);
  await proofJob?.remove?.().catch(() => null);
  await queueEvents?.close?.().catch(() => null);
  await closeQueues().catch(() => null);
  await closeRedis().catch(() => null);
}

async function main() {
  const [bull, redisModule, queueModule, heartbeatModule, names] = await Promise.all([
    import("bullmq"),
    import("../src/lib/redis.js"),
    import("../src/lib/queue.js"),
    import("../src/lib/workerHeartbeat.js"),
    import("../src/workers/queueNames.js"),
  ]);

  if (!queueModule.isQueueEnabled()) {
    const error = new Error("QUEUES_ENABLED=true and REDIS_URL are required for production worker proof");
    error.code = "WORKER_PROOF_QUEUES_DISABLED";
    throw error;
  }

  heartbeatBefore = await heartbeatModule.getWorkerHeartbeats();
  if (!heartbeatBefore.healthy) {
    const error = new Error("A fresh heartbeat from a separately running KiranaOS worker is required");
    error.code = "WORKER_PROOF_HEARTBEAT_MISSING";
    throw error;
  }

  const connection = await redisModule.getRedisClient();
  if (!connection) {
    const error = new Error("Redis connection unavailable for production worker proof");
    error.code = "WORKER_PROOF_REDIS_UNAVAILABLE";
    throw error;
  }
  redisVersion = redisServerVersion(await connection.info("server"));

  queueEvents = new bull.QueueEvents(names.QUEUE_NAMES.syncCleanupQueue, { connection });
  await queueEvents.waitUntilReady();

  const requestedAt = new Date().toISOString();
  const jobId = `production-worker-proof-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const queued = await queueModule.addJob(
    names.QUEUE_NAMES.syncCleanupQueue,
    names.JOB_NAMES.WORKER_HEALTHCHECK,
    { shopId: "worker-production-proof", requestedAt },
    { jobId, attempts: 1, removeOnComplete: false, removeOnFail: false }
  );
  if (!queued.success) {
    const error = new Error(`Production worker proof enqueue failed: ${queued.code}`);
    error.code = queued.code || "WORKER_PROOF_ENQUEUE_FAILED";
    throw error;
  }

  const queue = await queueModule.getQueue(names.QUEUE_NAMES.syncCleanupQueue);
  proofJob = await queue.getJob(queued.jobId);
  if (!proofJob) {
    const error = new Error("Queued production worker proof job could not be read back");
    error.code = "WORKER_PROOF_JOB_MISSING";
    throw error;
  }

  const processed = await proofJob.waitUntilFinished(queueEvents, 15_000);
  if (processed?.status !== "ok" || processed?.jobName !== names.JOB_NAMES.WORKER_HEALTHCHECK) {
    const error = new Error("The production worker returned an unexpected healthcheck result");
    error.code = "WORKER_PROOF_RESULT_INVALID";
    throw error;
  }

  heartbeatAfter = await heartbeatModule.getWorkerHeartbeats();
  if (!heartbeatAfter.healthy) {
    const error = new Error("Worker heartbeat became unhealthy while processing the proof job");
    error.code = "WORKER_PROOF_HEARTBEAT_STALE";
    throw error;
  }

  if (backendSourceFingerprint() !== backendSourceFingerprintAtStart) {
    const error = new Error("Backend source changed while the worker proof was running");
    error.code = "WORKER_PROOF_SOURCE_CHANGED";
    throw error;
  }

  jobEvidence = {
    queueName: names.QUEUE_NAMES.syncCleanupQueue,
    jobName: names.JOB_NAMES.WORKER_HEALTHCHECK,
    jobId: queued.jobId,
    requestedAt,
    processed,
  };
  writeReport({ status: "passed", redisVersion, heartbeatBefore, heartbeatAfter, job: jobEvidence });
  console.log(JSON.stringify({
    type: "redis_worker_production_proof_passed",
    redisVersion,
    workers: heartbeatAfter.workers.length,
    job: jobEvidence,
    reportPath,
    time: new Date().toISOString(),
  }));
}

main()
  .catch((error) => {
    const failure = {
      code: error?.code || error?.name || "WORKER_PROOF_FAILED",
      message: error?.message || "Worker proof failed",
    };
    writeReport({ status: "failed", redisVersion, heartbeatBefore, heartbeatAfter, job: jobEvidence, failure });
    console.error(JSON.stringify({ type: "redis_worker_production_proof_failed", ...failure, reportPath, time: new Date().toISOString() }));
    process.exitCode = 1;
  })
  .finally(() => closeRuntime().catch(() => null));
