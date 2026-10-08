/**
 * Whether this tab holds a live sync stream the server has spoken on recently.
 *
 * The scheduled sync loop reads it to decide how long an idle till may wait: with
 * the stream open, another counter's change arrives as a nudge within a second
 * and the loop is only the backstop. Kept free of imports so the startup sync
 * engine can read it without loading the stream client.
 */

export const LIVE_STREAM_STATE_EVENT = "kirana:live-stream-state";

let openStreams = 0;

export function isLiveStreamOpen(): boolean {
  return openStreams > 0;
}

/** Called by the stream client when a stream becomes healthy (true) or ends (false). */
export function markLiveStream(open: boolean): void {
  const wasOpen = openStreams > 0;
  openStreams = Math.max(0, openStreams + (open ? 1 : -1));
  const isOpen = openStreams > 0;
  if (wasOpen === isOpen || typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new CustomEvent(LIVE_STREAM_STATE_EVENT, { detail: { open: isOpen } }));
}
