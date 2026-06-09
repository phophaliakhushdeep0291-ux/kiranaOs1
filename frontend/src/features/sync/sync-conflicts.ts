import { dexieDB } from "@/lib/offline/db";
import { getOfflineScope, nowIso } from "@/lib/offline/context";

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
}): Promise<void> {
  const scope = getOfflineScope();
  const now = nowIso();
  const id = makeConflictId(input.entityType, input.entityId, input.sourceId);
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
    local_snapshot: input.localSnapshot ?? null,
    server_snapshot: input.serverSnapshot ?? null,
    error_message: input.errorMessage ?? "Sync conflict",
  });
}
