import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const root = new URL("../dist/public/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL(".vite/manifest.json", root), "utf8"));
const visited = new Set();
const files = new Set();

function visit(key) {
  if (visited.has(key)) return;
  visited.add(key);
  const entry = manifest[key];
  if (!entry) throw new Error(`Missing Vite manifest entry: ${key}`);
  if (entry.file) files.add(entry.file);
  for (const css of entry.css ?? []) files.add(css);
  for (const imported of entry.imports ?? []) visit(imported);
}

visit("index.html");
const verticalSources = Object.entries(manifest)
  .filter(([key]) => key.startsWith("src/features/verticals/") && key.includes("/pages/"))
  .filter(([, entry]) => entry.file && files.has(entry.file));

if (verticalSources.length) {
  throw new Error(`Kirana startup imports vertical pages: ${verticalSources.map(([key]) => key).join(", ")}`);
}

let rawBytes = 0;
let gzipBytes = 0;
for (const file of files) {
  const contents = readFileSync(new URL(file, root));
  rawBytes += contents.byteLength;
  gzipBytes += gzipSync(contents).byteLength;
}
console.log(`Kirana startup: ${files.size} assets, ${rawBytes} raw bytes, ${gzipBytes} gzip bytes; no vertical page chunks.`);
