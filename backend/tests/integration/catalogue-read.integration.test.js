import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertSuccess } from "./setup.js";
import { createTenant, createProduct, login } from "./factories.js";
import { createCatalogueReader } from "../../src/modules/products/catalogue-read.js";

const ctx = await createIntegrationContext();
const databaseEngine = ctx.skip ? null : (await import("../../src/db.js")).databaseEngine;
if (ctx.skip) test("catalogue revision proof unavailable", { skip: ctx.reason }, () => {});
else {
  after(() => ctx.close());
  beforeEach(() => resetDatabase(ctx.db));
  test("PostgreSQL out-of-order commits invalidate pending reads even when the highest change sequence stays unchanged", { skip: databaseEngine !== "postgres" }, async () => {
    const tenant = await createTenant(ctx.db);
    const a = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10 });
    const b = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 20 });
    let commitOlder, started, failed;
    const commitGate = new Promise(resolve => { commitOlder = resolve; });
    const ready = new Promise((resolve, reject) => { started = resolve; failed = reject; });
    const olderWrite = ctx.db.$transaction(async tx => {
      await tx.product.update({ where: { id: a.id }, data: { stockBaseQty: 8 } });
      started();
      await commitGate;
    }, { timeout: 15000 });
    void olderWrite.catch(failed);
    let releaseRead, captured;
    const held = new Promise(resolve => { releaseRead = resolve; });
    const capturedRead = new Promise(resolve => { captured = resolve; });
    let old;
    try {
      await ready;
      await ctx.db.product.update({ where: { id: b.id }, data: { stockBaseQty: 18 } });
      const head = () => ctx.db.changeLog.findFirst({ where: { shopId: tenant.shop.id }, orderBy: { seq: "desc" } });
      const before = await head();
      let first = true;
      const read = createCatalogueReader({ $queryRaw: ctx.db.$queryRaw.bind(ctx.db), product: { findMany: async query => {
        const pause = first; first = false;
        const rows = await ctx.db.product.findMany(query);
        if (pause) { captured(); await held; }
        return rows;
      } } }, { engine: databaseEngine });
      const where = { shopId: tenant.shop.id, deletedAt: null };
      old = read(where);
      await capturedRead;
      commitOlder();
      await olderWrite;
      assert.equal((await head()).seq, before.seq, "the old max-sequence key would not detect this commit");
      let timer;
      try {
        const fresh = await Promise.race([read(where), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("out-of-order commit joined stale catalogue")), 5000); })]);
        assert.equal(fresh.find(row => row.id === a.id).stockBaseQty, 8);
      } finally { clearTimeout(timer); }
    } finally { commitOlder(); releaseRead(); await olderWrite; if (old) await old; }
  });
  test("committed product and pack changes cannot join an older pending catalogue read", async () => {
    const tenant = await createTenant(ctx.db);
    const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10 });
    const unit = await ctx.db.productSellingUnit.create({ data: { shopId: tenant.shop.id, productId: product.id, name: "Each", unitType: "piece", unitCode: "each", defaultPrice: 10 } });
    const where = { shopId: tenant.shop.id, deletedAt: null };
    for (const [change, verify] of [
      [() => ctx.db.product.update({ where: { id: product.id }, data: { stockBaseQty: 8 } }), rows => assert.equal(rows[0].stockBaseQty, 8)],
      [() => ctx.db.productSellingUnit.update({ where: { id: unit.id }, data: { defaultPrice: 12 } }), rows => assert.equal(rows[0].sellingUnits[0].defaultPrice, 12)],
      [() => ctx.db.productSellingUnit.delete({ where: { id: unit.id } }), rows => assert.equal(rows[0].sellingUnits.length, 0)],
    ]) {
      let release, captured;
      const held = new Promise(resolve => { release = resolve; });
      const ready = new Promise(resolve => { captured = resolve; });
      let reads = 0;
      const read = createCatalogueReader({ changeLog: ctx.db.changeLog, $queryRaw: ctx.db.$queryRaw.bind(ctx.db), product: { findMany: async query => {
        const first = reads++ === 0;
        const rows = await ctx.db.product.findMany(query);
        if (first) { captured(); await held; }
        return rows;
      } } }, { engine: databaseEngine });
      const old = read(where);
      await ready;
      try {
        await change();
        const fresh = read(where);
        // A timeout also catches accidental joining of the deliberately held read.
        let timer;
        try { verify(await Promise.race([fresh, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("fresh read joined stale catalogue")), 10000); })])); }
        finally { clearTimeout(timer); }
        assert.equal(reads, 2);
      } finally { release(); await old; }
    }
  });
  test("catalogue HTTP responses preserve money, filters, tenant boundaries and fresh branch stock", async () => {
    const tenant = await createTenant(ctx.db);
    const other = await createTenant(ctx.db);
    const product = await createProduct(ctx.db, tenant.shop.id, { name: "Rice", stockBaseQty: 10, lowStockThreshold: 3 });
    await createProduct(ctx.db, tenant.shop.id, { name: "Salt" });
    await createProduct(ctx.db, other.shop.id, { name: "Private rice" });
    await ctx.db.product.update({ where: { id: product.id }, data: { costPerRateUnitPaise: 9007199254740993n } });
    const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    const options = { token: auth.accessToken };
    const replies = await Promise.all(Array.from({ length: 5 }, () => ctx.get("/api/products", options)));
    for (const reply of replies) {
      const rows = assertSuccess(reply);
      assert.deepEqual(rows.map(row => row.name), ["Rice", "Salt"]);
      assert.equal(rows[0].costPerRateUnitPaise, "9007199254740993");
      assert.ok(Array.isArray(rows[0].sellingUnits));
      assert.ok(Array.isArray(rows[0].aliases));
    }
    assert.deepEqual(assertSuccess(await ctx.get("/api/products?search=Rice", options)).map(row => row.id), [product.id]);
    const location = await ctx.db.storeLocation.create({ data: { shopId: tenant.shop.id, name: "Branch", code: "BR1", isPrimary: false } });
    const stock = await ctx.db.locationStock.create({ data: { shopId: tenant.shop.id, locationId: location.id, productId: product.id, stockBaseQty: 2 } });
    const url = `/api/products?locationId=${location.id}&search=Rice`;
    assert.equal(assertSuccess(await ctx.get(url, options))[0].stockBaseQty, 2);
    await ctx.db.locationStock.update({ where: { id: stock.id }, data: { stockBaseQty: 7 } });
    assert.equal(assertSuccess(await ctx.get(url, options))[0].stockBaseQty, 7);
    assert.deepEqual(assertSuccess(await ctx.get(`${url}&lowStock=true`, options)), []);
  });
}
