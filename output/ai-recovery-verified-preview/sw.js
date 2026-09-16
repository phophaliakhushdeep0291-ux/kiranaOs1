/* Artha service worker: app-shell only. Business data stays in IndexedDB, not Cache Storage. */
const BUILD_ID = "20260914170952";
const CACHE_VERSION = `kiranaos-shell-v11-${BUILD_ID}`;
const NAVIGATION_NETWORK_TIMEOUT_MS = 3500;
const CORE_ASSETS = ["/assets/AdjustmentsPage-iunOpVkd.js","/assets/AdvancedSettingsPage-BfSC00D6.js","/assets/AreaChart-Z3pxR2a5.js","/assets/AuditLogsPage-6IY1uavt.js","/assets/BackgroundRuntime-FG463eez.js","/assets/BarChart-CDtZs1WI.js","/assets/BillDetailPage-B0mxcYSx.js","/assets/BillingPage-FtrpWT1s.js","/assets/BillingSearch-H8CD8pFf.js","/assets/BillingSettingsPage-CmBwwqVX.js","/assets/BillsPage-i4_BycFO.js","/assets/CartesianGrid-CyKkO-A6.js","/assets/CategoriesPage-D3XckJeT.js","/assets/ConfirmDialog-A3L-WJjx.js","/assets/CustomerDetailPage-DWeVmQ43.js","/assets/CustomersPage-C89_rH_g.js","/assets/DailyClosingPage-BLHP5Bhb.js","/assets/DashboardPage-bmIFRz_u.js","/assets/DataTableCard-CrrK2rNV.js","/assets/EmptyState-Dp9dTtV9.js","/assets/ErrorState-Bn3zj2FN.js","/assets/ExpensesPage-DvY4o2QY.js","/assets/FinancialAggregationService-sNUkxp8q.js","/assets/ImportOrderPage-IWAgDmDf.js","/assets/InventoryLotsPage-HnWZJhqR.js","/assets/InventoryPage-B7CqWzBn.js","/assets/LineChart-BtoL80OS.js","/assets/LoadingSkeleton-71T0xNi7.js","/assets/LocalDataUnavailable-Oy2UyReW.js","/assets/MerchantSetupPage-rwaNUzjI.js","/assets/ModulesSettingsPage-DXYBQ1F0.js","/assets/MoneyStatementPage-Dl1yy_DM.js","/assets/NearExpiryAlert-Dx_pDrwn.js","/assets/NewReturnPage-BUbYLdFL.js","/assets/OffersPage-C3TEHALj.js","/assets/OfflineConfidenceMeter-DgN0rDlS.js","/assets/OrdersReceivedPage-MC7QezHJ.js","/assets/PageHeader-D2DGy3Zc.js","/assets/PageShell-B5SLX0v9.js","/assets/PieChart-CAs5o1ki.js","/assets/PlanBadge-CSEtsJES.js","/assets/PrinterSettingsPage-B_U0a7uy.js","/assets/ProductPricingPage-ByfqQm5U.js","/assets/ProductsPage-D2BTS5dX.js","/assets/PurchaseBillsPage-BKOFT0Z9.js","/assets/QrCodeView-Usn2-sun.js","/assets/RecoveryModePage-Dg_pvd-0.js","/assets/RecycleBinPage-D8U6B4uY.js","/assets/ReportsPage-C284ajEG.js","/assets/ReturnDialog-CIk70Tt7.js","/assets/SalesOverviewPage-droO2Ob3.js","/assets/SearchInputWithIcon-DmNxqMjM.js","/assets/SecuritySettingsPage-WRxRvWz3.js","/assets/SettingsPage-CmHXe2sU.js","/assets/SettingsShell-Cuecl7xk.js","/assets/SmartToolsPage-q13m0som.js","/assets/StaffPage-Br47vfmv.js","/assets/StaffSettingsPage-CaHogJQ0.js","/assets/StatCard-_0eLZ1DL.js","/assets/StockCountsPage-DzLXBsJD.js","/assets/StockInPage-DqqAZun5.js","/assets/StockOutPage-BvspeZ5J.js","/assets/StockStatusView-BbYbf1zJ.js","/assets/StockTransfersPage-CkGuMwX8.js","/assets/StoreProfilePage-Zt2x5wCE.js","/assets/SubscriptionPage-9WBERowe.js","/assets/SuppliersPage-BD4euEMV.js","/assets/SyncBadge-Cbb7TjrT.js","/assets/SyncSettingsPage-BPFLJG5H.js","/assets/SyncStatusPage-CFNMWXZm.js","/assets/TaxesSettingsPage-B0MdUar4.js","/assets/TradeFocusStrip-j-mPkyaF.js","/assets/VoiceDictationBar-uaW0Pd43.js","/assets/YAxis-DGqXEiVR.js","/assets/ai-client-C8jpfcro.js","/assets/alert-dialog-BtpX0sdc.js","/assets/api-8OAlN-sW.js","/assets/api-Ck_sx0lZ.js","/assets/api-Cr5fC4aP.js","/assets/api-CvNfNOhw.js","/assets/api-CyCM2QXE.js","/assets/api-DCkVAB-o.js","/assets/api-D_mo9AVz.js","/assets/api-DqBgP7_X.js","/assets/api-DrRkXNdY.js","/assets/api-T4ueJ5od.js","/assets/assistant-staging-ThCswxw_.js","/assets/backend-transcription-DJYbnjwV.js","/assets/billing-calculations-BtOioO4I.js","/assets/billing-slots-YJ8csFzi.js","/assets/capabilities-LlF4eHLv.js","/assets/cart-codec-CbubRRIW.js","/assets/category-store-Cy3uOooU.js","/assets/checkbox-ZI4eASUe.js","/assets/chip-tones-cbbqDYQQ.js","/assets/cloud-hydration-DktfYJHY.js","/assets/deferred-runtime-B73HzK4c.js","/assets/demo-shop-data-D_Q-GGH7.js","/assets/dropdown-menu-CGlSFmGk.js","/assets/escape-html-DInPSGdP.js","/assets/generateCategoricalChart-DsIVR8CG.js","/assets/hooks-wwBpzUwu.js","/assets/index-BEjh-wr3.css","/assets/index-C-jOBSyf.js","/assets/index-CxWW_46C.js","/assets/index-DLkqWn8u.js","/assets/index-gWEAKz58.js","/assets/inventory-lots-api-MF83ERIi.js","/assets/ledger-drift-repair-DRovUOwC.js","/assets/local-actions-BWewRqqK.js","/assets/local-actions-DTDKQqNp.js","/assets/local-actions-DYBCcUgb.js","/assets/local-actions-DhHNz_uF.js","/assets/local-actions-UGj1uAnv.js","/assets/local-actions-xzJjdsp_.js","/assets/local-reporting-CbH1zkIp.js","/assets/open-bills-C-w0GUOe.js","/assets/payment-mode-DJNE_WM0.js","/assets/pending-cart-additions-DSLHPP0s.js","/assets/permissions-B52LKdlD.js","/assets/personalize-Cz4vV2EP.js","/assets/popover-DSqtdIhB.js","/assets/pricing-rules-cache-0FUm70MH.js","/assets/print-wB0Sow_z.js","/assets/product-configurators-4cbwrayb.js","/assets/product-form-state-Bnj0JNZj.js","/assets/product-import-csv-D0H_NzRM.js","/assets/product-pricing-B4WUOOpX.js","/assets/product-voice-parser-DxQrYUnh.js","/assets/progress-CUTaSE14.js","/assets/purchase-orders-api-SDFmwolR.js","/assets/qr-encoder-O1M434ck.js","/assets/queries-BeWwa58r.js","/assets/queries-CKZ9M97u.js","/assets/queries-CNtYDDRA.js","/assets/queries-ClT2r0hQ.js","/assets/queries-DvU7eBgi.js","/assets/queries-a6zrkTXA.js","/assets/query-options-DZ4mp_BJ.js","/assets/receipt-print-BsWjxVp9.js","/assets/restaurant-website-IRv-TSWP.js","/assets/select-hYYA1xfw.js","/assets/settle-checks-BvFvcl9V.js","/assets/share-TEUfwi25.js","/assets/sheet-Bjn62Vfr.js","/assets/shop-billing-BRyP6yCJ.js","/assets/shop-credit-BUbd94WT.js","/assets/shop-workflows-CEWWEHT4.js","/assets/stock-display-Bw0mQIjk.js","/assets/supplier-payment-history-CfNZNJyA.js","/assets/switch-vsNsgnjz.js","/assets/sync-engine-BFqxx4ef.js","/assets/sync-push-Cx1lZOzl.js","/assets/sync-reconcile-Clnl_hjJ.js","/assets/sync-status-repair-BwjPpaYQ.js","/assets/sync-types-B187FdZc.js","/assets/ui-6lLAatlj.js","/assets/use-panel-resize-B6bm_p7U.js","/assets/use-settings-prefs-2_47X_kn.js","/assets/useOfflineStatus-B46Exllh.js","/assets/useReportView-9D7GlXYT.js","/assets/useSearchTracking-hwYfl-CP.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-date-FYRyL2wv.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js","/assets/voice-recognition-DMs16Fd1.js","/assets/voice-text-BkOdDDiw.js","/assets/whatsapp-delivery-CbLxVQSM.js","/assets/zod-DQDEOc6Z.js"];
const VERTICAL_ASSETS = {"clothing":["/assets/RentalsPage-u3vAF3JH.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-B73HzK4c.js","/assets/index-BEjh-wr3.css","/assets/index-C-jOBSyf.js","/assets/queries-CNtYDDRA.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-Cx1lZOzl.js","/assets/sync-reconcile-Clnl_hjJ.js","/assets/sync-status-repair-BwjPpaYQ.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-B6bm_p7U.js","/assets/useOfflineStatus-B46Exllh.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"footwear":["/assets/SizeRunsPage-CrwonXTX.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-B73HzK4c.js","/assets/index-BEjh-wr3.css","/assets/index-C-jOBSyf.js","/assets/sync-push-Cx1lZOzl.js","/assets/sync-reconcile-Clnl_hjJ.js","/assets/sync-status-repair-BwjPpaYQ.js","/assets/sync-types-B187FdZc.js","/assets/useOfflineStatus-B46Exllh.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"auto-parts":["/assets/FitmentPage-CHryW-x0.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-B73HzK4c.js","/assets/index-BEjh-wr3.css","/assets/index-C-jOBSyf.js","/assets/pending-cart-additions-DSLHPP0s.js","/assets/queries-CNtYDDRA.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-Cx1lZOzl.js","/assets/sync-reconcile-Clnl_hjJ.js","/assets/sync-status-repair-BwjPpaYQ.js","/assets/sync-types-B187FdZc.js","/assets/useOfflineStatus-B46Exllh.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"electronics":["/assets/ProductUnitsPage-DftanLiH.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-B73HzK4c.js","/assets/index-BEjh-wr3.css","/assets/index-C-jOBSyf.js","/assets/queries-CNtYDDRA.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-Cx1lZOzl.js","/assets/sync-reconcile-Clnl_hjJ.js","/assets/sync-status-repair-BwjPpaYQ.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-B6bm_p7U.js","/assets/useOfflineStatus-B46Exllh.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"pharmacy":["/assets/PrescriptionsPage-BWIS3V2D.js","/assets/api-BhbpSItX.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-B73HzK4c.js","/assets/index-BEjh-wr3.css","/assets/index-C-jOBSyf.js","/assets/queries-CNtYDDRA.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-Cx1lZOzl.js","/assets/sync-reconcile-Clnl_hjJ.js","/assets/sync-status-repair-BwjPpaYQ.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-B6bm_p7U.js","/assets/useOfflineStatus-B46Exllh.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"stationery-books":["/assets/BookListsPage-hLcJFti1.js","/assets/billing-calculations-BtOioO4I.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-B73HzK4c.js","/assets/index-BEjh-wr3.css","/assets/index-C-jOBSyf.js","/assets/open-bills-C-w0GUOe.js","/assets/queries-CNtYDDRA.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-Cx1lZOzl.js","/assets/sync-reconcile-Clnl_hjJ.js","/assets/sync-status-repair-BwjPpaYQ.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-B6bm_p7U.js","/assets/useOfflineStatus-B46Exllh.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"furniture-home":["/assets/FurnitureOrdersPage-DT4HSURh.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-B73HzK4c.js","/assets/index-BEjh-wr3.css","/assets/index-C-jOBSyf.js","/assets/queries-CNtYDDRA.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-Cx1lZOzl.js","/assets/sync-reconcile-Clnl_hjJ.js","/assets/sync-status-repair-BwjPpaYQ.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-B6bm_p7U.js","/assets/useOfflineStatus-B46Exllh.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"beauty-cosmetics":["/assets/TestersPage-DZekMOGh.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-B73HzK4c.js","/assets/index-BEjh-wr3.css","/assets/index-C-jOBSyf.js","/assets/queries-CNtYDDRA.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-Cx1lZOzl.js","/assets/sync-reconcile-Clnl_hjJ.js","/assets/sync-status-repair-BwjPpaYQ.js","/assets/sync-types-B187FdZc.js","/assets/useOfflineStatus-B46Exllh.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"restaurant":["/assets/ConfirmDialog-A3L-WJjx.js","/assets/GuestOrdersStrip-DxBg8zOc.js","/assets/KitchenPage-mtCjF5zS.js","/assets/KitchenStockPage-CsSc534F.js","/assets/MenuPage-Cfw6rxNF.js","/assets/PageHeader-D2DGy3Zc.js","/assets/QrCodeView-Usn2-sun.js","/assets/TablesPage-CqgDyG2S.js","/assets/alert-dialog-BtpX0sdc.js","/assets/api-CvNfNOhw.js","/assets/billing-calculations-BtOioO4I.js","/assets/chip-tones-cbbqDYQQ.js","/assets/index-BEjh-wr3.css","/assets/index-C-jOBSyf.js","/assets/index-DLkqWn8u.js","/assets/open-bills-C-w0GUOe.js","/assets/qr-encoder-O1M434ck.js","/assets/queries-BeWwa58r.js","/assets/queries-CNtYDDRA.js","/assets/query-options-DZ4mp_BJ.js","/assets/reservations-api-BiZ0twgF.js","/assets/restaurant-api-Dy89OHj0.js","/assets/restaurant-website-IRv-TSWP.js","/assets/switch-vsNsgnjz.js","/assets/table-store-F-MigJ1B.js","/assets/use-settings-prefs-2_47X_kn.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"manufacturing":["/assets/ManufacturingPage-D6vUbOqn.js","/assets/PageHeader-D2DGy3Zc.js","/assets/PageShell-B5SLX0v9.js","/assets/api-Cr5fC4aP.js","/assets/deferred-runtime-B73HzK4c.js","/assets/index-BEjh-wr3.css","/assets/index-C-jOBSyf.js","/assets/sync-push-Cx1lZOzl.js","/assets/sync-reconcile-Clnl_hjJ.js","/assets/sync-status-repair-BwjPpaYQ.js","/assets/sync-types-B187FdZc.js","/assets/useOfflineStatus-B46Exllh.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"]};
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
