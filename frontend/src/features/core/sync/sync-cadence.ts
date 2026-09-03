/**
 * How often the sync loop should try again.
 *
 * A till with a queued sale wants the next attempt in seconds. A till that has
 * been idle since breakfast wants to stop waking the radio — the old fixed
 * interval did neither well, running every 18s forever whether or not there was
 * anything to send.
 *
 * The ladder steps down one rung per genuinely quiet tick and snaps back to the
 * top the moment work appears, so the busy case is FASTER than the fixed
 * interval it replaced while the idle case is far cheaper. Kept free of imports
 * so it can be tested as logic rather than asserted as text.
 */
export const SYNC_INTERVAL_LADDER_MS = [2_500, 8_000, 20_000, 45_000] as const;

export const MAX_IDLE_STEP = SYNC_INTERVAL_LADDER_MS.length - 1;

/**
 * The gap between batches while a queue is emptying.
 *
 * The engine sends up to SYNC_BATCH_SIZE rows per cycle, so a bulk write takes
 * several passes: loading the built-in starter catalogue queues one row per
 * product, and at the fast rung those passes were still 2.5s apart. That is
 * about half a minute of pure waiting added to a few seconds of actual work,
 * with a full backup warning on screen for all of it.
 *
 * Short rather than zero: it keeps a yield in the loop, so the till stays
 * responsive between batches and a miscomputed flag can never spin.
 */
export const SYNC_DRAINING_DELAY_MS = 150;

/**
 * `draining` means the last cycle actually SENT rows and more are still queued.
 *
 * Progress is the condition, not the backlog. A push that keeps failing leaves
 * exactly the same rows behind, and treating that as draining would turn a
 * broken sync into a hot loop against the server — so a failing queue keeps the
 * ladder and its backoff.
 */
export function syncDelayForStep(step: number, draining = false): number {
  if (draining) return SYNC_DRAINING_DELAY_MS;
  const clamped = Math.max(0, Math.min(Math.trunc(step), MAX_IDLE_STEP));
  return SYNC_INTERVAL_LADDER_MS[clamped];
}

/**
 * `hadWork` is whether the tick found blocking outbox rows — not whether the
 * push succeeded. A queue that needs several passes must keep the fast cadence
 * for all of them, and a failing queue is precisely when backing off would
 * strand the shop.
 */
export function nextIdleStep(current: number, hadWork: boolean): number {
  if (hadWork) return 0;
  return Math.min(Math.max(0, Math.trunc(current)) + 1, MAX_IDLE_STEP);
}
