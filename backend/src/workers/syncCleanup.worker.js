import db from "../db.js";
import { env } from "../config/env.js";
import { JOB_NAMES } from "./queueNames.js";

export async function handleSyncCleanupJob(job) {
  switch (job.name) {
    case JOB_NAMES.CLEANUP_SYNC_EVENTS:
      return runSyncRetentionCleanup(job.data);
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

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

export async function runSyncRetentionCleanup(payload = {}) {
  // A short idempotency window can duplicate real financial actions after an old
  // device reconnects. Never accept less than 90 days even if a generic worker
  // retention setting is configured lower.
  const retentionDays = boundedInteger(payload.retentionDays ?? env.JOB_RETENTION_DAYS, 90, 90, 3650);
  const limit = boundedInteger(payload.limit, 500, 1, 5000);
  const now = new Date();
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const writeEnabled = payload.dryRun === false && payload.confirm === true;

  const [eventCandidates, conflictCandidates] = await Promise.all([
    db.offlineSyncEvent.findMany({
      where: {
        createdAt: { lt: cutoff },
        status: "synced",
        // Failed, processing, and conflict rows remain recoverable indefinitely.
      },
      select: { id: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit,
    }),
    db.syncConflict.findMany({
      where: {
        status: { in: ["resolved", "dismissed"] },
        expiresAt: { lte: now },
        // Open conflict snapshots are never removed by retention.
      },
      select: { id: true },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take: limit,
    }),
  ]);

  let deletedOfflineSyncEvents = 0;
  let deletedSyncConflicts = 0;
  if (writeEnabled && (eventCandidates.length > 0 || conflictCandidates.length > 0)) {
    const [events, conflicts] = await db.$transaction([
      db.offlineSyncEvent.deleteMany({
        where: { id: { in: eventCandidates.map((row) => row.id) }, status: "synced", createdAt: { lt: cutoff } },
      }),
      db.syncConflict.deleteMany({
        where: {
          id: { in: conflictCandidates.map((row) => row.id) },
          status: { in: ["resolved", "dismissed"] },
          expiresAt: { lte: now },
        },
      }),
    ]);
    deletedOfflineSyncEvents = events.count;
    deletedSyncConflicts = conflicts.count;
  }

  return {
    status: writeEnabled ? "APPLIED" : "DRY_RUN",
    retentionDays,
    limit,
    cutoff: cutoff.toISOString(),
    eligibleOfflineSyncEvents: eventCandidates.length,
    eligibleSyncConflicts: conflictCandidates.length,
    deletedOfflineSyncEvents,
    deletedSyncConflicts,
    hasMore: eventCandidates.length === limit || conflictCandidates.length === limit,
    safety: {
      explicitConfirmationRequired: true,
      preservesStatuses: ["processing", "failed", "conflict", "open"],
    },
  };
}

async function archiveOldSyncEvents(payload = {}, { dryRun = true } = {}) {
  const result = await runSyncRetentionCleanup({ ...payload, dryRun: true, confirm: false });
  return { ...result, archive: true, status: dryRun ? "DRY_RUN" : "ARCHIVE_DESTINATION_REQUIRED" };
}
