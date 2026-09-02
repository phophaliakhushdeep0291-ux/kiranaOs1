import { dexieDB, offlineDB, rowMatchesCurrentScope, type PendingSyncEvent } from "@/lib/offline/db";
import { getSyncStatus, requestSyncRetry } from "@/features/core/sync/api";
import { pullServerChanges } from "@/features/core/sync/sync-pull";
import { applyRecoveredSyncEventResult, drainPendingOutboxOperations, pushPendingOutboxOperations } from "@/features/core/sync/sync-push";
import { getCurrentSubscriptionSnapshot } from "@/features/core/subscription/access";
import { readSyncQueueCounts, repairResolvedSyncStatusNoise, repairRetryableBillValidationConflicts } from "@/features/core/sync/sync-status-repair";
import { entityTypeFromOperation, tableNameForEntity, type SyncRunResult } from "@/features/core/sync/sync-types";
import { probeBackendConnection } from "@/features/core/sync/backend-health";
import { ApiClientError, getStoredAccessToken, getStoredRefreshToken } from "@/lib/api/http";
import { ACTIVITY_EVENTS, trackEvent, type ActivityEventType } from "@/lib/activity";
import { drainDeviceCommands } from "@/features/core/remote-support/command-runner";

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

let inFlightCycle: Promise<SyncRunResult> | null = null;
let queuedCycle: Promise<SyncRunResult> | null = null;
const CROSS_TAB_SYNC_LOCK = "kirana-os:sync-cycle:v1";

function hasWebLocks(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.locks?.request === "function"
  );
}

async function runWithCrossTabSyncLock(
  work: (ownsCrossTabLock: boolean) => Promise<SyncRunResult>,
): Promise<SyncRunResult> {
  if (!hasWebLocks()) return work(false);

  // The lock is released automatically if a tab reloads, navigates away, or
  // crashes. The next document can therefore distinguish an abandoned SYNCING
  // marker from work that another live tab still owns and safely replay it using
  // the operation's stable idempotency key.
  return navigator.locks.request(
    CROSS_TAB_SYNC_LOCK,
    { mode: "exclusive" },
    () => work(true),
  );
}

/**
 * Only one sync cycle runs at a time in a tab, whoever asks.
 *
 * Two independent schedulers drive this: `useOfflineStatus` on an 18s interval
 * and `useMultiDeviceSync` on an 8s one, plus manual retries and the recovery
 * path. Each kept its own re-entrancy flag, and separate flags do not compose —
 * they ran overlapping cycles that pushed the same outbox rows and re-pulled the
 * same pages. Measured on an idle Products page: cycles arriving in threes on the
 * same millisecond.
 *
 * Callers are coalesced rather than dropped, which matters because one of them is
 * the shopkeeper pressing Retry. Asking while a cycle runs chains exactly one
 * follow-up, so work enqueued after the running cycle already read the queue
 * still gets a pass, and a hundred callers still only cost one extra cycle.
 */
export function runSyncCycle(): Promise<SyncRunResult> {
  if (!inFlightCycle) {
    inFlightCycle = runExclusiveSyncCycle();
    return inFlightCycle;
  }
  if (!queuedCycle) {
    queuedCycle = inFlightCycle
      .catch(() => undefined)
      .then(() => {
        queuedCycle = null;
        return runSyncCycle();
      });
  }
  return queuedCycle;
}

async function runExclusiveSyncCycle(): Promise<SyncRunResult> {
  try {
    return await runWithCrossTabSyncLock(runSyncCycleBody);
  } finally {
    // Cleared before this promise settles, so a queued follow-up always finds the
    // slot free and starts a genuinely fresh cycle.
    inFlightCycle = null;
  }
}

async function runSyncCycleBody(ownsCrossTabLock = false): Promise<SyncRunResult> {
  await offlineDB.init();
  if (typeof window !== "undefined" && !getStoredAccessToken() && !getStoredRefreshToken()) return emptySyncResult();

  const connection = await probeBackendConnection();
  if (!connection.browserOnline || !connection.backendReachable) {
    return emptySyncResult();
  }

  // Remote-support commands drain here — above the subscription gate on purpose. A
  // shop whose sync is switched off is among the likeliest to have called support,
  // and a repair channel that dies with the thing being repaired is no channel at
  // all. Fire-and-forget so a slow repair never stalls the till's own sync; the
  // runner guards its own re-entrancy, since RUN_SYNC_NOW lands back here.
  void drainDeviceCommands();

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

  await repairResolvedSyncStatusNoise({
    recoverAbandonedSyncing: ownsCrossTabLock,
  }).catch(() => 0);
  await repairRetryableBillValidationConflicts().catch(() => 0);

  // §13 sync activity. A POS pushes on a timer, so emitting a start/finish pair
  // every cycle would bury every other event under sync noise. Only cycles that
  // actually moved something — or failed — are recorded, mirroring the backend
  // audit trail's "one terminal row per non-empty batch" rule.
  const startedAt = Date.now();
  let push: Awaited<ReturnType<typeof pushPendingOutboxOperations>>;
  let pull: Awaited<ReturnType<typeof pullServerChanges>>;
  try {
    // Drains rather than sending a single batch. One batch per cycle meant a
    // backlog moved at the scheduler's cadence — 2.5s of dead air per batch,
    // and no movement at all while the tab was hidden.
    push = await drainPendingOutboxOperations();
    pull = await pullServerChanges();
  } catch (error) {
    trackSyncEvent(ACTIVITY_EVENTS.SYNC_FAILED, Date.now() - startedAt, {
      reason: error instanceof ApiClientError ? error.data?.code ?? String(error.status) : "unknown",
    });
    throw error;
  }

  await repairResolvedSyncStatusNoise().catch(() => 0);
  const moved = push.pushed + pull.pulled + push.failed + push.conflicts + pull.conflicts;
  // A failed pull moves nothing, so it would never be recorded if `moved` alone
  // decided — which is exactly how a total receive outage stayed invisible.
  if (moved > 0 || pull.failed) {
    trackSyncEvent(
      push.failed > 0 || pull.failed ? ACTIVITY_EVENTS.SYNC_FAILED : ACTIVITY_EVENTS.SYNC_COMPLETED,
      Date.now() - startedAt,
      {
        pushed: push.pushed,
        pulled: pull.pulled,
        failed: push.failed,
        conflicts: push.conflicts + pull.conflicts,
        ...(pull.failed ? { pullFailed: true, reason: pull.failureReason ?? "unknown" } : {}),
      },
    );
  }

  return {
    pushed: push.pushed,
    pulled: pull.pulled,
    conflicts: push.conflicts + pull.conflicts,
    failed: push.failed,
    pending: (await readSyncQueueCounts()).totalBlocking,
    skipped: push.skipped,
    cursor: pull.cursor,
    pullFailed: pull.failed,
    pullFailureReason: pull.failureReason,
  };
}

function trackSyncEvent(eventType: ActivityEventType, durationMs: number, metadata: Record<string, unknown>): void {
  trackEvent(eventType, metadata, { durationMs, module: "sync" });
}

export async function retryFailedSyncOperations(
  opIds?: string[],
  storedConflictOpIds: string[] = [],
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

  const storedIds = new Set(storedConflictOpIds);
  const sourceIdFor = (row: PendingSyncEvent) => row.op_id || row.clientEventId;
  // A stored terminal conflict must be recovered by the server with a fresh
  // event id. Never put its original id back into PENDING: the backend correctly
  // rejects duplicate terminal events, which was the endless ₹180 bill loop.
  const locallyRetryableRows = rows.filter((row) => !storedIds.has(sourceIdFor(row)));
  const storedRows = rows.filter((row) => storedIds.has(sourceIdFor(row)));

  let retryResponse: Awaited<ReturnType<typeof requestSyncRetry>> | null = null;
  const retryIds = [...new Set([
    ...locallyRetryableRows.map(sourceIdFor),
    ...storedConflictOpIds,
  ].filter((value): value is string => typeof value === "string" && value.length > 0))];

  try {
    retryResponse = await requestSyncRetry({ op_ids: retryIds.length > 0 ? retryIds : opIds });
  } catch (error) {
    // The endpoint remains advisory for ordinary local failures: their outbox
    // bytes are still the source of truth. It is required for stored terminal
    // conflicts because only the server has the immutable recovery snapshot.
    if (storedConflictOpIds.length > 0) throw error;
  }

  const recoveryRows = retryResponse?.recovery?.results ?? [];
  const recoveredIds = new Set(
    recoveryRows
      .filter((row) => row.status === "replayed" || row.status === "already_recovered")
      .map((row) => row.sourceEventId),
  );
  for (const row of storedRows) {
    const sourceId = sourceIdFor(row);
    const recovery = recoveryRows.find((result) => result.sourceEventId === sourceId);
    if (recovery?.status === "replayed" && recovery.replay) {
      await applyRecoveredSyncEventResult(row, recovery.replay);
    } else if (recovery?.status === "already_recovered") {
      await dexieDB.sync_outbox.put({
        ...row,
        status: "SYNCED",
        sync_status: "synced",
        error_message: null,
        last_error: null,
        next_retry_at: null,
      });
    }
  }

  if (locallyRetryableRows.length > 0) {
    await dexieDB.transaction("rw", dexieDB.sync_outbox, async () => {
      for (const row of locallyRetryableRows) {
        await dexieDB.sync_outbox.put({
          ...row,
          status: "PENDING",
          sync_status: "pending_sync",
          error_message: null,
          last_error: null,
          next_retry_at: null,
          // An explicit "Retry" from the owner outranks the repair-sweep bound, so
          // a change the sweeps gave up on can be rescued by hand — and can be
          // swept again later. retry_count is deliberately NOT reset: PENDING
          // already bypasses the attempt cap, and the count is the history the
          // Sync Status screen shows ("Retries: 108").
          repair_requeues: 0,
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

  const syncResult = await runSyncCycle();
  if (storedConflictOpIds.length === 0) return syncResult;
  return {
    ...syncResult,
    storedConflictRecovery: {
      requested: storedConflictOpIds.length,
      recovered: recoveredIds.size,
      failed: recoveryRows.filter((row) => row.status === "failed").length,
      skipped: recoveryRows.filter((row) => row.status === "skipped").length,
      codes: recoveryRows
        .filter((row) => row.status === "failed" || row.status === "skipped")
        .map((row) => row.code),
    },
  };
}

export { pullServerChanges } from "@/features/core/sync/sync-pull";
export { pushPendingOutboxOperations } from "@/features/core/sync/sync-push";
export type { SyncRunResult } from "@/features/core/sync/sync-types";
