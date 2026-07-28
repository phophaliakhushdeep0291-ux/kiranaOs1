import {
  dexieDB,
  offlineDB,
  type OfflineRow,
  type PendingSyncEvent,
  type SyncCursorRow,
} from "@/lib/offline/db";
import { getCurrentSubscriptionSnapshot } from "@/features/subscription/access";
import { readOfflineReadiness, type OfflineReadinessState } from "@/features/sync/offline-readiness";

export interface OfflineConfidenceSnapshot {
  dbHealthy: boolean;
  pendingSyncCount: number;
  failedSyncCount: number;
  conflictCount: number;
  localBusinessRows: number;
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
    .getAll<SyncCursorRow>("sync_cursor")
    .catch(() => []);
  const cursor = cursors.find((row) => row.id === "global");
  const cursorTime = cursor?.last_pulled_at ?? cursor?.updated_at ?? null;
  const syncedRows = await offlineDB
    .getAll<PendingSyncEvent>("sync_outbox")
    .then((rows) =>
      rows.filter(
        (row) => row.status === "SYNCED" || row.sync_status === "synced",
      ),
    )
    .catch(() => []);
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
      .then((rows) => rows.length)
      .catch(() => 0),
    offlineDB
      .getAll<OfflineRow>("customers")
      .then((rows) => rows.length)
      .catch(() => 0),
    offlineDB
      .getAll<OfflineRow>("bills")
      .then((rows) => rows.length)
      .catch(() => 0),
    offlineDB
      .getAll<OfflineRow>("payments")
      .then((rows) => rows.length)
      .catch(() => 0),
    offlineDB
      .getAll<OfflineRow>("customer_ledger")
      .then((rows) => rows.length)
      .catch(() => 0),
    offlineDB
      .getAll<OfflineRow>("inventory_movements")
      .then((rows) => rows.length)
      .catch(() => 0),
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
      offlineDB.getAll<PendingSyncEvent>("sync_outbox").catch(() => []),
      offlineDB.getAll<OfflineRow>("sync_conflicts").catch(() => []),
      getLastCloudBackupAt(),
      countLocalBusinessRows(),
      getCurrentSubscriptionSnapshot().catch(() => null),
      readOfflineReadiness(),
    ]);

    const pendingSyncCount = allOperations.filter(
      (row) =>
        row.status === "PENDING" ||
        row.status === "SYNCING" ||
        row.sync_status === "pending_sync" ||
        row.sync_status === "syncing",
    ).length;
    const failedSyncCount = allOperations.filter(
      (row) => row.status === "FAILED" || row.sync_status === "failed",
    ).length;
    const conflictCount = conflicts.filter(
      (row) =>
        row.sync_status === "conflict" || row.resolution === "unresolved",
    ).length;
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
      pendingSyncCount: 0,
      failedSyncCount: 0,
      conflictCount: 0,
      localBusinessRows: 0,
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
