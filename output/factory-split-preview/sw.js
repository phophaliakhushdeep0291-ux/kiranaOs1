/* Artha service worker: app-shell only. Business data stays in IndexedDB, not Cache Storage. */
const BUILD_ID = "20260909120545";
const CACHE_VERSION = `kiranaos-shell-v11-${BUILD_ID}`;
const NAVIGATION_NETWORK_TIMEOUT_MS = 3500;
const CORE_ASSETS = ["/assets/AdjustmentsPage-a3EOo3HR.js","/assets/AdvancedSettingsPage-B2Hb10Ug.js","/assets/AreaChart-BDLHqYzm.js","/assets/AuditLogsPage-BXOk6LSB.js","/assets/BackgroundRuntime-Wp1Wksdn.js","/assets/BarChart-BHl33CVB.js","/assets/BillDetailPage-CnTTYHAk.js","/assets/BillingPage-DwPX5tJW.js","/assets/BillingSearch-Dkm7CkkB.js","/assets/BillingSettingsPage-BcABaup6.js","/assets/BillsPage-DvKG0A4U.js","/assets/CartesianGrid-BkcAFFud.js","/assets/CategoriesPage-OK9snBrO.js","/assets/ConfirmDialog-CyxipWqc.js","/assets/CustomerDetailPage-CTY1IfQe.js","/assets/CustomersPage-DROCnmcq.js","/assets/DailyClosingPage-Bg6Tfifi.js","/assets/DashboardPage-Dl0E8l-k.js","/assets/DataTableCard-BWL9XSbp.js","/assets/EmptyState-uXn2c933.js","/assets/ErrorState-Bzh3KmfI.js","/assets/ExpensesPage-CWCdBazK.js","/assets/FinancialAggregationService-Dgjonjph.js","/assets/ImportOrderPage-CfYueVR-.js","/assets/InventoryLotsPage-CUpur90R.js","/assets/InventoryPage-M2Vkr4UQ.js","/assets/LineChart-ctaeZGbs.js","/assets/LoadingSkeleton-Do0g-mGG.js","/assets/LocalDataUnavailable-Dw9K3ygl.js","/assets/MerchantSetupPage-C_LhbfyR.js","/assets/ModulesSettingsPage-YFd8EBS5.js","/assets/MoneyStatementPage-28fIiM2b.js","/assets/NearExpiryAlert-1L1Fo7Yd.js","/assets/NewReturnPage-BO9SI2zR.js","/assets/OffersPage-BYNcUgFU.js","/assets/OfflineConfidenceMeter-C3YZ0DV4.js","/assets/OrdersReceivedPage-Dmfff5oS.js","/assets/PageHeader-22NbdwY0.js","/assets/PageShell-BSlakLWy.js","/assets/PieChart-BXTPGvRq.js","/assets/PlanBadge-BGtYnMq1.js","/assets/PrinterSettingsPage-BPETbH7x.js","/assets/ProductPricingPage-CaOQEAbn.js","/assets/ProductsPage-BZdq9cAi.js","/assets/PurchaseBillsPage-DINUxIOF.js","/assets/QrCodeView-Usn2-sun.js","/assets/RecoveryModePage-Dc_qr6F6.js","/assets/RecycleBinPage-BQWmROZy.js","/assets/ReportsPage-Br3is-hJ.js","/assets/ReturnDialog-CHsbhbM3.js","/assets/SalesOverviewPage-DjnpuJbI.js","/assets/SearchInputWithIcon-B-cvO7-B.js","/assets/SecuritySettingsPage-CLsXlOQB.js","/assets/SettingsPage-D2jNKjYs.js","/assets/SettingsShell-Dj5l6kSk.js","/assets/SmartToolsPage-B70FScLA.js","/assets/StaffPage-DoaPpfdM.js","/assets/StaffSettingsPage-CIuDBzxc.js","/assets/StatCard-C1r_wYHF.js","/assets/StockCountsPage-C7SbjF_P.js","/assets/StockInPage-BasO1G_L.js","/assets/StockOutPage-CAlkRC5M.js","/assets/StockStatusView-BXbp7Gbt.js","/assets/StockTransfersPage-C451EvzY.js","/assets/StoreProfilePage-HdbMBBtP.js","/assets/SubscriptionPage-zcmcjvRv.js","/assets/SuppliersPage-B32hjwI5.js","/assets/SyncBadge-SuPy4zdD.js","/assets/SyncSettingsPage-egM4QYyR.js","/assets/SyncStatusPage-qbG4QiXx.js","/assets/TaxesSettingsPage-CGdLx61h.js","/assets/TradeFocusStrip-CfMUhrK_.js","/assets/VoiceDictationBar-6MJ0flwB.js","/assets/YAxis-DF6uUdWK.js","/assets/ai-client-suqiLr7C.js","/assets/alert-dialog-ZYNVKodt.js","/assets/api-B8XKRWO2.js","/assets/api-C0C6WOpZ.js","/assets/api-C7P5BX87.js","/assets/api-CsIGPyTb.js","/assets/api-DIdZpU9w.js","/assets/api-DT2z0zgj.js","/assets/api-DqBgP7_X.js","/assets/api-cGHpRBxe.js","/assets/api-pMcMYYdZ.js","/assets/assistant-staging-DcULsQRg.js","/assets/backend-transcription-DiK02rBl.js","/assets/billing-calculations-DrJWXY6g.js","/assets/billing-slots-YJ8csFzi.js","/assets/capabilities-DS1QiBH9.js","/assets/cart-codec-CbubRRIW.js","/assets/category-store-C7zqtOD0.js","/assets/checkbox-DPf21Hop.js","/assets/chip-tones-cbbqDYQQ.js","/assets/cloud-hydration-C1vqnhFy.js","/assets/deferred-runtime-G7K-NcIL.js","/assets/demo-shop-data-BTWpSFoa.js","/assets/dropdown-menu-g0DUt_Iv.js","/assets/escape-html-DInPSGdP.js","/assets/generateCategoricalChart-BdOhCth4.js","/assets/hooks-DNMoSx9t.js","/assets/index-B-026ryc.css","/assets/index-CYG8yywH.js","/assets/index-CxWW_46C.js","/assets/index-DLkqWn8u.js","/assets/index-DY0GzH8N.js","/assets/inventory-lots-api--wy7YmYm.js","/assets/ledger-drift-repair-BeWY9hC_.js","/assets/local-actions-9x78a0w4.js","/assets/local-actions-CZfcmK2q.js","/assets/local-actions-CoOmLgK_.js","/assets/local-actions-UqKs4SNW.js","/assets/local-actions-YDm1Td9j.js","/assets/local-actions-cXhC2UKu.js","/assets/local-reporting-5i4o_zfD.js","/assets/open-bills-MM61W_EO.js","/assets/payment-mode-DJNE_WM0.js","/assets/pending-cart-additions-CYBdoXKy.js","/assets/permissions-BnI2brTc.js","/assets/personalize-Cz4vV2EP.js","/assets/popover-BgB9M9Wq.js","/assets/pricing-rules-cache-BAQPJEUi.js","/assets/print-fLVfZ9AC.js","/assets/product-configurators-4cbwrayb.js","/assets/product-form-state-B1XDDhgV.js","/assets/product-import-csv-n-wU1CUa.js","/assets/product-pricing-CIkCS_1x.js","/assets/product-voice-parser-DtrT4kiI.js","/assets/progress-DjM1WYCz.js","/assets/purchase-orders-api-DIHWtEL9.js","/assets/qr-encoder-O1M434ck.js","/assets/queries-B88cGGxZ.js","/assets/queries-D0NbR4-o.js","/assets/queries-DdHROHOV.js","/assets/queries-DdiWLBJ4.js","/assets/queries-Dfv5A4y2.js","/assets/queries-DhjPNsy3.js","/assets/query-options-DZ4mp_BJ.js","/assets/receipt-print-xFWTBrsH.js","/assets/restaurant-website-IRv-TSWP.js","/assets/select-BZ5-oeZ3.js","/assets/settle-checks-BvFvcl9V.js","/assets/share-BwlAJrkM.js","/assets/sheet-zLzZ-AXy.js","/assets/shop-billing-CFx32cM8.js","/assets/shop-credit-BUbd94WT.js","/assets/shop-workflows-Drz0SVU-.js","/assets/stock-display-Bw0mQIjk.js","/assets/supplier-payment-history-DMqabSla.js","/assets/switch-B-Grvdzl.js","/assets/sync-engine-DOx0Tzn4.js","/assets/sync-push-DPx0V7kw.js","/assets/sync-reconcile-lGRdyR1D.js","/assets/sync-status-repair-Cj3Am-YZ.js","/assets/sync-types-B187FdZc.js","/assets/ui-S6rSucf0.js","/assets/use-panel-resize-C8PKX7A4.js","/assets/use-settings-prefs-DJaVuBcM.js","/assets/useOfflineStatus-DvchPfee.js","/assets/useReportView-TCm7sLrO.js","/assets/useSearchTracking-CVMDL6KF.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-date-FYRyL2wv.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js","/assets/voice-recognition-DMs16Fd1.js","/assets/voice-text-BkOdDDiw.js","/assets/whatsapp-delivery-BNSJgDDh.js","/assets/zod-DQDEOc6Z.js"];
const VERTICAL_ASSETS = {"clothing":["/assets/RentalsPage-B88vk4FV.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-G7K-NcIL.js","/assets/index-B-026ryc.css","/assets/index-CYG8yywH.js","/assets/queries-DdHROHOV.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-DPx0V7kw.js","/assets/sync-reconcile-lGRdyR1D.js","/assets/sync-status-repair-Cj3Am-YZ.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-C8PKX7A4.js","/assets/useOfflineStatus-DvchPfee.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"footwear":["/assets/SizeRunsPage-Dl4DGAh0.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-G7K-NcIL.js","/assets/index-B-026ryc.css","/assets/index-CYG8yywH.js","/assets/sync-push-DPx0V7kw.js","/assets/sync-reconcile-lGRdyR1D.js","/assets/sync-status-repair-Cj3Am-YZ.js","/assets/sync-types-B187FdZc.js","/assets/useOfflineStatus-DvchPfee.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"auto-parts":["/assets/FitmentPage-BcUOp7dS.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-G7K-NcIL.js","/assets/index-B-026ryc.css","/assets/index-CYG8yywH.js","/assets/pending-cart-additions-CYBdoXKy.js","/assets/queries-DdHROHOV.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-DPx0V7kw.js","/assets/sync-reconcile-lGRdyR1D.js","/assets/sync-status-repair-Cj3Am-YZ.js","/assets/sync-types-B187FdZc.js","/assets/useOfflineStatus-DvchPfee.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"electronics":["/assets/ProductUnitsPage-BCTWdocw.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-G7K-NcIL.js","/assets/index-B-026ryc.css","/assets/index-CYG8yywH.js","/assets/queries-DdHROHOV.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-DPx0V7kw.js","/assets/sync-reconcile-lGRdyR1D.js","/assets/sync-status-repair-Cj3Am-YZ.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-C8PKX7A4.js","/assets/useOfflineStatus-DvchPfee.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"pharmacy":["/assets/PrescriptionsPage-DWXSL5V6.js","/assets/api-BUpbe5Zm.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-G7K-NcIL.js","/assets/index-B-026ryc.css","/assets/index-CYG8yywH.js","/assets/queries-DdHROHOV.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-DPx0V7kw.js","/assets/sync-reconcile-lGRdyR1D.js","/assets/sync-status-repair-Cj3Am-YZ.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-C8PKX7A4.js","/assets/useOfflineStatus-DvchPfee.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"stationery-books":["/assets/BookListsPage-BgZIf0oU.js","/assets/billing-calculations-DrJWXY6g.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-G7K-NcIL.js","/assets/index-B-026ryc.css","/assets/index-CYG8yywH.js","/assets/open-bills-MM61W_EO.js","/assets/queries-DdHROHOV.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-DPx0V7kw.js","/assets/sync-reconcile-lGRdyR1D.js","/assets/sync-status-repair-Cj3Am-YZ.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-C8PKX7A4.js","/assets/useOfflineStatus-DvchPfee.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"furniture-home":["/assets/FurnitureOrdersPage-TZ4lDk_k.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-G7K-NcIL.js","/assets/index-B-026ryc.css","/assets/index-CYG8yywH.js","/assets/queries-DdHROHOV.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-DPx0V7kw.js","/assets/sync-reconcile-lGRdyR1D.js","/assets/sync-status-repair-Cj3Am-YZ.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-C8PKX7A4.js","/assets/useOfflineStatus-DvchPfee.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"beauty-cosmetics":["/assets/TestersPage-DRTazPL_.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-G7K-NcIL.js","/assets/index-B-026ryc.css","/assets/index-CYG8yywH.js","/assets/queries-DdHROHOV.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-DPx0V7kw.js","/assets/sync-reconcile-lGRdyR1D.js","/assets/sync-status-repair-Cj3Am-YZ.js","/assets/sync-types-B187FdZc.js","/assets/useOfflineStatus-DvchPfee.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"restaurant":["/assets/ConfirmDialog-CyxipWqc.js","/assets/GuestOrdersStrip-Cgyx4RNY.js","/assets/KitchenPage-abipS8lM.js","/assets/KitchenStockPage-CJTutxDh.js","/assets/MenuPage-BBiCV5t-.js","/assets/PageHeader-22NbdwY0.js","/assets/QrCodeView-Usn2-sun.js","/assets/TablesPage-DEn8nOX6.js","/assets/alert-dialog-ZYNVKodt.js","/assets/api-C7P5BX87.js","/assets/billing-calculations-DrJWXY6g.js","/assets/chip-tones-cbbqDYQQ.js","/assets/index-B-026ryc.css","/assets/index-CYG8yywH.js","/assets/index-DLkqWn8u.js","/assets/open-bills-MM61W_EO.js","/assets/qr-encoder-O1M434ck.js","/assets/queries-DdHROHOV.js","/assets/queries-DdiWLBJ4.js","/assets/query-options-DZ4mp_BJ.js","/assets/reservations-api-BCIVzDDX.js","/assets/restaurant-api-DNRoLYPu.js","/assets/restaurant-website-IRv-TSWP.js","/assets/switch-B-Grvdzl.js","/assets/table-store-BCVlyBW_.js","/assets/use-settings-prefs-DJaVuBcM.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"]};
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
