import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertSuccess, TEST_DATABASE_URL } from "./setup.js";
import { billPayload, createCustomer, createProduct, createTenant, login } from "./factories.js";
import { isSqliteTestDatabaseUrl } from "../../scripts/test-db-utils.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("production concurrency integration tests skipped", { skip: ctx.reason }, () => {});
} else if (isSqliteTestDatabaseUrl(TEST_DATABASE_URL)) {
  after(async () => ctx.close());
  test("production concurrency integration tests skipped on SQLite", {
    skip: "SQLite cannot prove production concurrent write behavior; run npm run test:postgres for the PostgreSQL proof.",
  }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  async function ownerCtx() {
    const tenant = await createTenant(ctx.db, { ownerPin: "1234" });
    const ownerAuth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    return { tenant, ownerAuth };
  }

  describe("production concurrency proof", () => {
    test("parallel bills cannot oversell the same product", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, {
        stockBaseQty: 10,
        defaultPricePerRateUnit: 20,
        costPerRateUnit: 10,
      });

      const payload = billPayload(product, {
        quantity: 7,
        ratePerRateUnit: 20,
        payments: [{ mode: "cash", amount: 140 }],
      });

      const [first, second] = await Promise.all([
        ctx.post("/api/bills/confirm", payload, { token: ownerAuth.accessToken }),
        ctx.post("/api/bills/confirm", payload, { token: ownerAuth.accessToken }),
      ]);

      const statuses = [first.status, second.status].sort();
      assert.deepEqual(statuses, [201, 409], JSON.stringify([first.body, second.body]));

      const refreshedProduct = await ctx.db.product.findUnique({ where: { id: product.id } });
      const activeBills = await ctx.db.bill.count({ where: { shopId: tenant.shop.id, status: "active" } });
      const saleLedger = await ctx.db.stockLedger.count({ where: { shopId: tenant.shop.id, productId: product.id, action: "sale" } });

      assert.equal(refreshedProduct.stockBaseQty, 3);
      assert.equal(activeBills, 1);
      assert.equal(saleLedger, 1);
      assert.ok(refreshedProduct.stockBaseQty >= 0, "stock must never become negative");
    });

    test("parallel udhar payments cannot over-decrement customer balance", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id, { udharAmount: 100, type: "udhar" });

      const paymentPayload = { amount: 80, mode: "cash", note: "parallel payment proof" };
      const [first, second] = await Promise.all([
        ctx.post(`/api/customers/${customer.id}/udhar-payment`, paymentPayload, { token: ownerAuth.accessToken }),
        ctx.post(`/api/customers/${customer.id}/udhar-payment`, paymentPayload, { token: ownerAuth.accessToken }),
      ]);

      const statuses = [first.status, second.status].sort();
      assert.deepEqual(statuses, [200, 409], JSON.stringify([first.body, second.body]));

      const refreshedCustomer = await ctx.db.customer.findUnique({ where: { id: customer.id } });
      const paymentLedgers = await ctx.db.udharLedger.count({ where: { shopId: tenant.shop.id, customerId: customer.id, type: "payment" } });

      assert.equal(refreshedCustomer.udharAmount, 20);
      assert.equal(paymentLedgers, 1);
      assert.ok(refreshedCustomer.udharAmount >= 0, "udhar must never become negative");
    });

    test("protected API tests use active device enforcement instead of bypassing it", async () => {
      const { ownerAuth } = await ownerCtx();
      const productList = assertSuccess(await ctx.get("/api/products", { token: ownerAuth.accessToken }));
      assert.ok(Array.isArray(productList));
    });
  });
}
