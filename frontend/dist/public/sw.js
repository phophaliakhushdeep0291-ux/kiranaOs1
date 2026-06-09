/* KiranaOS service worker: app-shell only. Business data stays in IndexedDB, not Cache Storage. */
const CACHE_VERSION = "kiranaos-shell-v3";
const APP_SHELL = ["/", "/offline.html", "/manifest.webmanifest", "/favicon.svg"];
const NEVER_CACHE_PATTERNS = [
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
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function shouldBypass(request, url) {
  if (request.method !== "GET") return true;
  if (url.origin !== self.location.origin) return true;
  return NEVER_CACHE_PATTERNS.some((pattern) => pattern.test(url.pathname + url.search));
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === "basic") {
      cache.put(request, response.clone()).catch(() => undefined);
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || cache.match("/offline.html");
  }
}

async function cacheFirstStatic(request) {
  const cached = await caches.match(request);
  const cache = await caches.open(CACHE_VERSION);
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

async function networkFirstStatic(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === "basic") cache.put(request, response.clone()).catch(() => undefined);
    return response;
  } catch {
    return cache.match(request);
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (shouldBypass(request, url)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (["style", "script", "worker"].includes(request.destination)) {
    event.respondWith(networkFirstStatic(request));
    return;
  }

  if (["font", "image"].includes(request.destination)) {
    event.respondWith(cacheFirstStatic(request));
  }
});
