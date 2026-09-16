/* Artha service worker: app-shell only. Business data stays in IndexedDB, not Cache Storage. */
const BUILD_ID = "20260914165924";
const CACHE_VERSION = `kiranaos-shell-v11-${BUILD_ID}`;
const NAVIGATION_NETWORK_TIMEOUT_MS = 3500;
const CORE_ASSETS = ["/assets/AdjustmentsPage-CJg4Fk_-.js","/assets/AdvancedSettingsPage--3PgeY86.js","/assets/AreaChart-pLH9iHDC.js","/assets/AuditLogsPage-Cz_VLNVI.js","/assets/BackgroundRuntime-Ccik0TO3.js","/assets/BarChart-CTQlwIjX.js","/assets/BillDetailPage-BkoqxdHf.js","/assets/BillingPage-Bd4P7ilw.js","/assets/BillingSearch-Dm2FhXaE.js","/assets/BillingSettingsPage-DizsUnBd.js","/assets/BillsPage-Bp2PEYDD.js","/assets/CartesianGrid-Dw2yWain.js","/assets/CategoriesPage-JoKifEhl.js","/assets/ConfirmDialog-B_fdBbEe.js","/assets/CustomerDetailPage-hX13upY9.js","/assets/CustomersPage-xWxTVpgb.js","/assets/DailyClosingPage-Cq0FeqLh.js","/assets/DashboardPage-CC3zX3MD.js","/assets/DataTableCard-DqHhFGYx.js","/assets/EmptyState-SxQX-KnB.js","/assets/ErrorState-DGzbSv0J.js","/assets/ExpensesPage-DYcviIuB.js","/assets/FinancialAggregationService-CI7A5Qwq.js","/assets/ImportOrderPage-Dsoe8gYY.js","/assets/InventoryLotsPage-BvDAI3SF.js","/assets/InventoryPage-C17myQnJ.js","/assets/LineChart-ov-IxUmZ.js","/assets/LoadingSkeleton-CHWkn1gf.js","/assets/LocalDataUnavailable-C9sT0kzE.js","/assets/MerchantSetupPage-C-9lsYTA.js","/assets/ModulesSettingsPage-BkYwM74d.js","/assets/MoneyStatementPage-7XfD4XCP.js","/assets/NearExpiryAlert-BGYG1Ivn.js","/assets/NewReturnPage-DtbpOAQs.js","/assets/OffersPage-CKbRvW_a.js","/assets/OfflineConfidenceMeter-Dd5pe8zG.js","/assets/OrdersReceivedPage-DFUOyTlK.js","/assets/PageHeader-CHcacbNa.js","/assets/PageShell-B93D6gwY.js","/assets/PieChart-BbL8gvYr.js","/assets/PlanBadge-C4T7gx0g.js","/assets/PrinterSettingsPage-Brz3SYUO.js","/assets/ProductPricingPage-D3c77CUt.js","/assets/ProductsPage-DllSsqwU.js","/assets/PurchaseBillsPage-DF6j68D9.js","/assets/QrCodeView-Usn2-sun.js","/assets/RecoveryModePage-B5Lp6zfW.js","/assets/RecycleBinPage-CTGAt8-g.js","/assets/ReportsPage-BdvzEFGt.js","/assets/ReturnDialog-DRqa-P4i.js","/assets/SalesOverviewPage-Ds2uI4hx.js","/assets/SearchInputWithIcon-Bzd4TFiU.js","/assets/SecuritySettingsPage-DaTqm5V8.js","/assets/SettingsPage-D7yVXSyb.js","/assets/SettingsShell-HQpg_NOW.js","/assets/SmartToolsPage-BHWFzRTX.js","/assets/StaffPage-DbvkLrdc.js","/assets/StaffSettingsPage-CTsYn91c.js","/assets/StatCard-zbf1GQMX.js","/assets/StockCountsPage-D2biWn1A.js","/assets/StockInPage-DWcs_-Ge.js","/assets/StockOutPage-MehHb8E1.js","/assets/StockStatusView-B_57-Di-.js","/assets/StockTransfersPage-Cd5kwQUa.js","/assets/StoreProfilePage-04GJuNJ5.js","/assets/SubscriptionPage-Dd-oppoT.js","/assets/SuppliersPage-D9JUxLfv.js","/assets/SyncBadge-DpcAb7j7.js","/assets/SyncSettingsPage-CQC8jYCB.js","/assets/SyncStatusPage-lz7qOWyP.js","/assets/TaxesSettingsPage-DkbA1uPp.js","/assets/TradeFocusStrip-CT2UNJnF.js","/assets/VoiceDictationBar-uaW0Pd43.js","/assets/YAxis-CsWnqVF-.js","/assets/ai-client-DmV_zfXs.js","/assets/alert-dialog-BneCFLEc.js","/assets/api-981MY5Is.js","/assets/api-BExk57IL.js","/assets/api-BbBXyYjG.js","/assets/api-C-zcTNDB.js","/assets/api-CG5gsx-6.js","/assets/api-COznR6RY.js","/assets/api-CuSwAIPz.js","/assets/api-D53RqE9P.js","/assets/api-DqBgP7_X.js","/assets/api-tJx6sDZA.js","/assets/assistant-staging-lMPY3W24.js","/assets/backend-transcription-oj2CaSck.js","/assets/billing-calculations-BWWTW_eu.js","/assets/billing-slots-YJ8csFzi.js","/assets/capabilities-Msa3cMFa.js","/assets/cart-codec-CbubRRIW.js","/assets/category-store-mpIrfZ_8.js","/assets/checkbox-oFmRAfY9.js","/assets/chip-tones-cbbqDYQQ.js","/assets/cloud-hydration-CsdvLLFt.js","/assets/deferred-runtime-CwpqeTWz.js","/assets/demo-shop-data-BzzXJ6vH.js","/assets/dropdown-menu-DYV5Wp7Z.js","/assets/escape-html-DInPSGdP.js","/assets/generateCategoricalChart-CPZs_sEu.js","/assets/hooks-DiDfuFbS.js","/assets/index-1NyO63cV.js","/assets/index-BEjh-wr3.css","/assets/index-CZBG2xBJ.js","/assets/index-CxWW_46C.js","/assets/index-DLkqWn8u.js","/assets/inventory-lots-api-C2Me_Z1F.js","/assets/ledger-drift-repair-CAIVON4B.js","/assets/local-actions-BROrVn6T.js","/assets/local-actions-D2cvALNf.js","/assets/local-actions-DI92CuCf.js","/assets/local-actions-DRzWVK2c.js","/assets/local-actions-G41xny97.js","/assets/local-actions-d37e_sku.js","/assets/local-reporting-sQAoDeeD.js","/assets/open-bills-BoVwFY_p.js","/assets/payment-mode-DJNE_WM0.js","/assets/pending-cart-additions-DmNQ239z.js","/assets/permissions-9yxIK_lt.js","/assets/personalize-Cz4vV2EP.js","/assets/popover-xQ1XxhW4.js","/assets/pricing-rules-cache-BddeTdUR.js","/assets/print-DKa_f8Ta.js","/assets/product-configurators-4cbwrayb.js","/assets/product-form-state-CND-rRyJ.js","/assets/product-import-csv-DmfEMM7D.js","/assets/product-pricing-CCf7UvPi.js","/assets/product-voice-parser-DxQrYUnh.js","/assets/progress-DNUZ0xc_.js","/assets/purchase-orders-api-8RPlXsMw.js","/assets/qr-encoder-O1M434ck.js","/assets/queries-BEbAVIWL.js","/assets/queries-BeBoMMx0.js","/assets/queries-CI1DFos2.js","/assets/queries-CL5xTLAh.js","/assets/queries-Dxk-o3JO.js","/assets/queries-lO8n6PcV.js","/assets/query-options-DZ4mp_BJ.js","/assets/receipt-print-BudDcsxU.js","/assets/restaurant-website-IRv-TSWP.js","/assets/select-DocAxaed.js","/assets/settle-checks-BvFvcl9V.js","/assets/share-BA-k-vWp.js","/assets/sheet-BCekms_o.js","/assets/shop-billing-BEgF4TTB.js","/assets/shop-credit-BUbd94WT.js","/assets/shop-workflows-CEWWEHT4.js","/assets/stock-display-Bw0mQIjk.js","/assets/supplier-payment-history-tZoeZF4Y.js","/assets/switch-rbX9YkAm.js","/assets/sync-engine-B_eiwhW6.js","/assets/sync-push-D1aFKy6H.js","/assets/sync-reconcile-B0FuQ3dz.js","/assets/sync-status-repair-BB_LprWC.js","/assets/sync-types-B187FdZc.js","/assets/ui-C9ed1kNY.js","/assets/use-panel-resize-Dy2DYHnm.js","/assets/use-settings-prefs-BG9cwniN.js","/assets/useOfflineStatus-CEHdBUXK.js","/assets/useReportView-hyxDrHPY.js","/assets/useSearchTracking-CCJZ9Uai.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-date-FYRyL2wv.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js","/assets/voice-recognition-DMs16Fd1.js","/assets/voice-text-BkOdDDiw.js","/assets/whatsapp-delivery-DhY2MfEy.js","/assets/zod-DQDEOc6Z.js"];
const VERTICAL_ASSETS = {"clothing":["/assets/RentalsPage-D0taNfrE.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-CwpqeTWz.js","/assets/index-1NyO63cV.js","/assets/index-BEjh-wr3.css","/assets/queries-Dxk-o3JO.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-D1aFKy6H.js","/assets/sync-reconcile-B0FuQ3dz.js","/assets/sync-status-repair-BB_LprWC.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-Dy2DYHnm.js","/assets/useOfflineStatus-CEHdBUXK.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"footwear":["/assets/SizeRunsPage-Do5co19f.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-CwpqeTWz.js","/assets/index-1NyO63cV.js","/assets/index-BEjh-wr3.css","/assets/sync-push-D1aFKy6H.js","/assets/sync-reconcile-B0FuQ3dz.js","/assets/sync-status-repair-BB_LprWC.js","/assets/sync-types-B187FdZc.js","/assets/useOfflineStatus-CEHdBUXK.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"auto-parts":["/assets/FitmentPage-BajeB7AA.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-CwpqeTWz.js","/assets/index-1NyO63cV.js","/assets/index-BEjh-wr3.css","/assets/pending-cart-additions-DmNQ239z.js","/assets/queries-Dxk-o3JO.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-D1aFKy6H.js","/assets/sync-reconcile-B0FuQ3dz.js","/assets/sync-status-repair-BB_LprWC.js","/assets/sync-types-B187FdZc.js","/assets/useOfflineStatus-CEHdBUXK.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"electronics":["/assets/ProductUnitsPage-CxG4FMx6.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-CwpqeTWz.js","/assets/index-1NyO63cV.js","/assets/index-BEjh-wr3.css","/assets/queries-Dxk-o3JO.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-D1aFKy6H.js","/assets/sync-reconcile-B0FuQ3dz.js","/assets/sync-status-repair-BB_LprWC.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-Dy2DYHnm.js","/assets/useOfflineStatus-CEHdBUXK.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"pharmacy":["/assets/PrescriptionsPage-DYmi6GuI.js","/assets/api-BiRVVmRn.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-CwpqeTWz.js","/assets/index-1NyO63cV.js","/assets/index-BEjh-wr3.css","/assets/queries-Dxk-o3JO.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-D1aFKy6H.js","/assets/sync-reconcile-B0FuQ3dz.js","/assets/sync-status-repair-BB_LprWC.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-Dy2DYHnm.js","/assets/useOfflineStatus-CEHdBUXK.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"stationery-books":["/assets/BookListsPage-Bvlqjt5S.js","/assets/billing-calculations-BWWTW_eu.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-CwpqeTWz.js","/assets/index-1NyO63cV.js","/assets/index-BEjh-wr3.css","/assets/open-bills-BoVwFY_p.js","/assets/queries-Dxk-o3JO.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-D1aFKy6H.js","/assets/sync-reconcile-B0FuQ3dz.js","/assets/sync-status-repair-BB_LprWC.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-Dy2DYHnm.js","/assets/useOfflineStatus-CEHdBUXK.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"furniture-home":["/assets/FurnitureOrdersPage-BkdJBnlf.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-CwpqeTWz.js","/assets/index-1NyO63cV.js","/assets/index-BEjh-wr3.css","/assets/queries-Dxk-o3JO.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-D1aFKy6H.js","/assets/sync-reconcile-B0FuQ3dz.js","/assets/sync-status-repair-BB_LprWC.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-Dy2DYHnm.js","/assets/useOfflineStatus-CEHdBUXK.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"beauty-cosmetics":["/assets/TestersPage-CXWFDhs1.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-CwpqeTWz.js","/assets/index-1NyO63cV.js","/assets/index-BEjh-wr3.css","/assets/queries-Dxk-o3JO.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-D1aFKy6H.js","/assets/sync-reconcile-B0FuQ3dz.js","/assets/sync-status-repair-BB_LprWC.js","/assets/sync-types-B187FdZc.js","/assets/useOfflineStatus-CEHdBUXK.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"restaurant":["/assets/ConfirmDialog-B_fdBbEe.js","/assets/GuestOrdersStrip-ZErMlVKz.js","/assets/KitchenPage-BhQJoOW-.js","/assets/KitchenStockPage-BVmgrz97.js","/assets/MenuPage-CjM-Dpov.js","/assets/PageHeader-CHcacbNa.js","/assets/QrCodeView-Usn2-sun.js","/assets/TablesPage-B3x64FSI.js","/assets/alert-dialog-BneCFLEc.js","/assets/api-D53RqE9P.js","/assets/billing-calculations-BWWTW_eu.js","/assets/chip-tones-cbbqDYQQ.js","/assets/index-1NyO63cV.js","/assets/index-BEjh-wr3.css","/assets/index-DLkqWn8u.js","/assets/open-bills-BoVwFY_p.js","/assets/qr-encoder-O1M434ck.js","/assets/queries-CI1DFos2.js","/assets/queries-Dxk-o3JO.js","/assets/query-options-DZ4mp_BJ.js","/assets/reservations-api-BzICmEnT.js","/assets/restaurant-api-C6CFUWwc.js","/assets/restaurant-website-IRv-TSWP.js","/assets/switch-rbX9YkAm.js","/assets/table-store-Ci6vh76J.js","/assets/use-settings-prefs-BG9cwniN.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"manufacturing":["/assets/ManufacturingPage-Be5q8EIo.js","/assets/PageHeader-CHcacbNa.js","/assets/PageShell-B93D6gwY.js","/assets/api-BExk57IL.js","/assets/deferred-runtime-CwpqeTWz.js","/assets/index-1NyO63cV.js","/assets/index-BEjh-wr3.css","/assets/sync-push-D1aFKy6H.js","/assets/sync-reconcile-B0FuQ3dz.js","/assets/sync-status-repair-BB_LprWC.js","/assets/sync-types-B187FdZc.js","/assets/useOfflineStatus-CEHdBUXK.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"]};
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
