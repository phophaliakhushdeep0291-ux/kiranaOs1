/**
 * Is this failure the shop's problem, or ours?
 *
 * The outbox used to answer "both the same way": a dropped wifi packet and a
 * rejected price both became `FAILED`, which increments `retry_count`, and at
 * twelve attempts an operation is retired from automatic sync altogether. So a
 * shop on patchy wifi could permanently strand a morning of sales — recoverable
 * only from the Sync Status screen, which nobody visits until something is
 * already wrong.
 *
 * The distinction that matters is not the error text, it is whether retrying
 * unchanged could ever succeed:
 *
 * - **Transient** — the request never got a verdict (network down, request timed
 *   out) or the server failed to answer properly (5xx), or asked us to slow down
 *   (429). Nothing is wrong with the operation. It must retry indefinitely, and
 *   must NOT spend the retirement budget.
 * - **Permanent** — the server looked at the operation and refused it (validation,
 *   a missing owner PIN, a business rule). Retrying the same bytes will fail the
 *   same way forever. Park it immediately for a human instead of burning twelve
 *   attempts over twenty minutes hammering an endpoint that will keep saying no.
 *
 * Kept free of imports so it can be tested as logic rather than asserted as text.
 */

/** 401 is deliberately transient: the refresh flow fixes it, and the shop's work
 * must not be retired because a token aged out mid-push. */
const TRANSIENT_STATUSES = new Set([0, 401, 408, 425, 429, 500, 502, 503, 504, 507, 508, 522, 524]);

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isFinite(status) ? status : undefined;
}

export function isTransientSyncFailure(error: unknown): boolean {
  const status = statusOf(error);

  // No status at all means the request never reached a verdict — a dropped
  // connection, a DNS failure, an aborted fetch. Always transient.
  if (status === undefined) return true;

  if (TRANSIENT_STATUSES.has(status)) return true;
  // Anything else in the 5xx range is the server failing, not the operation.
  if (status >= 500) return true;
  // A definite 4xx verdict: the server read it and said no.
  return false;
}

/**
 * Per-event codes that mean "no verdict on this operation" (backend
 * `classifySyncError`): a 5xx or status-less throw — including a write conflict
 * that outlasted the serializable retries — a 408/425/429, a reference whose
 * server id does not exist yet, and the same event still being processed by an
 * earlier request.
 */
const TRANSIENT_EVENT_CODES = new Set(["SERVER_ERROR", "SYNC_DEPENDENCY_PENDING", "SYNC_EVENT_IN_PROGRESS"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The same question for one operation inside a push that came back 200.
 *
 * A batch can succeed while a single event in it fails, and the server already
 * says which kind of failure it was: every per-event result carries `retryable`.
 * `true` means the server never judged the operation, so it must retry without
 * spending an attempt, exactly like a failed batch. `false` (PERMISSION_DENIED,
 * a business rule) is a verdict and stays FAILED.
 *
 * The flag sits on the nested `result` envelope today; the top level is read too,
 * so a server that promotes it is understood the same way. An explicit `false`
 * on either wins. The codes are only a fallback for a result with no flag at all,
 * and a failure with neither stays FAILED, as it always has.
 */
export function isTransientSyncEventResult(result: unknown): boolean {
  if (!isRecord(result)) return false;
  const envelope = isRecord(result.result) ? result.result : {};
  const flags = [result.retryable, envelope.retryable];
  if (flags.includes(false)) return false;
  if (flags.includes(true)) return true;
  const code = typeof result.code === "string" ? result.code : envelope.code;
  return typeof code === "string" && TRANSIENT_EVENT_CODES.has(code);
}

/**
 * Backoff for a transient failure, whole batch or one event in it. Capped well
 * below the ordinary failure ladder because the operation is not suspect — we are
 * only waiting for the network or the server to come back, and a till should
 * resume promptly when it does. `attempt` is how many transient failures the row
 * had already had in a row before this one — `transientFailureCount`, never
 * `retry_count`.
 */
export function transientRetryDelayMs(attempt: number): number {
  const safe = Number.isFinite(attempt) ? Math.max(0, Math.trunc(attempt)) : 0;
  return Math.min(30_000, 1_000 * 2 ** Math.min(safe, 5));
}

/**
 * Consecutive transient failures recorded on an outbox row (`transient_failures`).
 *
 * It has to be its own counter. `retry_count` rises only on FAILED — a transient
 * failure goes back to PENDING precisely so that it spends none of it — so a row
 * that had never been refused always read 0 there, the deferral was always 1s,
 * and a till facing a 500ing server re-sent every scheduler tick for as long as
 * the outage lasted. Absent on every row written before the counter existed,
 * which reads as none.
 */
export function transientFailureCount(row: { transient_failures?: unknown }): number {
  const count = row.transient_failures;
  return typeof count === "number" && Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}

/**
 * The counter a row carries after a status change. A deferred PENDING is one more
 * transient failure. SYNCED, FAILED and CONFLICT are verdicts and end the streak.
 * Anything else — SYNCING, a PENDING requeue with no deferral — leaves it alone,
 * or a push that is merely in flight would erase the backoff it is waiting out.
 */
export function nextTransientFailureCount(
  row: { transient_failures?: unknown },
  status: "PENDING" | "SYNCING" | "SYNCED" | "FAILED" | "CONFLICT",
  deferMs: number,
): number {
  if (status === "SYNCED" || status === "FAILED" || status === "CONFLICT") return 0;
  if (status === "PENDING" && deferMs > 0) return transientFailureCount(row) + 1;
  return transientFailureCount(row);
}
