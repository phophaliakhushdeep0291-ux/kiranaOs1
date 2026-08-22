import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const buildOutDir = process.env.KIRANA_OUT_DIR
  ? path.resolve(projectRoot, process.env.KIRANA_OUT_DIR)
  : path.resolve(projectRoot, "dist/public");

const rawPort = process.env.PORT ?? "5173";
const port = Number(rawPort);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const rawBasePath = process.env.BASE_PATH ?? "/";
const basePath = rawBasePath.startsWith("/") ? rawBasePath : `/${rawBasePath}`;
const buildId =
  process.env.KIRANA_BUILD_ID ||
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
  process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) ||
  process.env.GITHUB_SHA?.slice(0, 12) ||
  new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);

function stampServiceWorkerBuild() {
  return {
    name: "kiranaos-service-worker-build-stamp",
    closeBundle() {
      const swPath = path.resolve(buildOutDir, "sw.js");
      if (!fs.existsSync(swPath)) return;
      const source = fs.readFileSync(swPath, "utf8");
      const publicRoot = buildOutDir;
      const manifestPath = path.join(publicRoot, ".vite", "manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, {
        file?: string;
        imports?: string[];
        css?: string[];
        assets?: string[];
        name?: string;
        isDynamicEntry?: boolean;
      }>;
      const criticalEntries = [
        "index.html",
        "src/features/core/dashboard/pages/DashboardPage.tsx",
        "src/features/core/billing/pages/BillingPage.tsx",
        "src/features/core/customer-order/ImportOrderPage.tsx",
        "src/features/core/bills/pages/BillDetailPage.tsx",
        "src/features/core/orders/pages/OrdersReceivedPage.tsx",
        "src/features/core/sales/pages/SalesOverviewPage.tsx",
        "src/features/core/returns/pages/NewReturnPage.tsx",
        "src/features/core/products/pages/ProductsPage.tsx",
        "src/features/core/pricing/pages/ProductPricingPage.tsx",
        "src/features/core/customers/pages/CustomersPage.tsx",
        "src/features/core/customers/pages/CustomerDetailPage.tsx",
        "src/features/core/inventory/pages/InventoryPage.tsx",
        "src/features/core/inventory/pages/StockInPage.tsx",
        "src/features/core/inventory/pages/StockOutPage.tsx",
        "src/features/core/inventory/pages/AdjustmentsPage.tsx",
        "src/features/core/inventory/pages/StockTransfersPage.tsx",
        "src/features/core/inventory/pages/StockCountsPage.tsx",
        "src/features/core/inventory/pages/InventoryLotsPage.tsx",
        "src/features/core/inventory/pages/CategoriesPage.tsx",
        "src/features/core/bills/pages/BillsPage.tsx",
        "src/features/core/purchases/pages/PurchaseBillsPage.tsx",
        "src/features/core/suppliers/pages/SuppliersPage.tsx",
        "src/features/core/expenses/pages/ExpensesPage.tsx",
        "src/features/core/offers/pages/OffersPage.tsx",
        "src/features/core/loyalty/pages/LoyaltyPage.tsx",
        "src/features/core/gift-cards/GiftCardsPage.tsx",
        "src/features/core/reports/pages/ReportsPage.tsx",
        "src/features/core/reports/pages/ChannelSettlementsPage.tsx",
        "src/features/core/money-statement/pages/MoneyStatementPage.tsx",
        "src/features/core/reports/pages/DailyClosingPage.tsx",
        "src/features/core/settings/pages/SettingsPage.tsx",
        "src/features/core/settings/pages/MerchantSetupPage.tsx",
        "src/features/core/settings/pages/StoreProfilePage.tsx",
        "src/features/core/settings/pages/ModulesSettingsPage.tsx",
        "src/features/core/settings/pages/PrinterSettingsPage.tsx",
        "src/features/core/settings/pages/BillingSettingsPage.tsx",
        "src/features/core/settings/pages/StaffSettingsPage.tsx",
        "src/features/core/settings/pages/DevicesSettingsPage.tsx",
        "src/features/core/settings/pages/SyncSettingsPage.tsx",
        "src/features/core/settings/pages/TaxesSettingsPage.tsx",
        "src/features/core/settings/pages/SecuritySettingsPage.tsx",
        "src/features/core/settings/pages/NotificationsSettingsPage.tsx",
        "src/features/core/settings/pages/IntegrationsSettingsPage.tsx",
        "src/features/core/settings/pages/AdvancedSettingsPage.tsx",
        "src/features/core/sync/pages/SyncStatusPage.tsx",
        "src/features/core/subscription/pages/PlansPage.tsx",
        "src/features/core/subscription/pages/SubscriptionPage.tsx",
        "src/features/core/devices/pages/DevicesPage.tsx",
        "src/features/core/platform-admin/pages/PlatformAdminPage.tsx",
        "src/features/core/remote-support/pages/RemoteSupportConsolePage.tsx",
        "src/features/core/support/pages/AskArthaPage.tsx",
        "src/features/core/activity/pages/ActivityInsightsPage.tsx",
        "src/features/core/staff/pages/StaffPage.tsx",
        "src/features/core/audit-logs/pages/AuditLogsPage.tsx",
        "src/features/core/assurance/pages/AssuranceDashboardPage.tsx",
        "src/features/core/assurance/pages/FindingsPage.tsx",
        "src/features/core/assurance/pages/FindingDetailPage.tsx",
        "src/features/core/assurance/pages/EvidenceRequestsPage.tsx",
        "src/features/core/assurance/pages/AuditRunsPage.tsx",
        "src/features/core/assurance/pages/AuditRulesPage.tsx",
        "src/features/core/assurance/pages/ReviewQueuePage.tsx",
        "src/features/core/assurance/pages/AssuranceReportPage.tsx",
        "src/features/core/assurance/pages/CasesPage.tsx",
        "src/features/core/recycle-bin/pages/RecycleBinPage.tsx",
        "src/features/core/innovation/pages/SmartToolsPage.tsx",
        "src/features/core/recovery/pages/RecoveryModePage.tsx",
      ];
      const coreAssets = new Set<string>();
      const visited = new Set<string>();
      const resolveManifestKey = (requestedKey: string) => {
        if (manifest[requestedKey]) return requestedKey;

        // Rollup can turn a lazy route into a shared dynamic chunk when another
        // route starts importing one of its helpers. Vite then records the
        // chunk under an internal key (for example `_MerchantSetupPage-*.js`)
        // while retaining its unique source component name. Treat that as the
        // same entry, but keep ambiguity and genuinely missing routes fatal.
        const expectedName = path.basename(requestedKey, path.extname(requestedKey));
        const matches = Object.entries(manifest)
          .filter(([, record]) => record.isDynamicEntry && record.name === expectedName)
          .map(([key]) => key);
        if (matches.length === 1) return matches[0];

        const suffix = matches.length > 1 ? ` (${matches.length} matching dynamic entries)` : "";
        throw new Error(`Critical offline entry is missing or ambiguous in Vite manifest: ${requestedKey}${suffix}`);
      };
      const includeRecord = (key: string, assets = coreAssets, seen = visited) => {
        const resolvedKey = resolveManifestKey(key);
        if (seen.has(resolvedKey)) return;
        seen.add(resolvedKey);
        const record = manifest[resolvedKey];
        if (record.file) assets.add(`/${record.file}`);
        for (const file of [...(record.css ?? []), ...(record.assets ?? [])]) assets.add(`/${file}`);
        for (const imported of record.imports ?? []) includeRecord(imported, assets, seen);
      };
      criticalEntries.forEach((key) => includeRecord(key));
      const verticalEntries: Record<string, string[]> = {
        clothing: ["src/features/verticals/clothing/rentals/pages/RentalsPage.tsx"],
        footwear: ["src/features/verticals/footwear/sizes/pages/SizeRunsPage.tsx"],
        "auto-parts": ["src/features/verticals/auto-parts/fitment/pages/FitmentPage.tsx"],
        electronics: ["src/features/verticals/electronics/units/pages/ProductUnitsPage.tsx"],
        pharmacy: ["src/features/verticals/pharmacy/prescriptions/pages/PrescriptionsPage.tsx"],
        "stationery-books": ["src/features/verticals/stationery-books/book-lists/pages/BookListsPage.tsx"],
        "furniture-home": ["src/features/verticals/furniture-home/orders/pages/FurnitureOrdersPage.tsx"],
        "beauty-cosmetics": ["src/features/verticals/beauty-cosmetics/testers/pages/TestersPage.tsx"],
        restaurant: [
          "src/features/verticals/restaurant/pages/TablesPage.tsx",
          "src/features/verticals/restaurant/pages/KitchenPage.tsx",
          "src/features/verticals/restaurant/pages/MenuPage.tsx",
          "src/features/verticals/restaurant/pages/KitchenStockPage.tsx",
        ],
      };
      const verticalAssets = Object.fromEntries(Object.entries(verticalEntries).map(([id, entries]) => {
        const assets = new Set<string>();
        const seen = new Set<string>();
        entries.forEach((key) => includeRecord(key, assets, seen));
        for (const key of entries) {
          const file = manifest[resolveManifestKey(key)]?.file;
          if (file && coreAssets.has(`/${file}`)) throw new Error(`Vertical page leaked into the core offline cache: ${key}`);
        }
        return [id, [...assets].sort()];
      }));
      fs.writeFileSync(
        swPath,
        source
          .replaceAll("__KIRANA_BUILD_ID__", buildId)
          .replace("__KIRANA_CORE_ASSETS__", JSON.stringify([...coreAssets].sort()))
          .replace("__KIRANA_VERTICAL_ASSETS__", JSON.stringify(verticalAssets)),
      );
    },
  };
}

export default defineConfig({
  base: basePath,
  define: {
    __KIRANA_BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [react(), tailwindcss(), stampServiceWorkerBuild()],
  resolve: {
    alias: {
      "@": path.resolve(projectRoot, "src"),
      "@assets": path.resolve(projectRoot, "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: projectRoot,
  build: {
    // Floor chosen for iOS: Safari only ships with the OS, so old iPhones are
    // stuck on old engines. safari14 transpiles class fields/static blocks that
    // hard-crash (SyntaxError -> white screen) on iOS 14-16.3 WebKit.
    target: ["es2020", "safari14"],
    // Release builds favor smaller payloads over the default minifier's speed.
    // Multiple compression passes keep the full POS feature set inside the enforced
    // raw and gzip budgets without changing runtime behavior.
    minify: "terser",
    manifest: true,
    terserOptions: {
      ecma: 2020,
      module: true,
      compress: {
        passes: 10,
        toplevel: true,
        keep_fargs: false,
        pure_getters: "strict",
        // booleans_as_integers MUST stay off. It rewrites `x === true` to `1 == x`
        // and `x === false` to `0 == x`, turning every strict boolean check into
        // LOOSE equality — so a stored 1 or "1" passes as true. This app reads
        // booleans back out of untrusted persisted/synced JSON (billing draft,
        // held bills, Shop.settingsJson) and guards them with `=== true`; the flag
        // silently defeated exactly those guards. Worse, the divergence is
        // invisible to the test suite, which only ever runs unminified source.
        // It bought ~1.4 kB gzip; correctness is worth more than that.
        booleans_as_integers: false,
        drop_console: true,
        unsafe_arrows: true,
      },
      mangle: { toplevel: true },
      format: { comments: false, semicolons: false },
    },
    outDir: buildOutDir,
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Keep route entry chunks intact. Per-business offline packaging below relies
        // on each vertical page retaining its own Vite manifest record; automatic
        // small-chunk merging can fold a trade-specific screen into the universal
        // shell and make every shop download code it cannot use. The bundle gate
        // therefore budgets core + the largest single active vertical, while the
        // unchanged initial/chunk ceilings still protect startup performance.
        experimentalMinChunkSize: 0,
        manualChunks: {
          "vendor-react": ["react", "react-dom", "wouter"],
          "vendor-data": ["dexie", "@tanstack/react-query"],
          "vendor-ui": ["lucide-react"],
          "vendor-validation": ["zod"],
          "vendor-date": ["date-fns"],
          // The Hindi tables are dynamically imported, but left to its own
          // heuristics Rollup folded them into whichever route chunk happened to
          // pull them in first — so an English shop opening that page downloaded
          // ~45 kB of Devanagari it never renders, and a Hindi shop had to fetch
          // an unrelated route to get its own language. Pinning them to a named
          // chunk keeps the language payload independent of routing.
          //
          // TWO pins, not one, and pinned at the halves rather than at
          // translations/hindi. The object form assigns the named module AND
          // everything it imports, so naming the full dictionary would pull both
          // halves back into a single chunk and undo the split — the same trap
          // the vertical-pages note below describes. hindi.ts itself composes the
          // two halves and is reachable only from the completeness test.
          //
          // The split is what lets main.tsx block first paint on the shell and
          // billing tables alone; see hindi-critical.ts.
          "i18n-hindi-critical": ["./src/features/core/settings/translations/hindi-critical"],
          "i18n-hindi": ["./src/features/core/settings/translations/hindi-deferred"],
          // Do NOT add a per-vertical entry here in the object form. Naming a
          // trade's page assigns that module AND everything it imports, so the
          // shared UI kit lands in the trade's chunk and every core page then has
          // to import it — the opposite of isolation. It also costs
          // PurchaseBillsPage its own manifest record, which fails the offline
          // precache stamp below and breaks the build outright.
          //
          // Splitting verticals properly needs the function form (which assigns
          // one module at a time) AND a different answer for
          // experimentalMinChunkSize, since that is what merges a trade's screens
          // into shared chunks in the first place. Measured attempts are recorded
          // in scripts/check-bundle-size.mjs; it is a real piece of work, not a
          // one-line entry.
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
