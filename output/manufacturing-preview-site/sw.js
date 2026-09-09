/* Artha service worker: app-shell only. Business data stays in IndexedDB, not Cache Storage. */
const BUILD_ID = "20260909063123";
const CACHE_VERSION = `kiranaos-shell-v11-${BUILD_ID}`;
const NAVIGATION_NETWORK_TIMEOUT_MS = 3500;
const CORE_ASSETS = ["/assets/AdjustmentsPage-B-iefWF2.js","/assets/AdvancedSettingsPage-_1xmM7x9.js","/assets/AreaChart-C7eP-lva.js","/assets/AuditLogsPage-DEcyYn9s.js","/assets/BackgroundRuntime-DLxpU1Bh.js","/assets/BarChart-BVIId0mI.js","/assets/BillDetailPage-BiqWsX2G.js","/assets/BillingPage-Cr4Sd-9y.js","/assets/BillingSearch-DXM5lJLZ.js","/assets/BillingSettingsPage-BX6qa9gU.js","/assets/BillsPage-i7wTnacu.js","/assets/CartesianGrid-CqRpOb-n.js","/assets/CategoriesPage-BarpKFjf.js","/assets/ConfirmDialog-DYqPMFoS.js","/assets/CustomerDetailPage-BWJIwkTR.js","/assets/CustomersPage-CvS0T2nQ.js","/assets/DailyClosingPage-wIdGLTLK.js","/assets/DashboardPage-BYLUVrgo.js","/assets/DataTableCard-_tC8rpJ-.js","/assets/EmptyState-BSv00ksG.js","/assets/ErrorState-CgujA5RZ.js","/assets/ExpensesPage-DuYrWRZz.js","/assets/FinancialAggregationService-CDf7i0k7.js","/assets/ImportOrderPage-BVbqErOA.js","/assets/InventoryLotsPage-BzM5wppv.js","/assets/InventoryPage-Bx5amuJ7.js","/assets/LineChart-Cg2UqGym.js","/assets/LoadingSkeleton-B1LP8uDE.js","/assets/LocalDataUnavailable-DJZ1G-eZ.js","/assets/MerchantSetupPage-tlYRDHeR.js","/assets/ModulesSettingsPage-7EJWiHpY.js","/assets/MoneyStatementPage-DzwnAqQg.js","/assets/NearExpiryAlert-DDKSQjXS.js","/assets/NewReturnPage-CY6RmlCg.js","/assets/OffersPage-Ev1JtJc-.js","/assets/OfflineConfidenceMeter-BzmDiv5i.js","/assets/OrdersReceivedPage-B0K5TYEQ.js","/assets/PageHeader-CMTCsE17.js","/assets/PageShell-D-S2OWAF.js","/assets/PieChart-rY8dLQhz.js","/assets/PlanBadge-CcRnn-Hm.js","/assets/PrinterSettingsPage-Doiddcb9.js","/assets/ProductPricingPage-BtkCXX7A.js","/assets/ProductsPage-roIDxpjC.js","/assets/PurchaseBillsPage-BKNRdXQw.js","/assets/QrCodeView-Usn2-sun.js","/assets/RecoveryModePage-CS-PvaQh.js","/assets/RecycleBinPage-wO1s76rU.js","/assets/ReportsPage-DxmIzUPd.js","/assets/ReturnDialog-tMyQ3BaD.js","/assets/SalesOverviewPage-BVaaQHoZ.js","/assets/SearchInputWithIcon-HaE1XDpe.js","/assets/SecuritySettingsPage-SYsGjeih.js","/assets/SettingsPage-CRjxF_rC.js","/assets/SettingsShell-CBugTE3P.js","/assets/SmartToolsPage-Cp3mxA-Z.js","/assets/StaffPage-CgfTSx36.js","/assets/StaffSettingsPage-Bqoa0A_o.js","/assets/StatCard-Iy1nwPFv.js","/assets/StockCountsPage-CCIaQqPf.js","/assets/StockInPage-D0NAT1Sh.js","/assets/StockOutPage-1IMjoE14.js","/assets/StockStatusView-Cdn7jqeB.js","/assets/StockTransfersPage-CUhhrH19.js","/assets/StoreProfilePage-CoFyNux_.js","/assets/SubscriptionPage-DOoPBqm5.js","/assets/SuppliersPage-TwfNlKak.js","/assets/SyncBadge-DQ0lKhAU.js","/assets/SyncSettingsPage-C0PvGnjx.js","/assets/SyncStatusPage-EYYOiZB7.js","/assets/TaxesSettingsPage-CwL5nR8h.js","/assets/TradeFocusStrip-Bi24EFyg.js","/assets/VoiceDictationBar-6MJ0flwB.js","/assets/YAxis-BOBdLeNn.js","/assets/ai-client-C242r-8p.js","/assets/alert-dialog-CUWAWoZS.js","/assets/api-B8z3-EpJ.js","/assets/api-BcybwS1N.js","/assets/api-CTiQS4br.js","/assets/api-C_sVCu-A.js","/assets/api-ClJtZkMj.js","/assets/api-DAOt4WxI.js","/assets/api-DE9B2zxe.js","/assets/api-DqBgP7_X.js","/assets/api-OSMhuKuf.js","/assets/assistant-staging-BF5VzW4C.js","/assets/backend-transcription-Bo4ag6hc.js","/assets/billing-calculations-DK5e4L_4.js","/assets/billing-slots-YJ8csFzi.js","/assets/capabilities-Cw6z-NAs.js","/assets/cart-codec-CbubRRIW.js","/assets/category-store-DXD10XdE.js","/assets/checkbox-BMHkEDHU.js","/assets/chip-tones-cbbqDYQQ.js","/assets/cloud-hydration-oOoaiupV.js","/assets/deferred-runtime-DSBH9E_S.js","/assets/demo-shop-data-DGgCftLU.js","/assets/dropdown-menu-Cu0iVurs.js","/assets/escape-html-DInPSGdP.js","/assets/generateCategoricalChart-dq26NRqK.js","/assets/hooks-C1s7-DAI.js","/assets/index-B-026ryc.css","/assets/index-B7Jm7VZl.js","/assets/index-Ci-XYli4.js","/assets/index-CxWW_46C.js","/assets/index-DLkqWn8u.js","/assets/inventory-lots-api-BqGfcyEN.js","/assets/ledger-drift-repair-B3IK1jzL.js","/assets/local-actions-4U90yWOU.js","/assets/local-actions-BSoV0WO_.js","/assets/local-actions-BsRSuZKa.js","/assets/local-actions-CA4N3jj1.js","/assets/local-actions-DT7VS77J.js","/assets/local-actions-Dyt-HP5l.js","/assets/local-reporting-CEvAR_Rs.js","/assets/open-bills-DFhLTd_H.js","/assets/payment-mode-DJNE_WM0.js","/assets/pending-cart-additions-BS12AUwc.js","/assets/permissions-CqZ5DPS-.js","/assets/personalize-Cz4vV2EP.js","/assets/popover-DUxS65T8.js","/assets/pricing-rules-cache-D5dCzJ7T.js","/assets/print-ezTiIv2L.js","/assets/product-configurators-4cbwrayb.js","/assets/product-form-state-7mnAkm8q.js","/assets/product-import-csv-C4Bn-XDx.js","/assets/product-pricing-CHbZFNPU.js","/assets/product-voice-parser-DtrT4kiI.js","/assets/progress-LZztqwa4.js","/assets/purchase-orders-api-B1fXdFCw.js","/assets/qr-encoder-O1M434ck.js","/assets/queries-B7tyr0jT.js","/assets/queries-BFDQW0MI.js","/assets/queries-CA7hi50o.js","/assets/queries-CYGcYTMz.js","/assets/queries-Cc8GatVI.js","/assets/queries-Cm1QJwBl.js","/assets/query-options-DZ4mp_BJ.js","/assets/receipt-print-Bm1nm2MO.js","/assets/restaurant-website-IRv-TSWP.js","/assets/select-B96up5M4.js","/assets/settle-checks-BvFvcl9V.js","/assets/share-oCVuUOdG.js","/assets/sheet-K6864jr-.js","/assets/shop-billing-BkDbjTvZ.js","/assets/shop-credit-BUbd94WT.js","/assets/shop-workflows-Drz0SVU-.js","/assets/stock-display-Bw0mQIjk.js","/assets/supplier-payment-history-BgTCF1KG.js","/assets/switch-DWKEqFS-.js","/assets/sync-engine-fMru3tAT.js","/assets/sync-push-Dx95mRLP.js","/assets/sync-reconcile-CXUAdiJ7.js","/assets/sync-status-repair-D20_rW1P.js","/assets/sync-types-B187FdZc.js","/assets/ui-CU_2RWed.js","/assets/use-panel-resize-Ch5JhT6J.js","/assets/use-settings-prefs-8Hlsogn_.js","/assets/useOfflineStatus-B3wmUBBf.js","/assets/useReportView-DA5omrlt.js","/assets/useSearchTracking-CxhT1TMO.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-date-FYRyL2wv.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js","/assets/voice-recognition-DMs16Fd1.js","/assets/voice-text-BkOdDDiw.js","/assets/whatsapp-delivery-DJ7cVAOG.js","/assets/zod-DQDEOc6Z.js"];
const VERTICAL_ASSETS = {"clothing":["/assets/RentalsPage-DgdYxHZS.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-DSBH9E_S.js","/assets/index-B-026ryc.css","/assets/index-Ci-XYli4.js","/assets/queries-Cc8GatVI.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-Dx95mRLP.js","/assets/sync-reconcile-CXUAdiJ7.js","/assets/sync-status-repair-D20_rW1P.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-Ch5JhT6J.js","/assets/useOfflineStatus-B3wmUBBf.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"footwear":["/assets/SizeRunsPage-CgsCvr4t.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-DSBH9E_S.js","/assets/index-B-026ryc.css","/assets/index-Ci-XYli4.js","/assets/sync-push-Dx95mRLP.js","/assets/sync-reconcile-CXUAdiJ7.js","/assets/sync-status-repair-D20_rW1P.js","/assets/sync-types-B187FdZc.js","/assets/useOfflineStatus-B3wmUBBf.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"auto-parts":["/assets/FitmentPage-7umVbRMn.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-DSBH9E_S.js","/assets/index-B-026ryc.css","/assets/index-Ci-XYli4.js","/assets/pending-cart-additions-BS12AUwc.js","/assets/queries-Cc8GatVI.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-Dx95mRLP.js","/assets/sync-reconcile-CXUAdiJ7.js","/assets/sync-status-repair-D20_rW1P.js","/assets/sync-types-B187FdZc.js","/assets/useOfflineStatus-B3wmUBBf.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"electronics":["/assets/ProductUnitsPage-C8mgHFzD.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-DSBH9E_S.js","/assets/index-B-026ryc.css","/assets/index-Ci-XYli4.js","/assets/queries-Cc8GatVI.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-Dx95mRLP.js","/assets/sync-reconcile-CXUAdiJ7.js","/assets/sync-status-repair-D20_rW1P.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-Ch5JhT6J.js","/assets/useOfflineStatus-B3wmUBBf.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"pharmacy":["/assets/PrescriptionsPage-C6cCYbws.js","/assets/api-DdyFwYKQ.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-DSBH9E_S.js","/assets/index-B-026ryc.css","/assets/index-Ci-XYli4.js","/assets/queries-Cc8GatVI.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-Dx95mRLP.js","/assets/sync-reconcile-CXUAdiJ7.js","/assets/sync-status-repair-D20_rW1P.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-Ch5JhT6J.js","/assets/useOfflineStatus-B3wmUBBf.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"stationery-books":["/assets/BookListsPage-ul9oI48e.js","/assets/billing-calculations-DK5e4L_4.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-DSBH9E_S.js","/assets/index-B-026ryc.css","/assets/index-Ci-XYli4.js","/assets/open-bills-DFhLTd_H.js","/assets/queries-Cc8GatVI.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-Dx95mRLP.js","/assets/sync-reconcile-CXUAdiJ7.js","/assets/sync-status-repair-D20_rW1P.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-Ch5JhT6J.js","/assets/useOfflineStatus-B3wmUBBf.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"furniture-home":["/assets/FurnitureOrdersPage-ZULTUVLv.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-DSBH9E_S.js","/assets/index-B-026ryc.css","/assets/index-Ci-XYli4.js","/assets/queries-Cc8GatVI.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-Dx95mRLP.js","/assets/sync-reconcile-CXUAdiJ7.js","/assets/sync-status-repair-D20_rW1P.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-Ch5JhT6J.js","/assets/useOfflineStatus-B3wmUBBf.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"beauty-cosmetics":["/assets/TestersPage-D_fzFBba.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-DSBH9E_S.js","/assets/index-B-026ryc.css","/assets/index-Ci-XYli4.js","/assets/queries-Cc8GatVI.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-Dx95mRLP.js","/assets/sync-reconcile-CXUAdiJ7.js","/assets/sync-status-repair-D20_rW1P.js","/assets/sync-types-B187FdZc.js","/assets/useOfflineStatus-B3wmUBBf.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"restaurant":["/assets/ConfirmDialog-DYqPMFoS.js","/assets/GuestOrdersStrip-CXzGCjA6.js","/assets/KitchenPage-IxJkpgWX.js","/assets/KitchenStockPage-BF840nZZ.js","/assets/MenuPage-BzzXzPGC.js","/assets/PageHeader-CMTCsE17.js","/assets/QrCodeView-Usn2-sun.js","/assets/TablesPage-DfuuTymJ.js","/assets/alert-dialog-CUWAWoZS.js","/assets/api-B8z3-EpJ.js","/assets/billing-calculations-DK5e4L_4.js","/assets/chip-tones-cbbqDYQQ.js","/assets/index-B-026ryc.css","/assets/index-Ci-XYli4.js","/assets/index-DLkqWn8u.js","/assets/open-bills-DFhLTd_H.js","/assets/qr-encoder-O1M434ck.js","/assets/queries-Cc8GatVI.js","/assets/queries-Cm1QJwBl.js","/assets/query-options-DZ4mp_BJ.js","/assets/reservations-api-DycrHRcd.js","/assets/restaurant-api-CEiv6p7D.js","/assets/restaurant-website-IRv-TSWP.js","/assets/switch-DWKEqFS-.js","/assets/table-store-x10ow0jm.js","/assets/use-settings-prefs-8Hlsogn_.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"]};
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
