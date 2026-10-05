/**
 * Live change nudges for a shop's other counters.
 *
 * Every device pulls the incremental feed on its own cadence, and an idle till
 * steps that cadence down to 45s — so a sale on one counter took up to that long
 * to reach the next one, in a two-counter run 9–36s. This hub lets the server say
 * "something changed" the moment a push or a data write commits, and the other
 * counters pull straight away.
 *
 * A nudge carries no shop data. The pull it prompts is the same authenticated,
 * role-redacted read as ever, so nothing here can leak a field a device may not
 * see, and a lost nudge only means falling back to the cadence.
 *
 * In-process on purpose: the API runs as one instance. Behind several instances a
 * counter connected to another one misses the nudge and catches up on its next
 * scheduled pull — slower, never wrong.
 */

/** Bursts (a 200-row catalogue push, a bill and its payment) become one nudge. */
export const NUDGE_COALESCE_MS = 150;
/** A reloaded tab's old stream can outlive it until TCP notices; the newest wins. */
export const MAX_STREAMS_PER_DEVICE = 2;
export const MAX_STREAMS_PER_SHOP = 50;

const streamsByShop = new Map();
const pendingByShop = new Map();

/**
 * Registers a device's stream for a shop. `stream` is `{ send(event, data), close() }`.
 * Returns `{ ok: true, release }`, or `{ ok: false, reason }` when the shop is full.
 */
export function openLiveStream(shopId, deviceId, stream) {
  const streams = streamsByShop.get(shopId) ?? new Set();
  const entry = { deviceId: deviceId ?? null, stream, openedAt: Date.now() };
  const sameDevice = entry.deviceId ? [...streams].filter((other) => other.deviceId === entry.deviceId) : [];
  // Oldest first. In a full shop a device makes room by retiring one of its own
  // streams rather than being refused while its previous connection lingers.
  let retire = Math.max(0, sameDevice.length - MAX_STREAMS_PER_DEVICE + 1);
  if (streams.size - retire >= MAX_STREAMS_PER_SHOP && sameDevice.length > retire) retire += 1;
  for (const stale of sameDevice.slice(0, retire)) {
    streams.delete(stale);
    stale.stream.close();
  }
  if (streams.size >= MAX_STREAMS_PER_SHOP) return { ok: false, reason: "LIVE_STREAM_LIMIT" };
  streams.add(entry);
  streamsByShop.set(shopId, streams);

  return {
    ok: true,
    release() {
      streams.delete(entry);
      if (streams.size === 0 && streamsByShop.get(shopId) === streams) streamsByShop.delete(shopId);
    },
  };
}

/**
 * Tells the shop's other devices that its data changed. The originating device is
 * skipped — it already has the change — unless another device changed data in the
 * same burst. An unknown origin (a write without a device header) nudges everyone.
 */
export function announceShopChanges(shopId, originDeviceId = null) {
  if (!shopId) return;
  const pending = pendingByShop.get(shopId);
  if (pending) {
    pending.origins.add(originDeviceId ?? null);
    return;
  }
  const next = { origins: new Set([originDeviceId ?? null]) };
  next.timer = setTimeout(() => deliver(shopId, next.origins), NUDGE_COALESCE_MS);
  next.timer.unref?.();
  pendingByShop.set(shopId, next);
}

function deliver(shopId, origins) {
  pendingByShop.delete(shopId);
  const streams = streamsByShop.get(shopId);
  if (!streams) return;
  const data = { at: new Date().toISOString() };
  for (const { deviceId, stream } of [...streams]) {
    const onlyOwnChange = deviceId !== null && origins.size === 1 && origins.has(deviceId);
    if (onlyOwnChange) continue;
    try {
      stream.send("changes", data);
    } catch {
      // A broken socket closes itself; the device catches up on its cadence.
    }
  }
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Nudges after a successful REST write to shop data. Mount it only on routers
 * whose writes land in the sync feed — never on /sync itself, whose ack is a
 * write every pull makes: nudging on it would have counters prompting each other
 * forever.
 */
export function announceShopChangesAfterWrite(req, res, next) {
  if (WRITE_METHODS.has(req.method)) {
    res.on("finish", () => {
      if (res.statusCode < 200 || res.statusCode >= 300 || !req.shopId) return;
      const deviceId = req.device?.deviceId ?? req.get?.("x-device-id") ?? null;
      announceShopChanges(req.shopId, deviceId);
    });
  }
  next();
}

const LIVE_HEARTBEAT_MS = 25_000;
// Bounded so a revoked session or a removed device cannot keep a stream forever:
// the reconnect goes through the auth and device checks again.
const LIVE_STREAM_LIFETIME_MS = 10 * 60_000;

/**
 * GET /api/sync/events — a server-sent event stream that says "pull now" when
 * another device changes this shop's data. `no-transform` keeps compression()
 * from buffering it, and the heartbeat keeps a proxy's 60s idle timeout from
 * cutting it.
 */
export function streamShopChanges(req, res) {
  const write = (chunk) => {
    if (!res.writableEnded) res.write(chunk);
  };
  const live = openLiveStream(req.shopId, req.device?.deviceId ?? null, {
    send: (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    close: () => res.end(),
  });
  if (!live.ok) {
    return res.status(429).json({ success: false, code: live.reason, error: "Too many live sync connections for this shop" });
  }

  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  write("event: ready\ndata: {}\n\n");

  const heartbeat = setInterval(() => write(": keep-alive\n\n"), LIVE_HEARTBEAT_MS);
  const lifetime = setTimeout(() => res.end(), LIVE_STREAM_LIFETIME_MS);
  res.on("close", () => {
    clearInterval(heartbeat);
    clearTimeout(lifetime);
    live.release();
  });
}

/** Ends every open stream, so a graceful shutdown is not held open by them. */
export function closeAllLiveStreams() {
  for (const pending of pendingByShop.values()) clearTimeout(pending.timer);
  pendingByShop.clear();
  for (const streams of streamsByShop.values()) {
    for (const { stream } of streams) {
      try {
        stream.close();
      } catch {
        // Already closed.
      }
    }
  }
  streamsByShop.clear();
}

export function liveStreamStats() {
  let streams = 0;
  for (const set of streamsByShop.values()) streams += set.size;
  return { shops: streamsByShop.size, streams };
}
