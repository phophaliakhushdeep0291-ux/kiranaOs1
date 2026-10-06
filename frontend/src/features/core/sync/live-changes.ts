import { authenticatedStreamHeaders, getApiBaseUrl } from "@/lib/api/http";
import { markLiveStream } from "@/features/core/sync/live-stream-state";

/**
 * Pulls the moment another counter changes the shop's data.
 *
 * The sync cadence idles out at 45s, and that is how long a sale on one counter
 * could take to reach the next — 9–36s in a two-counter run. The server holds
 * GET /sync/events open and sends a bare `changes` nudge when another device's
 * write commits; this turns the nudge into a sync cycle. The stream carries no
 * data: the cadence stays the source of truth, and a dropped stream only means
 * waiting for it again.
 *
 * Read with fetch, not EventSource, which cannot send the Authorization and
 * device headers every sync request carries.
 */

/** Backoff between attempts; a stream that reached `ready` resets it. */
export const LIVE_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 15_000, 30_000] as const;
/** How often the gate is re-checked, open or closed (offline, hidden, lost leadership). */
export const LIVE_GATE_CHECK_MS = 5_000;
/**
 * The server sends a keep-alive every 25s. A stream silent for longer than this
 * is treated as dead — a proxy can hold a socket open that no longer delivers —
 * and reconnected, because while a stream counts as open the scheduled sync
 * relaxes to its three-minute rung.
 */
export const LIVE_SILENCE_LIMIT_MS = 60_000;

export interface SseEvent {
  event: string;
  data: string;
}

/** Incremental `text/event-stream` parser: chunks may split events anywhere. */
export function createSseParser(onEvent: (event: SseEvent) => void): (chunk: string) => void {
  let buffer = "";
  return (chunk) => {
    buffer += chunk.replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (!line || line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
      }
      if (data.length > 0) onEvent({ event, data: data.join("\n") });
      boundary = buffer.indexOf("\n\n");
    }
  };
}

export interface LiveChangesOptions {
  /** Online, visible and this profile's leader tab — one stream per device, not per tab. */
  shouldConnect: () => boolean;
  /** Another device changed the shop's data. */
  onChange: () => void;
  /** A stream is back after a gap; anything sent meanwhile was missed. */
  onReconnect: () => void;
  fetchImpl?: typeof fetch;
  headers?: () => Promise<Headers | null>;
}

export interface LiveChangesHandle {
  stop: () => void;
  /** Re-check the gate now (back online, tab visible) instead of on the next tick. */
  wake: () => void;
}

export function startLiveChanges(options: LiveChangesOptions): LiveChangesHandle {
  const fetchImpl = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const readHeaders = options.headers ?? authenticatedStreamHeaders;
  let stopped = false;
  let controller: AbortController | null = null;
  let hasBeenReady = false;
  let failures = 0;
  let wakeSleep: (() => void) | null = null;

  const sleep = (ms: number) => new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      wakeSleep = null;
      resolve();
    }
    wakeSleep = done;
  });

  /** One stream, start to end. True when it reached `ready`, i.e. was healthy. */
  const streamOnce = async (): Promise<boolean> => {
    const headers = await readHeaders().catch(() => null);
    if (!headers || stopped) return false;
    const abort = new AbortController();
    controller = abort;
    let lastHeardAt = Date.now();
    const gate = setInterval(() => {
      if (!options.shouldConnect() || Date.now() - lastHeardAt > LIVE_SILENCE_LIMIT_MS) abort.abort();
    }, LIVE_GATE_CHECK_MS);
    let ready = false;
    try {
      const response = await fetchImpl(`${getApiBaseUrl()}/sync/events`, { headers, signal: abort.signal, cache: "no-store" });
      if (!response.ok || !response.body) return false;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parse = createSseParser(({ event }) => {
        if (event === "ready") {
          if (!ready) markLiveStream(true);
          ready = true;
          if (hasBeenReady) options.onReconnect();
          hasBeenReady = true;
        } else if (event === "changes") {
          options.onChange();
        }
      });
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        lastHeardAt = Date.now();
        parse(decoder.decode(value, { stream: true }));
      }
    } catch {
      // Aborted by the gate, the silence watchdog or stop(), or the network
      // dropped: all end here.
    } finally {
      clearInterval(gate);
      if (controller === abort) controller = null;
      if (ready) markLiveStream(false);
    }
    return ready;
  };

  void (async () => {
    while (!stopped) {
      if (!options.shouldConnect()) {
        await sleep(LIVE_GATE_CHECK_MS);
        continue;
      }
      const healthy = await streamOnce();
      if (stopped) break;
      failures = healthy ? 0 : failures + 1;
      const base = LIVE_RECONNECT_DELAYS_MS[Math.min(failures, LIVE_RECONNECT_DELAYS_MS.length - 1)];
      await sleep(base + Math.random() * base * 0.2);
    }
  })();

  return {
    stop() {
      stopped = true;
      controller?.abort();
      wakeSleep?.();
    },
    wake() {
      wakeSleep?.();
    },
  };
}
