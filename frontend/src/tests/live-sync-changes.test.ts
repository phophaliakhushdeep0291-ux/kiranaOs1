import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isLiveStreamOpen } from "@/features/core/sync/live-stream-state";
import {
  LIVE_GATE_CHECK_MS,
  LIVE_RECONNECT_DELAYS_MS,
  LIVE_SILENCE_LIMIT_MS,
  createSseParser,
  startLiveChanges,
  type LiveChangesHandle,
  type SseEvent,
} from "@/features/core/sync/live-changes";

/**
 * Two-counter QA run: an idle till pulls every 45s, so a sale on counter A took
 * 9–36s to reach counter B. The server now holds /sync/events open and nudges the
 * shop's other devices; this is the client side of that stream.
 */

describe("server-sent event parsing", () => {
  it("assembles events split across chunks and skips keep-alive comments", () => {
    const events: SseEvent[] = [];
    const parse = createSseParser((event) => events.push(event));
    parse("event: rea");
    parse("dy\ndata: {}\n");
    parse("\n: keep-alive\n\nevent: changes\r\ndata: {\"at\":\"x\"}\r\n\r\n");
    parse("data: line one\ndata: line two\n\n");
    expect(events).toEqual([
      { event: "ready", data: "{}" },
      { event: "changes", data: "{\"at\":\"x\"}" },
      { event: "message", data: "line one\nline two" },
    ]);
  });
});

function controllableFetch() {
  const encoder = new TextEncoder();
  const streams: Array<{ send: (text: string) => void; end: () => void; signal: AbortSignal }> = [];
  const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start: (c) => { controller = c; } });
    const signal = init!.signal!;
    signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
    streams.push({ send: (text) => controller.enqueue(encoder.encode(text)), end: () => controller.close(), signal });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  });
  return { fetchImpl, streams };
}

describe("live change stream", () => {
  let handle: LiveChangesHandle | null = null;
  const headers = async () => new Headers({ Authorization: "Bearer token" });

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    handle?.stop();
    handle = null;
    vi.useRealTimers();
  });

  it("pulls on another device's change, and catches up after reconnecting — not on first connect", async () => {
    const { fetchImpl, streams } = controllableFetch();
    const onChange = vi.fn();
    const onReconnect = vi.fn();
    handle = startLiveChanges({ shouldConnect: () => true, onChange, onReconnect, fetchImpl, headers });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toMatch(/\/sync\/events$/);

    streams[0].send("event: ready\ndata: {}\n\n");
    await vi.advanceTimersByTimeAsync(0);
    expect(onReconnect).not.toHaveBeenCalled(); // the initial sync already covers first connect

    streams[0].send("event: changes\ndata: {}\n\n");
    await vi.advanceTimersByTimeAsync(0);
    expect(onChange).toHaveBeenCalledTimes(1);

    // The server ends streams after their lifetime; the client is back within the
    // first rung, and catches up on anything sent while it was away.
    streams[0].end();
    await vi.advanceTimersByTimeAsync(LIVE_RECONNECT_DELAYS_MS[0] * 1.2 + 10);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    streams[1].send("event: ready\ndata: {}\n\n");
    await vi.advanceTimersByTimeAsync(0);
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("holds no stream while the gate is shut, and closes an open one when it shuts", async () => {
    const { fetchImpl, streams } = controllableFetch();
    let open = false;
    handle = startLiveChanges({ shouldConnect: () => open, onChange: vi.fn(), onReconnect: vi.fn(), fetchImpl, headers });
    await vi.advanceTimersByTimeAsync(LIVE_GATE_CHECK_MS * 2);
    expect(fetchImpl).not.toHaveBeenCalled(); // offline, hidden, or not the leader tab

    open = true;
    handle.wake(); // back online / visible: no need to wait for the next check
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    streams[0].send("event: ready\ndata: {}\n\n");

    open = false;
    await vi.advanceTimersByTimeAsync(LIVE_GATE_CHECK_MS);
    expect(streams[0].signal.aborted).toBe(true);
  });

  it("backs off while the server cannot be reached", async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    handle = startLiveChanges({ shouldConnect: () => true, onChange: vi.fn(), onReconnect: vi.fn(), fetchImpl, headers });
    // Attempts at ~0, ~2s, ~+5s, ~+15s: an outage does not become a request storm.
    await vi.advanceTimersByTimeAsync(25_000);
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("counts as open only between the server's ready and the stream's end", async () => {
    // While open, the scheduled sync relaxes to three minutes; a stream that has
    // ended must hand the cadence straight back.
    const { fetchImpl, streams } = controllableFetch();
    handle = startLiveChanges({ shouldConnect: () => true, onChange: vi.fn(), onReconnect: vi.fn(), fetchImpl, headers });
    await vi.advanceTimersByTimeAsync(0);
    expect(isLiveStreamOpen()).toBe(false); // connected, but the server has not spoken
    streams[0].send("event: ready\ndata: {}\n\n");
    await vi.advanceTimersByTimeAsync(0);
    expect(isLiveStreamOpen()).toBe(true);
    streams[0].end();
    await vi.advanceTimersByTimeAsync(0);
    expect(isLiveStreamOpen()).toBe(false);
  });

  it("treats a stream the server has gone quiet on as dead", async () => {
    // A proxy can keep a socket open that delivers nothing. The server sends a
    // keep-alive every 25s, so a minute of silence means reconnect — and until
    // then the till must not sit on the three-minute rung.
    const { fetchImpl, streams } = controllableFetch();
    handle = startLiveChanges({ shouldConnect: () => true, onChange: vi.fn(), onReconnect: vi.fn(), fetchImpl, headers });
    await vi.advanceTimersByTimeAsync(0);
    streams[0].send("event: ready\ndata: {}\n\n");
    await vi.advanceTimersByTimeAsync(LIVE_SILENCE_LIMIT_MS - 10_000);
    streams[0].send(": keep-alive\n\n"); // heard from: the clock restarts
    await vi.advanceTimersByTimeAsync(LIVE_SILENCE_LIMIT_MS - 10_000);
    expect(streams[0].signal.aborted).toBe(false);
    expect(isLiveStreamOpen()).toBe(true);

    await vi.advanceTimersByTimeAsync(LIVE_SILENCE_LIMIT_MS);
    expect(streams[0].signal.aborted).toBe(true);
    expect(isLiveStreamOpen()).toBe(false);
    await vi.advanceTimersByTimeAsync(LIVE_RECONNECT_DELAYS_MS[0] * 1.2 + 10);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // and it reconnects
  });

  it("does not connect without a session, and stops for good on stop()", async () => {
    const { fetchImpl, streams } = controllableFetch();
    const noSession = startLiveChanges({ shouldConnect: () => true, onChange: vi.fn(), onReconnect: vi.fn(), fetchImpl, headers: async () => null });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchImpl).not.toHaveBeenCalled();
    noSession.stop();

    handle = startLiveChanges({ shouldConnect: () => true, onChange: vi.fn(), onReconnect: vi.fn(), fetchImpl, headers });
    await vi.advanceTimersByTimeAsync(0);
    handle.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(streams[0].signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
