import db from "../../db.js";
import { explainSyncFailure } from "./sync-explain.js";

// Consolidated, tenant-scoped sync health for Diagnostics §3. Aggregates the
// offline sync queue, conflicts, retries, and last successful sync, and attaches
// a plain-language explanation to every failure/conflict.

const RECENT_FAILURE_LIMIT = 20;
const RECENT_CONFLICT_LIMIT = 10;

export async function getSyncDiagnostics(shopId) {
  if (!shopId) return null;

  const [pending, failed, conflictEvents, synced, retryAgg, openConflicts, recentFailedRows, recentConflictRows, lastSyncDevice] = await Promise.all([
    db.offlineSyncEvent.count({ where: { shopId, status: "processing" } }),
    db.offlineSyncEvent.count({ where: { shopId, status: "failed" } }),
    db.offlineSyncEvent.count({ where: { shopId, status: "conflict" } }),
    db.offlineSyncEvent.count({ where: { shopId, status: "synced" } }),
    db.offlineSyncEvent.aggregate({ where: { shopId, attempts: { gt: 1 } }, _sum: { attempts: true }, _count: true }),
    db.syncConflict.count({ where: { shopId, status: "open" } }),
    db.offlineSyncEvent.findMany({
      where: { shopId, status: { in: ["failed", "conflict"] } },
      orderBy: { updatedAt: "desc" },
      take: RECENT_FAILURE_LIMIT,
      select: { eventId: true, type: true, status: true, attempts: true, error: true, requestJson: true, updatedAt: true },
    }),
    db.syncConflict.findMany({
      where: { shopId, status: "open" },
      orderBy: { detectedAt: "desc" },
      take: RECENT_CONFLICT_LIMIT,
      select: { id: true, entityType: true, entityId: true, reasonCode: true, message: true, localSnapshotJson: true, detectedAt: true },
    }),
    db.device.findFirst({ where: { shopId, lastSyncAt: { not: null } }, orderBy: { lastSyncAt: "desc" }, select: { lastSyncAt: true } }),
  ]);

  const recentFailures = recentFailedRows.map((row) => ({
    eventId: row.eventId,
    type: row.type,
    status: row.status,
    attempts: row.attempts,
    at: row.updatedAt,
    ...explainSyncFailure({ type: row.type, error: row.error, requestJson: row.requestJson }),
  }));

  const recentConflicts = recentConflictRows.map((row) => ({
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    reasonCode: row.reasonCode,
    at: row.detectedAt,
    ...explainSyncFailure({ entityType: row.entityType, reasonCode: row.reasonCode, message: row.message, localSnapshotJson: row.localSnapshotJson }),
  }));

  const needsAttention = failed + conflictEvents + openConflicts;

  return {
    lastSuccessfulSyncAt: lastSyncDevice?.lastSyncAt ?? null,
    healthy: needsAttention === 0,
    counts: {
      pending,
      queueSize: pending,
      failed,
      conflictEvents,
      openConflicts,
      synced,
      needsAttention,
      retriedEvents: retryAgg._count ?? 0,
      totalRetryAttempts: retryAgg._sum?.attempts ?? 0,
    },
    recentFailures,
    recentConflicts,
    generatedAt: new Date().toISOString(),
  };
}
