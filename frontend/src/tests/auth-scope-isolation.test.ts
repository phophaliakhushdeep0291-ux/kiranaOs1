import { afterEach, describe, expect, it } from "vitest";
import {
  licenseMatchesScope,
  type OfflineLicenseToken,
} from "@/features/core/devices/license";
import {
  clearSessionLockState,
  markAuthenticatedSessionActive,
} from "@/features/core/settings/SessionLockGate";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
}

const originalLocalStorage = globalThis.localStorage;
const originalSessionStorage = globalThis.sessionStorage;

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: originalLocalStorage,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: originalSessionStorage,
  });
});

describe("authentication scope isolation", () => {
  it("marks a successful sign-in as active instead of immediately cold-locking", () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: local,
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: session,
    });

    markAuthenticatedSessionActive(1_786_374_000_000);

    expect(local.getItem("kiranaos.security.lastActivity.v1")).toBe(
      "1786374000000",
    );
    expect(session.getItem("kiranaos.security.sessionStarted.v1")).toBe(
      "1786374000000",
    );

    clearSessionLockState();
    expect(local.length).toBe(0);
    expect(session.length).toBe(0);
  });

  it("never accepts a cached device license from another shop", () => {
    const token: OfflineLicenseToken = {
      tenant_id: "shop_a",
      store_id: "shop_a",
      plan: "pro",
      features: ["channel_settlement"],
      max_devices: 10,
      valid_until: "2026-09-01T00:00:00.000Z",
      offline_grace_until: "2026-09-08T00:00:00.000Z",
      signature: "signed-by-backend",
    };

    expect(
      licenseMatchesScope(token, {
        tenant_id: "shop_a",
        store_id: "shop_a",
        device_id: "device_1",
      }),
    ).toBe(true);
    expect(
      licenseMatchesScope(token, {
        tenant_id: "shop_b",
        store_id: "shop_b",
        device_id: "device_1",
      }),
    ).toBe(false);
  });
});
