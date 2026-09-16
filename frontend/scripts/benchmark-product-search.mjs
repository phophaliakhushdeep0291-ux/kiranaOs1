import { createServer } from "vite";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";

const server = await createServer({ configFile: false, logLevel: "silent", optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true } });
try {
  const { productMatchesSearch } = await server.ssrLoadModule('/src/features/core/products/product-reliability.ts');
  const { createProductSearchIndex } = await server.ssrLoadModule('/src/features/core/products/product-search-index.ts');
  const queries = ["r", "ri", "ric", "rice", "rice 99", "चीनी", "SUG-9", "grocery", "no match", "8900000009999"];
  const measurements = [];
  for (const count of [1000, 10000]) {
    const products = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Rice ${i}`, category: 'grocery', barcode: `890000000${i}`, sku: `SUG-${i}`, unit: 'kg', aliases: ['चावल', 'rice', 'चीनी'] }));
    const started = performance.now();
    const index = createProductSearchIndex(products);
    const buildMs = performance.now() - started;
    for (const query of queries) assert.deepEqual(index.search(query), products.filter((row) => productMatchesSearch(row, query)));
    const median = (values) => values.sort((a,b) => a-b)[Math.floor(values.length / 2)];
    const old = [], optimized = [];
    let totalMatches = 0;
    for (let run = 0; run < 5; run++) {
      let at = performance.now();
      for (const query of queries) totalMatches += products.filter((row) => productMatchesSearch(row, query)).length;
      old.push(performance.now() - at);
      at = performance.now();
      for (const query of queries) totalMatches += index.search(query).length;
      optimized.push(performance.now() - at);
    }
    measurements.push({ products: count, queriesPerRun: queries.length, runs: 5, buildMs: +buildMs.toFixed(2), previousMedianMs: +median(old).toFixed(2), indexedMedianMs: +median(optimized).toFixed(2), speedup: +(median(old)/median(optimized)).toFixed(1), totalMatches });
  }
  console.log(JSON.stringify({ environment: { node: process.version, platform: process.platform, arch: process.arch }, note: 'Synthetic local CPU benchmark; excludes networking, React rendering and database I/O. Index construction measured separately.', measurements }, null, 2));
} finally { await server.close(); }
