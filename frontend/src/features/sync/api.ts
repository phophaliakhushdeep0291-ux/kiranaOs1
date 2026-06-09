import { apiRequest, buildQuery } from "@/lib/api/http";
import type {
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  SyncResolveConflictRequest,
  SyncRetryRequest,
  SyncStatusResponse,
} from "@/types/api";

export interface SyncPullRequestParams {
  since?: string;
  cursor?: string | number | null;
  cursors?: Record<string, string | null | undefined> | null;
  limit?: number;
  background?: boolean;
}

const DEFAULT_SYNC_SINCE = "1970-01-01T00:00:00.000Z";

function encodeCursorMap(cursors?: Record<string, string | null | undefined> | null) {
  if (!cursors) return undefined;
  const clean = Object.fromEntries(
    Object.entries(cursors).filter(([, value]) => value === null || (typeof value === "string" && value.length > 0)),
  );
  return Object.keys(clean).length > 0 ? JSON.stringify(clean) : undefined;
}

export function syncPush(body: SyncPushRequest) {
  return apiRequest<SyncPushResponse>("/sync/push", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function syncPull(paramsOrCursor?: SyncPullRequestParams | string | number | null) {
  const params: SyncPullRequestParams =
    typeof paramsOrCursor === "string" || typeof paramsOrCursor === "number" || paramsOrCursor == null
      ? { cursor: paramsOrCursor ?? null }
      : paramsOrCursor;
  return apiRequest<SyncPullResponse>(`/sync/pull${buildQuery({
    since: params.since ?? DEFAULT_SYNC_SINCE,
    cursor: params.cursor ?? undefined,
    cursors: encodeCursorMap(params.cursors),
    limit: params.limit ?? 500,
  })}`, {
    method: "GET",
    background: params.background,
  });
}

export function getSyncStatus(options: { background?: boolean } = {}) {
  return apiRequest<SyncStatusResponse>("/sync/status", { method: "GET", background: options.background });
}

export function requestSyncRetry(body: SyncRetryRequest = {}) {
  return apiRequest<SyncStatusResponse>("/sync/retry", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function resolveSyncConflict(body: SyncResolveConflictRequest) {
  return apiRequest<SyncStatusResponse>("/sync/resolve-conflict", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
