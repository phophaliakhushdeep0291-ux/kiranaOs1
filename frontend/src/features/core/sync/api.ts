import { apiRequest, buildQuery } from "@/lib/api/http";
import type {
  SyncAcknowledgement,
  SyncConflictListResponse,
  SyncConflictReportRequest,
  SyncConflictReportResponse,
  SyncFleetResponse,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  SyncResolveConflictRequest,
  SyncRetryRequest,
  SyncRetryResponse,
  SyncStatusResponse,
} from "@/types/api";

export interface SyncPullRequestParams {
  since?: string;
  cursor?: string | number | null;
  cursors?: Record<string, string | null | undefined> | null;
  afterSeq?: string | number | null;
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
    afterSeq: params.afterSeq ?? undefined,
    limit: params.limit ?? 500,
  })}`, {
    method: "GET",
    background: params.background,
    // A catch-up page can hydrate hundreds of product rows (including selling
    // units) from a small production database that has just resumed from idle.
    // The generic 8s background timeout is appropriate for lightweight probes,
    // but aborting a valid pull at that boundary leaves the terminal's server
    // sequence permanently behind while pushes continue to succeed.
    timeoutMs: 30_000,
  });
}

export function getSyncStatus(options: { background?: boolean } = {}) {
  return apiRequest<SyncStatusResponse>("/sync/status", { method: "GET", background: options.background });
}

export interface SyncFailureExplanation {
  eventId?: string;
  id?: string;
  type?: string;
  entityType?: string;
  entityId?: string;
  status?: string;
  attempts?: number;
  code: string;
  explanation: string;
  retryable: boolean;
  action: string;
  at: string;
}

export interface SyncDiagnostics {
  lastSuccessfulSyncAt: string | null;
  healthy: boolean;
  counts: {
    pending: number;
    queueSize: number;
    failed: number;
    conflictEvents: number;
    openConflicts: number;
    synced: number;
    needsAttention: number;
    retriedEvents: number;
    totalRetryAttempts: number;
  };
  recentFailures: SyncFailureExplanation[];
  recentConflicts: SyncFailureExplanation[];
  generatedAt: string;
}

export function getSyncDiagnostics(options: { background?: boolean } = {}) {
  return apiRequest<SyncDiagnostics>("/sync/diagnostics", { method: "GET", background: options.background });
}

export function requestSyncRetry(body: SyncRetryRequest = {}) {
  return apiRequest<SyncRetryResponse>("/sync/retry", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function acknowledgeSyncSequence(
  serverSeq: string | number,
  options: { background?: boolean } = {},
) {
  return apiRequest<{ acknowledgement: SyncAcknowledgement }>("/sync/ack", {
    method: "POST",
    body: JSON.stringify({ server_seq: String(serverSeq) }),
    background: options.background,
  });
}

export function getSyncFleet(options: { background?: boolean } = {}) {
  return apiRequest<SyncFleetResponse>("/sync/devices", {
    method: "GET",
    background: options.background,
  });
}

export function resolveSyncConflict(body: SyncResolveConflictRequest) {
  return apiRequest<{ resolutionRecorded: boolean; conflict: import("@/types/api").SyncConflictRecord }>("/sync/resolve-conflict", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listSyncConflicts(params: {
  status?: "open" | "resolved" | "dismissed" | "all";
  entityType?: string;
  limit?: number;
  cursor?: string | null;
  background?: boolean;
} = {}) {
  return apiRequest<SyncConflictListResponse>(`/sync/conflicts${buildQuery({
    status: params.status ?? "open",
    entity_type: params.entityType,
    limit: params.limit ?? 50,
    cursor: params.cursor ?? undefined,
  })}`, { method: "GET", background: params.background });
}

export function reportSyncConflict(
  body: SyncConflictReportRequest,
  options: { background?: boolean } = {},
) {
  return apiRequest<SyncConflictReportResponse>("/sync/conflicts/report", {
    method: "POST",
    body: JSON.stringify(body),
    background: options.background,
  });
}
