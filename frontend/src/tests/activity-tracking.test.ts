import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  ACTIVITY_EVENTS,
  isOnlineEventType,
  trackEvent,
  startTiming,
  trackFeature,
  flushActivity,
  setOnlineActivityShop,
  __resetActivityQueue,
  __peekActivityQueue,
  ACTIVITY_QUEUE_STORAGE_KEY,
} from "@/lib/activity";
import { normalizeScreenPath } from "@/lib/activity/useScreenTracking";

// The activity client is the one piece of §13 that runs on the counter machine
// during a sale, so what is proven here is the safety contract, not the feature:
// tracking never throws, never blocks, never loses events to a flaky link, and
// never delivers one shop's storefront browsing to another shop.

vi.mock("@/lib/api/http", () => ({
  apiRequest: vi.fn(async () => ({ accepted: 0 })),
  getStoredAccessToken: vi.fn(() => "test-token"),
}));

vi.mock("@/lib/diagnostics/collectDeviceContext", () => ({
  collectDeviceContext: () => ({
    appVersion: "1.4.0",
    deviceId: "device-1",
    networkStatus: "online" as const,
    onlineMode: true,
    route: "/billing",
  }),
}));

const http = await import("@/lib/api/http");
const apiRequest = vi.mocked(http.apiRequest);

// This suite runs under the node environment, where there is no Web Storage.
// Only the persistence test needs it, so it is stubbed there rather than moving
// the whole file to jsdom — and the fact that every other test passes without it
// is itself the proof that tracking degrades quietly when storage is unavailable
// (a private-mode browser, or a device at its quota).
function stubLocalStorage(): Storage {
  const map = new Map<string, string>();
  const store = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
  vi.stubGlobal("localStorage", store);
  return store;
}

beforeEach(() => {
  __resetActivityQueue();
  apiRequest.mockClear();
  apiRequest.mockResolvedValue({ accepted: 0 });
});

afterEach(() => {
  __resetActivityQueue();
});

describe("event catalogue", () => {
  it("classifies storefront events separately from POS events", () => {
    expect(isOnlineEventType(ACTIVITY_EVENTS.ONLINE_CART_ADD)).toBe(true);
    expect(isOnlineEventType(ACTIVITY_EVENTS.BILL_CREATED)).toBe(false);
  });
});

describe("trackEvent", () => {
  it("queues an event with the spec's required attributes", () => {
    trackEvent(ACTIVITY_EVENTS.PRODUCT_SEARCH, { query: "maggi", results: 12 });
    const [event] = __peekActivityQueue();

    expect(event.eventType).toBe("PRODUCT_SEARCH");
    expect(event.eventId).toMatch(/^evt_/);
    expect(event.sessionId).toBeTruthy();
    expect(event.deviceId).toBe("device-1");
    expect(event.appVersion).toBe("1.4.0");
    expect(event.networkStatus).toBe("online");
    expect(event.screen).toBe("/billing");
    expect(event.occurredAt).toMatch(/^\d{4}-/);
    expect(event.metadata).toEqual({ query: "maggi", results: 12 });
  });

  it("gives every event a distinct id, so a batch cannot self-collide", () => {
    trackEvent(ACTIVITY_EVENTS.APP_LAUNCH);
    trackEvent(ACTIVITY_EVENTS.APP_LAUNCH);
    const ids = __peekActivityQueue().map((event) => event.eventId);
    expect(new Set(ids).size).toBe(2);
  });

  it("survives metadata that cannot be serialized, rather than throwing at the call site", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => trackEvent(ACTIVITY_EVENTS.FEATURE_USED, circular)).not.toThrow();
  });

  it("persists the queue so events survive a reload or a crash", () => {
    const store = stubLocalStorage();
    trackEvent(ACTIVITY_EVENTS.BILL_CREATED, { billId: "b1" });
    const stored = JSON.parse(store.getItem(ACTIVITY_QUEUE_STORAGE_KEY) ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].eventType).toBe("BILL_CREATED");
    vi.unstubAllGlobals();
  });

  it("caps the queue and drops the OLDEST events, keeping recent behaviour", () => {
    for (let i = 0; i < 520; i += 1) trackEvent(ACTIVITY_EVENTS.SCREEN_VIEW, { index: i });
    const queue = __peekActivityQueue();
    expect(queue).toHaveLength(500);
    expect(queue[0].metadata?.index).toBe(20);
    expect(queue.at(-1)?.metadata?.index).toBe(519);
  });
});

describe("startTiming", () => {
  it("records the elapsed duration once, ignoring a second call", () => {
    const done = startTiming(ACTIVITY_EVENTS.BILL_CREATED);
    done({ billId: "b1" });
    done({ billId: "b1" });

    const queue = __peekActivityQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("trackFeature", () => {
  it("records the adoption counter with its feature key", () => {
    trackFeature("barcode_scan", "Barcode scan");
    expect(__peekActivityQueue()[0].metadata).toMatchObject({ feature: "barcode_scan", featureLabel: "Barcode scan" });
  });
});

describe("flushActivity", () => {
  it("posts POS events to the authenticated ingest and clears them", async () => {
    trackEvent(ACTIVITY_EVENTS.BILL_CREATED, { billId: "b1" });
    await flushActivity();

    expect(apiRequest).toHaveBeenCalledTimes(1);
    const [path, options] = apiRequest.mock.calls[0];
    expect(path).toBe("/activity/events");
    expect(JSON.parse(String(options?.body)).events).toHaveLength(1);
    expect(__peekActivityQueue()).toHaveLength(0);
  });

  it("keeps events queued when delivery fails, so an offline stretch loses nothing", async () => {
    apiRequest.mockRejectedValueOnce(new Error("offline"));
    trackEvent(ACTIVITY_EVENTS.BILL_CREATED, { billId: "b1" });

    await expect(flushActivity()).resolves.toBeUndefined();
    expect(__peekActivityQueue()).toHaveLength(1);

    await flushActivity();
    expect(__peekActivityQueue()).toHaveLength(0);
  });

  it("routes each storefront's events to that storefront, never to the next shop visited", async () => {
    setOnlineActivityShop("shop-a");
    trackEvent(ACTIVITY_EVENTS.ONLINE_PRODUCT_VIEW, { productId: "p1" });
    // The shopper opens a second shop's QR page before the first batch went out.
    setOnlineActivityShop("shop-b");
    trackEvent(ACTIVITY_EVENTS.ONLINE_PRODUCT_VIEW, { productId: "p2" });

    await flushActivity();

    const paths = apiRequest.mock.calls.map(([path]) => path);
    expect(paths).toContain("/public/shops/shop-a/activity");
    expect(paths).toContain("/public/shops/shop-b/activity");

    for (const [path, options] of apiRequest.mock.calls) {
      const events = JSON.parse(String(options?.body)).events;
      expect(events).toHaveLength(1);
      // The routing field is internal and must never reach the server.
      expect(events[0]).not.toHaveProperty("onlineShopId");
      const expected = String(path).includes("shop-a") ? "p1" : "p2";
      expect(events[0].metadata.productId).toBe(expected);
    }
  });

  it("holds events rather than dropping them when there is no tenant to attribute them to", async () => {
    vi.mocked(http.getStoredAccessToken).mockReturnValueOnce(null);
    trackEvent(ACTIVITY_EVENTS.APP_LAUNCH);

    await flushActivity();

    expect(apiRequest).not.toHaveBeenCalled();
    expect(__peekActivityQueue()).toHaveLength(1);
  });
});

describe("normalizeScreenPath", () => {
  it("collapses record ids so a page ranking is not one row per record", () => {
    expect(normalizeScreenPath("/customers/ckp1abc23def45ghi67jkl")).toBe("/customers/:id");
    expect(normalizeScreenPath("/bills/12345")).toBe("/bills/:id");
    expect(normalizeScreenPath("/bills/550e8400-e29b-41d4-a716-446655440000")).toBe("/bills/:id");
  });

  it("leaves real routes alone", () => {
    expect(normalizeScreenPath("/inventory/stock-in")).toBe("/inventory/stock-in");
    expect(normalizeScreenPath("/settings/advanced?tab=2")).toBe("/settings/advanced");
  });
});
