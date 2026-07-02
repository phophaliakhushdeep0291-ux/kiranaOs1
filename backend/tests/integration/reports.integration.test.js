import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { createCustomer, createPaidBillViaApi, createProduct, createStaff, createTenant, login } from "./factories.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("report integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  describe("report integration", () => {
    test("daily/sales summary via payment-summary endpoint works", async () => {
      const tenant = await createTenant(ctx.db);
      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 25 });
      await createPaidBillViaApi(ctx, auth.accessToken, product, { quantity: 2, ratePerRateUnit: 25 });
      const summary = assertSuccess(await ctx.get("/api/reports/payment-summary", { token: auth.accessToken }));
      assert.equal(summary.cash, 50);
      assert.equal(summary.total, 50);
    });

    test("P&L blocks staff", async () => {
      const tenant = await createTenant(ctx.db);
      const staff = await createStaff(ctx.db, tenant.shop.id);
      const staffAuth = await login(ctx, staff.staffMobile, staff.staffPassword);
      assertFailure(await ctx.get("/api/reports/pnl?range=daily", { token: staffAuth.accessToken }), 403);
    });

    test("owner can access P&L", async () => {
      const tenant = await createTenant(ctx.db);
      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      const pnl = assertSuccess(await ctx.get("/api/reports/pnl?range=daily", { token: auth.accessToken }));
      assert.equal(typeof pnl.grossSales, "number");
    });

    test("payment summary works", async () => {
      const tenant = await createTenant(ctx.db);
      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      const summary = assertSuccess(await ctx.get("/api/reports/payment-summary", { token: auth.accessToken }));
      assert.equal(typeof summary.total, "number");
    });

    test("report data is shop-scoped", async () => {
      const a = await createTenant(ctx.db);
      const b = await createTenant(ctx.db);
      const authA = await login(ctx, a.ownerMobile, a.ownerPassword);
      const authB = await login(ctx, b.ownerMobile, b.ownerPassword);
      const productA = await createProduct(ctx.db, a.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 25 });
      const productB = await createProduct(ctx.db, b.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 100 });
      await createPaidBillViaApi(ctx, authA.accessToken, productA, { quantity: 1, ratePerRateUnit: 25 });
      await createPaidBillViaApi(ctx, authB.accessToken, productB, { quantity: 1, ratePerRateUnit: 100 });
      const summaryA = assertSuccess(await ctx.get("/api/reports/payment-summary", { token: authA.accessToken }));
      assert.equal(summaryA.total, 25);
    });

    test("cancelled records are excluded from active payment summary", async () => {
      const tenant = await createTenant(ctx.db);
      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 40 });
      const bill = await createPaidBillViaApi(ctx, auth.accessToken, product, { quantity: 1, ratePerRateUnit: 40 });
      await ctx.post(`/api/bills/${bill.id}/cancel`, { reason: "report exclusion" }, { token: auth.accessToken, ownerPin: tenant.ownerPin });
      const summary = assertSuccess(await ctx.get("/api/reports/payment-summary", { token: auth.accessToken }));
      assert.equal(summary.total, 0);
    });


    test("daily closing counts estimates like real sales and tracks them separately", async () => {
      const tenant = await createTenant(ctx.db);
      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 50, lowStockThreshold: 20 });
      await createPaidBillViaApi(ctx, auth.accessToken, product, { quantity: 1, ratePerRateUnit: 50, payments: [{ mode: "cash", amount: 50 }] });
      await createPaidBillViaApi(ctx, auth.accessToken, product, { billType: "estimate", quantity: 1, ratePerRateUnit: 50, payments: [{ mode: "cash", amount: 50 }] });
      const data = assertSuccess(await ctx.get("/api/reports/daily-closing", { token: auth.accessToken }));
      // Estimates work the same as real bills — sales and cash include them.
      assert.equal(data.totalSalesPaise, 10000);
      assert.equal(data.cashReceivedPaise, 10000);
      assert.equal(data.roughBills, 1);
      assert.equal(Array.isArray(data.lowStock), true);
    });

    test("sales summary hides gross profit from staff", async () => {
      const tenant = await createTenant(ctx.db);
      const staff = await createStaff(ctx.db, tenant.shop.id);
      const ownerAuth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      const staffAuth = await login(ctx, staff.staffMobile, staff.staffPassword);
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 30, costPerRateUnit: 10 });
      await createPaidBillViaApi(ctx, ownerAuth.accessToken, product, { quantity: 1, ratePerRateUnit: 30 });
      const staffSummary = assertSuccess(await ctx.get("/api/reports/sales-summary?range=today", { token: staffAuth.accessToken }));
      assert.equal(staffSummary.grossProfitPaise, undefined);
      const ownerSummary = assertSuccess(await ctx.get("/api/reports/sales-summary?range=today", { token: ownerAuth.accessToken }));
      assert.equal(typeof ownerSummary.grossProfitPaise, "number");
    });

    test("udhar ageing and payment mode reports work", async () => {
      const tenant = await createTenant(ctx.db);
      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      const customer = await createCustomer(ctx.db, tenant.shop.id, { type: "udhar" });
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 80 });
      await createPaidBillViaApi(ctx, auth.accessToken, product, {
        customerId: customer.id,
        customerName: customer.name,
        quantity: 1,
        ratePerRateUnit: 80,
        buyerPaidAmount: 30,
        payments: [{ mode: "cash", amount: 30 }, { mode: "credit", amount: 50 }],
      });
      const ageing = assertSuccess(await ctx.get("/api/reports/udhar-ageing", { token: auth.accessToken }));
      assert.equal(ageing.totalPendingUdharPaise, 5000);
      const paymentModes = assertSuccess(await ctx.get("/api/reports/payment-modes", { token: auth.accessToken }));
      assert.equal(paymentModes.creditUdharPaise, 5000);
      assert.equal(paymentModes.mixedPayments.length, 1);
    });

    test("inventory health and top products are shop scoped", async () => {
      const a = await createTenant(ctx.db);
      const b = await createTenant(ctx.db);
      const authA = await login(ctx, a.ownerMobile, a.ownerPassword);
      const authB = await login(ctx, b.ownerMobile, b.ownerPassword);
      const productA = await createProduct(ctx.db, a.shop.id, { name: "A scoped", stockBaseQty: 2, lowStockThreshold: 5, defaultPricePerRateUnit: 20 });
      const productB = await createProduct(ctx.db, b.shop.id, { name: "B scoped", stockBaseQty: 100, lowStockThreshold: 5, defaultPricePerRateUnit: 200 });
      await createPaidBillViaApi(ctx, authA.accessToken, productA, { quantity: 1, ratePerRateUnit: 20 });
      await createPaidBillViaApi(ctx, authB.accessToken, productB, { quantity: 1, ratePerRateUnit: 200 });
      const topA = assertSuccess(await ctx.get("/api/reports/top-products", { token: authA.accessToken }));
      assert.equal(topA.some((p) => p.productName === "B scoped"), false);
      const healthA = assertSuccess(await ctx.get("/api/reports/inventory-health", { token: authA.accessToken }));
      assert.equal(healthA.lowStock.some((p) => p.productName === "A scoped"), true);
    });
  });
}
