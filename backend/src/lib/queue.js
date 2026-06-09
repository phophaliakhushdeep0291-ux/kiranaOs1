import { env } from "../config/env.js";
import { getRedisClient, getRedisStatus } from "./redis.js";
import { QUEUE_NAMES, listQueueNames } from "../workers/queueNames.js";
import { recordQueueStatus, recordWorkerReadinessStatus } from "./metrics.js";
import { getWorkerHeartbeats } from "./workerHeartbeat.js";

const queueMap = new Map();
let bullModuleLoadError = null;

export function isQueueEnabled() {
  return Boolean(env.QUEUES_ENABLED && env.REDIS_URL);
}

export function assertQueueName(queueName) {
  if (!listQueueNames().includes(queueName)) {
    const error = new Error(`Unknown queue: ${queueName}`);
    error.code = "UNKNOWN_QUEUE";
    throw error;
  }
}

export function defaultJobOptions() {
  const retentionAge = Math.max(1, Number(env.JOB_RETENTION_DAYS || 7)) * 24 * 60 * 60;
  return {
    attempts: 3,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: { age: retentionAge, count: 1000 },
    removeOnFail: { age: retentionAge, count: 1000 },
  };
}

async function loadBullMQ() {
  try {
    return await import("bullmq");
  } catch (error) {
    bullModuleLoadError = error;
    if (env.NODE_ENV === "production" && env.QUEUES_ENABLED) throw error;
    return null;
  }
}

export async function getQueue(queueName) {
  assertQueueName(queueName);
  if (!isQueueEnabled()) return null;
  if (queueMap.has(queueName)) return queueMap.get(queueName);

  const bull = await loadBullMQ();
  if (!bull) return null;
  const connection = await getRedisClient();
  if (!connection) return null;
  const queue = new bull.Queue(queueName, { connection, defaultJobOptions: defaultJobOptions() });
  queueMap.set(queueName, queue);
  return queue;
}

export async function addJob(queueName, jobName, payload = {}, options = {}) {
  assertQueueName(queueName);
  if (!isQueueEnabled()) {
    return {
      success: false,
      queued: false,
      disabled: true,
      code: "JOB_QUEUE_DISABLED",
      queueName,
      jobName,
    };
  }

  const queue = await getQueue(queueName);
  if (!queue) {
    return {
      success: false,
      queued: false,
      disabled: true,
      code: "JOB_QUEUE_UNAVAILABLE",
      queueName,
      jobName,
    };
  }

  const job = await queue.add(jobName, payload, { ...defaultJobOptions(), ...options });
  return {
    success: true,
    queued: true,
    queueName,
    jobName,
    jobId: job.id,
  };
}

export async function getQueueStatus(queueName) {
  assertQueueName(queueName);
  if (!isQueueEnabled()) {
    return { queueName, enabled: false, waiting: 0, active: 0, failed: 0, delayed: 0, completed: 0 };
  }
  const queue = await getQueue(queueName);
  if (!queue) {
    return { queueName, enabled: false, unavailable: true, waiting: 0, active: 0, failed: 0, delayed: 0, completed: 0 };
  }
  const counts = await queue.getJobCounts("waiting", "active", "failed", "delayed", "completed", "paused");
  recordQueueStatus(queueName, counts);
  const paused = typeof queue.isPaused === "function" ? await queue.isPaused().catch(() => false) : false;
  return { queueName, name: queueName, enabled: true, paused, workerRequired: true, lastUpdatedAt: new Date().toISOString(), ...counts };
}

export async function getQueueDetail(queueName) {
  const status = await getQueueStatus(queueName);
  return { ...status, payloadsExposed: false, redisUrlExposed: false };
}

const SAFE_RETRY_QUEUE_SET = new Set(listQueueNames());

function assertSafeQueueAction(queueName) {
  assertQueueName(queueName);
  if (!SAFE_RETRY_QUEUE_SET.has(queueName)) {
    const error = new Error("Queue action is not allowed for this queue");
    error.code = "QUEUE_ACTION_NOT_ALLOWED";
    error.statusCode = 403;
    throw error;
  }
}

export async function pauseQueue(queueName) {
  assertSafeQueueAction(queueName);
  if (!isQueueEnabled()) return { success: false, code: "JOB_QUEUE_DISABLED" };
  const queue = await getQueue(queueName);
  await queue?.pause();
  return { success: true, queueName, action: "pause" };
}

export async function resumeQueue(queueName) {
  assertSafeQueueAction(queueName);
  if (!isQueueEnabled()) return { success: false, code: "JOB_QUEUE_DISABLED" };
  const queue = await getQueue(queueName);
  await queue?.resume();
  return { success: true, queueName, action: "resume" };
}

export async function getAllQueueStatus() {
  const statuses = [];
  for (const queueName of listQueueNames()) {
    statuses.push(await getQueueStatus(queueName));
  }
  const workerHeartbeat = await getWorkerHeartbeats();
  recordWorkerReadinessStatus(workerHeartbeat);
  return {
    queuesEnabled: isQueueEnabled(),
    redis: getRedisStatus(),
    queueNames: listQueueNames(),
    workerRequired: true,
    workerHeartbeat,
    bullModuleError: bullModuleLoadError?.message ?? null,
    queues: statuses,
  };
}

export async function getFailedJobs(queueName, { start = 0, end = 20 } = {}) {
  assertQueueName(queueName);
  if (!isQueueEnabled()) return { queueName, enabled: false, jobs: [] };
  const queue = await getQueue(queueName);
  if (!queue) return { queueName, enabled: false, unavailable: true, jobs: [] };
  const jobs = await queue.getJobs(["failed"], Number(start || 0), Number(end || 20), false);
  return {
    queueName,
    enabled: true,
    jobs: jobs.map((job) => ({
      jobId: job.id,
      queueName,
      jobName: job.name,
      attemptsMade: job.attemptsMade,
      failedReason: String(job.failedReason || "").slice(0, 500).replace(/(pin|password|token|secret|authorization|signature)=?[^\s&]+/gi, "$1=[REDACTED]"),
      timestamp: job.timestamp ? new Date(job.timestamp).toISOString() : null,
      processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
      finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    })),
  };
}

export async function retryFailedJob(queueName, jobId) {
  assertSafeQueueAction(queueName);
  if (!isQueueEnabled()) return { success: false, code: "JOB_QUEUE_DISABLED" };
  const queue = await getQueue(queueName);
  const job = await queue?.getJob(jobId);
  if (!job) {
    const error = new Error("Job not found");
    error.code = "JOB_NOT_FOUND";
    error.statusCode = 404;
    throw error;
  }
  await job.retry("failed");
  return { success: true, queueName, jobId, action: "retry" };
}

export async function discardFailedJob(queueName, jobId) {
  assertSafeQueueAction(queueName);
  if (!isQueueEnabled()) return { success: false, code: "JOB_QUEUE_DISABLED" };
  const queue = await getQueue(queueName);
  const job = await queue?.getJob(jobId);
  if (!job) {
    const error = new Error("Job not found");
    error.code = "JOB_NOT_FOUND";
    error.statusCode = 404;
    throw error;
  }
  await job.remove();
  return { success: true, queueName, jobId, action: "discard" };
}

export async function closeQueues() {
  for (const queue of queueMap.values()) {
    await queue.close().catch(() => null);
  }
  queueMap.clear();
}

export { QUEUE_NAMES };
