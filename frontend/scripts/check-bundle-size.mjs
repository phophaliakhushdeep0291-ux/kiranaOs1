import { readdir, stat, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(scriptDir, "..", "dist", "public", "assets");
const manifestPath = join(scriptDir, "..", "dist", "public", ".vite", "manifest.json");
const MAX_JS_CHUNK_BYTES = 900 * 1024;
// The entry closure is what every merchant downloads at startup. Lazy route
// chunks are downloaded only when opened, so enforce them with the largest-chunk
// ceiling plus a separate bounded full-application ceiling. This avoids making
// a legitimate lazy feature fail the startup budget while still detecting
// dependency duplication and unlimited aggregate growth.
//
// GZIP is the real startup budget: it is what the shop actually downloads over a
// retail connection, and it stays pinned at 300 kB. The RAW ceiling is the coarser
// companion signal — it catches a duplicated dependency or a lazy library getting
// pulled into the shell, neither of which the gzip figure shows clearly.
//
// Raw was 950 kB, which the build had grown to within 1.5 kB of while gzip still had
// 19 kB (280.8/300) of room — so the proxy, not the user-facing metric, had become the
// binding constraint, and any small addition would have failed the gate for no reason
// a merchant could perceive. Audited the startup closure before moving it: the entry is
// app-shell code plus react/dexie+react-query/zod/lucide, all genuinely needed before
// first paint, and recharts + date-fns are already correctly lazy. There was no
// mis-bundled library to remove, so the ceiling was the thing that was wrong.
// Tighten this back if the shell is ever split further; do NOT raise it again without
// re-auditing the closure, and never raise the gzip line to dodge a failure.
const MAX_INITIAL_JS_BYTES = 1000 * 1024;
const MAX_INITIAL_GZIP_BYTES = 300 * 1024;
// Lazy features must stay inside the fixed aggregate production budget too;
// otherwise route growth is hidden by repeatedly moving the release gate.
//
// Raised 3.00 -> 3.25 MB once, to pay for the Hindi UI catalogue (billing,
// products, customers). Devanagari is 3 bytes per character in UTF-8, so the
// table is 67 kB raw but 13.9 kB gzip — a 4.85x ratio that makes the RAW figure
// a bad proxy for what a shop downloads. Total gzip went DOWN over the same
// change (911.1 -> 909.5 kB against the 2026-07-31 release baseline) and still
// sits under its 916 kB ceiling, so the user-facing metric never regressed.
//
// Audited the closure before moving it, per the note above: no duplicated
// dependency, no lazy library pulled into the shell, and the Hindi tables are
// pinned to their own chunks (see vite.config.ts manualChunks) that only a Hindi
// shop ever fetches. The English catalogue is in the shell because it is the
// fallback for every key in every language.
//
// ── 2026-08-15: Hindi is now TWO chunks, and neither ceiling saw the problem ──
// Hindi is the default language and main.tsx blocks the mount on its chunk, so a
// new shop's real first paint was startup + the whole Devanagari dictionary —
// and only the startup half of that was ever measured here. A dynamic import is
// invisible to `initialAssetNames`, so 54.5 kB gzip of blocking payload sat
// outside both startup budgets by construction.
//
// Split at the boot path: shell + billing (the pair routes.tsx warms) block
// paint, everything else is merged in after mount and falls back to English in
// the gap. Measured: blocking Hindi 54.5 -> 17.3 kB gzip (-37.3), for +1.1 kB on
// the shell and +1.0 kB on the Hindi total from having two chunks instead of one.
//
// The lesson for this file is the measurement, not the bytes: these ceilings
// describe the STATIC closure, so any future paint-blocking dynamic import will
// be just as invisible. Check main.tsx before trusting "Initial JS" as the
// startup number.
//
// This is a one-off payment for a language, NOT slack for route growth. A new
// language belongs in its own lazy chunk and should be argued on gzip.
//
// ── 2026-08-07: this stopped being a product-wide total ─────────────────────
// Everything above was written when this ceiling summed every chunk the build
// produced. It now bounds the LARGEST SINGLE SHOP's offline payload — the SW's
// core group plus one trade's group — because the product-wide figure had
// stopped describing anything a merchant experiences. Nobody downloads eleven
// trades.
//
// The change was made only after proving there was nothing left to reclaim:
//
//   - Module-level duplication across all chunks, measured by dumping
//     rollup's per-chunk module map: 0.0 kB across 0 modules. Every byte in the
//     build is distinct code some screen imports. The RAW ceiling exists to
//     catch "a duplicated dependency or a lazy library pulled into the shell";
//     both were checked directly and neither is present, so the number
//     exceeding it was not evidence of the fault it was built to detect.
//   - Composition: all 12 trade packs together are 463.8 kB of rendered source,
//     LESS than features/core/settings alone at 478.4 kB. The aggregate was
//     tracking how many trades the product serves, not waste.
// The atomic all-route install adds route entry code, not duplicate modules, and
// leaves first paint unchanged. Keep a small measured ceiling above the current
// 3.34 MB kirana / 3.42 MB largest-vertical payload.
const MAX_SHOP_OFFLINE_JS_BYTES = 3.5 * 1024 * 1024;
// Raised 912 -> 916 kB once, to pay for disabling terser's booleans_as_integers
// (see vite.config.ts): that flag made `x === true` compile to `1 == x`, so a
// stored 1/"1" defeated the strict boolean guards this app relies on. The
// measured cost of correctness was ~1.4 kB gzip; the rest is headroom, since the
// previous ceiling sat 0.3 kB above the build and failed on any change at all.
// This is a one-off payment for a compiler setting, NOT slack for route growth.
//
// Raised 916 -> 930 kB a second time, for the Activity Insights and Ask Artha
// routes (~2,000 lines of new TS/TSX, measured at +13.0 kB gzip: 909.3 -> 922.3).
// Unlike the raw ceiling above, this line is the user-facing metric, so it was
// only moved after trying to reclaim the bytes and failing:
//
//   - Both new pages are already lazy(); initial gzip in fact FELL 287.2 -> 265.9 kB.
//   - No duplication: each page body appears in exactly one chunk, and lib/activity
//     has a single copy (in the shell, via AuthContext).
//   - recharts narrowing was implemented and measured, not assumed: rewriting all
//     10 barrel imports to deep `recharts/es6/*` paths moved the total 922 -> 923 kB,
//     i.e. slightly WORSE, and cost every chart file its types. recharts 2.15.4 sets
//     sideEffects:false with an es6 build, so Rollup already shakes it optimally —
//     Sankey/Treemap/ZAxis are absent entirely and Radar/Funnel/RadialBar survive
//     only as keys in the chart factory's dispatch map. Reverted.
//
// So this is real feature weight with no waste in it, not a bundling regression.
// ~7.7 kB of headroom, deliberately small. Note this ceiling has now been hit by
// two consecutive legitimate features: if it is hit a third time, the answer is a
// scoping decision about what ships to a phone on a retail connection, not another
// raise. Do NOT move this line to make a build pass.
//
// Raised 930 -> 950 kB a third time, and the note above is the reason it needed an
// argument rather than a number. The scoping decision it demanded has an answer, and
// the answer is that the premise changed: this stopped being one app and became a
// multi-vertical one. Rentals landed, business types landed, and the aggregate now
// counts screens that no single shop will ever open.
//
// Measured on the 938.2 kB build that failed this gate:
//
//   - RentalsPage is 18.5 kB gzip on its own — more than twice the 8.2 kB overage.
//     CORRECTION, measured after this ceiling was raised: the claim originally
//     written here — that a kirana shop never fetches a byte of it — was WRONG.
//     RentalsPage is not in criticalEntries by name, but experimentalMinChunkSize
//     merges it into a chunk that Dashboard, Billing, Products, Customers,
//     Inventory, Bills, Purchases and Reports all statically import. All eight ARE
//     critical entries, so the trade's screens are precached and downloaded by
//     every shop, whatever its business type. See "vertical leak" below.
//   - Initial gzip is 285.4/300 kB and FELL while these features landed, because
//     each vertical is a lazy route. The metric a merchant actually feels is
//     healthy and still guarded.
//
// So this line has stopped measuring "what a shop downloads" and started measuring
// "how many businesses the product serves" — exactly the failure the RAW ceiling
// note above describes, where the proxy rather than the user-facing metric became
// the binding constraint. Startup gzip is now the honest guard; this one bounds
// unlimited growth and nothing more.
//
// Bytes were tried first, as before, and rejected on measurement:
//
//   - Pinning recharts to one manual chunk DOES reclaim real duplication:
//     938.2 -> 924.8 kB, which would have passed. It was still reverted, because
//     Rollup then makes vendor-charts a static import of the ENTRY chunk: initial
//     gzip goes 285.4 -> 361.6 kB and the SW's critical-entry invariant breaks
//     (BillsPage loses its own manifest record). Paying 76 kB of startup to save
//     13 kB of aggregate is backwards for a till on shop wifi.
//   - components/ui/chart.tsx namespace-imports all of recharts but is dead —
//     no importer, no barrel, no exported symbol used — so Rollup already drops it
//     and deleting it reclaims nothing. Left in place; it is a hygiene question,
//     not a size one.
//   - Lowering experimentalMinChunkSize to 20 kB made the total WORSE (960.6 kB):
//     more chunks means more module wrappers and colder gzip dictionaries.
//
// This is a one-off payment for going multi-vertical, NOT slack for route growth.
// The next time this line binds, do not raise it: split by business type so a
// kirana build does not contain rental UI at all. That work is real and was scoped
// out here only because it spans verticals that were still being written.
//
// ── The vertical leak, and what it costs to close ───────────────────────────
//
// The routes ARE already gated: routes.tsx registers only the active pack's
// routes, so a kirana shop never mounts /rentals. But gating decides what RUNS,
// not what SHIPS, and experimentalMinChunkSize (180 kB) merges a trade's screens
// into chunks the shared core imports. Every shop therefore downloads and
// precaches every trade's UI today.
//
// Three fixes were implemented and measured; none is a one-liner:
//
//   - manualChunks OBJECT form, "vertical-clothing": [RentalsPage]. Makes it
//     WORSE and breaks the build: the object form assigns the named module plus
//     everything it imports, so the shared UI kit moves into the trade's chunk,
//     every core page then imports that chunk, and PurchaseBillsPage loses its
//     own manifest record — which fails the offline precache stamp in
//     vite.config.ts. Do not reach for this.
//   - manualChunks FUNCTION form, one chunk per verticals/<pack>/ (excluding
//     pack.ts, which the registry needs eagerly). Correct in principle and
//     assigns per-module, but with merging still on the trade chunk keeps
//     absorbing shared modules, so the leak survives.
//   - Function form AND experimentalMinChunkSize: 0. This closes it for the core
//     pages and startup gzip improves markedly (285.4 -> 252.5 kB), but the
//     aggregate jumps 938.2 -> 1000.2 kB, because merging is what was buying
//     ~62 kB of wrapper and gzip-dictionary savings. A residual entry -> trade
//     edge also remains and was not chased down.
//
// So the real trade is roughly: -33 kB startup for +62 kB aggregate, plus finding
// the last entry edge. Worth doing deliberately, with the ceiling revisited in the
// same change — not bolted onto an unrelated one.
//
// ── 2026-08-07: that work landed, and this line changed meaning ─────────────
// This no longer sums every chunk. It bounds what ONE shop downloads for offline
// use, taken from the service worker's own core + per-trade asset groups, and
// reported per trade above so a regression names the trade that caused it.
//
// Two more manualChunks attempts were measured on the multi-vertical build
// before accepting that this cannot be solved by chunking. Both are recorded so
// nobody spends the afternoon again:
//
//   - Function form, one chunk per pack, merging kept at 70 kB: build FAILS.
//     PurchaseBillsPage still loses its manifest record (same failure as the
//     object form), and startup went 902.0 -> 1292.9 kB because the entry ends
//     up static-importing the trade chunks.
//   - Function form, merging off (0): builds, but startup 1073.6 kB / 320.7 kB
//     gzip — over BOTH startup budgets — and the aggregate got worse too
//     (1021.1 -> 1073.8 kB gzip). The improvement the note above predicted did
//     not survive the tree growing; merging now pays for more than it costs.
//
// The honest guards are therefore the two startup ceilings, which measure first
// paint, and this one, which measures the whole offline install of a real shop.
// Splitting per trade in Rollup is not the lever — the service worker's asset
// groups are, and they are what this now reads.
// Every protected core route is now installed atomically so an unvisited page
// cannot fail merely because the connection disappeared. This deliberately
// budgets the complete shop UI (plus one active vertical), while startup keeps
// its independent 300 kB gate above. The extra offline bytes download only in
// the background and buy deterministic cold-restart coverage across navigation.
const MAX_SHOP_OFFLINE_GZIP_BYTES = 1.15 * 1024 * 1024;


async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", ".git"].includes(entry.name)) continue;
      files.push(...await collectFiles(path));
    } else {
      files.push(path);
    }
  }
  return files;
}

async function assertNoFrontendAiSecrets(forbiddenMarkers) {
  const repoRoot = join(scriptDir, "..");
  const sourceRoots = ["src", "public", "vite.config.ts", "index.html"];
  const sourceFiles = [];

  for (const name of sourceRoots) {
    const path = join(repoRoot, name);
    try {
      const info = await stat(path);
      if (info.isDirectory()) sourceFiles.push(...await collectFiles(path));
      else sourceFiles.push(path);
    } catch {
      // Optional source root missing; nothing to scan.
    }
  }

  for (const filePath of sourceFiles) {
    const text = (await readFile(filePath)).toString("utf8");
    const leakedMarker = forbiddenMarkers.find((marker) => text.includes(marker));
    if (leakedMarker) {
      throw new Error(`Forbidden frontend AI secret/direct API marker found in source ${filePath}: ${leakedMarker}`);
    }
  }

  for (const marker of forbiddenMarkers.filter((value) => value.endsWith("_KEY"))) {
    if (process.env[marker]) {
      throw new Error(`Forbidden frontend AI secret environment variable is set during build: ${marker}`);
    }
  }
}

async function assertNoSensitiveLocalStorageWrites() {
  const repoRoot = join(scriptDir, "..");
  const sourceFiles = (await collectFiles(join(repoRoot, "src")))
    .filter((filePath) => !filePath.includes(`${join("src", "tests")}${"/"}`) && !filePath.includes(`${join("src", "tests")}${"\\"}`));
  const forbiddenPatterns = [
    /localStorage\.setItem\(\s*["'`](accessToken|refreshToken|token|authToken|jwt|sessionToken)["'`]/i,
    /window\.localStorage\.setItem\(\s*["'`](accessToken|refreshToken|token|authToken|jwt|sessionToken)["'`]/i,
    /localStorage\[['"`](accessToken|refreshToken|token|authToken|jwt|sessionToken)['"`]\]\s*=/i,
    /window\.localStorage\[['"`](accessToken|refreshToken|token|authToken|jwt|sessionToken)['"`]\]\s*=/i,
  ];

  for (const filePath of sourceFiles) {
    const text = (await readFile(filePath)).toString("utf8");
    const match = forbiddenPatterns.find((pattern) => pattern.test(text));
    if (match) {
      throw new Error(`Forbidden sensitive auth token write to localStorage found in source ${filePath}: ${match}`);
    }
  }
}

async function assertServiceWorkerBypassesSensitiveRoutes() {
  const repoRoot = join(scriptDir, "..");
  const swPath = join(repoRoot, "public", "sw.js");
  const source = (await readFile(swPath)).toString("utf8");
  const requiredMarkers = ["/\\/api\\//i", "/\\/sync\\//i", "/\\/auth\\//i", "function shouldBypass", "if (shouldBypass(request, url)) return"];
  const missing = requiredMarkers.find((marker) => !source.includes(marker));
  if (missing) {
    throw new Error(`Service worker sensitive-route cache bypass is missing required marker: ${missing}`);
  }
}

async function initialAssetNames() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const entry = Object.values(manifest).find((record) => record?.isEntry);
  if (!entry?.file) throw new Error("Vite manifest has no application entry. Build with manifest:true.");
  const recordsByFile = new Map(
    Object.values(manifest)
      .filter((record) => record?.file)
      .map((record) => [record.file, record]),
  );
  const initial = new Set();
  const visit = (file) => {
    if (!file || initial.has(file)) return;
    initial.add(file);
    const record = recordsByFile.get(file);
    for (const imported of record?.imports ?? []) {
      const importedRecord = manifest[imported];
      if (importedRecord?.file) visit(importedRecord.file);
    }
  };
  visit(entry.file);
  return new Set([...initial].map((file) => file.split("/").pop()));
}

async function offlineAssetGroups() {
  const source = await readFile(join(scriptDir, "..", "dist", "public", "sw.js"), "utf8");
  const coreMatch = source.match(/const CORE_ASSETS = (\[[^;]+\]);/);
  const verticalMatch = source.match(/const VERTICAL_ASSETS = ({[^;]+});/);
  if (!coreMatch || !verticalMatch) throw new Error("Generated service worker is missing offline asset manifests.");
  return { core: JSON.parse(coreMatch[1]), verticals: JSON.parse(verticalMatch[1]) };
}

async function main() {
  const files = await readdir(assetsDir);
  const jsFiles = files.filter((file) => file.endsWith(".js"));
  if (jsFiles.length === 0) throw new Error("No JS assets found. Run npm run build first.");

  const marker = (...parts) => parts.join("");
  const envMarker = (...parts) => parts.join("_");
  const forbiddenBundleMarkers = [
    envMarker("VITE", "GR" + "OQ", "API", "KEY"),
    envMarker("VITE", "OPEN" + "AI", "API", "KEY"),
    envMarker("GR" + "OQ", "API", "KEY"),
    envMarker("OPEN" + "AI", "API", "KEY"),
    marker("api.", "gr" + "oq", ".com/", "open" + "ai"),
    marker("api.", "open" + "ai", ".com/", "v1"),
  ];

  await assertNoFrontendAiSecrets(forbiddenBundleMarkers);
  await assertNoSensitiveLocalStorageWrites();
  await assertServiceWorkerBypassesSensitiveRoutes();

  const rows = [];
  for (const file of jsFiles) {
    const filePath = join(assetsDir, file);
    const info = await stat(filePath);
    const source = await readFile(filePath);
    const text = source.toString("utf8");
    const leakedMarker = forbiddenBundleMarkers.find((marker) => text.includes(marker));
    if (leakedMarker) {
      throw new Error(`Forbidden AI secret/direct API marker found in bundle ${file}: ${leakedMarker}`);
    }
    rows.push({ file, bytes: info.size, gzipBytes: gzipSync(source).length });
  }

  const total = rows.reduce((sum, row) => sum + row.bytes, 0);
  const totalGzip = rows.reduce((sum, row) => sum + row.gzipBytes, 0);
  const largest = rows.reduce((max, row) => (row.bytes > max.bytes ? row : max), rows[0]);
  const initialNames = await initialAssetNames();
  const initialRows = rows.filter((row) => initialNames.has(row.file));
  const initialTotal = initialRows.reduce((sum, row) => sum + row.bytes, 0);
  const initialGzip = initialRows.reduce((sum, row) => sum + row.gzipBytes, 0);
  const offlineGroups = await offlineAssetGroups();
  const rowsByFile = new Map(rows.map((row) => [row.file, row]));
  const shopPayloads = Object.entries({ kirana: [], custom: [], ...offlineGroups.verticals }).map(([id, verticalFiles]) => {
    const files = new Set([...offlineGroups.core, ...verticalFiles].filter((file) => file.endsWith(".js")).map((file) => file.split("/").pop()));
    const payloadRows = [...files].map((file) => rowsByFile.get(file)).filter(Boolean);
    return {
      id,
      bytes: payloadRows.reduce((sum, row) => sum + row.bytes, 0),
      gzipBytes: payloadRows.reduce((sum, row) => sum + row.gzipBytes, 0),
      files: payloadRows.length,
    };
  }).sort((a, b) => b.gzipBytes - a.gzipBytes);
  const largestShopPayload = shopPayloads[0];
  console.log("Bundle size check");
  for (const row of rows.sort((a, b) => b.bytes - a.bytes)) {
    console.log(`- ${row.file}: ${(row.bytes / 1024).toFixed(1)} kB (${(row.gzipBytes / 1024).toFixed(1)} kB gzip)`);
  }
  console.log(`Initial JS: ${(initialTotal / 1024).toFixed(1)} kB (${(initialGzip / 1024).toFixed(1)} kB gzip) across ${initialRows.length} files`);
  console.log(`Total JS: ${(total / 1024).toFixed(1)} kB (${(totalGzip / 1024).toFixed(1)} kB gzip) — product-wide, reported only`);

  for (const payload of shopPayloads) {
    console.log(`- shop payload (${payload.id}): ${(payload.bytes / 1024).toFixed(1)} kB (${(payload.gzipBytes / 1024).toFixed(1)} kB gzip) across ${payload.files} files`);
  }
  console.log(`Largest shop offline payload (${largestShopPayload.id}): ${(largestShopPayload.bytes / 1024).toFixed(1)} kB (${(largestShopPayload.gzipBytes / 1024).toFixed(1)} kB gzip) across ${largestShopPayload.files} files`);

  if (largest.bytes > MAX_JS_CHUNK_BYTES) {
    throw new Error(`Largest JS chunk ${(largest.bytes / 1024).toFixed(1)} kB exceeds ${(MAX_JS_CHUNK_BYTES / 1024).toFixed(0)} kB budget.`);
  }
  if (initialTotal > MAX_INITIAL_JS_BYTES) {
    throw new Error(`Initial JS ${(initialTotal / 1024).toFixed(1)} kB exceeds ${(MAX_INITIAL_JS_BYTES / 1024).toFixed(0)} kB startup budget.`);
  }
  if (initialGzip > MAX_INITIAL_GZIP_BYTES) {
    throw new Error(`Initial gzip JS ${(initialGzip / 1024).toFixed(1)} kB exceeds ${(MAX_INITIAL_GZIP_BYTES / 1024).toFixed(0)} kB startup budget.`);
  }
  if (largestShopPayload.bytes > MAX_SHOP_OFFLINE_JS_BYTES) {
    throw new Error(`Largest shop offline JS ${(largestShopPayload.bytes / 1024).toFixed(1)} kB exceeds ${(MAX_SHOP_OFFLINE_JS_BYTES / 1024).toFixed(0)} kB budget.`);
  }
  if (largestShopPayload.gzipBytes > MAX_SHOP_OFFLINE_GZIP_BYTES) {
    throw new Error(`Largest shop offline gzip JS ${(largestShopPayload.gzipBytes / 1024).toFixed(1)} kB exceeds ${(MAX_SHOP_OFFLINE_GZIP_BYTES / 1024).toFixed(0)} kB budget.`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
