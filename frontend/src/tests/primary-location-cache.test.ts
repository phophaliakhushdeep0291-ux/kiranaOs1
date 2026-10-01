import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scope = vi.hoisted(() => ({ shopId: "shop-a" }));
vi.mock("@/lib/storage/auth-storage", () => ({ loadAuthSession: () => ({ shop: { id: scope.shopId } }) }));
import { cachePrimaryLocationId, getPrimaryLocationId, getActiveLocationId, setActiveLocationId } from "@/features/core/stores/location-context";

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) });
  scope.shopId = "shop-a";
});
afterEach(() => vi.unstubAllGlobals());

describe("primary branch after an offline restart", () => {
  it("retains primary separately from the selected branch and isolates shops", () => {
    cachePrimaryLocationId("primary-a");
    setActiveLocationId("branch-a");
    expect(getPrimaryLocationId()).toBe("primary-a");
    expect(getActiveLocationId()).toBe("branch-a");
    scope.shopId = "shop-b";
    expect(getPrimaryLocationId()).toBeNull();
    cachePrimaryLocationId("primary-b");
    scope.shopId = "shop-a";
    expect(getPrimaryLocationId()).toBe("primary-a");
  });
  it("does not invent a primary branch when storage is unavailable", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("unavailable"); }, setItem: () => { throw new Error("unavailable"); } });
    expect(() => cachePrimaryLocationId("primary-a")).not.toThrow();
    expect(getPrimaryLocationId()).toBeNull();
  });
});
