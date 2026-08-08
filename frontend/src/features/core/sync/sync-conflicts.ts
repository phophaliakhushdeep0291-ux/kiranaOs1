import { dexieDB } from "@/lib/offline/db";
import { getOfflineScope, nowIso } from "@/lib/offline/context";
import { reportSyncConflict } from "@/features/core/sync/api";
import { sanitizeSyncDiagnostic, sanitizeSyncRecord } from "@/features/core/sync/sensitive-data";

function makeConflictId(
  entityType: string,
  entityId: string,
  sourceId: string,
) {
  return `conflict_${entityType}_${entityId}_${sourceId}`.replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );
}

export async function storeConflict(input: {
  entityType: string;
  entityId: string;
  sourceId: string;
  localSnapshot?: unknown;
  serverSnapshot?: unknown;
  errorMessage?: string;
  serverConflictId?: string;
  serverRecordVersion?: number;
  serverVersion?: string | number | null;
}): Promise<void> {
  const scope = getOfflineScope();
  const now = nowIso();
  const id = makeConflictId(input.entityType, input.entityId, input.sourceId);
  const localSnapshot = sanitizeSyncDiagnostic(input.localSnapshot);
  const serverSnapshot = sanitizeSyncDiagnostic(input.serverSnapshot);
  await dexieDB.sync_conflicts.put({
    id,
    entity_type: input.entityType,
    entity_id: input.entityId,
    tenant_id: scope.tenant_id,
    store_id: scope.store_id,
    device_id: scope.device_id,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    version: 1,
    sync_status: "conflict",
    last_modified_by: null,
    resolution: "unresolved",
    local_snapshot: localSnapshot ?? null,
    server_snapshot: serverSnapshot ?? null,
    error_message: input.errorMessage ?? "Sync conflict",
    source_event_id: input.sourceId,
    server_conflict_id: input.serverConflictId,
    server_record_version: input.serverRecordVersion,
    server_version: input.serverVersion ?? input.sourceId,
  });


  if (input.serverConflictId) return;
  // Local persistence is authoritative while offline. Reporting is deliberately
  // best-effort and backgrounded; when connectivity exists it makes the same
  // review item visible to every owner/admin device without blocking reconciliation.
  try {
    const reporting = reportSyncConflict({
      client_conflict_id: id,
      entity_type: input.entityType,
      entity_id: input.entityId,
      reason_code: "CLIENT_SYNC_CONFLICT",
      message: input.errorMessage ?? "Sync conflict",
      local_snapshot: sanitizeSyncRecord(localSnapshot),
      server_snapshot: sanitizeSyncRecord(serverSnapshot),
      server_version: input.sourceId,
    }, { background: true });
    void reporting.then(async ({ conflict }) => {
      const current = await dexieDB.sync_conflicts.get(id);
      if (!current) return;
      await dexieDB.sync_conflicts.put({
        ...current,
        server_conflict_id: conflict.id,
        server_version: conflict.server_version ?? input.sourceId,
        updated_at: nowIso(),
      });
    }).catch(() => undefined);
  } catch {
    // The local conflict row is already durable; reporting must never break sync.
  }
}
