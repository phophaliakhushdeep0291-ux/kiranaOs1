import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, assertSuccess } from "./setup.js";
import { createTenant, createProduct, createStaff, login } from "./factories.js";
import { settingsForBusinessType } from "../../src/verticals/registry.js";
import * as production from "../../src/verticals/manufacturing/manufacturing.service.js";

const ctx = await createIntegrationContext();
const day = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
let phoneSequence = 8779090900;
if (ctx.skip) test("manufacturing production unavailable", { skip: ctx.reason }, () => {});
else {
  after(() => ctx.close());
  async function fixture() {
    const tenant = await createTenant(ctx.db, { ownerMobile: String(phoneSequence++) });
    const shopId = tenant.shop.id;
    await ctx.db.shop.update({ where: { id: shopId }, data: { settingsJson: JSON.stringify(settingsForBusinessType("manufacturing")) } });
    const raw = await createProduct(ctx.db, shopId, { stockBaseQty: 100 });
    const label = await createProduct(ctx.db, shopId, { stockBaseQty: 20 });
    const finished = await createProduct(ctx.db, shopId, { stockBaseQty: 0 });
    for (const product of [raw, finished]) await ctx.db.product.update({ where: { id: product.id }, data: { packagingMode: "per_pack", batchTrackingEnabled: true } });
    const pack = (productId, conversionToBase, onHandQty) => ctx.db.productSellingUnit.create({ data: { shopId, productId, name: "Pack", unitType: "pack", unitCode: "pack", conversionToBase, onHandQty, defaultPrice: 20 } });
    const rawPack = await pack(raw.id, 10, 10); const outputPack = await pack(finished.id, 2, 0);
    const bom = await production.createBom(shopId, { finishedProductId: finished.id, name: "Recipe", outputQuantityBaseQty: 10, items: [{ materialProductId: raw.id, quantityBaseQty: 10, wastagePercent: 0 }, { materialProductId: label.id, quantityBaseQty: 2, wastagePercent: 0 }] });
    const run = await production.createRun(shopId, { bomId: bom.id, runNumber: "RUN-1", plannedOutputBaseQty: 10 });
    const lot = await ctx.db.inventoryLot.create({ data: { shopId, locationId: run.locationId, productId: raw.id, batchNumber: "RAW-1", expiresOn: new Date(day(365)), receivedBaseQty: 100, availableBaseQty: 100, costPerRateUnit: 10 } });
    const input = { actualOutputBaseQty: 10, finishedBatchNumber: "FINISHED-1", manufacturedOn: day(), expiresOn: day(365), qcStatus: "conditional", consumptions: [{ productId: raw.id, inventoryLotId: lot.id, sellingUnitId: rawPack.id, packageCount: 1, actualBaseQty: 10 }, { productId: label.id, actualBaseQty: 2 }], outputs: [{ sellingUnitId: outputPack.id, packageCount: 2, quantityBaseQty: 4 }, { sellingUnitId: outputPack.id, packageCount: 3, quantityBaseQty: 6 }] };
    return { ...tenant, shopId, raw, label, finished, rawPack, outputPack, bom, run, lot, input };
  }

  test("invalid materials, source lots and pack totals roll back the whole stock transaction", async () => {
    const f = await fixture();
    const unchanged = async () => {
      assert.equal((await ctx.db.productionRun.findUnique({ where: { id: f.run.id } })).status, "planned");
      assert.equal((await ctx.db.product.findUnique({ where: { id: f.raw.id } })).stockBaseQty, 100);
      assert.equal((await ctx.db.product.findUnique({ where: { id: f.label.id } })).stockBaseQty, 20);
      assert.equal((await ctx.db.productSellingUnit.findUnique({ where: { id: f.rawPack.id } })).onHandQty, 10);
      assert.equal((await ctx.db.inventoryLot.findUnique({ where: { id: f.lot.id } })).availableBaseQty, 100);
      assert.equal(await ctx.db.stockLedger.count({ where: { sourceId: f.run.id } }), 0);
      assert.equal(await ctx.db.inventoryLot.count({ where: { producedByRunId: f.run.id } }), 0);
      assert.equal(await ctx.db.productionConsumption.count({ where: { runId: f.run.id } }), 0);
    };
    const bad = async (input, code) => { await assert.rejects(() => production.completeRun(f.shopId, f.run.id, input), { code }); await unchanged(); };
    await bad({ ...f.input, consumptions: f.input.consumptions.slice(0, 1) }, "PRODUCTION_MATERIALS_INCOMPLETE");
    await bad({ ...f.input, consumptions: f.input.consumptions.map((row) => ({ ...row, inventoryLotId: null })) }, "PRODUCTION_SOURCE_BATCH_REQUIRED");
    await bad({ ...f.input, outputs: [{ sellingUnitId: f.outputPack.id, packageCount: 4, quantityBaseQty: 10 }] }, "PRODUCTION_PACKAGING_MISMATCH");
    await bad({ ...f.input, outputs: [{ quantityBaseQty: 10 }] }, "PRODUCTION_PACKAGING_REQUIRED");
    await bad({ ...f.input, actualOutputBaseQty: 10.01 }, "PRODUCTION_OUTPUT_MISMATCH");
    await ctx.db.inventoryLot.update({ where: { id: f.lot.id }, data: { expiresOn: new Date(day(-1)) } });
    await bad(f.input, "INSUFFICIENT_BATCH_STOCK");
    await ctx.db.inventoryLot.update({ where: { id: f.lot.id }, data: { expiresOn: new Date(day(365)), status: "quarantined" } });
    await bad(f.input, "INSUFFICIENT_BATCH_STOCK");
    await ctx.db.product.update({ where: { id: f.finished.id }, data: { batchTrackingEnabled: false } });
    await bad(f.input, "FINISHED_PRODUCT_BATCH_TRACKING_REQUIRED");
  });

  test("held production reconciles pack counts, traces sources and can release only once without adding stock again", async () => {
    const f = await fixture();
    const held = await production.completeRun(f.shopId, f.run.id, f.input, { locationId: f.run.locationId, userId: f.owner.id });
    assert.equal(held.status, "quarantined");
    assert.equal((await ctx.db.product.findUnique({ where: { id: f.raw.id } })).stockBaseQty, 90);
    assert.equal((await ctx.db.product.findUnique({ where: { id: f.finished.id } })).stockBaseQty, 10);
    assert.equal((await ctx.db.productSellingUnit.findUnique({ where: { id: f.rawPack.id } })).onHandQty, 9);
    assert.equal((await ctx.db.productSellingUnit.findUnique({ where: { id: f.outputPack.id } })).onHandQty, 5, "repeated output packaging rows must be summed");
    assert.equal((await ctx.db.inventoryLot.findFirst({ where: { producedByRunId: f.run.id } })).status, "quarantined");
    assert.equal((await production.traceBatch(f.shopId, "RAW-1")).consumedBy[0].runId, f.run.id);
    await assert.rejects(() => production.completeRun(f.shopId, f.run.id, f.input), { code: "PRODUCTION_RUN_ALREADY_CLOSED" });
    await assert.rejects(() => production.releaseRun(f.shopId, f.run.id, { locationId: "wrong" }), { code: "PRODUCTION_LOCATION_MISMATCH" });
    const outputLot = await ctx.db.inventoryLot.findFirst({ where: { producedByRunId: f.run.id } });
    for (const data of [{ status: "recalled" }, { status: "quarantined", expiresOn: new Date(day(-1)) }]) {
      await ctx.db.inventoryLot.update({ where: { id: outputLot.id }, data });
      await assert.rejects(() => production.releaseRun(f.shopId, f.run.id), { code: "PRODUCTION_BATCH_NOT_RELEASABLE" });
      assert.equal((await ctx.db.productionRun.findUnique({ where: { id: f.run.id } })).status, "quarantined", "a rejected release must roll back its run claim");
    }
    await ctx.db.inventoryLot.update({ where: { id: outputLot.id }, data: { status: "quarantined", expiresOn: new Date(day(365)) } });
    const released = await production.releaseRun(f.shopId, f.run.id, { locationId: f.run.locationId });
    assert.equal(released.qcStatus, "passed");
    assert.equal((await ctx.db.inventoryLot.findFirst({ where: { producedByRunId: f.run.id } })).status, "active");
    await assert.rejects(() => production.releaseRun(f.shopId, f.run.id), { code: "PRODUCTION_RUN_NOT_ON_HOLD" });
    assert.equal((await ctx.db.product.findUnique({ where: { id: f.finished.id } })).stockBaseQty, 10);
    assert.equal(await ctx.db.stockLedger.count({ where: { sourceId: f.run.id } }), 3);
  });

  test("run details enforce tenant, role and location access and filter unusable batches", async () => {
    const f = await fixture(); const other = await createTenant(ctx.db, { ownerMobile: String(phoneSequence++) });
    await assert.rejects(() => production.runDetails(other.shop.id, f.run.id), { code: "PRODUCTION_RUN_NOT_FOUND" });
    await assert.rejects(() => production.runDetails(f.shopId, f.run.id, { locationId: "wrong" }), { code: "PRODUCTION_LOCATION_MISMATCH" });
    const auth = await login(ctx, f.ownerMobile, f.ownerPassword);
    const detail = assertSuccess(await ctx.get(`/api/manufacturing/runs/${f.run.id}`, { token: auth.accessToken, headers: { "x-location-id": f.run.locationId } }));
    assert.equal(detail.products.length, 3); assert.equal(detail.lots.length, 1);
    const staff = await createStaff(ctx.db, f.shopId, { mobile: String(phoneSequence++) }); const staffAuth = await login(ctx, staff.staffMobile, staff.staffPassword);
    const denied = await ctx.get(`/api/manufacturing/runs/${f.run.id}`, { token: staffAuth.accessToken });
    assert.equal(denied.status, 403);
    await ctx.db.inventoryLot.update({ where: { id: f.lot.id }, data: { expiresOn: new Date(day(-1)) } });
    assert.equal((await production.runDetails(f.shopId, f.run.id)).lots.length, 0);
    for (let i = 0; i < 21; i++) await ctx.db.productionRun.create({ data: { shopId: f.shopId, locationId: f.run.locationId, bomId: f.bom.id, runNumber: `CLOSED-${i}`, plannedOutputBaseQty: 10, status: "completed" } });
    const overview = await production.overview(f.shopId);
    assert.equal(overview.recentRuns[0].id, f.run.id, "old open work cannot disappear behind newer completed runs");
    assert.equal(overview.recentRuns.length, 21);
  });

  test("split source batches and mixed output packs reconcile genealogy, stock and pack ledger through the HTTP API", async () => {
    const f = await fixture();
    await ctx.db.inventoryLot.update({ where: { id: f.lot.id }, data: { receivedBaseQty: 6, availableBaseQty: 6, sellingUnitId: f.rawPack.id } });
    const secondLot = await ctx.db.inventoryLot.create({ data: { shopId: f.shopId, locationId: f.run.locationId, productId: f.raw.id, batchNumber: "RAW-2", expiresOn: new Date(day(365)), receivedBaseQty: 94, availableBaseQty: 94, costPerRateUnit: 10, sellingUnitId: f.rawPack.id } });
    const carton = await ctx.db.productSellingUnit.create({ data: { shopId: f.shopId, productId: f.finished.id, name: "Carton", unitType: "pack", unitCode: "carton", conversionToBase: 3, onHandQty: 0, defaultPrice: 30 } });
    const input = { ...f.input, consumptions: [
      { ...f.input.consumptions[0], actualBaseQty: 6, packageCount: 0.6 },
      { ...f.input.consumptions[0], inventoryLotId: secondLot.id, actualBaseQty: 4, packageCount: 0.4 },
      f.input.consumptions[1],
    ], outputs: [f.input.outputs[0], { sellingUnitId: carton.id, packageCount: 2, quantityBaseQty: 6 }] };
    const auth = await login(ctx, f.ownerMobile, f.ownerPassword);
    const result = assertSuccess(await ctx.post(`/api/manufacturing/runs/${f.run.id}/complete`, input, { token: auth.accessToken, headers: { "x-location-id": f.run.locationId } }));
    assert.equal(result.consumptions.length, 3);
    const rawConsumption = result.consumptions.filter((row) => row.productId === f.raw.id);
    assert.deepEqual(rawConsumption.map((row) => row.plannedBaseQty).sort(), [4, 6]);
    assert.equal((await ctx.db.inventoryLot.findUnique({ where: { id: f.lot.id } })).status, "depleted");
    assert.equal((await ctx.db.inventoryLot.findUnique({ where: { id: secondLot.id } })).availableBaseQty, 90);
    assert.equal((await ctx.db.product.findUnique({ where: { id: f.raw.id } })).stockBaseQty, 90);
    assert.equal((await ctx.db.productSellingUnit.findUnique({ where: { id: f.rawPack.id } })).onHandQty, 9);
    for (const packId of [f.outputPack.id, carton.id]) assert.equal((await ctx.db.productSellingUnit.findUnique({ where: { id: packId } })).onHandQty, 2);
    const ledger = await ctx.db.stockLedger.findMany({ where: { sourceId: f.run.id, action: "production_output" } });
    assert.equal(ledger.length, 2);
    assert.equal(ledger.reduce((sum, row) => sum + row.changeBaseQty, 0), 10);
    assert.equal(ledger.find((row) => row.sellingUnitId === f.outputPack.id).sellingUnitQty, 2);
    assert.equal(ledger.find((row) => row.sellingUnitId === carton.id).sellingUnitQty, 2);
    assert.deepEqual(ledger.map((row) => [row.oldStockBaseQty, row.newStockBaseQty]).sort((a, b) => a[0] - b[0]), [[0, 4], [4, 10]]);
    for (const batch of ["RAW-1", "RAW-2"]) assert.equal((await production.traceBatch(f.shopId, batch)).consumedBy[0].runId, f.run.id);
    await production.releaseRun(f.shopId, f.run.id);
    assert.equal(await ctx.db.stockLedger.count({ where: { sourceId: f.run.id } }), 5);
    await assert.rejects(() => production.completeRun(f.shopId, f.run.id, input), { code: "PRODUCTION_RUN_ALREADY_CLOSED" });
    assert.equal((await ctx.db.product.findUnique({ where: { id: f.finished.id } })).stockBaseQty, 10);
  });

  test("a later split failure or wrong source packaging rolls back earlier sources and the run claim", async () => {
    const f = await fixture();
    const secondLot = await ctx.db.inventoryLot.create({ data: { shopId: f.shopId, locationId: f.run.locationId, productId: f.raw.id, batchNumber: "RAW-SMALL", expiresOn: new Date(day(365)), receivedBaseQty: 3, availableBaseQty: 3, costPerRateUnit: 10 } });
    const split = { ...f.input, consumptions: [
      { ...f.input.consumptions[0], actualBaseQty: 6, packageCount: 0.6 },
      { ...f.input.consumptions[0], inventoryLotId: secondLot.id, actualBaseQty: 4, packageCount: 0.4 },
      f.input.consumptions[1],
    ] };
    await assert.rejects(() => production.completeRun(f.shopId, f.run.id, split), { code: "INSUFFICIENT_BATCH_STOCK" });
    await assert.rejects(() => production.completeRun(f.shopId, f.run.id, { ...f.input, consumptions: [...f.input.consumptions, f.input.consumptions[0]] }), { code: "DUPLICATE_CONSUMPTION" });
    await ctx.db.inventoryLot.update({ where: { id: f.lot.id }, data: { sellingUnitId: "different-pack" } });
    await assert.rejects(() => production.completeRun(f.shopId, f.run.id, f.input), { code: "PRODUCTION_SOURCE_PACK_MISMATCH" });
    await ctx.db.inventoryLot.update({ where: { id: f.lot.id }, data: { sellingUnitId: f.rawPack.id } });
    await ctx.db.productSellingUnit.update({ where: { id: f.rawPack.id }, data: { onHandQty: 0 } });
    await assert.rejects(() => production.completeRun(f.shopId, f.run.id, f.input), { code: "PRODUCTION_PACK_STOCK_SHORT" });
    await ctx.db.productSellingUnit.update({ where: { id: f.rawPack.id }, data: { onHandQty: 10 } });
    assert.equal((await ctx.db.inventoryLot.findUnique({ where: { id: f.lot.id } })).availableBaseQty, 100);
    assert.equal((await ctx.db.product.findUnique({ where: { id: f.raw.id } })).stockBaseQty, 100);
    assert.equal((await ctx.db.productSellingUnit.findUnique({ where: { id: f.rawPack.id } })).onHandQty, 10);
    assert.equal((await ctx.db.productionRun.findUnique({ where: { id: f.run.id } })).status, "planned");
    assert.equal(await ctx.db.productionConsumption.count({ where: { runId: f.run.id } }), 0);
    assert.equal(await ctx.db.stockLedger.count({ where: { sourceId: f.run.id } }), 0);
  });
}
