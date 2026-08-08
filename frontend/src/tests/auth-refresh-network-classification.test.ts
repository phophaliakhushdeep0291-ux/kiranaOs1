import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest, setAuthTokenGetter } from "@/lib/api/http";
import { clearAuthStorage, saveAuthSession } from "@/lib/storage/auth-storage";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("auth refresh network classification", () => {
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
    setAuthTokenGetter(() => null);
    saveAuthSession({
      refreshToken: "refresh-token",
      user: { id: "owner_1", name: "Owner", role: "owner", shopId: "shop_1" },
      shop: null,
    });
  });

  afterEach(() => {
    clearAuthStorage();
    setAuthTokenGetter(() => null);
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true, writable: true });
    else Reflect.deleteProperty(globalThis, "window");
    vi.restoreAllMocks();
  });

  it("preserves a refresh network error when no access token is available", async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });

    await expect(apiRequest("/customers", { skipDevice: true })).rejects.toThrow("Failed to fetch");
  });

  it("preserves a refresh network error after an API 401", async () => {
    setAuthTokenGetter(() => "expired-access-token");
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "expired" }), { status: 401, headers: { "content-type": "application/json" } }))
      .mockRejectedValueOnce(new TypeError("Refresh endpoint unavailable"));

    await expect(apiRequest("/customers", { skipDevice: true })).rejects.toThrow("Refresh endpoint unavailable");
  });
});
