import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { billPayload, createCustomer, createPaidBillViaApi, createProduct, createTenant, login } from "./factories.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("billing integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  async function ownerCtx() {
    const tenant = await createTenant(ctx.db, { ownerPin: "1234" });
    const ownerAuth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    return { tenant, ownerAuth };
  }

  describe("billing integration", () => {
    test("paid bill creates bill, items, payment, stock ledger and deducts stock", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 50, costPerRateUnit: 30 });
      const bill = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, { quantity: 2, ratePerRateUnit: 50 }), { token: ownerAuth.accessToken }), 201);

      assert.ok(bill.billNo);
      assert.equal(bill.grandTotal, 100);
      assert.equal(bill.items.length, 1);
      assert.equal(bill.payments.length, 1);

      const refreshedProduct = await ctx.db.product.findUnique({ where: { id: product.id } });
      const stockLedger = await ctx.db.stockLedger.findMany({ where: { billId: bill.id, action: "sale" } });
      assert.equal(refreshedProduct.stockBaseQty, 8);
      assert.equal(stockLedger.length, 1);
    });

    test("partial bill creates paid payment + udhar impact", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id);
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 100 });
      const bill = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, {
        quantity: 1,
        ratePerRateUnit: 100,
        customerId: customer.id,
        customerName: customer.name,
        buyerPaidAmount: 40,
        payments: [{ mode: "cash", amount: 40 }, { mode: "credit", amount: 60 }],
      }), { token: ownerAuth.accessToken }), 201);

      assert.equal(bill.paidAmount, 40);
      assert.equal(bill.creditAmount, 60);
      assert.deepEqual(bill.payments.map((payment) => payment.mode), ["cash"]);
      const updatedCustomer = await ctx.db.customer.findUnique({ where: { id: customer.id } });
      assert.equal(updatedCustomer.udharAmount, 60);
    });

    test("pure udhar bill updates customer udhar", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id);
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 80 });
      const bill = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, {
        quantity: 1,
        ratePerRateUnit: 80,
        customerId: customer.id,
        customerName: customer.name,
        buyerPaidAmount: 0,
        payments: [{ mode: "credit", amount: 80 }],
      }), { token: ownerAuth.accessToken }), 201);
      assert.equal(bill.creditAmount, 80);
      assert.equal(bill.payments.length, 0);
      const updatedCustomer = await ctx.db.customer.findUnique({ where: { id: customer.id } });
      assert.equal(updatedCustomer.udharAmount, 80);
    });

    test("buyer paid amount greater than bill total is rejected", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 50 });
      const response = await ctx.post("/api/bills/confirm", billPayload(product, {
        quantity: 1,
        ratePerRateUnit: 50,
        buyerPaidAmount: 51,
        payments: [{ mode: "cash", amount: 50 }],
      }), { token: ownerAuth.accessToken });
      assertFailure(response, 400);
    });

    test("waived amount greater than bill total is rejected", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 50 });
      const response = await ctx.post("/api/bills/confirm", billPayload(product, {
        quantity: 1,
        ratePerRateUnit: 50,
        buyerPaidAmount: 1,
        waivedAmount: 51,
        payments: [{ mode: "cash", amount: 1 }],
      }), { token: ownerAuth.accessToken });
      assertFailure(response, 400);
    });

    test("discount greater than subtotal is rejected with a clear error", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 100 });
      // ₹1500 discount on a ₹100 subtotal would drive the bill total negative; it must be
      // rejected up front, not surface later as a confusing payment-mismatch error.
      const response = await ctx.post("/api/bills/confirm", billPayload(product, {
        quantity: 1,
        ratePerRateUnit: 100,
        discount: 1500,
        buyerPaidAmount: 0,
        payments: [{ mode: "cash", amount: 1 }],
      }), { token: ownerAuth.accessToken });
      const body = assertFailure(response, 400);
      assert.match(JSON.stringify(body), /[Dd]iscount/, "error message should name the discount as the cause");
    });

    test("insufficient stock is rejected", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 1, defaultPricePerRateUnit: 50 });
      const response = await ctx.post("/api/bills/confirm", billPayload(product, { quantity: 2, ratePerRateUnit: 50, payments: [{ mode: "cash", amount: 100 }] }), { token: ownerAuth.accessToken });
      assertFailure(response, 400);
    });

    test("estimate/rough bill does not deduct stock", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 50 });
      const payload = billPayload(product, { billType: "estimate", quantity: 2, ratePerRateUnit: 50, payments: [] });
      delete payload.buyerPaidAmount;
      const bill = assertSuccess(await ctx.post("/api/bills/confirm", payload, { token: ownerAuth.accessToken }), 201);
      assert.equal(bill.billType, "estimate");
      const refreshedProduct = await ctx.db.product.findUnique({ where: { id: product.id } });
      assert.equal(refreshedProduct.stockBaseQty, 10);
    });

    test("bill number is generated", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10 });
      const bill = await createPaidBillViaApi(ctx, ownerAuth.accessToken, product, { quantity: 1, ratePerRateUnit: 20 });
      assert.match(bill.billNo, /KOS-/);
    });

    test("bill cancellation restores stock and reverses udhar", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id);
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 50 });
      const bill = await createPaidBillViaApi(ctx, ownerAuth.accessToken, product, {
        quantity: 2,
        ratePerRateUnit: 50,
        customerId: customer.id,
        customerName: customer.name,
        buyerPaidAmount: 0,
        payments: [{ mode: "credit", amount: 100 }],
      });

      assertSuccess(await ctx.post(`/api/bills/${bill.id}/cancel`, { reason: "Test cancellation" }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }));
      const refreshedProduct = await ctx.db.product.findUnique({ where: { id: product.id } });
      const refreshedCustomer = await ctx.db.customer.findUnique({ where: { id: customer.id } });
      assert.equal(refreshedProduct.stockBaseQty, 10);
      assert.equal(refreshedCustomer.udharAmount, 0);
    });

    test("cancelling a bill nets its FinancialLedger entries to zero", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 50 });
      const bill = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, {
        quantity: 2,
        ratePerRateUnit: 50,
        payments: [{ mode: "cash", amount: 100 }],
      }), { token: ownerAuth.accessToken }), 201);

      const sumOf = async (entryType) => {
        const rows = await ctx.db.financialLedger.findMany({ where: { shopId: tenant.shop.id, entryType } });
        return rows.reduce((total, row) => total + Number(row.amountPaise), 0);
      };
      // After creation: sale +₹100, cash_in +₹100.
      assert.equal(await sumOf("sale"), 10000);
      assert.equal(await sumOf("cash_in"), 10000);

      assertSuccess(await ctx.post(`/api/bills/${bill.id}/cancel`, { reason: "Test cancellation" }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }));

      // The reversal rows (same entryType, negated amount) net every KPI back to zero.
      assert.equal(await sumOf("sale"), 0, "sales net to zero after cancellation");
      assert.equal(await sumOf("cash_in"), 0, "cash collected nets to zero after cancellation");
    });

    test("cancelled bill is not counted as active sale in P&L", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 50 });
      const bill = await createPaidBillViaApi(ctx, ownerAuth.accessToken, product, { quantity: 1, ratePerRateUnit: 50 });
      await ctx.post(`/api/bills/${bill.id}/cancel`, { reason: "Exclude from sales" }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin });
      const pnl = assertSuccess(await ctx.get("/api/reports/pnl?range=daily", { token: ownerAuth.accessToken }));
      assert.equal(pnl.totalBills, 0);
      assert.equal(pnl.grossSales, 0);
    });
  });
}
