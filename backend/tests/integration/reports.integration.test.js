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

    test("owner reconciliation proves journal parity, detects drift, and survives cancellation", async () => {
      const tenant = await createTenant(ctx.db);
      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      const staff = await createStaff(ctx.db, tenant.shop.id);
      const staffAuth = await login(ctx, staff.staffMobile, staff.staffPassword);
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 75 });
      const bill = await createPaidBillViaApi(ctx, auth.accessToken, product, {
        quantity: 1,
        ratePerRateUnit: 75,
        payments: [{ mode: "cash", amount: 75 }],
      });

      assertFailure(await ctx.get("/api/reports/financial-ledger-reconciliation", { token: staffAuth.accessToken }), 403);

      const reconciled = assertSuccess(await ctx.get("/api/reports/financial-ledger-reconciliation", { token: auth.accessToken }));
      assert.equal(reconciled.authority, "operational_tables_and_locked_snapshots");
      assert.equal(reconciled.journalRole, "append_only_reconciliation_candidate");
      assert.equal(reconciled.comparisonScope, "shop_all_time_current_state");
      assert.equal(reconciled.readyForCutover, true);
      assert.deepEqual(reconciled.variancePaise, {
        sales: 0,
        cashCollected: 0,
        upiCollected: 0,
        bankCollected: 0,
        outstanding: 0,
      });

      await ctx.db.financialLedger.create({
        data: {
          shopId: tenant.shop.id,
          sourceType: "reconciliation_fixture",
          sourceId: "intentional-drift",
          entryType: "sale",
          direction: "debit",
          amountPaise: 1n,
          businessDate: new Date(),
          idempotencyKey: "reconciliation:intentional-drift",
        },
      });
      const drifted = assertSuccess(await ctx.get("/api/reports/financial-ledger-reconciliation", { token: auth.accessToken }));
      assert.equal(drifted.readyForCutover, false);
      assert.equal(drifted.variancePaise.sales, 1);
      await ctx.db.financialLedger.deleteMany({ where: { shopId: tenant.shop.id, sourceType: "reconciliation_fixture" } });

      await ctx.post(`/api/bills/${bill.id}/cancel`, { reason: "reconciliation cancellation" }, { token: auth.accessToken, ownerPin: tenant.ownerPin });
      const cancelled = assertSuccess(await ctx.get("/api/reports/financial-ledger-reconciliation", { token: auth.accessToken }));
      assert.equal(cancelled.readyForCutover, true);
      assert.equal(cancelled.operational.sales, 0);
      assert.equal(cancelled.journal.sales, 0);
      assert.equal(cancelled.operational.cashCollected, 0);
      assert.equal(cancelled.journal.cashCollected, 0);
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

    test("daily closing and GST report reconcile an exact mixed-tender sale, refund, udhar recovery, and cash expense", async () => {
      const tenant = await createTenant(ctx.db, { gstNumber: "29AAPFU0939F1ZR" });
      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      const customer = await createCustomer(ctx.db, tenant.shop.id, {
        type: "udhar",
        gstNumber: "29AAPFU0939F1ZR",
        stateCode: "29",
      });
      const product = await createProduct(ctx.db, tenant.shop.id, {
        name: "Closing GST Fixture",
        stockBaseQty: 20,
        defaultPricePerRateUnit: 118,
        gstRate: 18,
        hsn: "1905",
      });

      const sale = await createPaidBillViaApi(ctx, auth.accessToken, product, {
        billType: "gst_invoice",
        gstMode: "inclusive",
        customerId: customer.id,
        customerName: customer.name,
        quantity: 2,
        ratePerRateUnit: 118,
        gstRate: 18,
        hsn: "1905",
        actualAmount: 236,
        buyerPaidAmount: 200,
        payments: [
          { mode: "cash", amount: 80 },
          { mode: "upi", amount: 80 },
          { mode: "bank", amount: 40 },
          { mode: "credit", amount: 36 },
        ],
      });
      assert.equal(sale.grandTotal, 236);
      assert.equal(sale.gst, 36);

      await createPaidBillViaApi(ctx, auth.accessToken, product, {
        billType: "estimate",
        quantity: 1,
        ratePerRateUnit: 50,
        gstRate: 18,
        payments: [{ mode: "cash", amount: 50 }],
      });

      const refund = assertSuccess(await ctx.post("/api/bills/returns", {
        refundMode: "cash",
        returnOfBillId: sale.id,
        reason: "P0 closing and GST reconciliation fixture",
        items: [{
          originalBillItemId: sale.items[0].id,
          productId: product.id,
          name: product.name,
          quantity: 1,
          enteredUnit: "piece",
          ratePerRateUnit: 118,
          lineDiscount: 0,
          gstRate: 18,
          hsn: "1905",
          damaged: false,
        }],
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 201);
      assert.equal(refund.grandTotal, -118);
      assert.equal(refund.gst, -18);

      assertSuccess(await ctx.post(`/api/customers/${customer.id}/udhar-payment`, {
        amount: 20,
        mode: "cash",
        note: "P0 closing reconciliation fixture",
        idempotencyKey: "reports-p0-udhar-recovery",
      }, { token: auth.accessToken }));
      assertSuccess(await ctx.post("/api/expenses", {
        idempotencyKey: "reports-p0-cash-expense",
        clientExpenseId: "reports-p0-cash-expense",
        title: "Closing cash expense",
        amount: 10,
        category: "general",
        paymentMode: "cash",
        status: "paid",
        spentAt: new Date().toISOString(),
      }, { token: auth.accessToken }), 201);

      const closing = assertSuccess(await ctx.get("/api/reports/daily-closing?source=live", { token: auth.accessToken }));
      assert.deepEqual({
        totalSalesPaise: closing.totalSalesPaise,
        cashReceivedPaise: closing.cashReceivedPaise,
        upiReceivedPaise: closing.upiReceivedPaise,
        bankReceivedPaise: closing.bankReceivedPaise,
        udharGivenPaise: closing.udharGivenPaise,
        oldUdharRecoveredPaise: closing.oldUdharRecoveredPaise,
        cashExpensesPaidPaise: closing.cashExpensesPaidPaise,
        expectedCashPaise: closing.expectedCashPaise,
        totalBills: closing.totalBills,
        roughBills: closing.roughBills,
      }, {
        totalSalesPaise: 16800,
        cashReceivedPaise: 3200,
        upiReceivedPaise: 8000,
        bankReceivedPaise: 4000,
        udharGivenPaise: 3600,
        oldUdharRecoveredPaise: 2000,
        cashExpensesPaidPaise: 1000,
        expectedCashPaise: 2200,
        totalBills: 3,
        roughBills: 1,
      });

      const snapshot = assertSuccess(await ctx.post("/api/reports/daily-closing/snapshot", {
        date: closing.date,
      }, { token: auth.accessToken }), 201);
      assert.equal(snapshot.totalSalesPaise, closing.totalSalesPaise);
      assert.equal(snapshot.expectedCashPaise, closing.expectedCashPaise);
      assert.equal(snapshot.snapshot.persisted, true);

      const gst = assertSuccess(await ctx.get("/api/reports/gst?range=monthly", { token: auth.accessToken }));
      assert.deepEqual({
        totalBills: gst.totalBills,
        gstBills: gst.gstBills,
        taxableSales: gst.taxableSales,
        gstCollected: gst.gstCollected,
        cgst: gst.cgst,
        sgst: gst.sgst,
        igst: gst.igst,
      }, {
        totalBills: 2,
        gstBills: 2,
        taxableSales: 100,
        gstCollected: 18,
        cgst: 9,
        sgst: 9,
        igst: 0,
      });
      assert.equal(gst.taxableSales + gst.gstCollected, sale.grandTotal + refund.grandTotal);
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

    test("udhar ageing settles oldest debt first and restores its age after a payment reversal", async () => {
      const tenant = await createTenant(ctx.db);
      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      const customer = await createCustomer(ctx.db, tenant.shop.id, {
        name: "Ageing allocation customer",
        type: "udhar",
        udharAmount: 30,
      });
      const now = Date.now();
      const oldDebit = await ctx.db.udharLedger.create({
        data: {
          shopId: tenant.shop.id,
          customerId: customer.id,
          customerName: customer.name,
          type: "debit",
          mode: "credit",
          amount: 100,
          businessDate: new Date(now - 70 * 86_400_000),
        },
      });
      await ctx.db.udharLedger.create({
        data: {
          shopId: tenant.shop.id,
          customerId: customer.id,
          customerName: customer.name,
          type: "debit",
          mode: "credit",
          amount: 50,
          businessDate: new Date(now - 20 * 86_400_000),
        },
      });
      const payment = await ctx.db.udharLedger.create({
        data: {
          shopId: tenant.shop.id,
          customerId: customer.id,
          customerName: customer.name,
          type: "payment",
          mode: "cash",
          amount: 120,
          businessDate: new Date(now - 5 * 86_400_000),
        },
      });

      const afterPayment = assertSuccess(await ctx.get("/api/reports/udhar-ageing", { token: auth.accessToken }));
      assert.equal(afterPayment.totalPendingUdharPaise, 3000);
      assert.equal(afterPayment.buckets["60_plus_days"].amountPaise, 0);
      assert.equal(afterPayment.buckets["8_30_days"].amountPaise, 3000);
      assert.equal(afterPayment.customers[0].oldestPendingDate.slice(0, 10), new Date(now - 20 * 86_400_000).toISOString().slice(0, 10));

      await ctx.db.$transaction([
        ctx.db.udharLedger.update({ where: { id: payment.id }, data: { reversedAt: new Date() } }),
        ctx.db.udharLedger.create({
          data: {
            shopId: tenant.shop.id,
            customerId: customer.id,
            customerName: customer.name,
            type: "debit",
            mode: "reversal",
            amount: 120,
            reversalOfLedgerId: payment.id,
            businessDate: new Date(),
          },
        }),
        ctx.db.customer.update({ where: { id: customer.id }, data: { udharAmount: 150 } }),
      ]);

      const afterReversal = assertSuccess(await ctx.get("/api/reports/udhar-ageing", { token: auth.accessToken }));
      assert.equal(afterReversal.totalPendingUdharPaise, 15000);
      assert.equal(afterReversal.buckets["60_plus_days"].amountPaise, 10000);
      assert.equal(afterReversal.buckets["8_30_days"].amountPaise, 5000);
      assert.equal(afterReversal.customers[0].oldestPendingDate.slice(0, 10), oldDebit.businessDate.toISOString().slice(0, 10));
      assert.deepEqual(afterReversal.customers[0].ageingPaise, {
        "0_7_days": 0,
        "8_30_days": 5000,
        "31_60_days": 0,
        "60_plus_days": 10000,
      });
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
