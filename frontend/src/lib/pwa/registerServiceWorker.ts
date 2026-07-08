export interface ServiceWorkerRegistrationResult {
  supported: boolean;
  registered: boolean;
  error?: string;
}

const LOCAL_APP_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const LOCAL_SW_CLEANUP_RELOAD_KEY = "kirana-os:local-sw-cleanup-reloaded:v1";
const KIRANA_CACHE_PREFIXES = ["kiranaos-shell"];

function isLocalAppHost(): boolean {
  if (typeof window === "undefined") return false;
  return LOCAL_APP_HOSTS.has(window.location.hostname);
}

async function clearKiranaShellCaches(): Promise<number> {
  if (typeof window === "undefined" || !("caches" in window)) return 0;

  const keys = await window.caches.keys();
  const kiranaKeys = keys.filter((key) => KIRANA_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)));
  await Promise.all(kiranaKeys.map((key) => window.caches.delete(key)));
  return kiranaKeys.length;
}

function reloadOnceAfterLocalCleanup(): void {
  try {
    if (window.sessionStorage.getItem(LOCAL_SW_CLEANUP_RELOAD_KEY) === "1") return;
    window.sessionStorage.setItem(LOCAL_SW_CLEANUP_RELOAD_KEY, "1");
  } catch {
    // sessionStorage can be unavailable in locked-down browsers. A single reload is still the safest escape.
  }

  window.location.reload();
}

export async function unregisterStaleLocalServiceWorkers(): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  const hadController = Boolean(navigator.serviceWorker.controller);
  const registrations = await navigator.serviceWorker.getRegistrations();
  const clearedCaches = await clearKiranaShellCaches();

  await Promise.all(registrations.map((registration) => registration.unregister()));

  if (hadController && (registrations.length > 0 || clearedCaches > 0)) {
    reloadOnceAfterLocalCleanup();
    return;
  }

  try {
    window.sessionStorage.removeItem(LOCAL_SW_CLEANUP_RELOAD_KEY);
  } catch {
    // Ignore storage errors; cleanup already finished.
  }
}

export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (import.meta.env.DEV && isLocalAppHost()) {
    void unregisterStaleLocalServiceWorkers().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Local service worker cleanup failed";
      window.dispatchEvent(new CustomEvent("kirana:pwa-local-cleanup-failed", { detail: { message } }));
    });
    return;
  }

  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              window.dispatchEvent(new CustomEvent("kirana:pwa-update-ready"));
            }
          });
        });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Service worker registration failed";
        window.dispatchEvent(new CustomEvent("kirana:pwa-registration-failed", { detail: { message } }));
      });
  });
}

/**
 * Recover from a stale deploy (a lazy chunk failed to load because this tab's cached index.html
 * points at asset files the new build renamed). A plain reload is not enough on a PWA: the
 * service worker can serve the same stale index again, so the chunk error just repeats. This
 * clears the app-shell cache and unregisters the SW so the reload fetches the fresh index/chunks.
 *
 * Safety: only busts caches when ONLINE. Doing it offline would strip an offline-first POS of the
 * very cache it needs to run, so when offline we just reload (the SW keeps serving the shell).
 */
export async function recoverFromStaleDeploy(): Promise<void> {
  if (typeof window === "undefined") return;

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    window.location.reload();
    return;
  }

  try {
    await clearKiranaShellCaches();
  } catch {
    // Cache API may be unavailable; unregister and reload is still the escape.
  }
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } catch {
    // Ignore; a fresh reload re-registers the SW on next load.
  }
  window.location.reload();
}

export function activateWaitingServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.getRegistration().then((registration) => {
    registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
    window.location.reload();
  });
}
