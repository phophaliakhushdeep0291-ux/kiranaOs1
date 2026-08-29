import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, apiRequest, setAuthTokenGetter } from "@/lib/api/http";
import { clearAuthStorage, getAuthValue, loadAuthSession, saveAuthSession } from "@/lib/storage/auth-storage";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function session(shopId: string, token: string, refreshToken: string) {
  return {
    accessToken: token,
    refreshToken,
    user: { id: `owner_${shopId}`, name: "Owner", role: "owner", shopId },
    shop: { id: shopId, name: shopId === "kirana" ? "Kirana Store" : "Restaurant" },
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("cross-shop authenticated request isolation", () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    Object.defineProperty(globalThis, "window", {
      value: { localStorage, sessionStorage, dispatchEvent: vi.fn() },
      configurable: true,
      writable: true,
    });
    setAuthTokenGetter(() => getAuthValue("accessToken"));
  });

  afterEach(() => {
    clearAuthStorage();
    setAuthTokenGetter(() => null);
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true, writable: true });
    else Reflect.deleteProperty(globalThis, "window");
    vi.restoreAllMocks();
  });

  it("rejects a Kirana response that completes after the restaurant logs in", async () => {
    saveAuthSession(session("kirana", "kirana-access", "kirana-refresh"));
    let finish!: (response: Response) => void;
    globalThis.fetch = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));

    const oldRequest = apiRequest<{ id: string }[]>("/products", { skipDevice: true });
    saveAuthSession(session("restaurant", "restaurant-access", "restaurant-refresh"));
    finish(json([{ id: "kirana-product" }]));

    await expect(oldRequest).rejects.toMatchObject<ApiClientError>({
      status: 409,
      data: { code: "AUTH_SESSION_CHANGED" },
    });
  });

  it("does not share an in-flight Kirana refresh with the restaurant session", async () => {
    saveAuthSession(session("kirana", "", "kirana-refresh"));
    let finishKiranaRefresh!: (response: Response) => void;
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { refreshToken?: string };
        if (body.refreshToken === "kirana-refresh") {
          return new Promise<Response>((resolve) => { finishKiranaRefresh = resolve; });
        }
        return json(session("restaurant", "restaurant-new-access", "restaurant-new-refresh"));
      }
      return json([{ id: "restaurant-product" }]);
    });

    const oldRequest = apiRequest<{ id: string }[]>("/products", { skipDevice: true });
    saveAuthSession(session("restaurant", "", "restaurant-refresh"));
    const restaurantRows = await apiRequest<{ id: string }[]>("/products", { skipDevice: true });

    expect(restaurantRows).toEqual([{ id: "restaurant-product" }]);
    expect(loadAuthSession().shop?.id).toBe("restaurant");
    expect(loadAuthSession().accessToken).toBe("restaurant-new-access");

    finishKiranaRefresh(json(session("kirana", "kirana-new-access", "kirana-new-refresh")));
    await expect(oldRequest).rejects.toMatchObject<ApiClientError>({ data: { code: "AUTH_SESSION_CHANGED" } });
    expect(loadAuthSession().shop?.id).toBe("restaurant");
    expect(loadAuthSession().accessToken).toBe("restaurant-new-access");
  });
});
