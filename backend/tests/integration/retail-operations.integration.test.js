import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { billPayload, createCustomer, createProduct, createTenant, login } from "./factories.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("retail operations integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  async function ownerContext(overrides = {}) {
    const tenant = await createTenant(ctx.db, { planCode: "pro", gstNumber: "27AAPFU0939F1ZV", ...overrides });
    const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    return { tenant, auth };
  }

  describe("retail operations foundation", () => {
    test("creates a second store and atomically transfers location stock", async () => {
      const { tenant, auth } = await ownerContext();
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "Branch Rice", stockBaseQty: 20 });
      const locations = assertSuccess(await ctx.get("/api/stores", { token: auth.accessToken }));
      assert.equal(locations.locations.length, 1);
      assert.equal(locations.locations[0].isPrimary, true);

      const branch = assertSuccess(await ctx.post("/api/stores", { name: "Market Branch", code: "MKT01", city: "Pune" }, { token: auth.accessToken }), 201);
      const transfer = assertSuccess(await ctx.post("/api/stores/transfers", {
        fromLocationId: locations.locations[0].id,
        toLocationId: branch.id,
        items: [{ productId: product.id, quantityBaseQty: 7 }],
        note: "Opening stock",
        ownerPin: tenant.ownerPin,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 201);
      assert.equal(transfer.status, "completed");

      const mainInventory = assertSuccess(await ctx.get(`/api/stores/${locations.locations[0].id}/inventory`, { token: auth.accessToken }));
      const branchInventory = assertSuccess(await ctx.get(`/api/stores/${branch.id}/inventory`, { token: auth.accessToken }));
      assert.equal(mainInventory.products.find((row) => row.id === product.id).stockBaseQty, 13);
      assert.equal(branchInventory.products.find((row) => row.id === product.id).stockBaseQty, 7);
      assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 20, "a transfer must not change company-wide stock");

      const overdraw = assertFailure(await ctx.post("/api/stores/transfers", {
        fromLocationId: branch.id,
        toLocationId: locations.locations[0].id,
        items: [{ productId: product.id, quantityBaseQty: 8 }], ownerPin: tenant.ownerPin,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 409);
      assert.equal(overdraw.code, "INSUFFICIENT_LOCATION_STOCK");
    });

    test("enforces the subscribed store limit", async () => {
      const { tenant, auth } = await ownerContext();
      assertSuccess(await ctx.get("/api/stores", { token: auth.accessToken }));
      assertSuccess(await ctx.post("/api/stores", { name: "Second Store", code: "S02" }, { token: auth.accessToken }), 201);
      const blocked = assertFailure(await ctx.post("/api/stores", { name: "Third Store", code: "S03" }, { token: auth.accessToken }), 403);
      assert.equal(blocked.code, "STORE_LIMIT_REACHED");
    });

    test("earns loyalty points once and reverses available points on bill cancellation", async () => {
      const { tenant, auth } = await ownerContext();
      const customer = await createCustomer(ctx.db, tenant.shop.id, { name: "Loyal Buyer" });
      const product = await createProduct(ctx.db, tenant.shop.id, { defaultPricePerRateUnit: 20, stockBaseQty: 20 });
      assertSuccess(await ctx.request("PUT", "/api/loyalty/program", { token: auth.accessToken, ownerPin: tenant.ownerPin, body: { active: true, pointsPerRupee: 2, redemptionPaisePerPoint: 25, minimumRedeemPoints: 10, ownerPin: tenant.ownerPin } }));

      const bill = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, { customerId: customer.id, customerName: customer.name, quantity: 2 }), { token: auth.accessToken }), 201);
      const account = assertSuccess(await ctx.get(`/api/loyalty/accounts/${customer.id}`, { token: auth.accessToken }));
      assert.equal(account.account.pointsBalance, 80);
      assert.equal(account.account.transactions.filter((row) => row.type === "earn").length, 1);

      assertSuccess(await ctx.post(`/api/bills/${bill.id}/cancel`, { reason: "Customer changed mind" }, { token: auth.accessToken, ownerPin: tenant.ownerPin }));
      const reversed = assertSuccess(await ctx.get(`/api/loyalty/accounts/${customer.id}`, { token: auth.accessToken }));
      assert.equal(reversed.account.pointsBalance, 0);
      assert.equal(reversed.account.transactions.some((row) => row.type === "adjustment" && row.points === -80), true);
    });

    test("reports GST readiness, exports an HSN invoice register, and blocks fake legal submission", async () => {
      const { tenant, auth } = await ownerContext();
      const customer = await createCustomer(ctx.db, tenant.shop.id, { name: "GST Buyer" });
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "Taxed Goods", hsn: "1905", gstRate: 5, defaultPricePerRateUnit: 105 });
      const bill = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, { billType: "gst_invoice", customerId: customer.id, customerName: customer.name, quantity: 1, ratePerRateUnit: 105, gstRate: 5 }), { token: auth.accessToken }), 201);

      const readiness = assertSuccess(await ctx.get("/api/compliance/readiness", { token: auth.accessToken }));
      assert.equal(readiness.checks.find((row) => row.key === "gstin").ready, true);
      assert.equal(readiness.checks.find((row) => row.key === "hsn").ready, true);
      assert.equal(readiness.provider.legalSubmission, false);

      const csv = await ctx.get("/api/compliance/gst-register?range=yearly&format=csv", { token: auth.accessToken });
      assert.equal(csv.status, 200);
      assert.match(csv.text, /Invoice Number/);
      assert.match(csv.text, /1905/);
      assert.match(csv.text, new RegExp(bill.billNo));

      const disabled = assertFailure(await ctx.post(`/api/compliance/e-invoices/${bill.id}/sandbox`, {}, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 503);
      assert.equal(disabled.code, "GST_PROVIDER_NOT_CONFIGURED");
    });
  });
}

