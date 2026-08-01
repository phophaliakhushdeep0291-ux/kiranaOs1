import {
  discardFailedJob,
  getAllShopQueueStatus,
  getFailedJobs,
  getShopQueueDetail,
  retryFailedJob,
} from "../../lib/queue.js";
import { getWorkerHeartbeats } from "../../lib/workerHeartbeat.js";
import { QUEUE_NAMES, listQueueNames } from "../../workers/queueNames.js";
import {
  createAndEnqueueShopBackup,
  listShopBackups,
  openShopBackup,
  previewShopBackupRestore as previewRestore,
  restoreShopBackup as executeRestore,
} from "../backups/backup.service.js";
import { createAuditLog } from "../audit/audit.service.js";
import { pipeline } from "node:stream/promises";

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

export async function status(req, res, next) {
  try {
    const data = await getAllShopQueueStatus(req.shopId);
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

export async function createShopBackup(req, res, next) {
  try {
    const backup = await createAndEnqueueShopBackup(req.shopId, req.user?.userId ?? req.user?.id);
    res.status(202).json({ success: true, data: { backup } });
  } catch (error) {
    next(error);
  }
}

export async function shopBackups(req, res, next) {
  try {
    res.json({ success: true, data: await listShopBackups(req.shopId, req.query) });
  } catch (error) {
    next(error);
  }
}

export async function downloadShopBackup(req, res, next) {
  try {
    const download = await openShopBackup(req.shopId, req.params.id);
    res.setHeader("Content-Type", "application/vnd.kiranaos.backup");
    res.setHeader("Content-Disposition", `attachment; filename="${download.fileName}"`);
    if (download.contentLength !== null) res.setHeader("Content-Length", String(download.contentLength));
    await pipeline(download.stream, res);
    await createAuditLog({
      shopId: req.shopId,
      userId: req.user?.userId,
      action: "SHOP_BACKUP_DOWNLOADED",
      entityType: "BackupArtifact",
      entityId: req.params.id,
      metadata: { encrypted: true, completed: true },
      req,
    });
    return undefined;
  } catch (error) {
    if (res.headersSent) return res.destroy(error);
    return next(error);
  }
}

export async function previewShopBackupRestore(req, res, next) {
  try {
    const preview = await previewRestore(req.shopId, req.params.id);
    await createAuditLog({
      shopId: req.shopId,
      userId: req.user?.userId,
      action: "SHOP_BACKUP_RESTORE_PREVIEWED",
      entityType: "BackupArtifact",
      entityId: req.params.id,
      metadata: { schemaVersion: preview.schema_version, recordCount: preview.record_count },
      req,
    });
    res.json({ success: true, data: { preview } });
  } catch (error) {
    next(error);
  }
}

export async function restoreShopBackup(req, res, next) {
  try {
    const result = await executeRestore(req.shopId, req.params.id, req.user?.userId, req.body.confirmation);
    res.json({ success: true, data: { restore: result } });
  } catch (error) {
    next(error);
  }
}

export async function queueDetail(req, res, next) {
  try {
    const queueName = assertSafeQueue(req.params.queueName);
    const data = await getShopQueueDetail(queueName, req.shopId);
    res.json({ success: true, data: { ...data, serverTime: new Date().toISOString() } });
  } catch (error) {
    next(error);
  }
}

export async function failed(req, res, next) {
  try {
    const queueNames = req.query.queueName ? [assertSafeQueue(req.query.queueName)] : listQueueNames();
    const data = [];
    for (const queueName of queueNames) {
      data.push(await getFailedJobs(queueName, { start: 0, end: 20, shopId: req.shopId }));
    }
    res.json({ success: true, data: { queues: data, payloadsExposed: false, serverTime: new Date().toISOString() } });
  } catch (error) {
    next(error);
  }
}

export async function queueFailed(req, res, next) {
  try {
    const queueName = assertSafeQueue(req.params.queueName);
    const data = await getFailedJobs(queueName, {
      start: req.query.start ?? 0,
      end: req.query.end ?? 20,
      shopId: req.shopId,
    });
    res.json({ success: true, data: { ...data, payloadsExposed: false, serverTime: new Date().toISOString() } });
  } catch (error) {
    next(error);
  }
}

export async function retry(req, res, next) {
  try {
    const queueName = assertSafeQueue(req.params.queueName);
    const data = await retryFailedJob(queueName, req.params.jobId, req.shopId);
    await createAuditLog({
      shopId: req.shopId,
      userId: req.user?.userId,
      action: "SHOP_JOB_RETRIED",
      entityType: "BackgroundJob",
      entityId: req.params.jobId,
      metadata: { queueName },
      req,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function discard(req, res, next) {
  try {
    const queueName = assertSafeQueue(req.params.queueName);
    const data = await discardFailedJob(queueName, req.params.jobId, req.shopId);
    await createAuditLog({
      shopId: req.shopId,
      userId: req.user?.userId,
      action: "SHOP_JOB_DISCARDED",
      entityType: "BackgroundJob",
      entityId: req.params.jobId,
      metadata: { queueName },
      req,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export const __jobsControllerInternals = { QUEUE_ALIASES, assertSafeQueue };
