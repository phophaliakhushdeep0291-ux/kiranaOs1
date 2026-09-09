/* Artha service worker: app-shell only. Business data stays in IndexedDB, not Cache Storage. */
const BUILD_ID = "20260909192643";
const CACHE_VERSION = `kiranaos-shell-v11-${BUILD_ID}`;
const NAVIGATION_NETWORK_TIMEOUT_MS = 3500;
const CORE_ASSETS = ["/assets/AdjustmentsPage-CQXvASlv.js","/assets/AdvancedSettingsPage-DUbmoK3v.js","/assets/AreaChart-DL_2sziB.js","/assets/AuditLogsPage-DMPGIKr_.js","/assets/BackgroundRuntime-B4Kc3Ayq.js","/assets/BarChart-Cg1n5QKB.js","/assets/BillDetailPage-KuUfoc15.js","/assets/BillingPage-CQsk9xJh.js","/assets/BillingSearch-DbDVua_b.js","/assets/BillingSettingsPage-BjBhguBP.js","/assets/BillsPage-Dko-ZMB5.js","/assets/CartesianGrid-BApm6Ff6.js","/assets/CategoriesPage-sDEu-eAV.js","/assets/ConfirmDialog-DN2fselo.js","/assets/CustomerDetailPage-BamT3eGT.js","/assets/CustomersPage-C-hevI4k.js","/assets/DailyClosingPage-CNYvR4Hn.js","/assets/DashboardPage-g45jCRph.js","/assets/DataTableCard-CThVakju.js","/assets/EmptyState-DymA6waH.js","/assets/ErrorState-Bsa-nKD2.js","/assets/ExpensesPage-DKy0C84T.js","/assets/FinancialAggregationService-C6c9PVzr.js","/assets/ImportOrderPage-MsSU5WK3.js","/assets/InventoryLotsPage-BW8jRqs9.js","/assets/InventoryPage-OEGCuati.js","/assets/LineChart-Ddzo2klZ.js","/assets/LoadingSkeleton-cFuOUimr.js","/assets/LocalDataUnavailable-DLfH_vTG.js","/assets/MerchantSetupPage-QYa2DvKs.js","/assets/ModulesSettingsPage-7NnScBz4.js","/assets/MoneyStatementPage-D-DjM7sR.js","/assets/NearExpiryAlert-DBCErRa_.js","/assets/NewReturnPage-DGP_KDs-.js","/assets/OffersPage-xIY1TML1.js","/assets/OfflineConfidenceMeter-DdIV33FU.js","/assets/OrdersReceivedPage-Dgm5jJ0C.js","/assets/PageHeader-GBIvyIO7.js","/assets/PageShell-fw3djrvQ.js","/assets/PieChart-LxqBU6Th.js","/assets/PlanBadge-gcquC03L.js","/assets/PrinterSettingsPage-BeFn851K.js","/assets/ProductPricingPage-DER4ieQc.js","/assets/ProductsPage-g8cQyCJw.js","/assets/PurchaseBillsPage-COifTxb8.js","/assets/QrCodeView-Usn2-sun.js","/assets/RecoveryModePage-BqhRjvTa.js","/assets/RecycleBinPage-Cov3fQ0q.js","/assets/ReportsPage-5d1nhX6y.js","/assets/ReturnDialog-Dvx_r69S.js","/assets/SalesOverviewPage-D5ogYbI_.js","/assets/SearchInputWithIcon-DsmQMu9J.js","/assets/SecuritySettingsPage-CvMfaNPW.js","/assets/SettingsPage-CoJUZi6v.js","/assets/SettingsShell-PSc28Qsx.js","/assets/SmartToolsPage-DZO1SKDY.js","/assets/StaffPage-DAIHBjVi.js","/assets/StaffSettingsPage-Dn22r4o1.js","/assets/StatCard-DIpT85mz.js","/assets/StockCountsPage-Bja1O_iD.js","/assets/StockInPage-MA-rEpMs.js","/assets/StockOutPage-BMxQM5dE.js","/assets/StockStatusView-C6NBUJYN.js","/assets/StockTransfersPage-sAcQlL7p.js","/assets/StoreProfilePage-DUKhJQum.js","/assets/SubscriptionPage-CX3AlZ-y.js","/assets/SuppliersPage-CNGNqv_E.js","/assets/SyncBadge-DJ23hgJ1.js","/assets/SyncSettingsPage-BVlvqAbl.js","/assets/SyncStatusPage-aqHo53AP.js","/assets/TaxesSettingsPage-BhDGfFMz.js","/assets/TradeFocusStrip-CbdWUP-v.js","/assets/VoiceDictationBar-uaW0Pd43.js","/assets/YAxis-CgNffInv.js","/assets/ai-client-Cfe33gej.js","/assets/alert-dialog-ZZikVS_D.js","/assets/api-35nNIy4Q.js","/assets/api-3hKDFzft.js","/assets/api-ChthShsd.js","/assets/api-Cp9M-Clo.js","/assets/api-CuHkflwx.js","/assets/api-DqBgP7_X.js","/assets/api-DuULelFS.js","/assets/api-VplWiMDQ.js","/assets/api-nb05TjI0.js","/assets/api-pPUbfnLK.js","/assets/assistant-staging-Cg87WuGM.js","/assets/backend-transcription-BeCCIxAq.js","/assets/billing-calculations-sn4kidtF.js","/assets/billing-slots-YJ8csFzi.js","/assets/capabilities-Bh-xCAV5.js","/assets/cart-codec-CbubRRIW.js","/assets/category-store-y-cuOpdZ.js","/assets/checkbox-Dtu8VGCp.js","/assets/chip-tones-cbbqDYQQ.js","/assets/cloud-hydration-8u1jwLFs.js","/assets/deferred-runtime-ClHL0ErT.js","/assets/demo-shop-data-DJwZCe-0.js","/assets/dropdown-menu-vB-3THM1.js","/assets/escape-html-DInPSGdP.js","/assets/generateCategoricalChart-guuFGrUT.js","/assets/hooks-By1nfxTr.js","/assets/index-C-nn0uN8.css","/assets/index-CxWW_46C.js","/assets/index-DLkqWn8u.js","/assets/index-DpnGZZlV.js","/assets/index-DtTTo2f-.js","/assets/inventory-lots-api-4ZudafUN.js","/assets/ledger-drift-repair-Ca1Og-XC.js","/assets/local-actions-5oKsoXJk.js","/assets/local-actions-BNl8dXEM.js","/assets/local-actions-C9oF_zl6.js","/assets/local-actions-CzyRq_CX.js","/assets/local-actions-DmGp15Rh.js","/assets/local-actions-gnK4U9y9.js","/assets/local-reporting-CttfKLn5.js","/assets/open-bills-CcleOoAT.js","/assets/payment-mode-DJNE_WM0.js","/assets/pending-cart-additions-CgFWbHRW.js","/assets/permissions-BxYGW7j7.js","/assets/personalize-Cz4vV2EP.js","/assets/popover-g7aZyjjz.js","/assets/pricing-rules-cache-C_uaUK1G.js","/assets/print-CVF0lEXY.js","/assets/product-configurators-4cbwrayb.js","/assets/product-form-state-C5kLlU1E.js","/assets/product-import-csv-BQndHCCR.js","/assets/product-pricing-CcPp4jyY.js","/assets/product-voice-parser-DxQrYUnh.js","/assets/progress-W2wT3yYV.js","/assets/purchase-orders-api-LO8b9Y9M.js","/assets/qr-encoder-O1M434ck.js","/assets/queries-CXVOE3q-.js","/assets/queries-CgIkt7M-.js","/assets/queries-DB7ZpxSZ.js","/assets/queries-Db6pxogG.js","/assets/queries-amt-M72F.js","/assets/queries-qv2amA5M.js","/assets/query-options-DZ4mp_BJ.js","/assets/receipt-print-lEXBn_XL.js","/assets/restaurant-website-IRv-TSWP.js","/assets/select-Cxg7Ip16.js","/assets/settle-checks-BvFvcl9V.js","/assets/share-DgtJW_kT.js","/assets/sheet-D1ZPB3MP.js","/assets/shop-billing-Cwd2lir4.js","/assets/shop-credit-BUbd94WT.js","/assets/shop-workflows-Drz0SVU-.js","/assets/stock-display-Bw0mQIjk.js","/assets/supplier-payment-history-Dk8rspeK.js","/assets/switch-CEoBfYkX.js","/assets/sync-engine-BS6Jk2A_.js","/assets/sync-push-L32v8TG6.js","/assets/sync-reconcile-CJOvFc-z.js","/assets/sync-status-repair-Ca3OOA-w.js","/assets/sync-types-B187FdZc.js","/assets/ui-B-H-LsU4.js","/assets/use-panel-resize-DvJwiBLq.js","/assets/use-settings-prefs-B5Xewg3n.js","/assets/useOfflineStatus-DuVqR3Wi.js","/assets/useReportView-thkDryz3.js","/assets/useSearchTracking-xBDpwuOp.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-date-FYRyL2wv.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js","/assets/voice-recognition-DMs16Fd1.js","/assets/voice-text-BkOdDDiw.js","/assets/whatsapp-delivery-Ch6PLjkD.js","/assets/zod-DQDEOc6Z.js"];
const VERTICAL_ASSETS = {"clothing":["/assets/RentalsPage-CZOppsyx.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-ClHL0ErT.js","/assets/index-C-nn0uN8.css","/assets/index-DtTTo2f-.js","/assets/queries-amt-M72F.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-L32v8TG6.js","/assets/sync-reconcile-CJOvFc-z.js","/assets/sync-status-repair-Ca3OOA-w.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-DvJwiBLq.js","/assets/useOfflineStatus-DuVqR3Wi.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"footwear":["/assets/SizeRunsPage-C4V9oHI1.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-ClHL0ErT.js","/assets/index-C-nn0uN8.css","/assets/index-DtTTo2f-.js","/assets/sync-push-L32v8TG6.js","/assets/sync-reconcile-CJOvFc-z.js","/assets/sync-status-repair-Ca3OOA-w.js","/assets/sync-types-B187FdZc.js","/assets/useOfflineStatus-DuVqR3Wi.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"auto-parts":["/assets/FitmentPage-D6L1uu05.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-ClHL0ErT.js","/assets/index-C-nn0uN8.css","/assets/index-DtTTo2f-.js","/assets/pending-cart-additions-CgFWbHRW.js","/assets/queries-amt-M72F.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-L32v8TG6.js","/assets/sync-reconcile-CJOvFc-z.js","/assets/sync-status-repair-Ca3OOA-w.js","/assets/sync-types-B187FdZc.js","/assets/useOfflineStatus-DuVqR3Wi.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"electronics":["/assets/ProductUnitsPage-B7ZS4dNe.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-ClHL0ErT.js","/assets/index-C-nn0uN8.css","/assets/index-DtTTo2f-.js","/assets/queries-amt-M72F.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-L32v8TG6.js","/assets/sync-reconcile-CJOvFc-z.js","/assets/sync-status-repair-Ca3OOA-w.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-DvJwiBLq.js","/assets/useOfflineStatus-DuVqR3Wi.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"pharmacy":["/assets/PrescriptionsPage-BVceUE_i.js","/assets/api-BDrx5cjT.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-ClHL0ErT.js","/assets/index-C-nn0uN8.css","/assets/index-DtTTo2f-.js","/assets/queries-amt-M72F.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-L32v8TG6.js","/assets/sync-reconcile-CJOvFc-z.js","/assets/sync-status-repair-Ca3OOA-w.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-DvJwiBLq.js","/assets/useOfflineStatus-DuVqR3Wi.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"stationery-books":["/assets/BookListsPage-DQgWqY_R.js","/assets/billing-calculations-sn4kidtF.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-ClHL0ErT.js","/assets/index-C-nn0uN8.css","/assets/index-DtTTo2f-.js","/assets/open-bills-CcleOoAT.js","/assets/queries-amt-M72F.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-L32v8TG6.js","/assets/sync-reconcile-CJOvFc-z.js","/assets/sync-status-repair-Ca3OOA-w.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-DvJwiBLq.js","/assets/useOfflineStatus-DuVqR3Wi.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"furniture-home":["/assets/FurnitureOrdersPage-YtMH-eXH.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-ClHL0ErT.js","/assets/index-C-nn0uN8.css","/assets/index-DtTTo2f-.js","/assets/queries-amt-M72F.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-L32v8TG6.js","/assets/sync-reconcile-CJOvFc-z.js","/assets/sync-status-repair-Ca3OOA-w.js","/assets/sync-types-B187FdZc.js","/assets/use-panel-resize-DvJwiBLq.js","/assets/useOfflineStatus-DuVqR3Wi.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"beauty-cosmetics":["/assets/TestersPage-COpS4ntJ.js","/assets/chip-tones-cbbqDYQQ.js","/assets/deferred-runtime-ClHL0ErT.js","/assets/index-C-nn0uN8.css","/assets/index-DtTTo2f-.js","/assets/queries-amt-M72F.js","/assets/query-options-DZ4mp_BJ.js","/assets/sync-push-L32v8TG6.js","/assets/sync-reconcile-CJOvFc-z.js","/assets/sync-status-repair-Ca3OOA-w.js","/assets/sync-types-B187FdZc.js","/assets/useOfflineStatus-DuVqR3Wi.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"],"restaurant":["/assets/ConfirmDialog-DN2fselo.js","/assets/GuestOrdersStrip-D-d-Sz1j.js","/assets/KitchenPage-CfsduOFf.js","/assets/KitchenStockPage-Dy257rkZ.js","/assets/MenuPage-C8n6If3-.js","/assets/PageHeader-GBIvyIO7.js","/assets/QrCodeView-Usn2-sun.js","/assets/TablesPage-eEpi-eIN.js","/assets/alert-dialog-ZZikVS_D.js","/assets/api-ChthShsd.js","/assets/billing-calculations-sn4kidtF.js","/assets/chip-tones-cbbqDYQQ.js","/assets/index-C-nn0uN8.css","/assets/index-DLkqWn8u.js","/assets/index-DtTTo2f-.js","/assets/open-bills-CcleOoAT.js","/assets/qr-encoder-O1M434ck.js","/assets/queries-CXVOE3q-.js","/assets/queries-amt-M72F.js","/assets/query-options-DZ4mp_BJ.js","/assets/reservations-api-Dxa-znIJ.js","/assets/restaurant-api-BVtmYTDQ.js","/assets/restaurant-website-IRv-TSWP.js","/assets/switch-CEoBfYkX.js","/assets/table-store-BzwiBCDE.js","/assets/use-settings-prefs-B5Xewg3n.js","/assets/vendor-data-BaHBZjtO.js","/assets/vendor-react-CdF70ZyV.js","/assets/vendor-ui-CIi-vqR6.js","/assets/vendor-validation-C84QDzN5.js"]};
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
