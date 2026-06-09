import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { activateDeviceViaApi, createCustomer, createPaidBillViaApi, createProduct, createTenant, login } from "./factories.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("tenant isolation integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  async function tenants() {
    const a = await createTenant(ctx.db, { shopName: "Tenant A" });
    const b = await createTenant(ctx.db, { shopName: "Tenant B" });
    const authA = await login(ctx, a.ownerMobile, a.ownerPassword);
    const authB = await login(ctx, b.ownerMobile, b.ownerPassword);
    return { a, b, authA, authB };
  }

  describe("cross-shop tenant isolation", () => {
    test("product from Shop A cannot be read/updated by Shop B", async () => {
      const { a, authB } = await tenants();
      const productA = await createProduct(ctx.db, a.shop.id, { name: "Private Product A" });
      assertFailure(await ctx.get(`/api/products/${productA.id}`, { token: authB.accessToken }), 404);
      assertFailure(await ctx.patch(`/api/products/${productA.id}`, { name: "Cross Update" }, { token: authB.accessToken }), 404);
    });

    test("customer from Shop A cannot be read/updated by Shop B", async () => {
      const { a, authB } = await tenants();
      const customerA = await createCustomer(ctx.db, a.shop.id, { name: "Private Customer A" });
      assertFailure(await ctx.get(`/api/customers/${customerA.id}`, { token: authB.accessToken }), 404);
      assertFailure(await ctx.patch(`/api/customers/${customerA.id}`, { name: "Cross Update" }, { token: authB.accessToken }), 404);
    });

    test("bill from Shop A cannot be accessed by Shop B", async () => {
      const { a, authA, authB } = await tenants();
      const productA = await createProduct(ctx.db, a.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 20 });
      const billA = await createPaidBillViaApi(ctx, authA.accessToken, productA, { quantity: 1, ratePerRateUnit: 20 });
      assertFailure(await ctx.get(`/api/bills/${billA.id}`, { token: authB.accessToken }), 404);
    });

    test("sync pull for Shop A does not return Shop B data", async () => {
      const { a, b, authA } = await tenants();
      const productA = await createProduct(ctx.db, a.shop.id, { name: "Sync Tenant A" });
      const productB = await createProduct(ctx.db, b.shop.id, { name: "Sync Tenant B" });
      const since = encodeURIComponent(new Date(0).toISOString());
      const deviceA = await activateDeviceViaApi(ctx, authA.accessToken, { deviceId: "tenant-sync-a" });
      const data = assertSuccess(await ctx.get(`/api/sync/pull?since=${since}&limit=100`, { token: authA.accessToken, headers: { "x-device-id": deviceA.deviceId } }));
      assert.ok(data.products.some((p) => p.id === productA.id));
      assert.equal(data.products.some((p) => p.id === productB.id), false);
    });

    test("reports for Shop A do not include Shop B data", async () => {
      const { a, b, authA, authB } = await tenants();
      const productA = await createProduct(ctx.db, a.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 10 });
      const productB = await createProduct(ctx.db, b.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 90 });
      await createPaidBillViaApi(ctx, authA.accessToken, productA, { quantity: 1, ratePerRateUnit: 10 });
      await createPaidBillViaApi(ctx, authB.accessToken, productB, { quantity: 1, ratePerRateUnit: 90 });
      const summaryA = assertSuccess(await ctx.get("/api/reports/payment-summary", { token: authA.accessToken }));
      assert.equal(summaryA.total, 10);
    });
  });
}
