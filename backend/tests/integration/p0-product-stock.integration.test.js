/**
 * Regression test for P0-3 in docs/STABILIZATION_AUDIT.md.
 *
 * `updateProductSchema` accepts `stockBaseQty`, and products.service.updateProduct
 * used to spread it straight into `tx.product.update`. That rewrote on-hand stock
 * with no StockLedger row, no LocationStock adjustment, and last-write-wins over a
 * concurrent sale — while POST /api/inventory/correction does the same job
 * correctly behind the shared inventory primitive.
 *
 * Bulk edit legitimately sets stock through this route, so the capability is kept.
 * What must hold is the invariant: on-hand stock only ever moves via a recorded
 * movement. These tests fail against the unfixed service.
 */
import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertSuccess } from "./setup.js";
import { createProduct, createTenant, login } from "./factories.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("p0 product stock tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  describe("P0-3 — product update must never move stock without recording it", () => {
    test("setting stockBaseQty on PATCH writes a StockLedger movement", async () => {
      const tenant = await createTenant(ctx.db);
      const session = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 50 });

      const response = await ctx.patch(
        `/api/products/${product.id}`,
        { name: "Renamed Product", stockBaseQty: 80 },
        { token: session.accessToken, ownerPin: tenant.ownerPin },
      );
      assertSuccess(response, 200);

      const fresh = await ctx.db.product.findUnique({ where: { id: product.id } });
      assert.equal(fresh.name, "Renamed Product", "the non-stock edit should still apply");
      assert.equal(Number(fresh.stockBaseQty), 80, "requested stock should be applied");

      const movements = await ctx.db.stockLedger.findMany({
        where: { shopId: tenant.shop.id, productId: product.id },
      });
      assert.equal(movements.length, 1, "exactly one movement must record the change");
      assert.equal(Number(movements[0].changeBaseQty), 30);
      assert.equal(Number(movements[0].oldStockBaseQty), 50);
      assert.equal(Number(movements[0].newStockBaseQty), 80);
    });

    test("current stock equals the sum of recorded movements after product edits", async () => {
      const tenant = await createTenant(ctx.db);
      const session = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 0 });

      for (const qty of [10, 45, 7]) {
        await ctx.patch(
          `/api/products/${product.id}`,
          { stockBaseQty: qty },
          { token: session.accessToken, ownerPin: tenant.ownerPin },
        );
      }

      const fresh = await ctx.db.product.findUnique({ where: { id: product.id } });
      const movements = await ctx.db.stockLedger.findMany({
        where: { shopId: tenant.shop.id, productId: product.id },
      });
      const summed = movements.reduce((total, row) => total + Number(row.changeBaseQty), 0);

      assert.equal(Number(fresh.stockBaseQty), 7, "final stock should be the last requested value");
      assert.equal(summed, 7, "sum of movements must equal on-hand stock");
    });

    test("an edit that does not touch stock records no phantom movement", async () => {
      const tenant = await createTenant(ctx.db);
      const session = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 25 });

      await ctx.patch(
        `/api/products/${product.id}`,
        { name: "Only A Rename" },
        { token: session.accessToken, ownerPin: tenant.ownerPin },
      );

      const movements = await ctx.db.stockLedger.findMany({
        where: { shopId: tenant.shop.id, productId: product.id },
      });
      assert.equal(movements.length, 0, "a pure rename must not write a stock movement");

      const fresh = await ctx.db.product.findUnique({ where: { id: product.id } });
      assert.equal(Number(fresh.stockBaseQty), 25);
    });
  });
}
