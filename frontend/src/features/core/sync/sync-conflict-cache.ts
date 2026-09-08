import { dexieDB, offlineDB, filterRowsForCurrentScope, type OfflineRow } from "@/lib/offline/db";
import { getOfflineScope } from "@/lib/offline/context";
import { listSyncConflicts } from "@/features/core/sync/api";
import type { SyncConflictRecord } from "@/types/api";
import { isUnresolvedSyncConflict } from "@/features/core/sync/sync-health";
import { sanitizeSyncDiagnostic } from "@/features/core/sync/sensitive-data";

type ConflictRow = OfflineRow;

function readStringFromRecord(row: unknown, keys: string[]): string | undefined {
  if (!row || typeof row !== "object") return undefined;
  const record = row as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key]) return record[key] as string;
  }
  return undefined;
}

export function mergeServerConflictRows(
  localRows: ConflictRow[],
  serverRows: SyncConflictRecord[],
): ConflictRow[] {
  const scope = getOfflineScope();
  const sourceEventIds = new Set(
    serverRows
      .map((row) => row.source_event_id)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );
  const serverIdentity = (row: SyncConflictRecord) => {
    const explicitSource = typeof row.source_event_id === "string" && row.source_event_id.length > 0
      ? row.source_event_id
      : null;
    const linkedSource = explicitSource
      ?? (typeof row.server_version === "string" && sourceEventIds.has(row.server_version)
        ? row.server_version
        : null);
    if (linkedSource) return `source:${linkedSource}`;
    if (row.client_conflict_id) return `client:${row.client_conflict_id}`;
    return `server:${row.id}`;
  };
  const canonicalServerRows = new Map<string, SyncConflictRecord>();
  for (const row of serverRows) {
    const identity = serverIdentity(row);
    const current = canonicalServerRows.get(identity);
    const rowIsAuthoritative = typeof row.source_event_id === "string" && row.source_event_id.length > 0;
    const currentIsAuthoritative = typeof current?.source_event_id === "string" && current.source_event_id.length > 0;
    if (!current || (rowIsAuthoritative && !currentIsAuthoritative)) {
      canonicalServerRows.set(identity, row);
    }
  }

  const byIdentity = new Map<string, ConflictRow>();
  for (const row of localRows) {
    const explicitSource = readStringFromRecord(row, ["source_event_id"]);
    const linkedSource = explicitSource
      ?? (typeof row.server_version === "string" && sourceEventIds.has(row.server_version)
        ? row.server_version
        : null);
    const identity = linkedSource ? `source:${linkedSource}` : `client:${String(row.id)}`;
    byIdentity.set(identity, row);
  }

  for (const [identity, server] of canonicalServerRows) {
    const clientId = server.client_conflict_id ?? undefined;
    const local = byIdentity.get(identity)
      ?? (clientId ? byIdentity.get(`client:${clientId}`) : undefined)
      ?? [...byIdentity.values()].find((row) => row.server_conflict_id === server.id);
    const id = local?.id ?? clientId ?? server.id;
    const merged: ConflictRow = {
      ...(local ?? {}),
      id,
      entity_type: server.entity_type,
      entity_id: server.entity_id,
      tenant_id: local?.tenant_id ?? scope.tenant_id,
      store_id: local?.store_id ?? scope.store_id,
      device_id: local?.device_id ?? server.device_id ?? scope.device_id,
      created_at: local?.created_at ?? server.created_at,
      updated_at: server.updated_at,
      deleted_at: null,
      version: local?.version ?? 1,
      sync_status: "conflict",
      last_modified_by: local?.last_modified_by ?? null,
      resolution: "unresolved",
      local_snapshot: sanitizeSyncDiagnostic(local?.local_snapshot ?? server.local_snapshot ?? null),
      server_snapshot: sanitizeSyncDiagnostic(server.server_snapshot ?? local?.server_snapshot ?? null),
      error_message: server.message,
      source_event_id: server.source_event_id ?? readStringFromRecord(local, ["source_event_id"]),
      server_conflict_id: server.id,
      server_record_version: server.version,
      server_version: server.server_version,
    };
    if (local) {
      for (const [key, row] of byIdentity) {
        if (key !== identity && row.id === local.id) byIdentity.delete(key);
      }
    }
    byIdentity.set(identity, merged);
  }
  return [...byIdentity.values()].sort((a, b) =>
    String(b.updated_at ?? b.created_at ?? "").localeCompare(String(a.updated_at ?? a.created_at ?? "")),
  );
}

const refreshes = new Map<string, { startedAt: number; promise: Promise<void>; inFlight: boolean }>();

/** Cache server reviews for every local status consumer, never just one page. */
export function refreshServerConflictCache(options: { force?: boolean } = {}): Promise<void> {
  const scope = getOfflineScope();
  const key = `${scope.tenant_id}:${scope.store_id}`;
  const previous = refreshes.get(key);
  if (previous && (previous.inFlight || (!options.force && Date.now() - previous.startedAt < 60_000))) return previous.promise;
  const startedAt = Date.now();
  const promise = (async () => {
    const initialRows = filterRowsForCurrentScope(await offlineDB.getAll<OfflineRow>("sync_conflicts"));
    const initialById = new Map(initialRows.map((row) => [row.id, JSON.stringify(row)]));
    const serverRows: SyncConflictRecord[] = [];
    const cursors = new Set<string>();
    let cursor: string | null = null;
    do {
      const page = await listSyncConflicts({ status: "open", limit: 100, cursor, background: true });
      serverRows.push(...page.conflicts);
      if (!page.pagination.hasMore) break;
      cursor = page.pagination.nextCursor;
      if (!cursor || cursors.has(cursor)) throw new Error("Conflict pagination did not advance");
      cursors.add(cursor);
    } while (true);

    const sameScope = () => {
      const current = getOfflineScope();
      return current.tenant_id === scope.tenant_id && current.store_id === scope.store_id;
    };
    if (!sameScope()) return;
    let changed = false;
    await dexieDB.transaction("rw", [dexieDB.sync_conflicts], async () => {
      if (!sameScope()) return;
      const localRows = filterRowsForCurrentScope(await offlineDB.getAll<OfflineRow>("sync_conflicts"));
      // A fresh read inside the write transaction protects concurrent local
      // reviews. A response started before that decision must not reopen it.
      const recentIds = new Set(localRows.filter((row) =>
        Date.parse(row.updated_at) > startedAt || initialById.get(row.id) !== JSON.stringify(row),
      ).map((row) => row.id));
      const eligibleServer = serverRows.filter((server) => !localRows.some((local) =>
        (local.server_conflict_id === server.id || local.id === server.client_conflict_id) &&
        (recentIds.has(local.id) || Number(local.server_record_version ?? 0) > server.version),
      ));
      const openServerIds = new Set(serverRows.map((row) => row.id));
      const merged = mergeServerConflictRows(localRows, eligibleServer);
      const originals = new Map(localRows.map((row) => [row.id, row]));
      for (const row of merged) {
        let next = row;
        if (typeof row.server_conflict_id === "string" && !openServerIds.has(row.server_conflict_id) &&
            isUnresolvedSyncConflict(row) && !recentIds.has(row.id)) {
          // Only a complete successful server listing may close a cloud review.
          // Preserve both snapshots; this does not choose or modify financial data.
          next = { ...row, resolution: "server_closed", sync_status: "synced", updated_at: new Date().toISOString() };
        }
        if (JSON.stringify(originals.get(next.id)) === JSON.stringify(next)) continue;
        await dexieDB.sync_conflicts.put(next);
        changed = true;
      }
    });
    if (changed && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("kirana:sync-queue-updated"));
    }
  })();
  const entry = { startedAt, promise, inFlight: true };
  refreshes.set(key, entry);
  void promise.then(() => { entry.inFlight = false; }, () => { entry.inFlight = false; });
  return promise;
}
