import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Two ways LocationStock silently breaks once it holds a variant row per size
 * beside the product-level row. Both of these shipped once; neither was caught by
 * any test, because the suites do not exercise a non-primary location against a
 * real database. These are the cheap guards that would have caught them.
 */

const SRC = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function jsFilesUnder(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".js")) found.push(full);
    }
  };
  walk(dir);
  return found;
}

const files = jsFilesUnder(SRC).map((path) => ({ path, source: readFileSync(path, "utf8") }));

/* ── 1. Prisma cannot put null in a compound unique key ─────────────── */
// findUnique/upsert on locationId_productId_sellingUnitId throws
// "Argument `sellingUnitId` must not be null" at runtime — and the product-level
// row IS the null case, so this breaks essentially every branch stock operation
// while every existing test stays green. Use findLocationStockRow /
// writeLocationStockRow instead, which go through findFirst and updateMany.
const compoundKeyUsers = files
  .filter(({ source }) => /locationId_productId_sellingUnitId\s*:/.test(source))
  .map(({ path }) => path.slice(SRC.length).replace(/\\/g, "/"));

assert.deepEqual(
  compoundKeyUsers,
  [],
  "LocationStock must not be addressed by its compound unique key: Prisma rejects the null sellingUnitId that the product-level row carries",
);

/* ── 2. A bulk write must say which kind of row it means ────────────── */
// Without sellingUnitId in the where, updateMany matches the product-level row
// AND every variant row. A two-size product returns count 3, so the guard
// `if (changed.count !== 1)` rejects a movement it has already applied to all
// three rows.
const unscopedBulkWrites = [];
for (const { path, source } of files) {
  const pattern = /locationStock\.(updateMany|deleteMany)\(\{\s*(?:\/\/[^\n]*\n\s*)*where:\s*\{([^}]*)\}/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    if (!/sellingUnitId/.test(match[2])) {
      unscopedBulkWrites.push(`${path.slice(SRC.length).replace(/\\/g, "/")} -> ${match[1]}`);
    }
  }
}

assert.deepEqual(
  unscopedBulkWrites,
  [],
  "a locationStock updateMany/deleteMany must scope sellingUnitId, or it silently hits the variant rows too",
);

/* ── 3. The helpers that replace both patterns exist and are shared ── */
const context = readFileSync(join(SRC, "modules/stores/location-context.service.js"), "utf8");
assert.match(context, /export async function findLocationStockRow/, "the null-safe read helper must exist");
assert.match(context, /export async function writeLocationStockRow/, "the null-safe write helper must exist");
assert.match(context, /findFirst/, "the read helper must use findFirst, which allows a null");

console.log("location-stock-scoping.examples.js OK");
