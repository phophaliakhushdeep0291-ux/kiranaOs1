import crypto from "crypto";
import { env } from "../config/env.js";
import { getRedisClient, getRedisStatus } from "./redis.js";
import { listQueueNames } from "../workers/queueNames.js";

const HEARTBEAT_PREFIX = "kiranaos:worker-heartbeat";
const DEFAULT_STALE_AFTER_MS = 90_000;
const DEFAULT_INTERVAL_MS = 30_000;

export function getWorkerInstanceId() {
  if (env.WORKER_INSTANCE_ID) return String(env.WORKER_INSTANCE_ID);
  const host = process.env.HOSTNAME || process.env.COMPUTERNAME || "local";
  return `${host}:${process.pid}:${crypto.randomUUID()}`;
}

export function workerHeartbeatConfig() {
  const intervalMs = Math.max(5_000, Number(env.WORKER_HEARTBEAT_INTERVAL_MS || DEFAULT_INTERVAL_MS));
  const staleAfterMs = Math.max(intervalMs * 2, Number(env.WORKER_STALE_AFTER_MS || DEFAULT_STALE_AFTER_MS));
  return { intervalMs, staleAfterMs };
}

function heartbeatKey(instanceId) {
  const safeInstanceId = String(instanceId || "unknown").replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 160);
  return `${HEARTBEAT_PREFIX}:${safeInstanceId}`;
}

function sanitizeWorkerRecord(record = {}) {
  return {
    instanceId: String(record.instanceId || "unknown").slice(0, 160),
    status: record.status === "stopping" ? "stopping" : "running",
    pid: Number(record.pid || 0) || null,
    queueNames: Array.isArray(record.queueNames) ? record.queueNames.filter((q) => listQueueNames().includes(q)) : [],
    concurrency: Number(record.concurrency || env.WORKER_CONCURRENCY || 0) || null,
    startedAt: record.startedAt || null,
    lastSeenAt: record.lastSeenAt || null,
    version: record.version || "unknown",
  };
}

export async function recordWorkerHeartbeat({ instanceId, status = "running", queueNames = listQueueNames(), startedAt = new Date().toISOString() } = {}) {
  if (!env.QUEUES_ENABLED || !env.REDIS_URL) {
    return { recorded: false, code: "WORKER_HEARTBEAT_DISABLED" };
  }
  const client = await getRedisClient();
  if (!client) return { recorded: false, code: "REDIS_UNAVAILABLE" };
  const { staleAfterMs } = workerHeartbeatConfig();
  const record = sanitizeWorkerRecord({
    instanceId,
    status,
    pid: process.pid,
    queueNames,
    concurrency: env.WORKER_CONCURRENCY,
    startedAt,
    lastSeenAt: new Date().toISOString(),
    version: process.env.npm_package_version || "1.0.0",
  });
  await client.set(heartbeatKey(record.instanceId), JSON.stringify(record), "PX", staleAfterMs);
  return { recorded: true, instanceId: record.instanceId, staleAfterMs };
}

export function startWorkerHeartbeat({ instanceId = getWorkerInstanceId(), queueNames = listQueueNames() } = {}) {
  const startedAt = new Date().toISOString();
  const { intervalMs, staleAfterMs } = workerHeartbeatConfig();
  let stopped = false;
  let timer = null;

  async function beat(status = "running") {
    if (stopped && status !== "stopping") return;
    await recordWorkerHeartbeat({ instanceId, status, queueNames, startedAt }).catch((error) => {
      console.error(JSON.stringify({
        type: "worker_heartbeat_error",
        instanceId,
        errorCode: error?.code ?? error?.name ?? "WORKER_HEARTBEAT_ERROR",
        errorMessage: error?.message,
        time: new Date().toISOString(),
      }));
    });
  }

  beat();
  timer = setInterval(() => beat(), intervalMs);
  timer.unref?.();

  return {
    instanceId,
    intervalMs,
    staleAfterMs,
    stop: async () => {
      stopped = true;
      if (timer) clearInterval(timer);
      await beat("stopping");
    },
  };
}

export async function getWorkerHeartbeats() {
  const { staleAfterMs } = workerHeartbeatConfig();
  if (!env.QUEUES_ENABLED || !env.REDIS_URL) {
    return {
      enabled: false,
      required: Boolean(env.QUEUES_ENABLED),
      healthy: !env.QUEUES_ENABLED,
      staleAfterMs,
      redis: getRedisStatus(),
      workers: [],
    };
  }
  const client = await getRedisClient();
  if (!client) {
    return { enabled: true, required: true, healthy: false, staleAfterMs, redis: getRedisStatus(), workers: [] };
  }

  const keys = await client.keys(`${HEARTBEAT_PREFIX}:*`).catch(() => []);
  const workers = [];
  for (const key of keys) {
    const raw = await client.get(key).catch(() => null);
    if (!raw) continue;
    try {
      const parsed = sanitizeWorkerRecord(JSON.parse(raw));
      const ageMs = parsed.lastSeenAt ? Date.now() - Date.parse(parsed.lastSeenAt) : Number.POSITIVE_INFINITY;
      workers.push({ ...parsed, ageMs: Number.isFinite(ageMs) ? Math.max(0, ageMs) : null, fresh: Number.isFinite(ageMs) && ageMs <= staleAfterMs });
    } catch {
      // Ignore malformed heartbeat keys; never expose raw Redis values.
    }
  }

  const healthy = workers.some((worker) => worker.status === "running" && worker.fresh);
  return {
    enabled: true,
    required: true,
    healthy,
    staleAfterMs,
    redis: getRedisStatus(),
    workers: workers.sort((a, b) => String(a.instanceId).localeCompare(String(b.instanceId))),
  };
}
