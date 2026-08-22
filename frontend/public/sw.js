/* Artha service worker: app-shell only. Business data stays in IndexedDB, not Cache Storage. */
const BUILD_ID = "__KIRANA_BUILD_ID__";
const CACHE_VERSION = `kiranaos-shell-v9-${BUILD_ID}`;
const CORE_ASSETS = __KIRANA_CORE_ASSETS__;
const VERTICAL_ASSETS = __KIRANA_VERTICAL_ASSETS__;
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/offline.html",
  "/favicon.svg",
  "/icons/kiranaos-icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
];
const NEVER_CACHE_PATTERNS = [
  // The customer QR self-order page belongs to a walk-in stranger, not to this
  // install. Never intercept it: a worker that already exists on this device
  // (the owner previewing on their own phone) must not serve a stale shell or a
  // half-cached chunk to someone who is standing at the counter trying to order.
  /^\/order(\/|$)/i,
  /\/api\//i,
  /\/sync\//i,
  /\/auth\//i,
  /\/login/i,
  /\/logout/i,
  /\/register/i,
  /token/i,
  /password/i,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(async (cache) => {
        // `addAll` is atomic: publish the marker only after every operational
        // route and dependency is present. Readiness can then prove the whole
        // build is restartable instead of guessing from one arbitrary JS file.
        await cache.addAll([...APP_SHELL, ...CORE_ASSETS]);
        await cache.put(`/__offline/core/${BUILD_ID}`, new Response("ready"));
      })
  );
});

async function deleteOldShellCaches() {
  const keys = await caches.keys();
  const oldKeys = keys.filter((key) => key.startsWith("kiranaos-shell") && key !== CACHE_VERSION);
  await Promise.all(oldKeys.map((key) => caches.delete(key)));
  return oldKeys.length;
}

self.addEventListener("activate", (event) => {
  // A new worker activates only after the cashier accepts the update (or every
  // old tab closes). Never navigate/reload an open till from the worker itself.
  event.waitUntil(deleteOldShellCaches().then(() => self.clients.claim()));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data && event.data.type === "CACHE_VERTICAL") {
    const assets = VERTICAL_ASSETS[event.data.verticalId];
    if (Array.isArray(assets)) event.waitUntil(
      caches.open(CACHE_VERSION).then(async (cache) => {
        await cache.addAll(assets);
        await cache.put(`/__offline/vertical/${event.data.verticalId}/${BUILD_ID}`, new Response("ready"));
      }),
    );
  }
});

// Sensitive routes (API, auth, sync, cross-origin, non-GET) must never touch Cache Storage.
function shouldBypass(request, url) {
  if (request.method !== "GET") return true;
  if (url.origin !== self.location.origin) return true;
  return NEVER_CACHE_PATTERNS.some((pattern) => pattern.test(url.pathname + url.search));
}

async function cacheFirstNavigation(request) {
  const cache = await caches.open(CACHE_VERSION);
  // Keep the HTML shell and its content-hashed chunks on the same installed
  // release. Serving a newer network index through an older active worker can
  // mix builds if connectivity drops halfway through startup. The app's normal
  // service-worker update flow installs the next complete cache and asks the
  // cashier before activating it.
  const installedShell =
    (await cache.match("/index.html")) ||
    (await cache.match("/")) ||
    (await cache.match("/offline.html"));
  if (installedShell) return installedShell;

  try {
    const response = await fetch(request);
    // Recovery path for a damaged/evicted cache. A normally installed worker
    // always returns above because install publishes atomically.
    if (response && response.ok && response.type === "basic") {
      cache.put("/index.html", response.clone()).catch(() => undefined);
    }
    return response;
  } catch (error) {
    // Offline: serve the cached SPA shell so any in-app route can boot, then fall back to offline.html.
    const shell =
      (await cache.match("/index.html")) ||
      (await cache.match("/")) ||
      (await cache.match("/offline.html"));
    // A navigation that resolves undefined is a hard failure and shows a blank
    // page instead of the browser's own error.
    if (!shell) throw error;
    return shell;
  }
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(CACHE_VERSION);
  // Only read from this worker's build-scoped cache. During an atomic upgrade an
  // older cache can briefly coexist, and a global caches.match() could otherwise
  // mix files from two releases.
  const cached = await cache.match(request);
  const fetchAndStore = fetch(request).then((response) => {
    if (response && response.ok && response.type === "basic") cache.put(request, response.clone()).catch(() => undefined);
    return response;
  });
  if (cached) {
    fetchAndStore.catch(() => undefined);
    return cached;
  }
  return fetchAndStore;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (shouldBypass(request, url)) return;

  if (request.mode === "navigate") {
    event.respondWith(cacheFirstNavigation(request));
    return;
  }

  // App code uses this build's complete, atomically installed cache. Network-first
  // can hang indefinitely during a hard disconnect, leaving React lazy routes on
  // their loading screen even though the exact chunk is already cached. Filenames
  // are content-hashed and CACHE_VERSION is build-scoped, so serving the installed
  // copy first cannot mix releases; the background request still refreshes it.
  if (["style", "script", "worker"].includes(request.destination)) {
    event.respondWith(cacheFirstStatic(request));
    return;
  }

  // Fonts and images rarely change; serve them cache-first for speed.
  if (["font", "image"].includes(request.destination)) {
    event.respondWith(cacheFirstStatic(request));
  }
});
