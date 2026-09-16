/* Artha service worker: app-shell only. Business data stays in IndexedDB, not Cache Storage. */
const BUILD_ID = "20260914165255";
const CACHE_VERSION = `kiranaos-shell-v11-${BUILD_ID}`;
const NAVIGATION_NETWORK_TIMEOUT_MS = 3500;
const CORE_ASSETS = ["/assets/AdjustmentsPage-DUESCXIA.js","/assets/AdvancedSettingsPage-Cglfmeeb.js","/assets/AreaChart-PWP-zFZv.js","/assets/AuditLogsPage-BHH6cHqW.js","/assets/BackgroundRuntime-CW5O-ndJ.js","/assets/BarChart-DI0Fxzf2.js","/assets/BillDetailPage-DZN6T0CH.js","/assets/BillingPage-Dz5AGs3L.js","/assets/BillingSearch-BMGync8B.js","/assets/BillingSettingsPage-BwgY5IAc.js","/assets/BillsPage-B24i4887.js","/assets/CartesianGrid-eieT8ocL.js","/assets/CategoriesPage-BpOzpeLJ.js","/assets/ConfirmDialog-Bq6jC7WJ.js","/assets/CustomerDetailPage-CViBwI-k.js","/assets/CustomersPage-Cpp_bksO.js","/assets/DailyClosingPage-09hMehjz.js","/assets/DashboardPage-DiT4taZ-.js","/assets/DataTableCard-BP5iYRuF.js","/assets/EmptyState-XKlXAyef.js","/assets/ErrorState-DbwkPNlV.js","/assets/ExpensesPage-BESO3vjp.js","/assets/FinancialAggregationService-CmSwW_Z5.js","/assets/ImportOrderPage-DHL_efr0.js","/assets/InventoryLotsPage-D9RE4vVc.js","/assets/InventoryPage-Dgd_XPE4.js","/assets/LineChart-nA-B_SYu.js","/assets/LoadingSkeleton-CZOObkSo.js","/assets/LocalDataUnavailable-BLCINFXS.js","/assets/MerchantSetupPage-B7oRw88Q.js","/assets/ModulesSettingsPage-BlLyqB3I.js","/assets/MoneyStatementPage-B-JdQQoc.js","/assets/NearExpiryAlert-CNfPOL33.js","/assets/NewReturnPage-B6cXvPxb.js","/assets/OffersPage-DSsmQPPI.js","/assets/OfflineConfidenceMeter-B7ihbk4I.js","/assets/OrdersReceivedPage-DZvvm5Wy.js","/assets/PageHeader-i7acpfz8.js","/assets/PageShell-ABsJVPFc.js","/assets/PieChart-Dlm3RP2V.js","/assets/PlanBadge-yjjHsCtU.js","/assets/PrinterSettingsPage-DHxbh2Ku.js","/assets/ProductPricingPage-vscEA9rh.js","/assets/ProductsPage-Cn2bvnzm.js","/assets/PurchaseBillsPage-B7slFlLl.js","/assets/QrCodeView-Usn2-sun.js","/assets/RecoveryModePage-DUEcHJeS.js","/assets/RecycleBinPage-BbM7J118.js","/assets/ReportsPage-BKL6rdXU.js","/assets/ReturnDialog-B8TVTwq-.js","/assets/SalesOverviewPage-Dk7toYG_.js","/assets/SearchInputWithIcon-DXnOxXNt.js","/assets/SecuritySettingsPage-PxYT8nUe.js","/assets/SettingsPage-CtZipZUp.js","/assets/SettingsShell-DBn0AtHA.js","/assets/SmartToolsPage-BXxSR12O.js","/assets/StaffPage-Ckqaxfme.js","/assets/StaffSettingsPage-B7hbjjiF.js","/assets/StatCard-q8SH6JGj.js","/assets/StockCountsPage-ueeDrBYK.js","/assets/StockInPage-Bbbaqo9N.js","/assets/StockOutPage-BjxglRD2.js","/assets/StockStatusView-D3KFf8B3.js","/assets/StockTransfersPage-VlvuYMgV.js","/assets/StoreProfilePage-DbeV_uhA.js","/assets/SubscriptionPage-CtnohCiF.js","/assets/SuppliersPage-t-dAlzyb.js","/assets/SyncBadge-D6jj0U4R.js","/assets/SyncSettingsPage-pS2Y8iIO.js","/assets/SyncStatusPage-RJAYyjnG.js","/assets/TaxesSettingsPage-DjdTjKF7.js","/assets/TradeFocusStrip-Va6icC_G.js","/assets/VoiceDictationBar-uaW0Pd43.js","/assets/YAxis-RbUYWHLQ.js","/assets/ai-client--dG_5n5W.js","/assets/alert-dialog-CI3K5iLr.js","/assets/api-B2_aluva.js","/assets/api-BGKTEfWC.js","/assets/api-BsuLiC6W.js","/assets/api-CNmWg911.js","/assets/api-CPinD3WB.js","/assets/api-CkECM2sV.js","/assets/api-CkLUEoDG.js","/assets/api-CnUP5HAK.js","/assets/api-DqBgP7_X.js","/assets/api-vMIiWixG.js","/assets/assistant-staging-DP78-M3y.js","/assets/backend-transcription-5NU8D-sM.js","/assets/billing-calculations-xtjR86bH.js","/assets/billing-slots-YJ8csFzi.js","/assets/capabilities-lYPeV-kl.js","/assets/cart-codec-CbubRRIW.js","/assets/category-store-BW0JKIMm.js","/assets/checkbox-CAiYgNN9.js","/assets/chip-tones-cbbqDYQQ.js","/assets/cloud-hydration-7ZLaFtau.js","/assets/deferred-runtime-CzrXKF7T.js","/assets/demo-shop-data-CrNp8EwC.js","/assets/dropdown-menu-lVxNQ62B.js","/assets/escape-html-DInPSGdP.js","/assets/generateCategoricalChart-xgVlke6y.js","/assets/hooks--zHNKwsj.js","/assets/index-BEjh-wr3.css","/assets/index-BlqwGr5S.js","/assets/index-CxWW_46C.js","/assets/index-DLkqWn8u.js","/assets/index-DhCGH5L2.js","/assets/inventory-lots-api-f2cR5xEy.js","/assets/ledger-drift-repair-DuFk541f.js","/assets/local-actions-AN3FXPoe.js","/assets/local-actions-Bv1jz9kI.js","/assets/local-actions-DDOsHBmr.js","/assets/local-actions-DgmcrO65.js","/assets/local-actions-Dvr42VKf.js","/assets/local-actions-a9JDbSSt.js","/assets/local-reporting-qvefvRsh.js","/assets/open-bills-C2YfcvU-.js","/assets/payment-mode-DJNE_WM0.js","/assets/pending-cart-additions-Lwr7jNYS.js","/assets/permissions-D_MDsIop.js","/assets/personalize-Cz4vV2EP.js","/assets/popover-C44MYI6w.js","/assets/pricing-rules-cache-BjU1dlsm.js","/assets/print-SI7e2UKW.js","/assets/product-configurators-4cbwrayb.js","/assets/product-form-state-LqD_KP9v.js","/assets/product-import-csv-D8wXlEO6.js","/assets/product-pricing-BM1RI124.js","/assets/product-voice-parser-DxQrYUnh.js","/assets/progress-B9lCXohd.js","/assets/purchase-orders-api-CYnSBfdJ.js","/assets/qr-encoder-O1M434ck.js","/assets/queries-5yKUq-jU.js","/assets/queries-BSg4cSLx.js","/assets/queries-C0JdnjjN.js","/assets/queries-C3G1KdVI.js","/assets/queries-DXmPxf5F.js","/assets/queries-X7OcDQEH.js","/assets/query-options-DZ4mp_BJ.js","/assets/receipt-print-D2K1VUcq.js","/assets/restaurant-website-IRv-TSWP.js","/assets/select-C7kjLM8A.js","/assets/settle-checks-BvFvcl9V.js","/assets/share-BI6voOAY.js","/assets/sheet-RYA23ASH.js","/assets/shop-billing-DMoz9IJ4.js","/assets/shop-credit-BUbd94WT.js","/assets/shop-workflows-CEWWEHT4.js","/assets/stock-display-Bw0mQIjk.js","/assets/supplier-payment-history-Oxnb-GOq.js","/assets/switch-D6pbxS4g.js","/assets/sync-engine-CEaweufP.js","/assets/sync-push-BfdTogiR.js","/assets/sync-reconcile-btNMUEr7.js","/assets/sync-status-repair-CP18WTtH.js","/assets/sync-types-B187FdZc.js","/assets/ui-CW9RD7Tk.js","/assets/use-panel-resize-Bv8hNar5.js","/assets/use-settings-prefs-CmKW8cWF.js","/assets/useOfflineStatus-DtpnQobF.js","/assets/useReportView-DpNWTKoW.js","/assets/useSearchTracking-DXWeP-e-.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-date-FYRyL2wv.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js","/assets/voice-recognition-DMs16Fd1.js","/assets/voice-text-BkOdDDiw.js","/assets/whatsapp-delivery-CYFXeRX9.js","/assets/zod-DQDEOc6Z.js"];
const VERTICAL_ASSETS = {"clothing":["/assets/RentalsPage-B4kc1GGT.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-CzrXKF7T.js","/assets/index-BEjh-wr3.css","/assets/index-DhCGH5L2.js","/assets/queries-X7OcDQEH.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-BfdTogiR.js","/assets/sync-reconcile-btNMUEr7.js","/assets/sync-status-repair-CP18WTtH.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-Bv8hNar5.js","/assets/useOfflineStatus-DtpnQobF.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"footwear":["/assets/SizeRunsPage-Bsfzv8D3.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-CzrXKF7T.js","/assets/index-BEjh-wr3.css","/assets/index-DhCGH5L2.js","/assets/sync-push-BfdTogiR.js","/assets/sync-reconcile-btNMUEr7.js","/assets/sync-status-repair-CP18WTtH.js","/assets/sync-types-B187FdZc.js","/assets/useOfflineStatus-DtpnQobF.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"auto-parts":["/assets/FitmentPage-B9r96Kxe.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-CzrXKF7T.js","/assets/index-BEjh-wr3.css","/assets/index-DhCGH5L2.js","/assets/pending-cart-additions-Lwr7jNYS.js","/assets/queries-X7OcDQEH.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-BfdTogiR.js","/assets/sync-reconcile-btNMUEr7.js","/assets/sync-status-repair-CP18WTtH.js","/assets/sync-types-B187FdZc.js","/assets/useOfflineStatus-DtpnQobF.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"electronics":["/assets/ProductUnitsPage-DKFguvbo.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-CzrXKF7T.js","/assets/index-BEjh-wr3.css","/assets/index-DhCGH5L2.js","/assets/queries-X7OcDQEH.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-BfdTogiR.js","/assets/sync-reconcile-btNMUEr7.js","/assets/sync-status-repair-CP18WTtH.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-Bv8hNar5.js","/assets/useOfflineStatus-DtpnQobF.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"pharmacy":["/assets/PrescriptionsPage-DYAJkTWp.js","/assets/api-Bkpdj9Jr.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-CzrXKF7T.js","/assets/index-BEjh-wr3.css","/assets/index-DhCGH5L2.js","/assets/queries-X7OcDQEH.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-BfdTogiR.js","/assets/sync-reconcile-btNMUEr7.js","/assets/sync-status-repair-CP18WTtH.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-Bv8hNar5.js","/assets/useOfflineStatus-DtpnQobF.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"stationery-books":["/assets/BookListsPage-dDgcf43N.js","/assets/billing-calculations-xtjR86bH.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-CzrXKF7T.js","/assets/index-BEjh-wr3.css","/assets/index-DhCGH5L2.js","/assets/open-bills-C2YfcvU-.js","/assets/queries-X7OcDQEH.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-BfdTogiR.js","/assets/sync-reconcile-btNMUEr7.js","/assets/sync-status-repair-CP18WTtH.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-Bv8hNar5.js","/assets/useOfflineStatus-DtpnQobF.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"furniture-home":["/assets/FurnitureOrdersPage-BA8heDK-.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-CzrXKF7T.js","/assets/index-BEjh-wr3.css","/assets/index-DhCGH5L2.js","/assets/queries-X7OcDQEH.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-BfdTogiR.js","/assets/sync-reconcile-btNMUEr7.js","/assets/sync-status-repair-CP18WTtH.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-Bv8hNar5.js","/assets/useOfflineStatus-DtpnQobF.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"beauty-cosmetics":["/assets/TestersPage-CuptEQ-0.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-CzrXKF7T.js","/assets/index-BEjh-wr3.css","/assets/index-DhCGH5L2.js","/assets/queries-X7OcDQEH.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-BfdTogiR.js","/assets/sync-reconcile-btNMUEr7.js","/assets/sync-status-repair-CP18WTtH.js","/assets/sync-types-B187FdZc.js","/assets/useOfflineStatus-DtpnQobF.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"restaurant":["/assets/ConfirmDialog-Bq6jC7WJ.js","/assets/GuestOrdersStrip-DLfSbQfq.js","/assets/KitchenPage--oHuFakK.js","/assets/KitchenStockPage-D28aF_Mu.js","/assets/MenuPage-DZceLSr1.js","/assets/PageHeader-i7acpfz8.js","/assets/QrCodeView-Usn2-sun.js","/assets/TablesPage-2PPUjWds.js","/assets/alert-dialog-CI3K5iLr.js","/assets/api-CkECM2sV.js","/assets/billing-calculations-xtjR86bH.js","/assets/chip-tones-cbbqDYQQ.js","/assets/index-BEjh-wr3.css","/assets/index-DLkqWn8u.js","/assets/index-DhCGH5L2.js","/assets/open-bills-C2YfcvU-.js","/assets/qr-encoder-O1M434ck.js","/assets/queries-C3G1KdVI.js","/assets/queries-X7OcDQEH.js","/assets/query-options-DZ4mp_BJ.js","/assets/reservations-api-BYR9uGg9.js","/assets/restaurant-api-DhTaQr-C.js","/assets/restaurant-website-IRv-TSWP.js","/assets/switch-D6pbxS4g.js","/assets/table-store-C9qbm_Tj.js","/assets/use-settings-prefs-CmKW8cWF.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"manufacturing":["/assets/ManufacturingPage-BzfRxUG5.js","/assets/PageHeader-i7acpfz8.js","/assets/PageShell-ABsJVPFc.js","/assets/api-vMIiWixG.js","/assets/deferred-runtime-CzrXKF7T.js","/assets/index-BEjh-wr3.css","/assets/index-DhCGH5L2.js","/assets/sync-push-BfdTogiR.js","/assets/sync-reconcile-btNMUEr7.js","/assets/sync-status-repair-CP18WTtH.js","/assets/sync-types-B187FdZc.js","/assets/useOfflineStatus-DtpnQobF.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"]};
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

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_VERSION);
  let timer;
  try {
    // A stale installed shell can reference a bundle that no longer starts on a
    // customer's browser. Prefer today's HTML while online, but bound the wait
    // so a counter with no network still opens from its complete offline cache.
    const response = await Promise.race([
      fetch(request, { cache: "no-store" }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("navigation network timeout")), NAVIGATION_NETWORK_TIMEOUT_MS);
      }),
    ]);
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
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(CACHE_VERSION);
  // Only read from this worker's build-scoped cache. During an atomic upgrade an
  // older cache can briefly coexist, and a global caches.match() could otherwise
  // mix files from two releases.
  const cached = await cache.match(request);
  // Content-hashed assets inside a build-scoped, atomically installed cache are
  // immutable. Do not start a background network request for a cache hit: during
  // a hard disconnect those requests can remain pending and eventually starve a
  // later lazy import, even though that route chunk is already cached. This was
  // visible after a long offline route sequence as an endless "Opening…" screen.
  if (cached) return cached;

  return fetch(request).then((response) => {
    if (response && response.ok && response.type === "basic") cache.put(request, response.clone()).catch(() => undefined);
    return response;
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (shouldBypass(request, url)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // App code uses this build's complete, atomically installed cache. Network-first
  // can hang indefinitely during a hard disconnect, leaving React lazy routes on
  // their loading screen even though the exact chunk is already cached. Filenames
  // are content-hashed and CACHE_VERSION is build-scoped, so serving the installed
  // copy cannot mix releases and needs no background revalidation.
  if (["style", "script", "worker"].includes(request.destination)) {
    event.respondWith(cacheFirstStatic(request));
    return;
  }

  // Fonts and images rarely change; serve them cache-first for speed.
  if (["font", "image"].includes(request.destination)) {
    event.respondWith(cacheFirstStatic(request));
  }
});
