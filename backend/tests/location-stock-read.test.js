import test from "node:test";
import assert from "node:assert/strict";
import { readLocationProductStockBatches } from "../src/modules/stores/location-stock-read.js";

function fixture(productCount = 2501, branchCount = 20) {
  const products = Array.from({ length: productCount }, (_, i) => ({ id: `p${i}` }));
  const calls = [];
  let returned = 0;
  const client = { locationStock: { findMany: async ({ where }) => {
    calls.push(where);
    assert.equal(where.shopId, "shop-a");
    assert.equal(where.sellingUnitId, null);
    const branches = where.locationId ? [where.locationId] : Array.from({ length: branchCount }, (_, i) => `branch-${i}`);
    const rows = where.productId.in.flatMap((productId) => branches.map((locationId) => ({ productId, locationId, stockBaseQty: 2, lowStockThreshold: 1 })));
    returned += rows.length;
    return rows;
  } } };
  return { products, client, calls, count: () => returned };
}

test("a branch retrieves only its own stock with bounded queries", async () => {
  const f = fixture();
  const rows = [];
  for await (const batch of readLocationProductStockBatches(f.client, "shop-a", { id: "branch-7", isPrimary: false }, f.products)) rows.push(...batch);
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.calls.map((call) => call.productId.in.length), [1000, 1000, 501]);
  assert.equal(rows.length, 2501); // Previously 50,020 rows for 20 branches.
  assert.ok(rows.every((row) => row.locationId === "branch-7"));
  assert.equal(new Set(rows.map((row) => row.productId)).size, 2501);
});

test("primary allocation retains all branches but fetches batches on demand", async () => {
  const f = fixture();
  const batches = readLocationProductStockBatches(f.client, "shop-a", { id: "primary", isPrimary: true }, f.products);
  assert.equal(f.calls.length, 0);
  const first = await batches.next();
  assert.equal(f.calls.length, 1);
  assert.equal(first.value.length, 20_000);
  assert.equal(f.calls[0].locationId, undefined);
  let total = first.value.length;
  for await (const batch of batches) total += batch.length;
  assert.equal(total, 50_020);
  assert.equal(f.calls.length, 3);
});

test("empty catalogues do not query stock", async () => {
  const f = fixture(0);
  for await (const _batch of readLocationProductStockBatches(f.client, "shop-a", { id: "branch-1", isPrimary: false }, f.products)) assert.fail("unexpected rows");
  assert.equal(f.calls.length, 0);
});
