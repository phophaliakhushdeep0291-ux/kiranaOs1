import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { billPayload, createCustomer, createPaidBillViaApi, createProduct, createTenant, login } from "./factories.js";
import { restoreCancelledBill } from "../../src/modules/bills/bills.service.js";
import { redeemPoints } from "../../src/modules/loyalty/loyalty.service.js";
import { env } from "../../src/config/env.js";

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

    test("emails a tenant-scoped receipt through the configured provider and audits only the recipient domain", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      env.EMAIL_PROVIDER = "console";
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 5, defaultPricePerRateUnit: 75 });
      const bill = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product), { token: ownerAuth.accessToken }), 201);

      assertFailure(await ctx.post(`/api/bills/${bill.id}/email`, { email: "not-an-email" }, { token: ownerAuth.accessToken }), 400);
      const delivered = assertSuccess(await ctx.post(`/api/bills/${bill.id}/email`, { email: "buyer@example.com" }, { token: ownerAuth.accessToken }));
      assert.equal(delivered.delivered, true);
      assert.equal(delivered.provider, "console");

      const audit = await ctx.db.auditLog.findFirst({ where: { shopId: tenant.shop.id, entityId: bill.id, action: "BILL_RECEIPT_EMAILED" } });
      assert.ok(audit);
      assert.equal(audit.metadataJson.includes("example.com"), true);
      assert.equal(audit.metadataJson.includes("buyer@"), false, "audit metadata does not retain the recipient local part");

      const other = await createTenant(ctx.db);
      const otherAuth = await login(ctx, other.ownerMobile, other.ownerPassword);
      assertFailure(await ctx.post(`/api/bills/${bill.id}/email`, { email: "attacker@example.com" }, { token: otherAuth.accessToken }), 404);
    });

    test("sensitive bill actions survive validation and require the owner PIN", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 100 });
      const payload = {
        ...billPayload(product, {
        discount: 20,
        actualAmount: 180,
        buyerPaidAmount: 180,
        payments: [{ mode: "cash", amount: 180 }],
        }),
        sensitiveActions: ["large_discount"],
        reason: "Manager-approved promotion",
      };

      const blocked = await ctx.post("/api/bills/confirm", payload, { token: ownerAuth.accessToken });
      assertFailure(blocked, 403);

      const approved = assertSuccess(await ctx.post("/api/bills/confirm", { ...payload, ownerPin: tenant.ownerPin }, { token: ownerAuth.accessToken }), 201);
      assert.equal(approved.discount, 20);
      assert.equal(approved.grandTotal, 180);
    });

    test("coupon validation and usage accounting commit with the bill lifecycle", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 20, defaultPricePerRateUnit: 100 });
      const offer = await ctx.db.offer.create({
        data: {
          shopId: tenant.shop.id,
          title: "Ten percent capped",
          code: "SAVE10",
          type: "percentage",
          value: 10,
          minBillAmount: 500,
          maxDiscount: 80,
          usageLimit: 1,
          active: true,
        },
      });
      const payload = {
        ...billPayload(product, {
          quantity: 10,
          ratePerRateUnit: 100,
          discount: 80,
          actualAmount: 920,
          buyerPaidAmount: 920,
          payments: [{ mode: "cash", amount: 920 }],
        }),
        offerId: offer.id,
        offerCode: "save10",
        offerDiscount: 80,
      };

      const changedDiscount = await ctx.post("/api/bills/confirm", { ...payload, offerDiscount: 70 }, { token: ownerAuth.accessToken });
      assertFailure(changedDiscount, 409);
      assert.equal((await ctx.db.offer.findUnique({ where: { id: offer.id } })).usedCount, 0, "rejected bill must not consume the coupon");

      const bill = assertSuccess(await ctx.post("/api/bills/confirm", payload, { token: ownerAuth.accessToken }), 201);
      assert.equal(bill.offerId, offer.id);
      assert.equal(bill.offerCode, "SAVE10");
      assert.equal(bill.offerDiscount, 80);
      let refreshedOffer = await ctx.db.offer.findUnique({ where: { id: offer.id } });
      assert.equal(refreshedOffer.usedCount, 1);
      assert.equal(refreshedOffer.discountGiven, 80);

      assertSuccess(await ctx.post(`/api/bills/${bill.id}/cancel`, { reason: "Coupon lifecycle proof" }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }));
      refreshedOffer = await ctx.db.offer.findUnique({ where: { id: offer.id } });
      assert.equal(refreshedOffer.usedCount, 0);
      assert.equal(refreshedOffer.discountGiven, 0);

      await restoreCancelledBill(tenant.shop.id, bill.id, { reason: "Coupon lifecycle restore proof" });
      refreshedOffer = await ctx.db.offer.findUnique({ where: { id: offer.id } });
      assert.equal(refreshedOffer.usedCount, 1);
      assert.equal(refreshedOffer.discountGiven, 80);

      const standalone = await ctx.post(`/api/offers/${offer.id}/redeem`, { discount: 80 }, { token: ownerAuth.accessToken });
      const standaloneBody = assertFailure(standalone, 409);
      assert.equal(standaloneBody.code, "OFFER_REDEMPTION_REQUIRES_BILL");
    });

    test("loyalty cancel/restore cycles preserve balances and immutable lifetime totals", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id, { name: "Lifecycle Loyal" });
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 20, defaultPricePerRateUnit: 100 });
      await ctx.db.loyaltyProgram.create({
        data: {
          shopId: tenant.shop.id,
          active: true,
          pointsPerRupee: 1,
          redemptionPaisePerPoint: 25,
          minimumRedeemPoints: 10,
        },
      });

      assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, {
        quantity: 1,
        ratePerRateUnit: 100,
        customerId: customer.id,
        customerName: customer.name,
      }), { token: ownerAuth.accessToken }), 201);

      const lifecycleBill = assertSuccess(await ctx.post("/api/bills/confirm", {
        ...billPayload(product, {
          quantity: 1,
          ratePerRateUnit: 50,
          customerId: customer.id,
          customerName: customer.name,
          actualAmount: 40,
          buyerPaidAmount: 40,
          payments: [{ mode: "cash", amount: 40 }],
        }),
        loyaltyPointsToRedeem: 40,
        sensitiveActions: ["loyalty_redemption"],
        reason: "Lifecycle ledger proof",
        ownerPin: tenant.ownerPin,
      }, { token: ownerAuth.accessToken }), 201);

      let account = await ctx.db.loyaltyAccount.findUnique({ where: { customerId: customer.id } });
      assert.deepEqual(
        { balance: account.pointsBalance, earned: account.lifetimeEarned, redeemed: account.lifetimeRedeemed },
        { balance: 100, earned: 140, redeemed: 40 },
      );

      for (const cycle of [1, 2]) {
        assertSuccess(await ctx.post(`/api/bills/${lifecycleBill.id}/cancel`, { reason: `Loyalty cycle ${cycle}` }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }));
        account = await ctx.db.loyaltyAccount.findUnique({ where: { customerId: customer.id } });
        assert.deepEqual(
          { balance: account.pointsBalance, earned: account.lifetimeEarned, redeemed: account.lifetimeRedeemed },
          { balance: 100, earned: 100, redeemed: 0 },
        );

        await restoreCancelledBill(tenant.shop.id, lifecycleBill.id, { reason: `Loyalty cycle ${cycle} restore` });
        account = await ctx.db.loyaltyAccount.findUnique({ where: { customerId: customer.id } });
        assert.deepEqual(
          { balance: account.pointsBalance, earned: account.lifetimeEarned, redeemed: account.lifetimeRedeemed },
          { balance: 100, earned: 140, redeemed: 40 },
        );
      }

      const ledger = await ctx.db.loyaltyTransaction.findMany({ where: { billId: lifecycleBill.id } });
      for (const type of ["earn_reversal", "redeem_reversal", "earn_reapply", "redeem_reapply"]) {
        assert.deepEqual(
          ledger.filter((row) => row.type === type).map((row) => row.lifecycleCycle).sort(),
          [1, 2],
          `${type} must retain one immutable entry per lifecycle cycle`,
        );
      }
    });

    test("cancelling an earn bill never grants already-spent loyalty points", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id, { name: "Spent Points" });
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 100 });
      await ctx.db.loyaltyProgram.create({ data: { shopId: tenant.shop.id, active: true, pointsPerRupee: 1, redemptionPaisePerPoint: 25, minimumRedeemPoints: 10 } });
      const earnBill = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, {
        customerId: customer.id,
        customerName: customer.name,
      }), { token: ownerAuth.accessToken }), 201);

      await redeemPoints(tenant.shop.id, customer.id, { points: 80, note: "Spent before source bill cancellation" });
      assertSuccess(await ctx.post(`/api/bills/${earnBill.id}/cancel`, { reason: "Source sale reversed after points spent" }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }));

      const account = await ctx.db.loyaltyAccount.findUnique({ where: { customerId: customer.id } });
      assert.equal(account.pointsBalance, -80, "spent points must become a recoverable negative balance, not free value");
      assert.equal(account.lifetimeEarned, 0);
      assert.equal(account.lifetimeRedeemed, 80);
      await assert.rejects(
        () => redeemPoints(tenant.shop.id, customer.id, { points: 10, note: "Must be blocked while negative" }),
        (error) => error?.code === "INSUFFICIENT_LOYALTY_POINTS",
      );
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

    test("selling more than stock is allowed and drives stock negative (shortfall for reconcile)", async () => {
      // Kirana counts drift, so the counter must not block a real sale for "0 stock". The sale
      // goes through and stock shows the exact deficit (per "allow stock shortfall" + "negative
      // stock handling"); the frontend warns before confirming.
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 1, defaultPricePerRateUnit: 50 });
      const response = await ctx.post("/api/bills/confirm", billPayload(product, { quantity: 2, ratePerRateUnit: 50, payments: [{ mode: "cash", amount: 100 }] }), { token: ownerAuth.accessToken });
      const bill = assertSuccess(response, 201);
      assert.equal(bill.status, "active");
      const refreshed = await ctx.db.product.findUnique({ where: { id: product.id } });
      assert.equal(refreshed.stockBaseQty, -1, "1 in stock, 2 sold -> -1 deficit recorded");
    });

    test("estimate bill deducts stock and records tender like a real sale", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 50 });
      const payload = billPayload(product, { billType: "estimate", quantity: 2, ratePerRateUnit: 50, payments: [{ mode: "cash", amount: 100 }] });
      const bill = assertSuccess(await ctx.post("/api/bills/confirm", payload, { token: ownerAuth.accessToken }), 201);
      assert.equal(bill.billType, "estimate");
      assert.match(bill.billNo, /^EST-/);
      assert.equal(bill.paidAmount, 100);
      const refreshedProduct = await ctx.db.product.findUnique({ where: { id: product.id } });
      assert.equal(refreshedProduct.stockBaseQty, 8);
    });

    test("legacy quote-shaped estimate (no payment data) is still accepted as unpaid", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 50 });
      const payload = billPayload(product, { billType: "estimate", quantity: 2, ratePerRateUnit: 50, payments: [] });
      delete payload.buyerPaidAmount;
      const bill = assertSuccess(await ctx.post("/api/bills/confirm", payload, { token: ownerAuth.accessToken }), 201);
      assert.equal(bill.billType, "estimate");
      assert.equal(bill.paidAmount, 0);
      assert.equal(bill.creditAmount, 0);
      // Goods still leave the shop on a kacha bill — stock deducts either way.
      const refreshedProduct = await ctx.db.product.findUnique({ where: { id: product.id } });
      assert.equal(refreshedProduct.stockBaseQty, 8);
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

    test("release cancellation reverses mixed tender, udhar, stock and ledger exactly once with an owner audit", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id, { name: "Cancellation Proof Customer" });
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 100, costPerRateUnit: 60 });
      const bill = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, {
        quantity: 3,
        ratePerRateUnit: 100,
        customerId: customer.id,
        customerName: customer.name,
        buyerPaidAmount: 150,
        payments: [
          { mode: "cash", amount: 100 },
          { mode: "upi", amount: 50 },
          { mode: "credit", amount: 150 },
        ],
      }), { token: ownerAuth.accessToken }), 201);

      assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 7);
      assert.equal((await ctx.db.customer.findUnique({ where: { id: customer.id } })).udharAmount, 150);

      const denied = await ctx.post(`/api/bills/${bill.id}/cancel`, { reason: "Owner proof" }, { token: ownerAuth.accessToken, ownerPin: "9999" });
      assertFailure(denied, 403);
      assert.equal((await ctx.db.bill.findUnique({ where: { id: bill.id } })).status, "active", "wrong PIN cannot change the bill");
      assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 7, "wrong PIN cannot restore stock");

      const cancelled = assertSuccess(await ctx.post(
        `/api/bills/${bill.id}/cancel`,
        { reason: "Customer changed the order" },
        { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin },
      ));
      assert.equal(cancelled.status, "cancelled");
      assert.equal(cancelled.cancelledReason, "Customer changed the order");
      assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 10, "all sold stock is restored");
      assert.equal((await ctx.db.customer.findUnique({ where: { id: customer.id } })).udharAmount, 0, "the credit leg is fully reversed");

      const stockRows = await ctx.db.stockLedger.findMany({ where: { shopId: tenant.shop.id, billId: bill.id }, orderBy: { createdAt: "asc" } });
      assert.equal(stockRows.filter((row) => row.action === "sale").length, 1);
      assert.equal(stockRows.filter((row) => row.action === "cancel_reversal").length, 1);
      assert.equal(stockRows.reduce((sum, row) => sum + Number(row.changeBaseQty), 0), 0, "stock ledger nets to zero units");

      const udharRows = await ctx.db.udharLedger.findMany({ where: { shopId: tenant.shop.id, billId: bill.id }, orderBy: { createdAt: "asc" } });
      assert.equal(udharRows.filter((row) => row.type === "debit").length, 1);
      assert.equal(udharRows.filter((row) => row.type === "payment").length, 1);
      assert.equal(
        udharRows.reduce((sum, row) => sum + (row.type === "debit" ? Number(row.amountPaise) : -Number(row.amountPaise)), 0),
        0,
        "udhar ledger nets to zero paise",
      );

      const financialRows = await ctx.db.financialLedger.findMany({ where: { shopId: tenant.shop.id, billId: bill.id } });
      for (const entryType of ["sale", "cash_in", "upi_in", "udhar_debit"]) {
        assert.equal(
          financialRows.filter((row) => row.entryType === entryType).reduce((sum, row) => sum + Number(row.amountPaise), 0),
          0,
          `${entryType} nets to zero paise`,
        );
      }
      assert.equal(financialRows.filter((row) => row.sourceType === "bill_cancel").length, 4, "one reversal row exists for every economic leg");

      const audit = await ctx.db.auditLog.findFirst({
        where: { shopId: tenant.shop.id, entityId: bill.id, action: "BILL_CANCELLED" },
        orderBy: { createdAt: "desc" },
      });
      assert.ok(audit, "the authorized cancellation is audit logged");
      assert.equal(JSON.parse(audit.metadataJson).reason, "Customer changed the order");
      assert.equal(JSON.parse(audit.afterJson).cancelledReason, "Customer changed the order");

      assertSuccess(await ctx.post(
        `/api/bills/${bill.id}/cancel`,
        { reason: "Lost response retry" },
        { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin },
      ));
      assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 10, "retry cannot restore stock twice");
      assert.equal(await ctx.db.stockLedger.count({ where: { shopId: tenant.shop.id, billId: bill.id, action: "cancel_reversal" } }), 1);
      assert.equal(await ctx.db.financialLedger.count({ where: { shopId: tenant.shop.id, billId: bill.id, sourceType: "bill_cancel" } }), 4);
      assert.equal(await ctx.db.udharLedger.count({ where: { shopId: tenant.shop.id, billId: bill.id, type: "payment" } }), 1);
    });

    test("concurrent cancels restore stock only once", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 50 });
      const bill = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, {
        quantity: 2,
        ratePerRateUnit: 50,
        payments: [{ mode: "cash", amount: 100 }],
      }), { token: ownerAuth.accessToken }), 201);
      // Stock is now 8.

      // Two cancels race. A request that observes the committed cancellation may
      // return the existing bill idempotently; an overlapping loser may return a
      // conflict. In either schedule, the reversal itself must happen only once.
      const [a, b] = await Promise.all([
        ctx.post(`/api/bills/${bill.id}/cancel`, { reason: "Race A" }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }),
        ctx.post(`/api/bills/${bill.id}/cancel`, { reason: "Race B" }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }),
      ]);

      const statuses = [a.status, b.status];
      assert.ok(statuses.includes(200), "one cancel succeeds");
      assert.ok(statuses.every((status) => status === 200 || status === 409), "the other cancel is idempotent or rejected");

      const refreshed = await ctx.db.product.findUnique({ where: { id: product.id } });
      assert.equal(refreshed.stockBaseQty, 10, "stock restored exactly once (not doubled)");

      const reversals = await ctx.db.stockLedger.findMany({
        where: { shopId: tenant.shop.id, productId: product.id, action: "cancel_reversal" },
      });
      assert.equal(reversals.length, 1, "exactly one stock reversal recorded");
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
