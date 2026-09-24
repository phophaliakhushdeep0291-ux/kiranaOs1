import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createIntegrationContext, resetDatabase } from "./setup.js";
import { createTenant, createProduct } from "./factories.js";
import { settingsForBusinessType } from "../../src/verticals/registry.js";
import { confirmBill, cancelBill, restoreCancelledBill, createSaleReturn } from "../../src/modules/bills/bills.service.js";
import { setComboComponents } from "../../src/verticals/restaurant/menu/combos.service.js";
import { listProducts } from "../../src/modules/products/products.service.js";

const ctx = await createIntegrationContext();
if (ctx.skip) test("restaurant stock unavailable", { skip: ctx.reason }, () => {});
else {
  after(() => ctx.close());
  beforeEach(() => resetDatabase(ctx.db));
  async function fixture() {
    const tenant = await createTenant(ctx.db, { planCode: "pro" });
    const shopId = tenant.shop.id;
    await ctx.db.shop.update({ where: { id: shopId }, data: { settingsJson: JSON.stringify(settingsForBusinessType("restaurant")) } });
    const dish = await createProduct(ctx.db, shopId, { name: "Dal Fry", stockBaseQty: -12, stockTrackingEnabled: false, lowStockThreshold: 5, defaultPricePerRateUnit: 100 });
    await ctx.db.product.update({ where: { id: dish.id }, data: { stockTrackingEnabled: false } });
    const drink = await createProduct(ctx.db, shopId, { name: "Bottled Water", stockBaseQty: 10, stockTrackingEnabled: true, defaultPricePerRateUnit: 20 });
    const stock = async (product) => (await ctx.db.product.findUniqueOrThrow({ where: { id: product.id } })).stockBaseQty;
    const line = (product, quantity = 1) => ({ productId: product.id, name: product.name, quantity, enteredUnit: "piece", ratePerRateUnit: product.defaultPricePerRateUnit, gstRate: 0 });
    const sale = (items, key) => confirmBill(shopId, { billType: "normal_sale", gstMode: "none", customerName: "Walk-in", items, discount: 0,
      payments: [{ mode: "cash", amount: items.reduce((total, item) => total + item.quantity * item.ratePerRateUnit, 0) }],
      ...(key ? { idempotencyKey: key } : {}),
    });
    return { tenant, shopId, dish, drink, stock, line, sale };
  }

  test("strict billing and low-stock reports honour dish tracking while stocked drinks still move", async () => {
    const f = await fixture();
    const bill = await f.sale([f.line(f.dish, 2), f.line(f.drink)]);
    assert.equal(await f.stock(f.dish), -12, "historical counts are preserved, never decremented again");
    assert.equal(await f.stock(f.drink), 9);
    assert.deepEqual((await ctx.db.stockLedger.findMany({ where: { billId: bill.id } })).map((row) => row.productId), [f.drink.id]);
    assert.ok(!(await listProducts(f.shopId, { lowStock: true })).some((row) => row.id === f.dish.id));
  });

  test("cancelling and restoring a mixed bill never invents dish stock", async () => {
    const f = await fixture();
    const bill = await f.sale([f.line(f.dish), f.line(f.drink)]);
    await cancelBill(f.shopId, bill.id, { reason: "Wrong table" });
    assert.equal(await f.stock(f.dish), -12);
    assert.equal(await f.stock(f.drink), 10);
    await restoreCancelledBill(f.shopId, bill.id, { reason: "Confirmed correct table" });
    assert.equal(await f.stock(f.dish), -12);
    assert.equal(await f.stock(f.drink), 9);
    assert.equal(await ctx.db.stockLedger.count({ where: { billId: bill.id, productId: f.dish.id } }), 0);
  });

  test("refunding an untracked dish records money without returning a fictional plate to stock", async () => {
    const f = await fixture();
    const bill = await f.sale([f.line(f.dish)]);
    const returned = await createSaleReturn(f.shopId, { returnOfBillId: bill.id, refundMode: "cash", reason: "Dish refund", items: [{ ...f.line(f.dish), originalBillItemId: bill.items[0].id }] });
    assert.equal(returned.grandTotal, -100);
    assert.equal(await f.stock(f.dish), -12);
    assert.equal(await ctx.db.stockLedger.count({ where: { billId: returned.id } }), 0);
  });

  test("combo billing consumes ingredients and counted goods exactly once, with no combo or untracked component decrement", async () => {
    const f = await fixture();
    const combo = await createProduct(ctx.db, f.shopId, { name: "Lunch Combo", stockBaseQty: 0, defaultPricePerRateUnit: 120 });
    const cooked = await createProduct(ctx.db, f.shopId, { name: "Rice Plate", stockBaseQty: 0, defaultPricePerRateUnit: 50 });
    await ctx.db.dishRecipeComponent.create({ data: { shopId: f.shopId, dishProductId: cooked.id, ingredientProductId: f.drink.id, ingredientName: f.drink.name, qtyBase: 0.5 } });
    await setComboComponents(f.shopId, combo.id, [f.dish, cooked, f.drink].map((product) => ({ componentProductId: product.id, quantity: 1 })));
    assert.equal((await ctx.db.product.findUniqueOrThrow({ where: { id: combo.id } })).stockTrackingEnabled, false);
    // Old synced records can still have the flag set. The server's combo guard
    // must own stock even before that till receives the migration.
    await ctx.db.product.update({ where: { id: combo.id }, data: { stockTrackingEnabled: true } });
    const bill = await f.sale([f.line(combo)], "combo-stock-once");
    assert.equal((await f.sale([f.line(combo)], "combo-stock-once")).id, bill.id);
    assert.equal(await f.stock(combo), 0);
    assert.equal(await f.stock(f.dish), -12);
    assert.equal(await f.stock(cooked), 0);
    assert.equal(await f.stock(f.drink), 8.5, "0.5 recipe use plus one direct component");
    const rows = await ctx.db.stockLedger.findMany({ where: { billId: bill.id } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, "recipe_use");
    assert.equal(rows[0].changeBaseQty, -1.5);
  });

  test("combo migration stops tracking assembled meals and preserves counted components and history", async (t) => {
    if (!process.env.DATABASE_URL?.startsWith("file:")) return t.skip("SQLite migration proof");
    const f = await fixture();
    const combo = await createProduct(ctx.db, f.shopId, { name: "Legacy Combo", stockBaseQty: -3 });
    await ctx.db.menuComboComponent.create({ data: { shopId: f.shopId, comboProductId: combo.id, componentProductId: f.drink.id, componentName: f.drink.name, quantity: 1 } });
    const sql = await readFile(new URL("../../prisma/migrations/20260923070000_combo_stock_tracking/migration.sql", import.meta.url), "utf8");
    await ctx.db.$executeRawUnsafe(sql);
    await ctx.db.$executeRawUnsafe(sql);
    const stored = await ctx.db.product.findUniqueOrThrow({ where: { id: combo.id } });
    assert.equal(stored.stockTrackingEnabled, false);
    assert.equal(stored.stockBaseQty, -3);
    assert.equal((await ctx.db.product.findUniqueOrThrow({ where: { id: f.drink.id } })).stockTrackingEnabled, true);
  });
}
