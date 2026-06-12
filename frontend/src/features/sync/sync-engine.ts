import { dexieDB, offlineDB, rowMatchesCurrentScope, type PendingSyncEvent } from "@/lib/offline/db";
import { getSyncStatus, requestSyncRetry } from "@/features/sync/api";
import { pullServerChanges } from "@/features/sync/sync-pull";
import { pushPendingOutboxOperations } from "@/features/sync/sync-push";
import { getCurrentSubscriptionSnapshot } from "@/features/subscription/access";
import { readSyncQueueCounts, repairResolvedSyncStatusNoise, repairRetryableBillValidationConflicts } from "@/features/sync/sync-status-repair";
import { entityTypeFromOperation, tableNameForEntity, type SyncRunResult } from "@/features/sync/sync-types";
import { probeBackendConnection } from "@/features/sync/backend-health";
import { ApiClientError, getStoredAccessToken, getStoredRefreshToken } from "@/lib/api/http";

async function canSubscriptionSync(): Promise<boolean> {
  const snapshot = await getCurrentSubscriptionSnapshot();
  return snapshot.cloudSyncAllowed;
}

function isAuthSyncFailure(error: unknown) {
  return error instanceof ApiClientError && (error.status === 401 || error.status === 403);
}

async function emptySyncResult(cursor?: string | number | null): Promise<SyncRunResult> {
  return {
    pushed: 0,
    pulled: 0,
    conflicts: 0,
    failed: 0,
    pending: (await readSyncQueueCounts()).totalBlocking,
    skipped: 0,
    cursor,
  };
}

export async function runSyncCycle(): Promise<SyncRunResult> {
  await offlineDB.init();
  if (typeof window !== "undefined" && !getStoredAccessToken() && !getStoredRefreshToken()) return emptySyncResult();

  const connection = await probeBackendConnection();
  if (!connection.browserOnline || !connection.backendReachable) {
    return emptySyncResult();
  }
  const localSubscriptionAllowsSync = await canSubscriptionSync();
  let serverAllowsSync: boolean | null = null;
  let statusCursor: string | number | null | undefined;

  try {
    const status = await getSyncStatus({ background: true });
    serverAllowsSync = status.allowed !== false;
    statusCursor = status.cursor ?? status.server_version;
  } catch (error) {
    if (isAuthSyncFailure(error)) return emptySyncResult(statusCursor);
    // If /sync/status is unavailable, continue. Push and pull will surface real failures.
  }

  const syncAllowed = serverAllowsSync ?? localSubscriptionAllowsSync;
  if (!syncAllowed) {
    return emptySyncResult(statusCursor);
  }

  await repairRetryableBillValidationConflicts().catch(() => 0);
  const push = await pushPendingOutboxOperations();
  const pull = await pullServerChanges();
  await repairResolvedSyncStatusNoise().catch(() => 0);
  return {
    pushed: push.pushed,
    pulled: pull.pulled,
    conflicts: push.conflicts + pull.conflicts,
    failed: push.failed,
    pending: (await readSyncQueueCounts()).totalBlocking,
    skipped: push.skipped,
    cursor: pull.cursor,
  };
}

export async function retryFailedSyncOperations(
  opIds?: string[],
): Promise<SyncRunResult> {
  await dexieDB.open();
  const rows = opIds?.length
    ? await Promise.all(opIds.map((id) => dexieDB.sync_outbox.get(id))).then(
        (items) =>
          items.filter(
            (item): item is PendingSyncEvent =>
              Boolean(item) && rowMatchesCurrentScope(item),
          ),
      )
    : await offlineDB
        .getAll<PendingSyncEvent>("sync_outbox")
        .then((items) =>
          items.filter(
            (row) =>
              row.status === "FAILED" ||
              row.status === "CONFLICT" ||
              row.sync_status === "failed" ||
              row.sync_status === "conflict",
          ),
        );

  if (rows.length > 0) {
    await dexieDB.transaction("rw", dexieDB.sync_outbox, async () => {
      for (const row of rows) {
        await dexieDB.sync_outbox.put({
          ...row,
          status: "PENDING",
          sync_status: "pending_sync",
          error_message: null,
          last_error: null,
          next_retry_at: null,
        });
        const entityType = entityTypeFromOperation(row.operation_type, row.entity_type);
        const tableName = tableNameForEntity(entityType);
        if (tableName && tableName !== "settings") {
          const table = dexieDB.table(tableName);
          const entity = await table.get(row.entity_id).catch(() => undefined);
          if (entity && rowMatchesCurrentScope(entity)) {
            await table.put({
              ...entity,
              sync_status: "pending_sync",
              isSynced: tableName === "bills" ? false : entity.isSynced,
              is_synced: tableName === "bills" ? false : entity.is_synced,
            });
          }
        }
      }
    });
  }

  try {
    await requestSyncRetry({ op_ids: opIds });
  } catch {
    // Backend retry endpoint is advisory. The local outbox retry below remains the source of truth.
  }

  return runSyncCycle();
}

export { pullServerChanges } from "@/features/sync/sync-pull";
export { pushPendingOutboxOperations } from "@/features/sync/sync-push";
export type { SyncRunResult } from "@/features/sync/sync-types";
