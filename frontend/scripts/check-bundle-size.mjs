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
// pinned to their own `i18n-hindi` chunk (see vite.config.ts manualChunks) that
// only a Hindi shop ever fetches. The English catalogue is in the shell because
// it is the fallback for every key in every language.
//
// This is a one-off payment for a language, NOT slack for route growth. A new
// language belongs in its own lazy chunk and should be argued on gzip.
const MAX_TOTAL_JS_BYTES = 3.25 * 1024 * 1024;
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
const MAX_TOTAL_GZIP_BYTES = 930 * 1024;


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
  console.log("Bundle size check");
  for (const row of rows.sort((a, b) => b.bytes - a.bytes)) {
    console.log(`- ${row.file}: ${(row.bytes / 1024).toFixed(1)} kB (${(row.gzipBytes / 1024).toFixed(1)} kB gzip)`);
  }
  console.log(`Initial JS: ${(initialTotal / 1024).toFixed(1)} kB (${(initialGzip / 1024).toFixed(1)} kB gzip) across ${initialRows.length} files`);
  console.log(`Total JS: ${(total / 1024).toFixed(1)} kB (${(totalGzip / 1024).toFixed(1)} kB gzip)`);

  if (largest.bytes > MAX_JS_CHUNK_BYTES) {
    throw new Error(`Largest JS chunk ${(largest.bytes / 1024).toFixed(1)} kB exceeds ${(MAX_JS_CHUNK_BYTES / 1024).toFixed(0)} kB budget.`);
  }
  if (initialTotal > MAX_INITIAL_JS_BYTES) {
    throw new Error(`Initial JS ${(initialTotal / 1024).toFixed(1)} kB exceeds ${(MAX_INITIAL_JS_BYTES / 1024).toFixed(0)} kB startup budget.`);
  }
  if (initialGzip > MAX_INITIAL_GZIP_BYTES) {
    throw new Error(`Initial gzip JS ${(initialGzip / 1024).toFixed(1)} kB exceeds ${(MAX_INITIAL_GZIP_BYTES / 1024).toFixed(0)} kB startup budget.`);
  }
  if (total > MAX_TOTAL_JS_BYTES) {
    throw new Error(`Total JS ${(total / 1024).toFixed(1)} kB exceeds ${(MAX_TOTAL_JS_BYTES / 1024).toFixed(0)} kB budget.`);
  }
  if (totalGzip > MAX_TOTAL_GZIP_BYTES) {
    throw new Error(`Total gzip JS ${(totalGzip / 1024).toFixed(1)} kB exceeds ${(MAX_TOTAL_GZIP_BYTES / 1024).toFixed(0)} kB budget.`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
