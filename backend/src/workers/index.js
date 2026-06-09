import { env } from "../config/env.js";
import { closeRedis, getRedisClient, getRedisStatus } from "../lib/redis.js";
import { closeQueues, isQueueEnabled } from "../lib/queue.js";
import { runLoggedJob } from "./workerUtils.js";
import { startWorkerHeartbeat } from "../lib/workerHeartbeat.js";

const workers = [];
let heartbeatController = null;

async function loadBullMQ() {
  try {
    return await import("bullmq");
  } catch (error) {
    console.error(JSON.stringify({ type: "worker_startup_error", code: "BULLMQ_UNAVAILABLE", errorMessage: error?.message, time: new Date().toISOString() }));
    if (env.NODE_ENV === "production" && env.QUEUES_ENABLED) process.exit(1);
    return null;
  }
}

async function startWorkers() {
  if (!isQueueEnabled()) {
    console.log(JSON.stringify({ type: "worker_disabled", queuesEnabled: env.QUEUES_ENABLED, redis: getRedisStatus(), workerRequired: true, time: new Date().toISOString() }));
    return;
  }

  const [{ WORKER_REGISTRY }, bull, connection] = await Promise.all([
    import("./queues.js"),
    loadBullMQ(),
    getRedisClient(),
  ]);
  if (!bull || !connection) {
    console.log(JSON.stringify({ type: "worker_disabled", reason: "REDIS_OR_BULLMQ_UNAVAILABLE", redis: getRedisStatus(), time: new Date().toISOString() }));
    return;
  }

  for (const spec of WORKER_REGISTRY) {
    const worker = new bull.Worker(
      spec.queueName,
      async (job) => runLoggedJob({ name: job.name, data: job.data, id: job.id, attemptsMade: job.attemptsMade, queueName: spec.queueName }, spec.handler),
      { connection, concurrency: env.WORKER_CONCURRENCY }
    );
    worker.on("failed", (job, error) => {
      console.error(JSON.stringify({
        type: "worker_job_failed",
        queueName: spec.queueName,
        jobName: job?.name,
        jobId: job?.id,
        attemptsMade: job?.attemptsMade,
        errorCode: error?.code ?? error?.name ?? "JOB_ERROR",
        errorMessage: error?.message,
        time: new Date().toISOString(),
      }));
    });
    worker.on("completed", (job) => {
      console.log(JSON.stringify({ type: "worker_job_completed", queueName: spec.queueName, jobName: job?.name, jobId: job?.id, time: new Date().toISOString() }));
    });
    workers.push(worker);
  }

  heartbeatController = startWorkerHeartbeat({ queueNames: WORKER_REGISTRY.map((w) => w.queueName) });

  console.log(JSON.stringify({
    type: "worker_startup",
    message: "KiranaOS workers started",
    queues: WORKER_REGISTRY.map((w) => w.queueName),
    concurrency: env.WORKER_CONCURRENCY,
    workerInstanceId: heartbeatController.instanceId,
    heartbeatIntervalMs: heartbeatController.intervalMs,
    heartbeatStaleAfterMs: heartbeatController.staleAfterMs,
    time: new Date().toISOString(),
  }));
}

async function shutdown(signal) {
  console.log(JSON.stringify({ type: "worker_shutdown_start", signal, time: new Date().toISOString() }));
  await heartbeatController?.stop?.().catch(() => null);
  heartbeatController = null;
  await Promise.all(workers.map((worker) => worker.close().catch(() => null)));
  workers.length = 0;
  await closeQueues();
  await closeRedis();
  try {
    const dbModule = await import("../db.js");
    await dbModule.default.$disconnect().catch(() => null);
  } catch {
    // Prisma may be unavailable in restricted sandboxes; shutdown should stay safe.
  }
  console.log(JSON.stringify({ type: "worker_shutdown_complete", signal, time: new Date().toISOString() }));
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

startWorkers().catch((error) => {
  console.error(JSON.stringify({ type: "worker_startup_error", errorMessage: error?.message, time: new Date().toISOString() }));
  process.exit(1);
});
