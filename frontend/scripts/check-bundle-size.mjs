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
const MAX_INITIAL_JS_BYTES = 950 * 1024;
const MAX_INITIAL_GZIP_BYTES = 300 * 1024;
// The assurance control plane adds independently lazy audit, findings, evidence,
// case, run, and review surfaces. Keep startup/per-chunk ceilings fixed, while
// ratcheting aggregate capacity only for those opt-in route chunks.
const MAX_TOTAL_JS_BYTES = 3.00 * 1024 * 1024;
const MAX_TOTAL_GZIP_BYTES = 902 * 1024;


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
