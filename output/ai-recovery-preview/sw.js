/* Artha service worker: app-shell only. Business data stays in IndexedDB, not Cache Storage. */
const BUILD_ID = "20260914164531";
const CACHE_VERSION = `kiranaos-shell-v11-${BUILD_ID}`;
const NAVIGATION_NETWORK_TIMEOUT_MS = 3500;
const CORE_ASSETS = ["/assets/AdjustmentsPage-BIP31opq.js","/assets/AdvancedSettingsPage-BOhLoKur.js","/assets/AreaChart-7WMg-toH.js","/assets/AuditLogsPage-CNIfniSm.js","/assets/BackgroundRuntime-DRyqNPfh.js","/assets/BarChart-BGbVP-it.js","/assets/BillDetailPage-CycmWaJn.js","/assets/BillingPage-C1AGXKPe.js","/assets/BillingSearch-LMEt7Rcu.js","/assets/BillingSettingsPage-Dv7hTUg_.js","/assets/BillsPage-BM5O8vwz.js","/assets/CartesianGrid-06HVBaSx.js","/assets/CategoriesPage-CCC9Oqny.js","/assets/ConfirmDialog-z-vReFSG.js","/assets/CustomerDetailPage-CldL40uq.js","/assets/CustomersPage-sYTumYeZ.js","/assets/DailyClosingPage-BuHAaGBy.js","/assets/DashboardPage-CIvgQtOj.js","/assets/DataTableCard-BqTITPg4.js","/assets/EmptyState-Cr-DgyrV.js","/assets/ErrorState-B6fR0cH1.js","/assets/ExpensesPage-Dx3CY2ph.js","/assets/FinancialAggregationService-B7PdJc4B.js","/assets/ImportOrderPage-CretA1Nz.js","/assets/InventoryLotsPage-CfSi1DTH.js","/assets/InventoryPage-CzCDlK3U.js","/assets/LineChart-vChFyM6J.js","/assets/LoadingSkeleton-DJVEPgx5.js","/assets/LocalDataUnavailable-CcDm8uGm.js","/assets/MerchantSetupPage-BJullGTc.js","/assets/ModulesSettingsPage-RBGDrGZe.js","/assets/MoneyStatementPage-D0wq705K.js","/assets/NearExpiryAlert-GNqXPkKV.js","/assets/NewReturnPage-Df7XAPhg.js","/assets/OffersPage-BIpUe5R6.js","/assets/OfflineConfidenceMeter-0HMxBNmN.js","/assets/OrdersReceivedPage-DtnYLtG4.js","/assets/PageHeader-B9g_6TFk.js","/assets/PageShell-B2mCdo_6.js","/assets/PieChart-CvEtRCSC.js","/assets/PlanBadge-BpZSYC-b.js","/assets/PrinterSettingsPage-BuPvbW0Y.js","/assets/ProductPricingPage-BJpEygEi.js","/assets/ProductsPage-naFjcVUd.js","/assets/PurchaseBillsPage-C4b4dTqy.js","/assets/QrCodeView-Usn2-sun.js","/assets/RecoveryModePage-EGqf3rHX.js","/assets/RecycleBinPage-9Pk2_FyB.js","/assets/ReportsPage-Dsqsum46.js","/assets/ReturnDialog-ynWekAGw.js","/assets/SalesOverviewPage-wtFqJGoq.js","/assets/SearchInputWithIcon-DpbQbQAJ.js","/assets/SecuritySettingsPage-CVy1Vvxh.js","/assets/SettingsPage-kxAbdVWH.js","/assets/SettingsShell-D3ZxQimt.js","/assets/SmartToolsPage-DYSl7_46.js","/assets/StaffPage-C1YCV2eG.js","/assets/StaffSettingsPage-hd10M2OO.js","/assets/StatCard-CQN8RQRa.js","/assets/StockCountsPage-B36lMZbq.js","/assets/StockInPage-BLFEzssC.js","/assets/StockOutPage-BUfru7cv.js","/assets/StockStatusView-DiHcA80I.js","/assets/StockTransfersPage-r3WeBcB3.js","/assets/StoreProfilePage-BlMzz1eK.js","/assets/SubscriptionPage-DXyF2l9q.js","/assets/SuppliersPage-DqJdVKba.js","/assets/SyncBadge-Cu0tf11m.js","/assets/SyncSettingsPage-hu7pMmZ4.js","/assets/SyncStatusPage-CMatHNhb.js","/assets/TaxesSettingsPage-GZCO9t_6.js","/assets/TradeFocusStrip-0kuTSsAA.js","/assets/VoiceDictationBar-uaW0Pd43.js","/assets/YAxis-Ramzzv12.js","/assets/ai-client-DCKdUChv.js","/assets/alert-dialog-BmYIkKN8.js","/assets/api-B9CDl0Li.js","/assets/api-C9oA9H4D.js","/assets/api-CTqeYz2K.js","/assets/api-CTtH8LWg.js","/assets/api-Cbg6jJyZ.js","/assets/api-DUr_nXbT.js","/assets/api-DmzgAIKm.js","/assets/api-DqBgP7_X.js","/assets/api-TntuSDDg.js","/assets/api-_hjNCs7f.js","/assets/assistant-staging-Dpv7_KHj.js","/assets/backend-transcription-C8AozXPi.js","/assets/billing-calculations-Dtm5NkWF.js","/assets/billing-slots-YJ8csFzi.js","/assets/capabilities-Pq-oxP-f.js","/assets/cart-codec-CbubRRIW.js","/assets/category-store-Ccjti0pZ.js","/assets/checkbox-BsUj5bnO.js","/assets/chip-tones-cbbqDYQQ.js","/assets/cloud-hydration-WbYFyyxu.js","/assets/deferred-runtime-DvDpJgjU.js","/assets/demo-shop-data-C8BLmXLp.js","/assets/dropdown-menu-CJJmtbZB.js","/assets/escape-html-DInPSGdP.js","/assets/generateCategoricalChart-CkWIg6_1.js","/assets/hooks-j7X7zp2z.js","/assets/index-CGZ0_TYN.css","/assets/index-CxWW_46C.js","/assets/index-D6Dz31Hj.js","/assets/index-DLkqWn8u.js","/assets/index-DnTeTJJW.js","/assets/inventory-lots-api-CwGf0BhW.js","/assets/ledger-drift-repair-4Ad5xYjD.js","/assets/local-actions-BarLu5zP.js","/assets/local-actions-Dc-HkY2C.js","/assets/local-actions-Dt3lcyyL.js","/assets/local-actions-Dx5jHJ7x.js","/assets/local-actions-PTH18YeD.js","/assets/local-actions-g_HeJUti.js","/assets/local-reporting-BDX2Q_7J.js","/assets/open-bills-DigGz4dW.js","/assets/payment-mode-DJNE_WM0.js","/assets/pending-cart-additions-Dy5zKhW5.js","/assets/permissions-DXAl3ggD.js","/assets/personalize-Cz4vV2EP.js","/assets/popover-sRMyAwSS.js","/assets/pricing-rules-cache-CyRZ7Lb8.js","/assets/print-DDJyZHP4.js","/assets/product-configurators-4cbwrayb.js","/assets/product-form-state-474byO_-.js","/assets/product-import-csv-rW-eSRe-.js","/assets/product-pricing-DabT4WDW.js","/assets/product-voice-parser-DxQrYUnh.js","/assets/progress-C9Vbikro.js","/assets/purchase-orders-api-CEJVAkAD.js","/assets/qr-encoder-O1M434ck.js","/assets/queries-BCGbdr2N.js","/assets/queries-Bjsj9_kM.js","/assets/queries-CP6utKOP.js","/assets/queries-CQjI178u.js","/assets/queries-DTcwsZST.js","/assets/queries-_l1UPD2X.js","/assets/query-options-DZ4mp_BJ.js","/assets/receipt-print-CcCZeHDT.js","/assets/restaurant-website-IRv-TSWP.js","/assets/select-BK2q6UCY.js","/assets/settle-checks-BvFvcl9V.js","/assets/share-Dg4fpj6g.js","/assets/sheet-DBKONeZt.js","/assets/shop-billing-DoFZmaih.js","/assets/shop-credit-BUbd94WT.js","/assets/shop-workflows-Drz0SVU-.js","/assets/stock-display-Bw0mQIjk.js","/assets/supplier-payment-history-B-zrTwZp.js","/assets/switch-BCNvvszl.js","/assets/sync-engine-ORtQP0KB.js","/assets/sync-push-CozltoV2.js","/assets/sync-reconcile-D_8RAxJn.js","/assets/sync-status-repair-CGXdRbfs.js","/assets/sync-types-B187FdZc.js","/assets/ui-C756xJvd.js","/assets/use-panel-resize-B79tGzEW.js","/assets/use-settings-prefs-O7vfmgl3.js","/assets/useOfflineStatus-D6OIolW5.js","/assets/useReportView-BZZTalOT.js","/assets/useSearchTracking-8zAJ6gyD.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-date-FYRyL2wv.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js","/assets/voice-recognition-DMs16Fd1.js","/assets/voice-text-BkOdDDiw.js","/assets/whatsapp-delivery-CEbvjYF3.js","/assets/zod-DQDEOc6Z.js"];
const VERTICAL_ASSETS = {"clothing":["/assets/RentalsPage-FoNVUgRJ.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-DvDpJgjU.js","/assets/index-CGZ0_TYN.css","/assets/index-DnTeTJJW.js","/assets/queries-_l1UPD2X.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-CozltoV2.js","/assets/sync-reconcile-D_8RAxJn.js","/assets/sync-status-repair-CGXdRbfs.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-B79tGzEW.js","/assets/useOfflineStatus-D6OIolW5.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"footwear":["/assets/SizeRunsPage-3GAZxN0x.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-DvDpJgjU.js","/assets/index-CGZ0_TYN.css","/assets/index-DnTeTJJW.js","/assets/sync-push-CozltoV2.js","/assets/sync-reconcile-D_8RAxJn.js","/assets/sync-status-repair-CGXdRbfs.js","/assets/sync-types-B187FdZc.js","/assets/useOfflineStatus-D6OIolW5.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"auto-parts":["/assets/FitmentPage-Cx2TgUOo.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-DvDpJgjU.js","/assets/index-CGZ0_TYN.css","/assets/index-DnTeTJJW.js","/assets/pending-cart-additions-Dy5zKhW5.js","/assets/queries-_l1UPD2X.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-CozltoV2.js","/assets/sync-reconcile-D_8RAxJn.js","/assets/sync-status-repair-CGXdRbfs.js","/assets/sync-types-B187FdZc.js","/assets/useOfflineStatus-D6OIolW5.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"electronics":["/assets/ProductUnitsPage-CktHfH8E.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-DvDpJgjU.js","/assets/index-CGZ0_TYN.css","/assets/index-DnTeTJJW.js","/assets/queries-_l1UPD2X.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-CozltoV2.js","/assets/sync-reconcile-D_8RAxJn.js","/assets/sync-status-repair-CGXdRbfs.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-B79tGzEW.js","/assets/useOfflineStatus-D6OIolW5.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"pharmacy":["/assets/PrescriptionsPage-D8yttYXQ.js","/assets/api-CGQYvEer.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-DvDpJgjU.js","/assets/index-CGZ0_TYN.css","/assets/index-DnTeTJJW.js","/assets/queries-_l1UPD2X.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-CozltoV2.js","/assets/sync-reconcile-D_8RAxJn.js","/assets/sync-status-repair-CGXdRbfs.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-B79tGzEW.js","/assets/useOfflineStatus-D6OIolW5.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"stationery-books":["/assets/BookListsPage-BnF4UiUh.js","/assets/billing-calculations-Dtm5NkWF.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-DvDpJgjU.js","/assets/index-CGZ0_TYN.css","/assets/index-DnTeTJJW.js","/assets/open-bills-DigGz4dW.js","/assets/queries-_l1UPD2X.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-CozltoV2.js","/assets/sync-reconcile-D_8RAxJn.js","/assets/sync-status-repair-CGXdRbfs.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-B79tGzEW.js","/assets/useOfflineStatus-D6OIolW5.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"furniture-home":["/assets/FurnitureOrdersPage-THXYTqxB.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-DvDpJgjU.js","/assets/index-CGZ0_TYN.css","/assets/index-DnTeTJJW.js","/assets/queries-_l1UPD2X.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-CozltoV2.js","/assets/sync-reconcile-D_8RAxJn.js","/assets/sync-status-repair-CGXdRbfs.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-B79tGzEW.js","/assets/useOfflineStatus-D6OIolW5.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"beauty-cosmetics":["/assets/TestersPage-zrjYPCFi.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-DvDpJgjU.js","/assets/index-CGZ0_TYN.css","/assets/index-DnTeTJJW.js","/assets/queries-_l1UPD2X.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-CozltoV2.js","/assets/sync-reconcile-D_8RAxJn.js","/assets/sync-status-repair-CGXdRbfs.js","/assets/sync-types-B187FdZc.js","/assets/useOfflineStatus-D6OIolW5.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"restaurant":["/assets/ConfirmDialog-z-vReFSG.js","/assets/GuestOrdersStrip-BpRvmo7u.js","/assets/KitchenPage-e8CaMDYL.js","/assets/KitchenStockPage-Dje_ka0o.js","/assets/MenuPage-DbdDodLp.js","/assets/PageHeader-B9g_6TFk.js","/assets/QrCodeView-Usn2-sun.js","/assets/TablesPage-Cpd2reJ9.js","/assets/alert-dialog-BmYIkKN8.js","/assets/api-TntuSDDg.js","/assets/billing-calculations-Dtm5NkWF.js","/assets/chip-tones-cbbqDYQQ.js","/assets/index-CGZ0_TYN.css","/assets/index-DLkqWn8u.js","/assets/index-DnTeTJJW.js","/assets/open-bills-DigGz4dW.js","/assets/qr-encoder-O1M434ck.js","/assets/queries-BCGbdr2N.js","/assets/queries-_l1UPD2X.js","/assets/query-options-DZ4mp_BJ.js","/assets/reservations-api-BhMRCwuR.js","/assets/restaurant-api-Ck_FFpsI.js","/assets/restaurant-website-IRv-TSWP.js","/assets/switch-BCNvvszl.js","/assets/table-store-ByRU0daq.js","/assets/use-settings-prefs-O7vfmgl3.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"manufacturing":["/assets/ManufacturingPage-DTNCKlgd.js","/assets/PageHeader-B9g_6TFk.js","/assets/PageShell-B2mCdo_6.js","/assets/api-B9CDl0Li.js","/assets/deferred-runtime-DvDpJgjU.js","/assets/index-CGZ0_TYN.css","/assets/index-DnTeTJJW.js","/assets/sync-push-CozltoV2.js","/assets/sync-reconcile-D_8RAxJn.js","/assets/sync-status-repair-CGXdRbfs.js","/assets/sync-types-B187FdZc.js","/assets/useOfflineStatus-D6OIolW5.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"]};
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
