import { getApiBaseUrl, isBrowserOnline } from "@/lib/api/http";

export interface BackendConnectionSnapshot {
  browserOnline: boolean;
  backendReachable: boolean;
  checkedAt: string | null;
  apiBaseUrl: string;
  error?: string;
}

const BACKEND_HEALTH_CACHE_MS = 4_000;
const DEFAULT_BACKEND_HEALTH_TIMEOUT_MS = 2_500;

let lastProbeAt = 0;
let cachedSnapshot: BackendConnectionSnapshot = {
  browserOnline: typeof navigator === "undefined" ? true : navigator.onLine,
  backendReachable: false,
  checkedAt: null,
  apiBaseUrl: "",
};

function emitBackendStatusChanged(snapshot: BackendConnectionSnapshot) {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent("kirana:backend-status-changed", { detail: snapshot }));
  } catch {
    // Ignore event dispatch issues in non-browser/test environments.
  }
}

function healthUrl() {
  return `${getApiBaseUrl()}/health?ts=${Date.now()}`;
}

function shouldBypassBackendProbeInTests() {
  return import.meta.env.MODE === "test" && import.meta.env.VITE_ENABLE_BACKEND_HEALTH_IN_TESTS !== "true";
}

export function readBackendConnectionSnapshot(): BackendConnectionSnapshot {
  return cachedSnapshot;
}

export async function probeBackendConnection(options: { force?: boolean; timeoutMs?: number } = {}): Promise<BackendConnectionSnapshot> {
  const browserOnline = isBrowserOnline();
  const apiBaseUrl = getApiBaseUrl();

  if (!browserOnline) {
    const next = {
      browserOnline: false,
      backendReachable: false,
      checkedAt: new Date().toISOString(),
      apiBaseUrl,
      error: "BROWSER_OFFLINE",
    } satisfies BackendConnectionSnapshot;
    cachedSnapshot = next;
    lastProbeAt = Date.now();
    emitBackendStatusChanged(next);
    return next;
  }

  if (shouldBypassBackendProbeInTests()) {
    const next = {
      browserOnline,
      backendReachable: true,
      checkedAt: new Date().toISOString(),
      apiBaseUrl,
    } satisfies BackendConnectionSnapshot;
    cachedSnapshot = next;
    lastProbeAt = Date.now();
    return next;
  }

  const now = Date.now();
  if (!options.force && cachedSnapshot.checkedAt && cachedSnapshot.apiBaseUrl === apiBaseUrl && now - lastProbeAt < BACKEND_HEALTH_CACHE_MS) {
    return { ...cachedSnapshot, browserOnline, apiBaseUrl };
  }

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout = controller
    ? setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_BACKEND_HEALTH_TIMEOUT_MS)
    : null;

  let next: BackendConnectionSnapshot;
  try {
    const response = await fetch(healthUrl(), {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller?.signal,
    });
    next = {
      browserOnline,
      backendReachable: response.ok,
      checkedAt: new Date().toISOString(),
      apiBaseUrl,
      error: response.ok ? undefined : `HTTP_${response.status}`,
    };
  } catch (error) {
    next = {
      browserOnline,
      backendReachable: false,
      checkedAt: new Date().toISOString(),
      apiBaseUrl,
      error: error instanceof Error ? error.name || error.message : "BACKEND_UNREACHABLE",
    };
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }

  cachedSnapshot = next;
  lastProbeAt = Date.now();
  emitBackendStatusChanged(next);
  return next;
}
