import { z } from "zod";
import { SYNC_EVENT_TYPES } from "../../utils/syncRules.js";

// ── Constants ────────────────────────────────────────────────────────────────
export const PULL_DEFAULT_LIMIT = 500;
export const PULL_MAX_LIMIT = 1000;

// ── Cursor format helpers ─────────────────────────────────────────────────────
// Cursor encodes the last record seen as "ISO_TIMESTAMP|CUID".
// e.g. "2026-06-05T17:30:00.000Z|clxyz1234567890"
// This lets us use keyset pagination: (updatedAt > ts) OR (updatedAt = ts AND id > id)
// which is stable and skips no records even when multiple rows share the same timestamp.

export function encodeCursor(updatedAt, id) {
  const ts = updatedAt instanceof Date ? updatedAt.toISOString() : String(updatedAt);
  return `${ts}|${id}`;
}

export function decodeCursor(cursor) {
  if (!cursor || typeof cursor !== "string") return null;
  const pipe = cursor.indexOf("|");
  if (pipe === -1) return null;
  const ts = cursor.slice(0, pipe);
  const id = cursor.slice(pipe + 1);
  if (!ts || !id) return null;
  const date = new Date(ts);
  if (!Number.isFinite(date.getTime())) return null;
  return { date, id };
}

export const pullQuerySchema = z.object({
  since: z.string().datetime({ message: "since must be ISO datetime, e.g. 2026-01-01T00:00:00.000Z" }),
  // Monotonic protocol v2 cursor. Unlike timestamps, a database sequence cannot
  // share or cross a boundary with a concurrent update.
  afterSeq: z.string().regex(/^\d+$/, "afterSeq must be a non-negative integer").optional(),
  // cursor is the legacy single cursor. Prefer cursors for production per-entity pagination.
  cursor: z.string().optional(),
  // JSON string of per-entity cursors: {"products":"...","customers":"..."}.
  cursors: z.string().optional(),
  // limit per entity type; capped at PULL_MAX_LIMIT.
  limit: z.coerce.number().int().min(1).max(PULL_MAX_LIMIT).default(PULL_DEFAULT_LIMIT),
});

export const syncAckSchema = z.object({
  server_seq: z.union([
    z.string().regex(/^\d+$/, "server_seq must be a non-negative integer"),
    z.number().int().nonnegative(),
  ]).transform((value) => String(value)),
});

// ── Push batch size limits ────────────────────────────────────────────────────
// Recommended frontend batch size: ≤100 events per flush.
// Hard backend ceiling: 500 events. Requests above this are rejected immediately
// so they never block the event loop or exhaust DB connections.
export const PUSH_MAX_BATCH_SIZE = 500;
export const PUSH_BATCH_TOO_LARGE_CODE = "SYNC_BATCH_TOO_LARGE";

export const syncEventSchema = z.object({
  eventId: z.string().min(1).optional(),
  clientEventId: z.string().min(1).optional(),
  type: z.enum(Object.values(SYNC_EVENT_TYPES)),
  payload: z.record(z.any()).default({}),
  status: z.string().optional(),
  attempts: z.number().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  ownerPin: z.string().optional(),
}).passthrough().refine((data) => data.eventId || data.clientEventId, {
  message: "eventId or clientEventId required",
  path: ["clientEventId"],
}).transform((data) => ({
  ...data,
  eventId: data.eventId ?? data.clientEventId,
  clientEventId: data.clientEventId ?? data.eventId,
}));

// pushBodySchema accepts events[] or actions[] (backward-compatible alias).
// The merged array is capped at PUSH_MAX_BATCH_SIZE before the Zod transform runs
// so that the limit applies regardless of which field name the client uses.
export const pushBodySchema = z.object({
  events:  z.array(syncEventSchema).optional(),
  // Backward compatibility with the old placeholder name.
  actions: z.array(syncEventSchema).optional(),
}).superRefine((data, ctx) => {
  const count = (data.events?.length ?? 0) + (data.actions?.length ?? 0);
  // events and actions are mutually exclusive in practice; the transform below
  // picks events first, then actions. We sum both here to guard against a client
  // that accidentally sends both fields.
  const effective = data.events ?? data.actions ?? [];
  if (effective.length > PUSH_MAX_BATCH_SIZE) {
    ctx.addIssue({
      code: z.ZodIssueCode.too_big,
      type: "array",
      maximum: PUSH_MAX_BATCH_SIZE,
      inclusive: true,
      path: ["events"],
      message: `Sync batch too large. Please split into batches of ${PUSH_MAX_BATCH_SIZE} or fewer events.`,
    });
  }
}).transform((data) => ({
  events: data.events ?? data.actions ?? [],
}));

export const syncConflictListQuerySchema = z.object({
  status: z.enum(["open", "resolved", "dismissed", "all"]).default("open"),
  entity_type: z.string().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const conflictSnapshotSchema = z.record(z.any()).nullable().optional();

export const reportSyncConflictSchema = z.object({
  client_conflict_id: z.string().min(1).max(220),
  entity_type: z.string().min(1).max(80),
  entity_id: z.string().min(1).max(220),
  reason_code: z.string().min(1).max(100).default("CLIENT_SYNC_CONFLICT"),
  message: z.string().min(1).max(1000).default("Client detected a sync conflict"),
  local_snapshot: conflictSnapshotSchema,
  server_snapshot: conflictSnapshotSchema,
  base_snapshot: conflictSnapshotSchema,
  server_version: z.union([z.string(), z.number()]).nullable().optional(),
});

export const resolveSyncConflictSchema = z.object({
  conflict_id: z.string().min(1).max(220),
  resolution: z.enum([
    "use_server",
    "use_local",
    "manual_merge",
    "dismiss",
    "resolved_by_owner",
    "ignored_by_owner",
  ]),
  merged_payload: z.record(z.any()).optional(),
  note: z.string().max(1000).optional(),
  expected_version: z.coerce.number().int().positive().optional(),
}).superRefine((data, ctx) => {
  if (data.resolution === "manual_merge" && !data.merged_payload) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["merged_payload"],
      message: "merged_payload is required for manual_merge",
    });
  }
});
