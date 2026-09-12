type SyncRow = {
  id?: unknown;
  status?: unknown;
  sync_status?: unknown;
  deleted_at?: unknown;
  deletedAt?: unknown;
  resolution?: unknown;
  source_event_id?: unknown;
  sourceEventId?: unknown;
  sourceId?: unknown;
  op_id?: unknown;
  clientEventId?: unknown;
  server_conflict_id?: unknown;
  entity_id?: unknown;
  payload?: unknown;
  local_snapshot?: unknown;
  server_snapshot?: unknown;
  error_message?: unknown;
  last_error?: unknown;
};

export interface SyncQueueCounts {
  pending: number;
  failed: number;
  conflict: number;
  retryable: number;
  totalBlocking: number;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function syncOperationState(row: SyncRow): "pending" | "failed" | "conflict" | "synced" | null {
  // Prefer the blocking state when a legacy row has contradictory status fields.
  if (row.status === "CONFLICT" || row.sync_status === "conflict") return "conflict";
  if (row.status === "FAILED" || row.sync_status === "failed") return "failed";
  if (row.status === "PENDING" || row.status === "SYNCING" || row.sync_status === "pending_sync" || row.sync_status === "syncing") return "pending";
  if (row.status === "SYNCED" || row.sync_status === "synced") return "synced";
  return null;
}

export function isUnresolvedSyncConflict(row: SyncRow): boolean {
  return row.deleted_at == null && row.deletedAt == null &&
    (row.sync_status === "conflict" || row.resolution === "unresolved");
}

export function conflictSourceEventId(row: SyncRow): string | undefined {
  // Older local rejection rows stored the exact operation ID as sourceId.
  return text(row.source_event_id) ?? text(row.sourceEventId) ?? text(row.sourceId);
}

export function syncOperationIds(row: SyncRow): string[] {
  return [row.op_id, row.clientEventId].map(text).filter((id): id is string => Boolean(id));
}

export function syncReviewRows(outbox: SyncRow[], conflicts: SyncRow[]): SyncRow[] {
  const reviews: SyncRow[] = [];
  const seen = new Set<string>();
  for (const row of conflicts.filter(isUnresolvedSyncConflict)) {
    const source = conflictSourceEventId(row);
    const identity = source ? `source:${source}` : text(row.server_conflict_id) ?? text(row.id);
    if (identity && seen.has(identity)) continue;
    if (identity) seen.add(identity);
    reviews.push(row);
  }
  for (const event of outbox) {
    if (syncOperationState(event) !== "conflict") continue;
    const ids = syncOperationIds(event);
    if (ids.some((id) => seen.has(`source:${id}`))) continue;
    for (const id of ids) seen.add(`source:${id}`);
    reviews.push({
      ...event,
      id: `outbox-conflict:${ids[0] ?? String(event.entity_id ?? "unknown")}`,
      source_event_id: ids[0],
      resolution: "unresolved",
      sync_status: "conflict",
      local_snapshot: event.payload ?? null,
      server_snapshot: null,
      error_message: event.error_message ?? event.last_error,
    });
  }
  return reviews;
}

export function syncReviewSourceIds(reviews: SyncRow[]): Set<string> {
  return new Set(reviews.map(conflictSourceEventId).filter((id): id is string => Boolean(id)));
}

export function canAutoResolveSyncConflict(conflict: SyncRow, outbox: SyncRow[]): boolean {
  // A server review requires a server/owner decision. Missing or pruned events,
  // another device's events, and pull sequence IDs are not acknowledgements.
  if (text(conflict.server_conflict_id)) return false;
  const source = conflictSourceEventId(conflict);
  if (!source) return false;
  const matching = outbox.filter((event) => syncOperationIds(event).includes(source));
  return matching.length > 0 && matching.every((event) => syncOperationState(event) === "synced");
}

/** Callers supply rows from the current tenant/store only. No writes or network work. */
export function calculateSyncQueueCounts(outbox: SyncRow[], conflicts: SyncRow[]): SyncQueueCounts {
  let pending = 0;
  let failed = 0;
  let retryable = 0;
  const reviews = syncReviewRows(outbox, conflicts);
  const reviewSources = syncReviewSourceIds(reviews);
  for (const row of outbox) {
    const state = syncOperationState(row);
    if (!state || state === "synced") continue;
    if (state === "failed" || state === "conflict") retryable += 1;
    // A stored owner review takes precedence over a pending/failed retry of
    // that exact operation. It remains one blocking action, shown under review.
    if (syncOperationIds(row).some((id) => reviewSources.has(id))) continue;
    if (state === "pending") pending += 1;
    else if (state === "failed") failed += 1;
  }
  const conflict = reviews.length;
  return { pending, failed, conflict, retryable, totalBlocking: pending + failed + conflict };
}
