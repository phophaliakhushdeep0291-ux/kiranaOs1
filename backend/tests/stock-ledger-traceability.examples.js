import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const sqliteSchema = read("prisma/schema.prisma");
const postgresSchema = read("prisma-postgres/schema.prisma");
const auth = read("src/middleware/auth.js");
const inventory = read("src/modules/inventory/inventory.service.js");

for (const schema of [sqliteSchema, postgresSchema]) {
  const ledger = schema.match(/model StockLedger \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(ledger, /actorUserId\s+String\?/);
  assert.match(ledger, /actorName\s+String\?/);
  assert.match(ledger, /sourceType\s+String\?/);
  assert.match(ledger, /oldStockBaseQty\s+Float/);
  assert.match(ledger, /newStockBaseQty\s+Float/);
}

assert.match(auth, /select:\s*\{[^}]*name:\s*true[^}]*email:\s*true/);
assert.match(auth, /userName:\s*user\.name/);
assert.match(inventory, /include:\s*\{\s*product:\s*\{\s*select:\s*\{\s*baseUnit:\s*true/);

const stockWriters = [
  "src/modules/bills/bills.service.js",
  "src/modules/inventory/inventory.service.js",
  "src/modules/inventory/repack.service.js",
  "src/modules/inventory/stockCounts.service.js",
  "src/modules/products/products.service.js",
  "src/modules/purchase-orders/purchaseOrders.service.js",
  "src/modules/purchase-returns/purchaseReturns.service.js",
  "src/modules/sync/sync.service.js",
  "src/verticals/manufacturing/manufacturing.service.js",
  "src/verticals/manufacturing/trade-orders.service.js",
  "src/verticals/restaurant/menu/addons.guard.js",
  "src/verticals/restaurant/menu/combos.guard.js",
  "src/verticals/restaurant/recipes/recipes.guard.js",
];

for (const path of stockWriters) {
  const source = read(path);
  assert.match(source, /stockLedgerProvenance/, `${path} must use shared stock attribution`);
  const createCount = (source.match(/stockLedger\.create\(/g) ?? []).length;
  const provenanceCount = (source.match(/\.\.\.stockLedgerProvenance\(/g) ?? []).length;
  // Product opening stock intentionally shares one provenance-bearing common
  // object across its pooled and per-pack creates.
  const sharedOpeningData = path.endsWith("products.service.js") ? 1 : 0;
  assert.ok(provenanceCount + sharedOpeningData >= createCount, `${path} has an unattributed StockLedger writer`);
}

console.log("Stock-ledger traceability examples passed");
