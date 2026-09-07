import { afterEach, describe, expect, it, vi } from "vitest";
import { isSessionLocked, persistSessionLock } from "@/features/core/settings/session-lock-state";

afterEach(() => vi.unstubAllGlobals());

describe("counter lock persistence", () => {
  it("restores a lock only for the same user and clears it after successful authentication", () => {
    const rows = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => rows.get(key) ?? null,
      setItem: (key: string, value: string) => rows.set(key, value),
      removeItem: (key: string) => rows.delete(key),
    });
    persistSessionLock("owner-a");
    expect(isSessionLocked("owner-a")).toBe(true);
    expect(isSessionLocked("owner-b")).toBe(false);
    expect(isSessionLocked()).toBe(false);
    persistSessionLock();
    expect(isSessionLocked("owner-a")).toBe(false);
  });
});
