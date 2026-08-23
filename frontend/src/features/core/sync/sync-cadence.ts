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

export function syncDelayForStep(step: number): number {
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
