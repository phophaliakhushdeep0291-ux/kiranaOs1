import { apiRequest, getStoredAccessToken } from "@/lib/api/http";
import { collectDeviceContext } from "@/lib/diagnostics/collectDeviceContext";
import { safeRandomUUID } from "@/lib/safe-uuid";
import { ACTIVITY_EVENTS, isOnlineEventType, type ActivityEventInput, type ActivityEventType, type ActivityMetadata } from "./events";
import { currentSessionId } from "./session";

/**
 * The client half of the activity pipeline (§13).
 *
 * The design constraint that shapes everything here: this runs on a shop counter
 * PC on an unreliable connection, next to the billing screen, while a customer
 * waits. So:
 *
 *  - `trackEvent` is **synchronous and does no work** beyond pushing onto an
 *    array. No await, no fetch, no JSON on the caller's stack.
 *  - Events are **batched** and flushed on a timer, so a busy billing minute is
 *    one request rather than sixty.
 *  - The queue is **persisted to localStorage**, so events survive the reload,
 *    crash or offline stretch that they are often the only record of.
 *  - Every failure is **swallowed**. If analytics cannot be delivered, the
 *    correct user-visible outcome is nothing at all.
 */

const STORAGE_KEY = "kiranaos.activity.queue.v1";
const FLUSH_INTERVAL_MS = 15_000;
const MAX_BATCH = 50;
/**
 * Queue ceiling. A device left offline for a week must not fill its storage
 * quota with telemetry and break the offline bill queue that shares it — that
 * data is a shop's money and this data is not.
 */
const MAX_QUEUE = 500;

/**
 * Queued events carry the storefront they belong to. A shopper can visit two
 * shops' QR pages in one browsing session, and without this the first shop's
 * unsent events would be delivered to the second shop's ingest — recording one
 * store's browsing as another's. Stripped before the request goes out.
 */
type QueuedEvent = ActivityEventInput & { onlineShopId?: string };

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let flushing = false;
let started = false;
/** Online events post to the public storefront endpoint for this shop. */
let onlineShopId: string | null = null;

function readPersisted(): QueuedEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-MAX_QUEUE) : [];
  } catch {
    return [];
  }
}

function persist(): void {
  try {
    if (queue.length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // A full or unavailable quota must not break tracking; the in-memory queue
    // still flushes for as long as the tab lives.
  }
}

/**
 * trackEvent — record one user action. Fire-and-forget by contract: it never
 * throws, never returns a promise, and never blocks the interaction it describes.
 */
export function trackEvent(eventType: ActivityEventType, metadata?: ActivityMetadata, options?: { durationMs?: number; screen?: string; module?: string }): void {
  try {
    const context = collectDeviceContext();
    queue.push({
      eventId: `evt_${safeRandomUUID().replaceAll("-", "")}`,
      eventType,
      occurredAt: new Date().toISOString(),
      sessionId: currentSessionId(),
      deviceId: context.deviceId,
      screen: options?.screen ?? context.route,
      module: options?.module,
      appVersion: context.appVersion,
      networkStatus: context.networkStatus,
      durationMs: options?.durationMs === undefined ? undefined : Math.max(0, Math.round(options.durationMs)),
      metadata,
      ...(isOnlineEventType(eventType) && onlineShopId ? { onlineShopId } : {}),
    });
    // Drop the OLDEST events when the cap is hit. Recent behaviour is what
    // personalization reads; a week-old queued search is worth less than the one
    // the user just typed.
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    persist();
  } catch {
    // Tracking is never allowed to surface.
  }
}

/**
 * startTiming — measure how long a user-facing operation actually took, for the
 * spec's average billing/checkout/search durations. Returns a function that
 * emits the event with its duration; calling it twice is a no-op.
 */
export function startTiming(eventType: ActivityEventType): (metadata?: ActivityMetadata) => void {
  const startedAt = Date.now();
  let done = false;
  return (metadata?: ActivityMetadata) => {
    if (done) return;
    done = true;
    trackEvent(eventType, metadata, { durationMs: Date.now() - startedAt });
  };
}

/** Convenience wrapper for the FEATURE_USED adoption counter. */
export function trackFeature(feature: string, label?: string, metadata?: ActivityMetadata): void {
  trackEvent(ACTIVITY_EVENTS.FEATURE_USED, { feature, featureLabel: label, ...metadata });
}

/**
 * The storefront runs unauthenticated, so its events go to the public per-shop
 * endpoint instead. Called once when the customer-order page mounts.
 */
export function setOnlineActivityShop(shopId: string | null): void {
  onlineShopId = shopId;
}

/** Drop the routing field so the server only ever sees the declared schema. */
function forWire({ onlineShopId: _routing, ...event }: QueuedEvent): ActivityEventInput {
  return event;
}

async function postBatch(events: QueuedEvent[]): Promise<void> {
  const pos = events.filter((event) => !isOnlineEventType(event.eventType));

  // Group storefront events by the shop they were recorded on, so each shop's
  // ingest only ever receives its own.
  const byShop = new Map<string, QueuedEvent[]>();
  for (const event of events) {
    if (!isOnlineEventType(event.eventType)) continue;
    const shop = event.onlineShopId;
    if (!shop) continue;
    const bucket = byShop.get(shop) ?? [];
    bucket.push(event);
    byShop.set(shop, bucket);
  }

  for (const [shop, shopEvents] of byShop) {
    await apiRequest(`/public/shops/${shop}/activity`, {
      method: "POST",
      skipAuth: true,
      skipRefresh: true,
      background: true,
      body: JSON.stringify({ events: shopEvents.map(forWire) }),
    });
  }
  if (pos.length > 0 && getStoredAccessToken()) {
    await apiRequest("/activity/events", {
      method: "POST",
      skipRefresh: true,
      background: true,
      body: JSON.stringify({ events: pos.map(forWire) }),
    });
  }
}

/**
 * flushActivity — deliver queued events. Safe to call at any time; concurrent
 * calls collapse into one.
 */
export async function flushActivity(): Promise<void> {
  if (flushing || queue.length === 0) return;
  // Nothing can be attributed without a tenant. Hold the events until one
  // exists rather than dropping them — a user who logs in five minutes later
  // still gets their launch event.
  const hasRoutableOnline = queue.some((event) => event.onlineShopId);
  if (!getStoredAccessToken() && !hasRoutableOnline) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  flushing = true;
  const batch = queue.slice(0, MAX_BATCH);
  try {
    await postBatch(batch);
    // Only drop what was actually sent; anything enqueued during the request
    // stays for the next flush.
    queue = queue.filter((event) => !batch.some((sent) => sent.eventId === event.eventId));
    persist();
  } catch {
    // Leave the batch queued. Ingest is idempotent on eventId, so a retry after
    // an ambiguous failure (the request landed but the response was lost) counts
    // once, not twice.
  } finally {
    flushing = false;
  }
}

/**
 * startActivityTracking — install the flush timer and the lifecycle hooks.
 * Idempotent, so React StrictMode's double-invoke cannot double-schedule it.
 */
export function startActivityTracking(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  queue = readPersisted();
  timer = setInterval(() => void flushActivity(), FLUSH_INTERVAL_MS);

  // A POS tab is usually closed by closing the lid or the browser, so
  // `visibilitychange → hidden` is the only reliable "we might not come back"
  // signal; `beforeunload` does not fire on mobile Safari.
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushActivity();
  });
  window.addEventListener("pagehide", () => void flushActivity());
  // Coming back online is the moment an offline queue can finally drain.
  window.addEventListener("online", () => void flushActivity());
}

export function stopActivityTracking(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}

/** Test seam. */
export function __resetActivityQueue(): void {
  queue = [];
  onlineShopId = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function __peekActivityQueue(): QueuedEvent[] {
  return [...queue];
}

export { STORAGE_KEY as ACTIVITY_QUEUE_STORAGE_KEY };
