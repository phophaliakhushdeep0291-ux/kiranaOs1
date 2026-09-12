import {
  dexieDB,
  offlineDB,
  filterRowsForCurrentScope,
  type OfflineRow,
  type PendingSyncEvent,
  type SyncCursorRow,
} from "@/lib/offline/db";
import { getCurrentSubscriptionSnapshot } from "@/features/core/subscription/access";
import { readOfflineReadiness, type OfflineReadinessState } from "@/features/core/sync/offline-readiness";
import { calculateSyncQueueCounts } from "@/features/core/sync/sync-health";

export interface OfflineConfidenceSnapshot {
  dbHealthy: boolean;
  pendingSyncCount: number | null;
  failedSyncCount: number | null;
  conflictCount: number | null;
  localBusinessRows: number | null;
  lastCloudBackupAt: string | null;
  offlineGraceUntil: string | null;
  cloudSyncAllowed: boolean;
  readinessState: OfflineReadinessState;
  appShellCached: boolean;
  persistentStorageGranted: boolean | null;
  storageUsageRatio: number | null;
  message: string;
  warning: string | null;
}

async function getLastCloudBackupAt(): Promise<string | null> {
  const cursors = await offlineDB
    .getAll<SyncCursorRow>("sync_cursor");
  const cursor = cursors.find((row) => row.id === "global");
  const cursorTime = cursor?.last_pulled_at ?? cursor?.updated_at ?? null;
  const syncedRows = await offlineDB
    .getAll<PendingSyncEvent>("sync_outbox")
    .then((rows) =>
      rows.filter(
        (row) => row.status === "SYNCED" || row.sync_status === "synced",
      ),
    );
  const outboxTimes = syncedRows
    .map((row) => row.last_attempt_at ?? row.client_created_at)
    .filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
  const times = [cursorTime, ...outboxTimes].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (times.length === 0) return null;
  return times.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
}

async function countLocalBusinessRows(): Promise<number> {
  const counts = await Promise.all([
    offlineDB
      .getAll<OfflineRow>("products")
      .then((rows) => filterRowsForCurrentScope(rows).length),
    offlineDB
      .getAll<OfflineRow>("customers")
      .then((rows) => filterRowsForCurrentScope(rows).length),
    offlineDB
      .getAll<OfflineRow>("bills")
      .then((rows) => filterRowsForCurrentScope(rows).length),
    offlineDB
      .getAll<OfflineRow>("payments")
      .then((rows) => filterRowsForCurrentScope(rows).length),
    offlineDB
      .getAll<OfflineRow>("customer_ledger")
      .then((rows) => filterRowsForCurrentScope(rows).length),
    offlineDB
      .getAll<OfflineRow>("inventory_movements")
      .then((rows) => filterRowsForCurrentScope(rows).length),
  ]);
  return counts.reduce((sum, count) => sum + count, 0);
}

export async function readOfflineConfidenceSnapshot(): Promise<OfflineConfidenceSnapshot> {
  try {
    await dexieDB.open();
    const [
      allOperations,
      conflicts,
      lastCloudBackupAt,
      localBusinessRows,
      subscription,
      readiness,
    ] = await Promise.all([
      offlineDB.getAll<PendingSyncEvent>("sync_outbox"),
      offlineDB.getAll<OfflineRow>("sync_conflicts"),
      getLastCloudBackupAt(),
      countLocalBusinessRows(),
      getCurrentSubscriptionSnapshot(),
      readOfflineReadiness(),
    ]);
    if (!readiness.databaseAvailable) throw new Error("Local readiness database check failed");

    const { pending: pendingSyncCount, failed: failedSyncCount, conflict: conflictCount } = calculateSyncQueueCounts(
      filterRowsForCurrentScope(allOperations), filterRowsForCurrentScope(conflicts),
    );
    const cloudSyncAllowed = subscription?.cloudSyncAllowed ?? true;

    const warning =
      readiness.state === "not_ready"
        ? readiness.warnings[0] ?? "This device is not ready for offline billing."
        : failedSyncCount > 0
        ? "Sync failed, retry needed. Billing can continue locally."
        : conflictCount > 0
          ? "Sync conflict needs owner review."
          : !cloudSyncAllowed
            ? "Cloud sync is disabled by plan/expiry. Data remains local."
            : pendingSyncCount > 0
              ? `${pendingSyncCount} change${pendingSyncCount === 1 ? "" : "s"} pending cloud backup.`
              : null;

    return {
      dbHealthy: true,
      pendingSyncCount,
      failedSyncCount,
      conflictCount,
      localBusinessRows,
      lastCloudBackupAt,
      offlineGraceUntil: subscription?.offlineGraceEndsAt ?? null,
      cloudSyncAllowed,
      readinessState: readiness.state,
      appShellCached: readiness.appShellCached,
      persistentStorageGranted: readiness.persistentStorageGranted,
      storageUsageRatio: readiness.storageUsageRatio,
      message:
        pendingSyncCount > 0
          ? "Data safe locally, cloud backup pending."
          : "All local data is safe on this device.",
      warning,
    };
  } catch {
    return {
      dbHealthy: false,
      pendingSyncCount: null,
      failedSyncCount: null,
      conflictCount: null,
      localBusinessRows: null,
      lastCloudBackupAt: null,
      offlineGraceUntil: null,
      cloudSyncAllowed: false,
      readinessState: "not_ready",
      appShellCached: false,
      persistentStorageGranted: null,
      storageUsageRatio: null,
      message: "Local database check failed.",
      warning: "Recovery mode should be opened before continuing billing.",
    };
  }
}
