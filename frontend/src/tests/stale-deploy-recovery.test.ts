import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recoverFromStaleDeploy } from "@/lib/pwa/registerServiceWorker";
import { ShellErrorBoundary } from "@/components/shared/ShellErrorBoundary";

const storage = new Map<string, string>();
const reload = vi.fn();
const removeCache = vi.fn(async () => true);
const unregister = vi.fn(async () => true);

beforeEach(() => {
  storage.clear();
  vi.clearAllMocks();
  vi.stubGlobal("__KIRANA_BUILD_ID__", "release-one");
  vi.stubGlobal("window", {
    location: { reload },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    caches: { keys: async () => ["kiranaos-shell-v1", "other-app-data"], delete: removeCache },
  });
  vi.stubGlobal("navigator", {
    onLine: true,
    serviceWorker: { getRegistrations: async () => [{ unregister }] },
  });
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("stale-deploy recovery", () => {
  it("reloads only once for concurrent shell/page failures and after a slow reload", async () => {
    expect(await Promise.all([
      recoverFromStaleDeploy({ automatic: true }),
      recoverFromStaleDeploy({ automatic: true }),
    ])).toEqual([true, false]);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
    expect(await recoverFromStaleDeploy({ automatic: true })).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(removeCache.mock.calls).toEqual([["kiranaos-shell-v1"]]);
  });

  it("allows one new automatic attempt after a different build arrives", async () => {
    await recoverFromStaleDeploy({ automatic: true });
    vi.stubGlobal("__KIRANA_BUILD_ID__", "release-two");
    expect(await recoverFromStaleDeploy({ automatic: true })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("leaves the fallback and cached app usable when offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(await recoverFromStaleDeploy({ automatic: true })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(removeCache).not.toHaveBeenCalled();
    expect(storage.size).toBe(0);
    expect(await recoverFromStaleDeploy()).toBe(true);
    expect(removeCache).not.toHaveBeenCalled();
  });

  it.each(["read", "write"])("does not auto-reload when session storage %s fails", async (operation) => {
    if (operation === "read") vi.spyOn(window.sessionStorage, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    else vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(await recoverFromStaleDeploy({ automatic: true })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(removeCache).not.toHaveBeenCalled();
    expect(await recoverFromStaleDeploy()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("keeps manual retry available after the automatic attempt is exhausted", async () => {
    await recoverFromStaleDeploy({ automatic: true });
    expect(await recoverFromStaleDeploy()).toBe(true);
    expect(await recoverFromStaleDeploy({ automatic: true })).toBe(false);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("bounds shell failures too, including remounts after reload", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new TypeError("Failed to fetch dynamically imported module: /assets/shell.js");
    new ShellErrorBoundary({ children: null }).componentDidCatch(error, { componentStack: "" });
    // Let the first asynchronous cleanup finish before simulating the next load.
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    new ShellErrorBoundary({ children: null }).componentDidCatch(error, { componentStack: "" });
    await Promise.resolve();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
