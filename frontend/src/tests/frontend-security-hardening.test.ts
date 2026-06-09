import { readFileSync } from "node:fs";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { clearAuthStorage, migrateAuthFromLocalStorage, setAuthValue } from "@/lib/storage/auth-storage";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  keys(): string[] {
    return Array.from(this.values.keys());
  }
}

function installWindowStorage() {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    value: { localStorage, sessionStorage },
    configurable: true,
    writable: true,
  });
  return { localStorage, sessionStorage };
}

describe("frontend security hardening", () => {
  let originalWindow: Window & typeof globalThis | undefined;

  beforeEach(() => {
    originalWindow = globalThis.window;
    installWindowStorage();
  });

  afterEach(() => {
    clearAuthStorage();
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true, writable: true });
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  });

  it("does not leave sensitive auth token names in localStorage", () => {
    setAuthValue("accessToken", "access-secret");
    setAuthValue("refreshToken", "refresh-secret");

    expect(window.sessionStorage.getItem("accessToken")).toBe("access-secret");
    expect(window.sessionStorage.getItem("refreshToken")).toBe("refresh-secret");
    expect(window.localStorage.getItem("accessToken")).toBeNull();
    expect(window.localStorage.getItem("refreshToken")).toBeNull();
  });

  it("migrates legacy auth tokens out of localStorage", () => {
    window.localStorage.setItem("accessToken", "legacy-access");
    window.localStorage.setItem("refreshToken", "legacy-refresh");

    migrateAuthFromLocalStorage();

    expect(window.sessionStorage.getItem("accessToken")).toBe("legacy-access");
    expect(window.sessionStorage.getItem("refreshToken")).toBe("legacy-refresh");
    expect(window.localStorage.getItem("accessToken")).toBeNull();
    expect(window.localStorage.getItem("refreshToken")).toBeNull();
  });

  it("service worker excludes API, auth, and sync routes from cache handling", () => {
    const source = readFileSync("public/sw.js", "utf8");

    expect(source).toContain("/\\/api\\//i");
    expect(source).toContain("/\\/auth\\//i");
    expect(source).toContain("/\\/sync\\//i");
    expect(source).toContain("function shouldBypass");
    expect(source).toContain("if (shouldBypass(request, url)) return");
  });

  it("cleans stale localhost service workers and app-shell caches", () => {
    const source = readFileSync("src/lib/pwa/registerServiceWorker.ts", "utf8");

    expect(source).toContain("unregisterStaleLocalServiceWorkers");
    expect(source).toContain("getRegistrations");
    expect(source).toContain("clearKiranaShellCaches");
    expect(source).toContain("kiranaos-shell");
    expect(source).toContain("!import.meta.env.PROD || isLocalAppHost()");
    expect(source).toContain("window.location.reload()");
  });

  it("fetches app code through the service worker with network-first freshness", () => {
    const source = readFileSync("public/sw.js", "utf8");

    expect(source).toContain('const CACHE_VERSION = "kiranaos-shell-v3"');
    expect(source).toContain("async function networkFirstStatic");
    expect(source).toContain('["style", "script", "worker"].includes(request.destination)');
    expect(source).toContain('["font", "image"].includes(request.destination)');
  });

  it("permission denied UI is accessible and explicit", () => {
    const source = readFileSync("src/components/shared/PermissionDenied.tsx", "utf8");

    expect(source).toContain('role="alert"');
    expect(source).toContain("Permission needed");
    expect(source).toContain('variant="destructive"');
  });

  it("bundle check enforces AI secret and direct API markers", () => {
    const source = readFileSync("scripts/check-bundle-size.mjs", "utf8");

    expect(source).toContain("assertNoFrontendAiSecrets");
    expect(source).toContain("VITE");
    expect(source).toContain("API");
    expect(source).toContain("KEY");
    expect(source).toContain("assertNoSensitiveLocalStorageWrites");
    expect(source).toContain("assertServiceWorkerBypassesSensitiveRoutes");
  });

  it("serializes stale-session refresh and clears auth after final failure", () => {
    const http = readFileSync("src/lib/api/http.ts", "utf8");
    const authContext = readFileSync("src/features/auth/AuthContext.tsx", "utf8");

    expect(http).toContain("let refreshPromise");
    expect(http).toContain("getSharedRefreshedAuth");
    expect(http).toContain("if (!token && !skipAuth && !skipRefresh)");
    expect(http).toContain("AUTH_REQUIRED");
    expect(http).toContain("clearAuthStorage()");
    expect(http).toContain("AUTH_SESSION_EXPIRED_EVENT");
    expect(authContext).toContain("window.addEventListener(AUTH_SESSION_EXPIRED_EVENT");
    expect(authContext).toContain("setLocation(\"/login\")");
  });
});
