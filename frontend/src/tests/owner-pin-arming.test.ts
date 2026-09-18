/**
 * The counter can only unlock offline if some earlier ONLINE PIN check armed it.
 * That link lives in `verifyOwnerPin`, and it is the whole acquisition path — if
 * it breaks, nothing fails until a shop loses its internet and cannot get back
 * into its own till. `counter-unlock.test.ts` mocks this module out, so the link
 * is asserted here instead.
 */
import { webcrypto } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { verifyOwnerPin } from "@/features/core/settings/api";
import { canVerifyCounterPinOffline } from "@/lib/storage/counter-pin-offline";
import { saveAuthSession } from "@/lib/storage/auth-storage";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api/http", () => ({
  apiRequest: mocks.request,
  ApiClientError: class extends Error {},
  isBrowserOnline: () => true,
  isRecoverableNetworkError: () => false,
}));
vi.mock("@/lib/device-identity", () => ({ getPermanentDeviceId: () => "test-device" }));

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
  };
}

beforeEach(() => {
  const localStorage = memoryStorage();
  const sessionStorage = memoryStorage();
  vi.stubGlobal("window", { localStorage, sessionStorage });
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("sessionStorage", sessionStorage);
  vi.stubGlobal("crypto", webcrypto);
  mocks.request.mockReset();
  saveAuthSession({ accessToken: "access", refreshToken: "refresh", user: { id: "owner-a", shopId: "shop-a", role: "owner", name: "QA Owner" } as never, shop: { id: "shop-a" } as never });
});
afterEach(() => vi.unstubAllGlobals());

describe("an online PIN confirmation arms offline unlock", () => {
  it("arms the device when the server says the PIN is valid", async () => {
    mocks.request.mockResolvedValue({ valid: true });
    expect(canVerifyCounterPinOffline()).toBe(false);
    await verifyOwnerPin("2468");
    await vi.waitFor(() => expect(canVerifyCounterPinOffline()).toBe(true));
  });

  it.each([{ valid: false }, {}, null, { valid: "true" }])("does not arm on a negative or malformed result %j", async (response) => {
    mocks.request.mockResolvedValue(response);
    await verifyOwnerPin("2468");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(canVerifyCounterPinOffline()).toBe(false);
  });

  it("does not arm when the request itself fails", async () => {
    mocks.request.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(verifyOwnerPin("2468")).rejects.toThrow("Failed to fetch");
    expect(canVerifyCounterPinOffline()).toBe(false);
  });

  it("still returns the server's answer to its caller", async () => {
    mocks.request.mockResolvedValue({ valid: true });
    await expect(verifyOwnerPin("2468")).resolves.toEqual({ valid: true });
  });
});
