export interface ServiceWorkerRegistrationResult {
  supported: boolean;
  registered: boolean;
  error?: string;
}

const LOCAL_APP_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const LOCAL_SW_CLEANUP_RELOAD_KEY = "kirana-os:local-sw-cleanup-reloaded:v1";
const PROD_SW_CONTROLLER_RELOAD_KEY = "kirana-os:sw-controller-reloaded:v1";
const KIRANA_CACHE_PREFIXES = ["kiranaos-shell"];

declare const __KIRANA_BUILD_ID__: string;

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

/**
 * The customer QR self-order page is opened by walk-in strangers, once, on a
 * phone we will never see again. They gain nothing from the PWA — and they carry
 * all of its risk: `clients.claim()` means a brand-new worker takes control
 * during that very first visit and then has to serve the route's lazy chunks
 * from a cache that is still empty. One dropped request on shop wifi and the
 * import rejects, which React caches for good, leaving a stranger staring at a
 * reload screen we cannot talk them through.
 *
 * So the public order route stays a plain web page: no worker, no interception,
 * always straight from the network. The shopkeeper's till still gets the full
 * offline PWA, because that is the surface that actually needs it.
 */
export function isPublicCustomerRoute(pathname: string): boolean {
  // "/t/<shop>/<table>" is the QR taped to a restaurant table. Same stranger,
  // same one-off phone, same shop wifi — and a guest who cannot load the menu
  // while sitting in the restaurant is a worse failure than one who cannot
  // order for delivery, because a waiter is now standing there waiting.
  //
  // The pattern is anchored on "/t/" rather than "/t": the till's own "/tables"
  // is a real app route and must keep its worker.
  return /^\/order(\/|$)/.test(pathname) || /^\/t\//.test(pathname);
}

const PUBLIC_ROUTE_SW_RELEASE_KEY = "kirana:public-route-sw-released";

/**
 * Heal a phone that is already stuck.
 *
 * A customer who scanned before this fix shipped still has the old worker
 * installed, and it will keep failing their order page forever — we cannot ask a
 * stranger at the counter to clear their Safari data. So when the public route
 * finds itself under a worker's control, it releases the worker, drops the shell
 * caches and reloads once into a clean, plain page.
 *
 * Guarded by sessionStorage so it can never loop, and scoped to /order/ only —
 * the till re-registers its worker the next time the owner opens the app.
 */
function releaseServiceWorkerForPublicRoute(): void {
  if (!navigator.serviceWorker.controller) return;
  try {
    if (window.sessionStorage.getItem(PUBLIC_ROUTE_SW_RELEASE_KEY) === "1") return;
    window.sessionStorage.setItem(PUBLIC_ROUTE_SW_RELEASE_KEY, "1");
  } catch {
    // Storage blocked (private mode): fall through, the reload below still runs once
    // per page load and the unregister makes the next load clean regardless.
  }
  void (async () => {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
      await clearKiranaShellCaches();
    } catch {
      // Nothing recoverable here; the reload is still worth attempting.
    }
    window.location.reload();
  })();
}

export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (isPublicCustomerRoute(window.location.pathname)) {
    releaseServiceWorkerForPublicRoute();
    return;
  }
  if (import.meta.env.DEV && isLocalAppHost()) {
    void unregisterStaleLocalServiceWorkers().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Local service worker cleanup failed";
      window.dispatchEvent(new CustomEvent("kirana:pwa-local-cleanup-failed", { detail: { message } }));
    });
    return;
  }

  const hadControllerAtStart = Boolean(navigator.serviceWorker.controller);
  let controllerReloadQueued = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadControllerAtStart || controllerReloadQueued) return;
    controllerReloadQueued = true;
    try {
      const reloadKey = `${PROD_SW_CONTROLLER_RELOAD_KEY}:${__KIRANA_BUILD_ID__}`;
      if (window.sessionStorage.getItem(reloadKey) === "1") return;
      window.sessionStorage.setItem(reloadKey, "1");
    } catch {
      // Storage can be blocked; a single controllerchange-triggered reload still refreshes stale app code.
    }
    window.location.reload();
  });

  window.addEventListener("load", () => {
    const swUrl = `/sw.js?build=${encodeURIComponent(__KIRANA_BUILD_ID__)}`;
    void navigator.serviceWorker
      .register(swUrl, { scope: "/" })
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
    if (registration?.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
      return;
    }
    void registration?.update();
  });
}
