import "dotenv/config";
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

  const queueEvents = new QueueEvents(QUEUE_NAMES.syncCleanupQueue, { connection });
  await queueEvents.waitUntilReady();

  const worker = new Worker(
    QUEUE_NAMES.syncCleanupQueue,
    async (job) => runLoggedJob({ name: job.name, data: job.data, id: job.id, attemptsMade: job.attemptsMade, queueName: QUEUE_NAMES.syncCleanupQueue }, handleSyncCleanupJob),
    { connection, concurrency: 1 }
  );

  await worker.waitUntilReady();
  const result = await addJob(QUEUE_NAMES.syncCleanupQueue, JOB_NAMES.WORKER_HEALTHCHECK, {
    shopId: "worker-verify",
    requestedAt: new Date().toISOString(),
  }, { jobId: `worker-healthcheck:${Date.now()}`, removeOnComplete: true, removeOnFail: true });

  if (!result.success) {
    const error = new Error(`Worker verification enqueue failed: ${result.code}`);
    error.code = result.code || "WORKER_VERIFY_ENQUEUE_FAILED";
    throw error;
  }

  const q = await queueModule.getQueue(QUEUE_NAMES.syncCleanupQueue);
  const job = await q.getJob(result.jobId);
  const processed = await job.waitUntilFinished(queueEvents, 15000);

  await worker.close();
  await queueEvents.close();
  await closeQueues();
  await closeRedis();

  console.log(JSON.stringify({ type: "worker_verify_success", jobId: result.jobId, processed, time: new Date().toISOString() }));
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
