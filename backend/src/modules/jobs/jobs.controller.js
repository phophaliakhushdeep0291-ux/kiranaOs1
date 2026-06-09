import {
  discardFailedJob,
  getAllQueueStatus,
  getFailedJobs,
  getQueueDetail,
  pauseQueue,
  resumeQueue,
  retryFailedJob,
} from "../../lib/queue.js";
import { getWorkerHeartbeats } from "../../lib/workerHeartbeat.js";
import { QUEUE_NAMES, listQueueNames } from "../../workers/queueNames.js";

const QUEUE_ALIASES = Object.freeze({
  reminders: QUEUE_NAMES.reminderQueue,
  reminder: QUEUE_NAMES.reminderQueue,
  reports: QUEUE_NAMES.reportsQueue,
  exports: QUEUE_NAMES.exportsQueue,
  backups: QUEUE_NAMES.backupQueue,
  backup: QUEUE_NAMES.backupQueue,
  syncCleanup: QUEUE_NAMES.syncCleanupQueue,
  "sync-cleanup": QUEUE_NAMES.syncCleanupQueue,
});

function assertSafeQueue(queueName) {
  const raw = String(queueName || "").trim();
  const resolved = QUEUE_ALIASES[raw] || QUEUE_NAMES[raw] || raw;
  if (!listQueueNames().includes(resolved)) {
    const error = new Error("Unknown queue");
    error.statusCode = 400;
    error.code = "UNKNOWN_QUEUE";
    throw error;
  }
  return resolved;
}

export async function status(_req, res, next) {
  try {
    const data = await getAllQueueStatus();
    res.json({ success: true, data: { ...data, serverTime: new Date().toISOString() } });
  } catch (error) {
    next(error);
  }
}

export async function workerHealth(_req, res, next) {
  try {
    const data = await getWorkerHeartbeats();
    res.json({ success: true, data: { ...data, payloadsExposed: false, serverTime: new Date().toISOString() } });
  } catch (error) {
    next(error);
  }
}

export async function queueDetail(req, res, next) {
  try {
    const queueName = assertSafeQueue(req.params.queueName);
    const data = await getQueueDetail(queueName);
    res.json({ success: true, data: { ...data, serverTime: new Date().toISOString() } });
  } catch (error) {
    next(error);
  }
}

export async function failed(req, res, next) {
  try {
    const queueNames = req.query.queueName ? [assertSafeQueue(req.query.queueName)] : listQueueNames();
    const data = [];
    for (const queueName of queueNames) data.push(await getFailedJobs(queueName, { start: 0, end: 20 }));
    res.json({ success: true, data: { queues: data, payloadsExposed: false, serverTime: new Date().toISOString() } });
  } catch (error) {
    next(error);
  }
}

export async function queueFailed(req, res, next) {
  try {
    const queueName = assertSafeQueue(req.params.queueName);
    const data = await getFailedJobs(queueName, { start: req.query.start ?? 0, end: req.query.end ?? 20 });
    res.json({ success: true, data: { ...data, payloadsExposed: false, serverTime: new Date().toISOString() } });
  } catch (error) {
    next(error);
  }
}

export async function retry(req, res, next) {
  try {
    const data = await retryFailedJob(assertSafeQueue(req.params.queueName), req.params.jobId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function discard(req, res, next) {
  try {
    const data = await discardFailedJob(assertSafeQueue(req.params.queueName), req.params.jobId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function pause(req, res, next) {
  try {
    const data = await pauseQueue(assertSafeQueue(req.params.queueName));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function resume(req, res, next) {
  try {
    const data = await resumeQueue(assertSafeQueue(req.params.queueName));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export const __jobsControllerInternals = { QUEUE_ALIASES, assertSafeQueue };
