/* Artha service worker: app-shell only. Business data stays in IndexedDB, not Cache Storage. */
const BUILD_ID = "20260909192127";
const CACHE_VERSION = `kiranaos-shell-v11-${BUILD_ID}`;
const NAVIGATION_NETWORK_TIMEOUT_MS = 3500;
const CORE_ASSETS = ["/assets/AdjustmentsPage-CDzQJstF.js","/assets/AdvancedSettingsPage-BCO6rKvt.js","/assets/AreaChart-BtmSJWUC.js","/assets/AuditLogsPage-D6-PoxdQ.js","/assets/BackgroundRuntime-3eLCfXc1.js","/assets/BarChart-DcFV90yt.js","/assets/BillDetailPage-BkFrt_-R.js","/assets/BillingPage-BP-WPDeq.js","/assets/BillingSearch-Bu7fVUX_.js","/assets/BillingSettingsPage-B4UZfHgH.js","/assets/BillsPage-DY8uehW4.js","/assets/CartesianGrid-CAyhCSKx.js","/assets/CategoriesPage-BtnX1_tM.js","/assets/ConfirmDialog-CvB0EHi8.js","/assets/CustomerDetailPage-UG43cot0.js","/assets/CustomersPage-fbCQHjej.js","/assets/DailyClosingPage-7fVwaCtQ.js","/assets/DashboardPage-B7zoWIBE.js","/assets/DataTableCard-BpZJGoKc.js","/assets/EmptyState-Ci7HAvXh.js","/assets/ErrorState-Bc3dA8Yt.js","/assets/ExpensesPage-BhlQBQ-s.js","/assets/FinancialAggregationService-CfM20cIE.js","/assets/ImportOrderPage-COR7DpRj.js","/assets/InventoryLotsPage-BNiIKDpm.js","/assets/InventoryPage-D6ae7aPK.js","/assets/LineChart-BlPmOQeY.js","/assets/LoadingSkeleton-BFxJwHW1.js","/assets/LocalDataUnavailable-D5ekh28v.js","/assets/MerchantSetupPage-D_hiIhXN.js","/assets/ModulesSettingsPage-BvKbnsPJ.js","/assets/MoneyStatementPage-M10r3PCO.js","/assets/NearExpiryAlert-CH7-tYBC.js","/assets/NewReturnPage-BSJvp-sT.js","/assets/OffersPage-BrW4ROLb.js","/assets/OfflineConfidenceMeter-CHT_pkM9.js","/assets/OrdersReceivedPage-70hCvYQW.js","/assets/PageHeader-CT_qCMTe.js","/assets/PageShell-BuInXBSU.js","/assets/PieChart-ogSie1Lw.js","/assets/PlanBadge-D9awVGLq.js","/assets/PrinterSettingsPage-DFJCibAT.js","/assets/ProductPricingPage-DoyAVwgt.js","/assets/ProductsPage-7GVWiTxU.js","/assets/PurchaseBillsPage-CN1dycCM.js","/assets/QrCodeView-Usn2-sun.js","/assets/RecoveryModePage-COHbw0Lt.js","/assets/RecycleBinPage-DsJcGS7D.js","/assets/ReportsPage-HSfRA-ZV.js","/assets/ReturnDialog-DqyGWNx6.js","/assets/SalesOverviewPage-CiI2vFXF.js","/assets/SearchInputWithIcon-Dx9sxCsa.js","/assets/SecuritySettingsPage-C9wVqtGy.js","/assets/SettingsPage-ZASJ2VOr.js","/assets/SettingsShell-BDkDNdGF.js","/assets/SmartToolsPage-D6YfVtG5.js","/assets/StaffPage-DaOV-ic6.js","/assets/StaffSettingsPage-D6uIbaNc.js","/assets/StatCard-Bx8wx-5q.js","/assets/StockCountsPage-BTwXhnqn.js","/assets/StockInPage-DgkV2MCI.js","/assets/StockOutPage-p4ws45gj.js","/assets/StockStatusView-Ctyv8GQ4.js","/assets/StockTransfersPage-el8NjpcM.js","/assets/StoreProfilePage-DYayw00-.js","/assets/SubscriptionPage-CWor3OYA.js","/assets/SuppliersPage-DoNdvtZm.js","/assets/SyncBadge-1wbstvm5.js","/assets/SyncSettingsPage-HuBlaXyb.js","/assets/SyncStatusPage-DQdMy5Wa.js","/assets/TaxesSettingsPage-Ce9UCnvF.js","/assets/TradeFocusStrip-D9W7TvoP.js","/assets/VoiceDictationBar-uaW0Pd43.js","/assets/YAxis-DZyHdcxk.js","/assets/ai-client-DV1bqC9z.js","/assets/alert-dialog-D_k6xZEk.js","/assets/api-Bo0oKdbL.js","/assets/api-CBSzySw4.js","/assets/api-CBwaPDBi.js","/assets/api-CH2tSpxP.js","/assets/api-D9how7t-.js","/assets/api-DEZvhm6g.js","/assets/api-Dh6UumHX.js","/assets/api-DqBgP7_X.js","/assets/api-Ds3IPs_8.js","/assets/api-YTU_-Nm3.js","/assets/assistant-staging-Bnaf4iri.js","/assets/backend-transcription-DEHRTUA1.js","/assets/billing-calculations-DbfnqEn3.js","/assets/billing-slots-YJ8csFzi.js","/assets/capabilities-DwC6V7Rz.js","/assets/cart-codec-CbubRRIW.js","/assets/category-store-BtYFKaJ-.js","/assets/checkbox-CcLs3Vwh.js","/assets/chip-tones-cbbqDYQQ.js","/assets/cloud-hydration-c9ELc8tY.js","/assets/deferred-runtime-DF2u_c1Y.js","/assets/demo-shop-data-BMUW0rmV.js","/assets/dropdown-menu-D5JvSaS7.js","/assets/escape-html-DInPSGdP.js","/assets/generateCategoricalChart-XCnZf7y-.js","/assets/hooks-OsI2t4yE.js","/assets/index-C-nn0uN8.css","/assets/index-CxWW_46C.js","/assets/index-DLkqWn8u.js","/assets/index-DbQMpL2c.js","/assets/index-DjQ2Vtyg.js","/assets/inventory-lots-api-CVj3kOF9.js","/assets/ledger-drift-repair-uks5EUlp.js","/assets/local-actions-B8pGcPGV.js","/assets/local-actions-BSjItSrk.js","/assets/local-actions-CJ-07oHE.js","/assets/local-actions-D9CQI-iL.js","/assets/local-actions-DCOss42d.js","/assets/local-actions-DkPvU9hk.js","/assets/local-reporting-D8H1NxyC.js","/assets/open-bills-Jn_xogou.js","/assets/payment-mode-DJNE_WM0.js","/assets/pending-cart-additions-B4_nDCiQ.js","/assets/permissions-BkYvSLiU.js","/assets/personalize-Cz4vV2EP.js","/assets/popover-cBxpWYSQ.js","/assets/pricing-rules-cache-CWMGLaEL.js","/assets/print-BGSj-1kK.js","/assets/product-configurators-4cbwrayb.js","/assets/product-form-state-UDUP08Fo.js","/assets/product-import-csv-Dlyrithl.js","/assets/product-pricing-bHKGCLNQ.js","/assets/product-voice-parser-DxQrYUnh.js","/assets/progress-BMKi7jQH.js","/assets/purchase-orders-api-C1VYFKZW.js","/assets/qr-encoder-O1M434ck.js","/assets/queries-4FZ7Oi9b.js","/assets/queries-CR_wRgw0.js","/assets/queries-D2nHoYcu.js","/assets/queries-DBHfLaOq.js","/assets/queries-D_bOCIYL.js","/assets/queries-ZEK2KQ7v.js","/assets/query-options-DZ4mp_BJ.js","/assets/receipt-print-DIgGlmt2.js","/assets/restaurant-website-IRv-TSWP.js","/assets/select-BLdawrX0.js","/assets/settle-checks-BvFvcl9V.js","/assets/share-hyW23T0m.js","/assets/sheet-6L_p7Cw7.js","/assets/shop-billing-fIT5qc09.js","/assets/shop-credit-BUbd94WT.js","/assets/shop-workflows-Drz0SVU-.js","/assets/stock-display-Bw0mQIjk.js","/assets/supplier-payment-history-BgPeCZ6X.js","/assets/switch-C5VNVCik.js","/assets/sync-engine-DYGstg73.js","/assets/sync-push-iPGo0vIO.js","/assets/sync-reconcile-MR5x3Lmq.js","/assets/sync-status-repair-CiPZ0ujK.js","/assets/sync-types-B187FdZc.js","/assets/ui-jkfgl_d5.js","/assets/use-panel-resize-DbaGe6rS.js","/assets/use-settings-prefs-CKRZRQuB.js","/assets/useOfflineStatus-BmqYJfs_.js","/assets/useReportView-C9Tnkaj7.js","/assets/useSearchTracking-CjYJ2AbD.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-date-FYRyL2wv.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js","/assets/voice-recognition-DMs16Fd1.js","/assets/voice-text-BkOdDDiw.js","/assets/whatsapp-delivery-NEgbnNJX.js","/assets/zod-DQDEOc6Z.js"];
const VERTICAL_ASSETS = {"clothing":["/assets/RentalsPage-BhrtDv5t.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-DF2u_c1Y.js","/assets/index-C-nn0uN8.css","/assets/index-DbQMpL2c.js","/assets/queries-ZEK2KQ7v.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-iPGo0vIO.js","/assets/sync-reconcile-MR5x3Lmq.js","/assets/sync-status-repair-CiPZ0ujK.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-DbaGe6rS.js","/assets/useOfflineStatus-BmqYJfs_.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"footwear":["/assets/SizeRunsPage-CcItNB5q.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-DF2u_c1Y.js","/assets/index-C-nn0uN8.css","/assets/index-DbQMpL2c.js","/assets/sync-push-iPGo0vIO.js","/assets/sync-reconcile-MR5x3Lmq.js","/assets/sync-status-repair-CiPZ0ujK.js","/assets/sync-types-B187FdZc.js","/assets/useOfflineStatus-BmqYJfs_.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"auto-parts":["/assets/FitmentPage-BjucslKu.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-DF2u_c1Y.js","/assets/index-C-nn0uN8.css","/assets/index-DbQMpL2c.js","/assets/pending-cart-additions-B4_nDCiQ.js","/assets/queries-ZEK2KQ7v.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-iPGo0vIO.js","/assets/sync-reconcile-MR5x3Lmq.js","/assets/sync-status-repair-CiPZ0ujK.js","/assets/sync-types-B187FdZc.js","/assets/useOfflineStatus-BmqYJfs_.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"electronics":["/assets/ProductUnitsPage-Cw57h96w.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-DF2u_c1Y.js","/assets/index-C-nn0uN8.css","/assets/index-DbQMpL2c.js","/assets/queries-ZEK2KQ7v.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-iPGo0vIO.js","/assets/sync-reconcile-MR5x3Lmq.js","/assets/sync-status-repair-CiPZ0ujK.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-DbaGe6rS.js","/assets/useOfflineStatus-BmqYJfs_.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"pharmacy":["/assets/PrescriptionsPage-lMtiCj3g.js","/assets/api-BOfGAuMM.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-DF2u_c1Y.js","/assets/index-C-nn0uN8.css","/assets/index-DbQMpL2c.js","/assets/queries-ZEK2KQ7v.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-iPGo0vIO.js","/assets/sync-reconcile-MR5x3Lmq.js","/assets/sync-status-repair-CiPZ0ujK.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-DbaGe6rS.js","/assets/useOfflineStatus-BmqYJfs_.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"stationery-books":["/assets/BookListsPage-CL50booT.js","/assets/billing-calculations-DbfnqEn3.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-DF2u_c1Y.js","/assets/index-C-nn0uN8.css","/assets/index-DbQMpL2c.js","/assets/open-bills-Jn_xogou.js","/assets/queries-ZEK2KQ7v.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-iPGo0vIO.js","/assets/sync-reconcile-MR5x3Lmq.js","/assets/sync-status-repair-CiPZ0ujK.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-DbaGe6rS.js","/assets/useOfflineStatus-BmqYJfs_.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"furniture-home":["/assets/FurnitureOrdersPage-BbeQ7T5z.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-DF2u_c1Y.js","/assets/index-C-nn0uN8.css","/assets/index-DbQMpL2c.js","/assets/queries-ZEK2KQ7v.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-iPGo0vIO.js","/assets/sync-reconcile-MR5x3Lmq.js","/assets/sync-status-repair-CiPZ0ujK.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-DbaGe6rS.js","/assets/useOfflineStatus-BmqYJfs_.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"beauty-cosmetics":["/assets/TestersPage-BIxhU9uh.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-DF2u_c1Y.js","/assets/index-C-nn0uN8.css","/assets/index-DbQMpL2c.js","/assets/queries-ZEK2KQ7v.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-iPGo0vIO.js","/assets/sync-reconcile-MR5x3Lmq.js","/assets/sync-status-repair-CiPZ0ujK.js","/assets/sync-types-B187FdZc.js","/assets/useOfflineStatus-BmqYJfs_.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"restaurant":["/assets/ConfirmDialog-CvB0EHi8.js","/assets/GuestOrdersStrip-DUvpaHDx.js","/assets/KitchenPage-C_u2pZUr.js","/assets/KitchenStockPage-CwaRLFCW.js","/assets/MenuPage-DgyKX-IE.js","/assets/PageHeader-CT_qCMTe.js","/assets/QrCodeView-Usn2-sun.js","/assets/TablesPage-BiFtBrGa.js","/assets/alert-dialog-D_k6xZEk.js","/assets/api-Bo0oKdbL.js","/assets/billing-calculations-DbfnqEn3.js","/assets/chip-tones-cbbqDYQQ.js","/assets/index-C-nn0uN8.css","/assets/index-DLkqWn8u.js","/assets/index-DbQMpL2c.js","/assets/open-bills-Jn_xogou.js","/assets/qr-encoder-O1M434ck.js","/assets/queries-D_bOCIYL.js","/assets/queries-ZEK2KQ7v.js","/assets/query-options-DZ4mp_BJ.js","/assets/reservations-api-BJIzNBxg.js","/assets/restaurant-api-B8oIU1ZM.js","/assets/restaurant-website-IRv-TSWP.js","/assets/switch-C5VNVCik.js","/assets/table-store-DcXUw2Ue.js","/assets/use-settings-prefs-CKRZRQuB.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"]};
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
