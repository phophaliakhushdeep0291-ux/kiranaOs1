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

function requireShopScope(shopId) {
  const normalized = String(shopId || "").trim();
  if (!normalized) {
    const error = new Error("Shop scope is required for tenant queue access");
    error.code = "SHOP_SCOPE_REQUIRED";
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function jobBelongsToShop(job, shopId) {
  const expectedShopId = requireShopScope(shopId);
  return String(job?.data?.shopId || "") === expectedShopId;
}

async function getShopJobs(queue, states, shopId) {
  const expectedShopId = requireShopScope(shopId);
  // Failed/completed jobs are already retention-bounded. Read the bounded queue
  // window first and filter server-side; no payload ever leaves this module.
  const jobs = await queue.getJobs(states, 0, -1, false);
  return jobs.filter((job) => jobBelongsToShop(job, expectedShopId));
}

function boundedRange(start, end, total) {
  const safeStart = Math.max(0, Number.parseInt(start, 10) || 0);
  const requestedEnd = Number.parseInt(end, 10);
  const safeEnd = Number.isFinite(requestedEnd) ? Math.max(safeStart, requestedEnd) : safeStart + 20;
  return {
    start: safeStart,
    end: Math.min(total, safeEnd + 1),
  };
}

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

export async function getShopQueueStatus(queueName, shopId) {
  assertQueueName(queueName);
  requireShopScope(shopId);
  if (!isQueueEnabled()) {
    return { queueName, enabled: false, scopedToShop: true, waiting: 0, active: 0, failed: 0, delayed: 0, completed: 0 };
  }
  const queue = await getQueue(queueName);
  if (!queue) {
    return { queueName, enabled: false, unavailable: true, scopedToShop: true, waiting: 0, active: 0, failed: 0, delayed: 0, completed: 0 };
  }
  const states = ["waiting", "active", "failed", "delayed", "completed"];
  const jobs = await getShopJobs(queue, states, shopId);
  const counts = Object.fromEntries(states.map((state) => [state, 0]));
  for (const job of jobs) {
    const state = await job.getState();
    if (Object.hasOwn(counts, state)) counts[state] += 1;
  }
  return {
    queueName,
    name: queueName,
    enabled: true,
    scopedToShop: true,
    workerRequired: true,
    lastUpdatedAt: new Date().toISOString(),
    ...counts,
  };
}

export async function getShopQueueDetail(queueName, shopId) {
  const status = await getShopQueueStatus(queueName, shopId);
  return { ...status, payloadsExposed: false, redisUrlExposed: false };
}

export async function getAllShopQueueStatus(shopId) {
  requireShopScope(shopId);
  const statuses = [];
  for (const queueName of listQueueNames()) {
    statuses.push(await getShopQueueStatus(queueName, shopId));
  }
  const workerHeartbeat = await getWorkerHeartbeats();
  return {
    queuesEnabled: isQueueEnabled(),
    queueNames: listQueueNames(),
    workerRequired: true,
    workerHeartbeat,
    scopedToShop: true,
    payloadsExposed: false,
    queues: statuses,
  };
}

export async function getFailedJobs(queueName, { start = 0, end = 20, shopId } = {}) {
  assertQueueName(queueName);
  requireShopScope(shopId);
  if (!isQueueEnabled()) return { queueName, enabled: false, jobs: [] };
  const queue = await getQueue(queueName);
  if (!queue) return { queueName, enabled: false, unavailable: true, jobs: [] };
  const scopedJobs = await getShopJobs(queue, ["failed"], shopId);
  const range = boundedRange(start, end, scopedJobs.length);
  const jobs = scopedJobs.slice(range.start, range.end);
  return {
    queueName,
    enabled: true,
    scopedToShop: true,
    total: scopedJobs.length,
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

export async function retryFailedJob(queueName, jobId, shopId) {
  assertSafeQueueAction(queueName);
  requireShopScope(shopId);
  if (!isQueueEnabled()) return { success: false, code: "JOB_QUEUE_DISABLED" };
  const queue = await getQueue(queueName);
  const job = await queue?.getJob(jobId);
  if (!job || !jobBelongsToShop(job, shopId)) {
    const error = new Error("Job not found");
    error.code = "JOB_NOT_FOUND";
    error.statusCode = 404;
    throw error;
  }
  await job.retry("failed");
  return { success: true, queueName, jobId, action: "retry" };
}

export async function discardFailedJob(queueName, jobId, shopId) {
  assertSafeQueueAction(queueName);
  requireShopScope(shopId);
  if (!isQueueEnabled()) return { success: false, code: "JOB_QUEUE_DISABLED" };
  const queue = await getQueue(queueName);
  const job = await queue?.getJob(jobId);
  if (!job || !jobBelongsToShop(job, shopId)) {
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

export const __queueInternals = {
  boundedRange,
  jobBelongsToShop,
  requireShopScope,
};
