import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

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
      const swPath = path.resolve(projectRoot, "dist/public/sw.js");
      if (!fs.existsSync(swPath)) return;
      const source = fs.readFileSync(swPath, "utf8");
      const publicRoot = path.resolve(projectRoot, "dist/public");
      const manifestPath = path.join(publicRoot, ".vite", "manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, {
        file?: string;
        imports?: string[];
        css?: string[];
        assets?: string[];
      }>;
      const criticalEntries = [
        "index.html",
        "src/features/core/dashboard/pages/DashboardPage.tsx",
        "src/features/core/billing/pages/BillingPage.tsx",
        "src/features/core/products/pages/ProductsPage.tsx",
        "src/features/core/customers/pages/CustomersPage.tsx",
        "src/features/core/inventory/pages/InventoryPage.tsx",
        "src/features/core/bills/pages/BillsPage.tsx",
        "src/features/core/purchases/pages/PurchaseBillsPage.tsx",
        "src/features/core/reports/pages/ReportsPage.tsx",
        "src/features/core/sync/pages/SyncStatusPage.tsx",
      ];
      const coreAssets = new Set<string>();
      const visited = new Set<string>();
      const includeRecord = (key: string) => {
        if (visited.has(key)) return;
        visited.add(key);
        const record = manifest[key];
        if (!record) throw new Error(`Critical offline entry is missing from Vite manifest: ${key}`);
        if (record.file) coreAssets.add(`/${record.file}`);
        for (const file of [...(record.css ?? []), ...(record.assets ?? [])]) coreAssets.add(`/${file}`);
        for (const imported of record.imports ?? []) includeRecord(imported);
      };
      criticalEntries.forEach(includeRecord);
      fs.writeFileSync(
        swPath,
        source
          .replaceAll("__KIRANA_BUILD_ID__", buildId)
          .replace("__KIRANA_CORE_ASSETS__", JSON.stringify([...coreAssets].sort())),
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
    outDir: path.resolve(projectRoot, "dist/public"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Merge compatible helper/leaf chunks below ~70 kB. Route entry points
        // remain lazy, while fewer tiny transport units remove repeated module
        // wrappers and gzip dictionaries from the full offline application cache.
        //
        // This threshold is a direct trade between the two budgets in
        // scripts/check-bundle-size.mjs, and it is NOT free to raise. Rollup merges
        // a small chunk into whatever chunk already pulls it — including the ENTRY —
        // so a threshold above a route's own size lets that route be swallowed by
        // the startup shell. At 180 kB the multi-vertical build had dragged whole
        // rarely-opened pages (customer self-order 72 kB, orders received 55 kB,
        // assurance case screens ~45 kB) into first paint: startup 1108.6 kB, over
        // the 1000 kB budget, while every shop paid for screens most never open.
        //
        // Measured across the same build (initial / total gzip):
        //   180 kB -> 1108.6 kB / 937.1 kB   startup budget FAILS
        //   120 kB -> 1021.0 kB / 939.0 kB   startup budget FAILS
        //    70 kB ->  930.3 kB / 943.1 kB   both pass, most balanced headroom
        //    60 kB ->  891.8 kB / 948.0 kB   passes, but 2 kB from the total ceiling
        //     0 kB ->  805.2 kB / 1002.2 kB  total budget FAILS
        //
        // Pinning routes with manualChunks instead does NOT work: a manual chunk has
        // no dynamic-entry facade, so each page loses its Vite manifest record and
        // the service worker can no longer precache it for offline use (the
        // "Critical offline entry is missing" guard below fires), and the entry
        // static-imports them all — startup measured 2043.4 kB.
        experimentalMinChunkSize: 40000,
        // FUNCTION form, deliberately. The object form assigns a named module
        // AND everything it imports, so naming a trade's page dragged the shared
        // UI kit into that trade's chunk and every core page then imported it —
        // the opposite of isolation, and it cost PurchaseBillsPage its manifest
        // record, failing the offline precache stamp below. The function form
        // assigns one module at a time, which is what a per-vertical split needs.
        manualChunks(id) {
          const file = id.replace(/\\/g, "/");

          if (file.includes("/node_modules/")) {
            // Package names plus the transitive deps the object form used to pull
            // in implicitly. Keep these lists in step with package.json — a missed
            // dep silently lands in whichever route chunk reaches it first.
            if (/\/node_modules\/(react|react-dom|scheduler|wouter|regexparam|use-sync-external-store)\//.test(file)) return "vendor-react";
            if (/\/node_modules\/(dexie|@tanstack\/react-query|@tanstack\/query-core)\//.test(file)) return "vendor-data";
            if (/\/node_modules\/lucide-react\//.test(file)) return "vendor-ui";
            if (/\/node_modules\/zod\//.test(file)) return "vendor-validation";
            if (/\/node_modules\/date-fns\//.test(file)) return "vendor-date";
            return undefined;
          }

          // The Hindi tables are dynamically imported, but left to its own
          // heuristics Rollup folded them into whichever route chunk happened to
          // pull them in first — so an English shop opening that page downloaded
          // ~45 kB of Devanagari it never renders, and a Hindi shop had to fetch
          // an unrelated route to get its own language. Pinning them to a named
          // chunk keeps the language payload independent of routing.
          if (file.includes("/src/features/core/settings/translations/hindi")) return "i18n-hindi";

          // One chunk per trade, so a kirana shop never downloads the restaurant
          // kitchen display. pack.ts is excluded on purpose: registry.ts imports
          // every pack eagerly to build the business-type map, so pinning it here
          // would make each trade chunk a static import of the shell and undo the
          // whole split. Business type is switchable at runtime (Settings → Store
          // Profile), so every trade must stay in the build — this decides when a
          // shop downloads a trade, not whether it is shipped.
          const vertical = /\/src\/features\/verticals\/([^/]+)\//.exec(file);
          if (vertical && !/\/pack\.ts$/.test(file)) return `vertical-${vertical[1]}`;

          return undefined;
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
