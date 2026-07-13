import {
  dexieDB,
  type SyncCursorRow,
} from "@/lib/offline/db";
import { getOfflineScope, nowIso } from "@/lib/offline/context";
import { emitLocalDataChanged } from "@/lib/offline/instant-cache";
import { syncPull } from "@/features/sync/api";
import { mergeServerChange, refreshBusinessCaches } from "@/features/sync/sync-reconcile";
import {
  DEFAULT_CURSOR_ID,
  isRecord,
  nextCursorFromResponse,
  SERVER_SEQUENCE_CURSOR_ID,
  serverSequenceFromResponse,
} from "@/features/sync/sync-types";
import type { SyncPullChange, SyncPullResponse } from "@/types/api";

const DEFAULT_SYNC_SINCE = "1970-01-01T00:00:00.000Z";
const SYNC_PULL_LIMIT = 500;
const MAX_PULL_PAGES_PER_CYCLE = 10;
const ENTITY_CURSOR_KEYS = [
  "products",
  "customers",
  "bills",
  "stockLedger",
  "udharLedger",
  "suppliers",
  "purchaseHistory",
] as const;

type EntityCursorKey = typeof ENTITY_CURSOR_KEYS[number];
type EntityCursorMap = Partial<Record<EntityCursorKey, string | null>>;

function cursorRowId(entity: string) {
  return `entity:${entity}`;
}

function isCurrentScope(row: SyncCursorRow | undefined) {
  const scope = getOfflineScope();
  return Boolean(row && row.tenant_id === scope.tenant_id && row.store_id === scope.store_id);
}

function buildCursorRow(id: string, entityType: string, cursor: string | number | null): SyncCursorRow {
  const scope = getOfflineScope();
  const now = nowIso();
  return {
    id,
    entity_type: entityType,
    cursor: cursor === null ? null : String(cursor),
    last_pulled_at: now,
    tenant_id: scope.tenant_id,
    store_id: scope.store_id,
    device_id: scope.device_id,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    version: 1,
    sync_status: "synced",
    last_modified_by: null,
  };
}

export async function getStoredCursor(): Promise<string | number | null> {
  await dexieDB.open();
  const row = await dexieDB.sync_cursor.get(DEFAULT_CURSOR_ID);
  if (!isCurrentScope(row)) return null;
  return row?.cursor ?? null;
}

export async function setStoredCursor(
  cursor: string | number | null | undefined,
): Promise<void> {
  if (cursor === undefined || cursor === "") return;
  await dexieDB.open();
  await dexieDB.sync_cursor.put(buildCursorRow(DEFAULT_CURSOR_ID, "global", cursor));
}

export async function getStoredServerSequence(): Promise<string | number | null> {
  await dexieDB.open();
  const row = await dexieDB.sync_cursor.get(SERVER_SEQUENCE_CURSOR_ID);
  if (!isCurrentScope(row)) return null;
  return row?.cursor ?? null;
}

export async function setStoredServerSequence(cursor: string | number | null | undefined): Promise<void> {
  if (cursor === undefined || cursor === "") return;
  await dexieDB.open();
  await dexieDB.sync_cursor.put(buildCursorRow(SERVER_SEQUENCE_CURSOR_ID, "server_sequence", cursor));
}

export async function getStoredEntityCursors(): Promise<EntityCursorMap> {
  await dexieDB.open();
  const entries = await Promise.all(
    ENTITY_CURSOR_KEYS.map(async (entity) => {
      const row = await dexieDB.sync_cursor.get(cursorRowId(entity));
      return [entity, isCurrentScope(row) ? row?.cursor ?? null : null] as const;
    }),
  );
  return Object.fromEntries(entries) as EntityCursorMap;
}

export async function setStoredEntityCursors(
  cursors: Record<string, string | number | null | undefined> | null | undefined,
): Promise<void> {
  if (!cursors || typeof cursors !== "object") return;
  await dexieDB.open();
  const rows: SyncCursorRow[] = [];
  for (const entity of ENTITY_CURSOR_KEYS) {
    const cursor = cursors[entity];
    if (cursor === undefined || cursor === "") continue;
    rows.push(buildCursorRow(cursorRowId(entity), entity, cursor));
  }
  if (rows.length > 0) await dexieDB.sync_cursor.bulkPut(rows);
}

function getResponseEntityCursors(response: SyncPullResponse): Record<string, string | null> | null {
  const sync = isRecord(response.sync) ? response.sync : null;
  const cursors = sync && isRecord(sync.entityCursors) ? sync.entityCursors : null;
  if (!cursors) return null;
  return Object.fromEntries(
    Object.entries(cursors).filter(([, value]) => typeof value === "string" || value === null),
  ) as Record<string, string | null>;
}

function responseHasMore(response: SyncPullResponse): boolean {
  const sync = isRecord(response.sync) ? response.sync : null;
  if (!sync) return false;
  if (sync.hasMore === true) return true;
  const byEntity = isRecord(sync.hasMoreByEntity) ? sync.hasMoreByEntity : null;
  return Boolean(byEntity && Object.values(byEntity).some((value) => value === true));
}

export function normalizePullChanges(response: SyncPullResponse): SyncPullChange[] {
  const raw = response.changes;
  if (Array.isArray(raw)) return raw.filter(isRecord) as SyncPullChange[];
  if (isRecord(raw)) {
    return Object.entries(raw).flatMap(([entityType, rows]) =>
      Array.isArray(rows)
        ? rows
            .filter(isRecord)
            .map((row) => ({ entity_type: entityType, entity: row }))
        : [],
    );
  }
  const records: Array<[string, string]> = [
    ["products", "product"],
    ["customers", "customer"],
    ["bills", "bill"],
    ["bill_items", "bill_item"],
    ["payments", "payment"],
    ["customer_ledger", "ledger_entry"],
    ["inventory_movements", "inventory_movement"],
    ["stockLedger", "stock_ledger"],
    ["udharLedger", "udhar_ledger"],
    ["suppliers", "supplier"],
    ["purchaseHistory", "purchase_history"],
    ["settings", "settings"],
  ];
  return records.flatMap(([key, entityType]) => {
    const rows = response[key];
    return Array.isArray(rows)
      ? rows.filter(isRecord).map((row) => ({ entity_type: entityType, entity: row }))
      : [];
  });
}

export async function pullServerChanges(): Promise<{
  pulled: number;
  conflicts: number;
  cursor?: string | number | null;
  hasMore?: boolean;
}> {
  let totalPulled = 0;
  let totalConflicts = 0;
  let latestCursor: string | number | null | undefined = await getStoredCursor();
  let latestServerSequence: string | number | null | undefined = await getStoredServerSequence();
  let hasMore = false;

  try {
    for (let page = 0; page < MAX_PULL_PAGES_PER_CYCLE; page += 1) {
      const response = await syncPull({
        since: DEFAULT_SYNC_SINCE,
        cursor: latestCursor,
        afterSeq: latestServerSequence ?? "0",
        limit: SYNC_PULL_LIMIT,
        background: true,
      });
      const changes = normalizePullChanges(response);
      let pulled = 0;
      let conflicts = 0;
      for (const change of changes) {
        const status = await mergeServerChange(change);
        if (status === "merged") pulled += 1;
        if (status === "conflict") conflicts += 1;
      }
      totalPulled += pulled;
      totalConflicts += conflicts;

      latestCursor = nextCursorFromResponse(response);
      const responseServerSequence = serverSequenceFromResponse(response);
      if (responseServerSequence !== undefined) latestServerSequence = responseServerSequence;
      await setStoredCursor(latestCursor);
      await setStoredServerSequence(latestServerSequence);
      await setStoredEntityCursors(getResponseEntityCursors(response));
      hasMore = responseHasMore(response);

      if (!hasMore) break;
    }

    await refreshBusinessCaches();
    if (totalPulled > 0 || totalConflicts > 0)
      emitLocalDataChanged({
        type: "sync",
        action: "pull",
        pulled: totalPulled,
        conflicts: totalConflicts,
      });
    return { pulled: totalPulled, conflicts: totalConflicts, cursor: latestCursor, hasMore };
  } catch {
    return { pulled: totalPulled, conflicts: totalConflicts, cursor: latestCursor, hasMore };
  }
}
