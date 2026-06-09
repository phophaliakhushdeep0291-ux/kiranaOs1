import db from "../db.js";
import { env } from "../config/env.js";
import { JOB_NAMES } from "./queueNames.js";

export async function handleSyncCleanupJob(job) {
  switch (job.name) {
    case JOB_NAMES.CLEANUP_SYNC_EVENTS:
      return cleanupSyncEvents(job.data, { dryRun: true });
    case JOB_NAMES.ARCHIVE_OLD_SYNC_EVENTS:
      return archiveOldSyncEvents(job.data, { dryRun: true });
    case JOB_NAMES.WORKER_HEALTHCHECK:
      return { status: "ok", jobName: JOB_NAMES.WORKER_HEALTHCHECK, time: new Date().toISOString() };
    default: {
      const error = new Error(`Unknown sync cleanup job: ${job.name}`);
      error.code = "UNKNOWN_SYNC_CLEANUP_JOB";
      throw error;
    }
  }
}

async function cleanupSyncEvents(payload = {}, { dryRun = true } = {}) {
  const retentionDays = Number(payload.retentionDays ?? env.JOB_RETENTION_DAYS ?? 7);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const where = {
    createdAt: { lt: cutoff },
    status: { in: ["synced", "failed"] },
    // Never delete recent idempotency records and never touch unresolved conflicts.
  };
  const count = await db.offlineSyncEvent.count({ where }).catch(() => 0);
  return { status: dryRun ? "DRY_RUN" : "NOT_IMPLEMENTED", retentionDays, cutoff: cutoff.toISOString(), eligibleOfflineSyncEvents: count };
}

async function archiveOldSyncEvents(payload = {}, { dryRun = true } = {}) {
  const result = await cleanupSyncEvents(payload, { dryRun: true });
  return { ...result, archive: true, status: dryRun ? "DRY_RUN" : "NOT_IMPLEMENTED" };
}
