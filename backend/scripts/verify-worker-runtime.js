import "dotenv/config";
import crypto from "node:crypto";
import { Worker, QueueEvents } from "bullmq";

process.env.DATABASE_URL ||= "file:./prisma/test.db";
process.env.JWT_SECRET ||= "worker-verify-jwt-secret-32-characters-minimum";
process.env.LICENSE_SIGNING_SECRET ||= "worker-verify-license-secret-32-characters-minimum";
process.env.NODE_ENV ||= "test";

async function main() {
  const [{ getRedisClient, closeRedis, getRedisStatus }, queueModule, { QUEUE_NAMES, JOB_NAMES }] = await Promise.all([
    import("../src/lib/redis.js"),
    import("../src/lib/queue.js"),
    import("../src/workers/queueNames.js"),
  ]);
  const { addJob, closeQueues, isQueueEnabled } = queueModule;

  if (!isQueueEnabled()) {
    console.log(JSON.stringify({ type: "worker_verify_skipped", reason: "QUEUES_DISABLED", redis: getRedisStatus(), time: new Date().toISOString() }));
    return;
  }

  const connection = await getRedisClient();
  if (!connection) {
    const error = new Error("Redis connection unavailable for worker verification");
    error.code = "REDIS_UNAVAILABLE";
    throw error;
  }

  const [{ handleSyncCleanupJob }, { runLoggedJob }] = await Promise.all([
    import("../src/workers/syncCleanup.worker.js"),
    import("../src/workers/workerUtils.js"),
  ]);

  // Reading the event stream before the job is added. A completion that lands
  // before waitUntilFinished subscribes is still caught: that call also reads the
  // job's finished state from Redis, which only works while the job exists.
  const queueEvents = new QueueEvents(QUEUE_NAMES.syncCleanupQueue, { connection });
  await queueEvents.waitUntilReady();

  const worker = new Worker(
    QUEUE_NAMES.syncCleanupQueue,
    async (job) => runLoggedJob({ name: job.name, data: job.data, id: job.id, attemptsMade: job.attemptsMade, queueName: QUEUE_NAMES.syncCleanupQueue }, handleSyncCleanupJob),
    { connection, concurrency: 1 }
  );

  let job = null;
  let processed;
  try {
    await worker.waitUntilReady();
    // The job is kept after it finishes and removed below, once verified. When
    // BullMQ removed it on completion, the worker could finish and delete it before
    // waitUntilFinished looked, and the check then failed with "Missing key for
    // job … isFinished" although the worker had done its work. The random
    // suffix matters now that the job outlives the run: BullMQ ignores an add whose
    // jobId already exists, and this run would then wait on another run's job.
    const result = await addJob(QUEUE_NAMES.syncCleanupQueue, JOB_NAMES.WORKER_HEALTHCHECK, {
      shopId: "worker-verify",
      requestedAt: new Date().toISOString(),
    }, {
      jobId: `worker-healthcheck-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false,
    });

    if (!result.success) {
      const error = new Error(`Worker verification enqueue failed: ${result.code}`);
      error.code = result.code || "WORKER_VERIFY_ENQUEUE_FAILED";
      throw error;
    }

    const q = await queueModule.getQueue(QUEUE_NAMES.syncCleanupQueue);
    job = await q.getJob(result.jobId);
    if (!job) {
      const error = new Error("Queued worker verification job could not be read back");
      error.code = "WORKER_VERIFY_JOB_MISSING";
      throw error;
    }

    processed = await job.waitUntilFinished(queueEvents, 15000);
    const state = await job.getState();
    if (state !== "completed" || processed?.status !== "ok" || processed?.jobName !== JOB_NAMES.WORKER_HEALTHCHECK) {
      const error = new Error(`Worker verification job finished as ${state} with an unexpected result`);
      error.code = "WORKER_VERIFY_RESULT_INVALID";
      throw error;
    }
  } finally {
    // The worker closes first so the job is no longer locked when it is removed.
    await worker.close().catch(() => null);
    await job?.remove().catch(() => null);
    await queueEvents.close().catch(() => null);
  }

  await closeQueues();
  await closeRedis();

  console.log(JSON.stringify({ type: "worker_verify_success", jobId: job.id, processed, time: new Date().toISOString() }));
}

main().catch(async (error) => {
  try {
    const [{ closeRedis }, { closeQueues }] = await Promise.all([import("../src/lib/redis.js"), import("../src/lib/queue.js")]);
    await closeQueues().catch(() => null);
    await closeRedis().catch(() => null);
  } catch {}
  console.error(JSON.stringify({ type: "worker_verify_failure", errorCode: error?.code ?? error?.name ?? "WORKER_VERIFY_FAILED", errorMessage: error?.message, time: new Date().toISOString() }));
  process.exit(1);
});
