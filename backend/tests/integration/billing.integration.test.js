import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { billPayload, createCustomer, createPaidBillViaApi, createProduct, createStaff, createTenant, login } from "./factories.js";
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
      const audit = await ctx.db.auditLog.findFirst({
        where: { shopId: tenant.shop.id, entityId: bill.id, action: "BILL_CREATED" },
      });
      assert.ok(audit);
      assert.equal(audit.userId, tenant.owner.id);
      assert.equal(JSON.parse(audit.afterJson).grandTotal, 100);
    });

    test("manual UPI references are reconcilable but never confirm a non-UPI payment", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 50 });

      const upiBill = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, {
        quantity: 1,
        ratePerRateUnit: 50,
        buyerPaidAmount: 50,
        payments: [{ mode: "upi", amount: 50, upiReference: "UTR90001111" }],
      }), { token: ownerAuth.accessToken }), 201);
      const upiPayment = await ctx.db.payment.findFirstOrThrow({ where: { billId: upiBill.id } });
      assert.equal(upiPayment.provider, "manual");
      assert.equal(upiPayment.providerReference, "UTR90001111");
      assert.equal(upiPayment.confirmationSource, "manual");

      const cashBill = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, {
        quantity: 1,
        ratePerRateUnit: 50,
        buyerPaidAmount: 50,
        payments: [{ mode: "cash", amount: 50, upiReference: "UTR-MUST-NOT-LEAK" }],
      }), { token: ownerAuth.accessToken }), 201);
      const cashPayment = await ctx.db.payment.findFirstOrThrow({ where: { billId: cashBill.id } });
      assert.equal(cashPayment.providerReference, null);

      const invalid = await ctx.post("/api/bills/confirm", billPayload(product, {
        quantity: 1,
        ratePerRateUnit: 50,
        buyerPaidAmount: 50,
        payments: [{ mode: "upi", amount: 50, upiReference: "bad!" }],
      }), { token: ownerAuth.accessToken });
      assertFailure(invalid, 400);
    });

    test("bill creation rolls back bill, stock, and accounting when its required audit cannot be stored", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 50, costPerRateUnit: 30 });
      await ctx.db.$executeRawUnsafe(`
        CREATE TRIGGER force_bill_create_audit_failure
        BEFORE INSERT ON AuditLog
        WHEN NEW.action = 'BILL_CREATED'
        BEGIN
          SELECT RAISE(ABORT, 'forced bill creation audit failure');
        END
      `);
      let response;
      try {
        response = await ctx.post(
          "/api/bills/confirm",
          billPayload(product, { quantity: 2, ratePerRateUnit: 50 }),
          { token: ownerAuth.accessToken },
        );
      } finally {
        await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_bill_create_audit_failure");
      }
      assertFailure(response, 503);
      assert.equal(response.body.code, "BILL_AUDIT_WRITE_FAILED");
      assert.equal(await ctx.db.bill.count({ where: { shopId: tenant.shop.id } }), 0);
      assert.equal((await ctx.db.product.findUniqueOrThrow({ where: { id: product.id } })).stockBaseQty, 10);
      assert.equal(await ctx.db.stockLedger.count({ where: { shopId: tenant.shop.id, action: "sale" } }), 0);
      assert.equal(await ctx.db.financialLedger.count({ where: { shopId: tenant.shop.id } }), 0);
      assert.equal(await ctx.db.auditLog.count({ where: { shopId: tenant.shop.id, action: "BILL_CREATED" } }), 0);
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

    test("server derives large discounts, requires owner PIN and writes the approval audit atomically", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 100 });
      const payload = {
        ...billPayload(product, {
        discount: 100,
        actualAmount: 100,
        buyerPaidAmount: 100,
        payments: [{ mode: "cash", amount: 100 }],
        }),
        reason: "Manager-approved promotion",
      };

      const blocked = await ctx.post("/api/bills/confirm", payload, { token: ownerAuth.accessToken });
      assertFailure(blocked, 403);
      assert.equal(await ctx.db.bill.count({ where: { shopId: tenant.shop.id } }), 0);

      const approved = assertSuccess(await ctx.post("/api/bills/confirm", { ...payload, ownerPin: tenant.ownerPin }, { token: ownerAuth.accessToken }), 201);
      assert.equal(approved.discount, 100);
      assert.equal(approved.grandTotal, 100);
      const approvalAudit = await ctx.db.auditLog.findFirst({
        where: { shopId: tenant.shop.id, entityId: approved.id, action: "BILL_LARGE_DISCOUNT_APPROVED" },
      });
      assert.ok(approvalAudit);
      assert.equal(JSON.parse(approvalAudit.metadataJson).reason, "Manager-approved promotion");
      assert.equal(approvalAudit.userId, tenant.owner.id);
    });

    test("server rejects an undeclared below-minimum line until the owner approves it", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, {
        stockBaseQty: 10,
        defaultPricePerRateUnit: 50,
        minPricePerRateUnit: 45,
      });
      const payload = {
        ...billPayload(product, { quantity: 2, ratePerRateUnit: 44, actualAmount: 88, buyerPaidAmount: 88, payments: [{ mode: "cash", amount: 88 }] }),
        sensitiveActions: [],
        reason: "Clear short-dated stock",
      };

      assertFailure(await ctx.post("/api/bills/confirm", payload, { token: ownerAuth.accessToken }), 403);
      const approved = assertSuccess(await ctx.post("/api/bills/confirm", { ...payload, ownerPin: tenant.ownerPin }, { token: ownerAuth.accessToken }), 201);
      const approvalAudit = await ctx.db.auditLog.findFirst({
        where: { shopId: tenant.shop.id, entityId: approved.id, action: "BILL_BELOW_MINIMUM_PRICE_APPROVED" },
      });
      assert.ok(approvalAudit);
      assert.equal(JSON.parse(approvalAudit.metadataJson).reason, "Clear short-dated stock");
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

    test("offer administration requires owner approval and rolls back every lifecycle action when audit storage fails", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const staff = await createStaff(ctx.db, tenant.shop.id);
      const staffAuth = await login(ctx, staff.staffMobile, staff.staffPassword);
      const createPayload = {
        title: "Audited festival offer",
        code: "FESTIVE10",
        type: "percentage",
        value: 10,
        minBillAmount: 100,
        maxDiscount: 50,
        usageLimit: 25,
        active: true,
        auditReason: "Festival campaign",
      };

      assertFailure(await ctx.post("/api/offers", createPayload, { token: ownerAuth.accessToken }), 403);
      assertFailure(await ctx.post("/api/offers", createPayload, {
        token: staffAuth.accessToken,
        ownerPin: tenant.ownerPin,
      }), 403);
      assert.equal(await ctx.db.offer.count({ where: { shopId: tenant.shop.id } }), 0);

      await ctx.db.$executeRawUnsafe(`
        CREATE TRIGGER force_offer_create_audit_failure
        BEFORE INSERT ON AuditLog
        WHEN NEW.action = 'OFFER_CREATED'
        BEGIN
          SELECT RAISE(ABORT, 'forced offer create audit failure');
        END
      `);
      let response;
      try {
        response = await ctx.post("/api/offers", createPayload, {
          token: ownerAuth.accessToken,
          ownerPin: tenant.ownerPin,
        });
      } finally {
        await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_offer_create_audit_failure");
      }
      assert.equal(assertFailure(response, 503).code, "OFFER_AUDIT_WRITE_FAILED");
      assert.equal(await ctx.db.offer.count({ where: { shopId: tenant.shop.id } }), 0);

      const offer = assertSuccess(await ctx.post("/api/offers", createPayload, {
        token: ownerAuth.accessToken,
        ownerPin: tenant.ownerPin,
      }), 201);
      const createdAudit = await ctx.db.auditLog.findFirstOrThrow({
        where: { shopId: tenant.shop.id, entityId: offer.id, action: "OFFER_CREATED" },
      });
      assert.equal(createdAudit.userId, tenant.owner.id);
      assert.ok(createdAudit.deviceId);

      await ctx.db.$executeRawUnsafe(`
        CREATE TRIGGER force_offer_update_audit_failure
        BEFORE INSERT ON AuditLog
        WHEN NEW.action = 'OFFER_UPDATED'
        BEGIN
          SELECT RAISE(ABORT, 'forced offer update audit failure');
        END
      `);
      try {
        response = await ctx.patch(`/api/offers/${offer.id}`, {
          title: "This title must roll back",
          auditReason: "Audit failure proof",
        }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin });
      } finally {
        await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_offer_update_audit_failure");
      }
      assert.equal(assertFailure(response, 503).code, "OFFER_AUDIT_WRITE_FAILED");
      assert.equal((await ctx.db.offer.findUniqueOrThrow({ where: { id: offer.id } })).title, createPayload.title);

      assertSuccess(await ctx.patch(`/api/offers/${offer.id}`, {
        title: "Approved festival offer",
        auditReason: "Correct campaign title",
      }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }));

      await ctx.db.$executeRawUnsafe(`
        CREATE TRIGGER force_offer_delete_audit_failure
        BEFORE INSERT ON AuditLog
        WHEN NEW.action = 'OFFER_DELETED'
        BEGIN
          SELECT RAISE(ABORT, 'forced offer delete audit failure');
        END
      `);
      try {
        response = await ctx.request("DELETE", `/api/offers/${offer.id}`, {
          token: ownerAuth.accessToken,
          ownerPin: tenant.ownerPin,
          body: { auditReason: "Audit failure proof" },
        });
      } finally {
        await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_offer_delete_audit_failure");
      }
      assert.equal(assertFailure(response, 503).code, "OFFER_AUDIT_WRITE_FAILED");
      assert.equal((await ctx.db.offer.findUniqueOrThrow({ where: { id: offer.id } })).deletedAt, null);

      assertSuccess(await ctx.request("DELETE", `/api/offers/${offer.id}`, {
        token: ownerAuth.accessToken,
        ownerPin: tenant.ownerPin,
        body: { auditReason: "Campaign completed" },
      }));
      assert.ok((await ctx.db.offer.findUniqueOrThrow({ where: { id: offer.id } })).deletedAt);

      await ctx.db.$executeRawUnsafe(`
        CREATE TRIGGER force_offer_restore_audit_failure
        BEFORE INSERT ON AuditLog
        WHEN NEW.action = 'OFFER_RESTORED'
        BEGIN
          SELECT RAISE(ABORT, 'forced offer restore audit failure');
        END
      `);
      try {
        response = await ctx.post(`/api/offers/${offer.id}/restore`, { auditReason: "Audit failure proof" }, {
          token: ownerAuth.accessToken,
          ownerPin: tenant.ownerPin,
        });
      } finally {
        await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_offer_restore_audit_failure");
      }
      assert.equal(assertFailure(response, 503).code, "OFFER_AUDIT_WRITE_FAILED");
      assert.ok((await ctx.db.offer.findUniqueOrThrow({ where: { id: offer.id } })).deletedAt);

      assertSuccess(await ctx.post(`/api/offers/${offer.id}/restore`, { auditReason: "Campaign resumed" }, {
        token: ownerAuth.accessToken,
        ownerPin: tenant.ownerPin,
      }));
      assert.equal((await ctx.db.offer.findUniqueOrThrow({ where: { id: offer.id } })).deletedAt, null);
      const lifecycleAudits = await ctx.db.auditLog.findMany({
        where: {
          shopId: tenant.shop.id,
          entityId: offer.id,
          action: { in: ["OFFER_CREATED", "OFFER_UPDATED", "OFFER_DELETED", "OFFER_RESTORED"] },
        },
      });
      assert.equal(lifecycleAudits.length, 4);
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

    test("Pakka bills and estimates keep independent number series across replay", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 20, defaultPricePerRateUnit: 20 });
      const year = new Date().getUTCFullYear();
      const normalPayload = {
        ...billPayload(product, { quantity: 1, ratePerRateUnit: 20 }),
        clientBillId: "series-pakka-1",
      };
      const estimatePayload = {
        ...billPayload(product, { billType: "estimate", quantity: 1, ratePerRateUnit: 20 }),
        clientBillId: "series-estimate-1",
      };

      const normal = assertSuccess(await ctx.post("/api/bills/confirm", normalPayload, { token: ownerAuth.accessToken }), 201);
      const estimate = assertSuccess(await ctx.post("/api/bills/confirm", estimatePayload, { token: ownerAuth.accessToken }), 201);
      const replay = assertSuccess(await ctx.post("/api/bills/confirm", estimatePayload, { token: ownerAuth.accessToken }), 201);
      const nextNormal = assertSuccess(await ctx.post("/api/bills/confirm", {
        ...normalPayload,
        clientBillId: "series-pakka-2",
      }, { token: ownerAuth.accessToken }), 201);

      assert.equal(normal.billNo, `KOS-${year}-000001`);
      assert.equal(estimate.billNo, `EST-${year}-000001`);
      assert.equal(replay.id, estimate.id, "lost-response replay returns the original estimate");
      assert.equal(nextNormal.billNo, `KOS-${year}-000002`, "estimate and replay do not consume Pakka numbers");
      assert.deepEqual(
        await ctx.db.billCounter.findUnique({ where: { shopId: tenant.shop.id }, select: { lastNumber: true, estimateLastNumber: true } }),
        { lastNumber: 2, estimateLastNumber: 1 },
      );
    });

    test("GST invoice rejects no-tax mode before any money or stock effect", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 118, gstRate: 18 });
      const response = await ctx.post("/api/bills/confirm", billPayload(product, {
        billType: "gst_invoice",
        gstMode: "none",
        quantity: 1,
        ratePerRateUnit: 118,
        gstRate: 18,
      }), { token: ownerAuth.accessToken });

      const failure = assertFailure(response, 400);
      assert.match(JSON.stringify(failure), /GST invoice requires inclusive or exclusive GST mode/);
      assert.equal(await ctx.db.bill.count({ where: { shopId: tenant.shop.id } }), 0);
      assert.equal(await ctx.db.billCounter.count({ where: { shopId: tenant.shop.id } }), 0);
      assert.equal((await ctx.db.product.findUniqueOrThrow({ where: { id: product.id } })).stockBaseQty, 10);
      assert.equal(await ctx.db.stockLedger.count({ where: { shopId: tenant.shop.id } }), 0);
      assert.equal(await ctx.db.financialLedger.count({ where: { shopId: tenant.shop.id } }), 0);
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
      for (const entryType of ["sale", "cash_in", "upi_in", "udhar_debit", "cost_of_goods_sold", "inventory_sale"]) {
        assert.equal(
          financialRows.filter((row) => row.entryType === entryType).reduce((sum, row) => sum + Number(row.amountPaise), 0),
          0,
          `${entryType} nets to zero paise`,
        );
      }
      assert.equal(financialRows.filter((row) => row.sourceType === "bill_cancel").length, 6, "one reversal row exists for every revenue, tender, receivable, COGS, and inventory leg");

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
      assert.equal(await ctx.db.financialLedger.count({ where: { shopId: tenant.shop.id, billId: bill.id, sourceType: "bill_cancel" } }), 6);
      assert.equal(await ctx.db.udharLedger.count({ where: { shopId: tenant.shop.id, billId: bill.id, type: "payment" } }), 1);
      assert.equal(await ctx.db.auditLog.count({ where: { shopId: tenant.shop.id, entityId: bill.id, action: "BILL_CANCELLED" } }), 1, "a lost-response retry cannot duplicate the trusted audit");
    });

    test("bill cancellation rolls every financial effect back when its required audit cannot be stored", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 50 });
      const bill = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, {
        quantity: 2,
        ratePerRateUnit: 50,
        payments: [{ mode: "cash", amount: 100 }],
      }), { token: ownerAuth.accessToken }), 201);
      assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 8);

      await ctx.db.$executeRawUnsafe(`
        CREATE TRIGGER force_bill_cancel_audit_failure
        BEFORE INSERT ON AuditLog
        WHEN NEW.action = 'BILL_CANCELLED'
        BEGIN
          SELECT RAISE(ABORT, 'forced bill cancellation audit failure');
        END
      `);
      let response;
      try {
        response = await ctx.post(
          `/api/bills/${bill.id}/cancel`,
          { reason: "must roll back" },
          { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin },
        );
      } finally {
        await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_bill_cancel_audit_failure");
      }

      assertFailure(response, 503);
      assert.equal(response.body.code, "BILL_AUDIT_WRITE_FAILED");
      assert.equal((await ctx.db.bill.findUnique({ where: { id: bill.id } })).status, "active");
      assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 8);
      assert.equal(await ctx.db.stockLedger.count({ where: { shopId: tenant.shop.id, billId: bill.id, action: "cancel_reversal" } }), 0);
      assert.equal(await ctx.db.financialLedger.count({ where: { shopId: tenant.shop.id, billId: bill.id, sourceType: "bill_cancel" } }), 0);
      assert.equal(await ctx.db.auditLog.count({ where: { shopId: tenant.shop.id, entityId: bill.id, action: "BILL_CANCELLED" } }), 0);
    });

    test("cancelled bill restore rolls all reapplied effects back when its required audit cannot be stored", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 50 });
      const bill = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, {
        quantity: 2,
        ratePerRateUnit: 50,
        payments: [{ mode: "cash", amount: 100 }],
      }), { token: ownerAuth.accessToken }), 201);
      assertSuccess(await ctx.post(
        `/api/bills/${bill.id}/cancel`,
        { reason: "prepare restore rollback" },
        { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin },
      ));
      assert.equal((await ctx.db.product.findUniqueOrThrow({ where: { id: product.id } })).stockBaseQty, 10);

      await ctx.db.$executeRawUnsafe(`
        CREATE TRIGGER force_bill_restore_audit_failure
        BEFORE INSERT ON AuditLog
        WHEN NEW.action = 'BILL_RESTORED'
        BEGIN
          SELECT RAISE(ABORT, 'forced bill restore audit failure');
        END
      `);
      try {
        await assert.rejects(
          restoreCancelledBill(
            tenant.shop.id,
            bill.id,
            { reason: "must roll back" },
            { userId: tenant.owner.id },
          ),
          (error) => error?.code === "BILL_AUDIT_WRITE_FAILED",
        );
      } finally {
        await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_bill_restore_audit_failure");
      }
      assert.equal((await ctx.db.bill.findUniqueOrThrow({ where: { id: bill.id } })).status, "cancelled");
      assert.equal((await ctx.db.product.findUniqueOrThrow({ where: { id: product.id } })).stockBaseQty, 10);
      assert.equal(await ctx.db.stockLedger.count({ where: { shopId: tenant.shop.id, billId: bill.id, action: "restore_reversal" } }), 0);
      assert.equal(await ctx.db.financialLedger.count({ where: { shopId: tenant.shop.id, billId: bill.id, sourceType: "bill_restore" } }), 0);
      assert.equal(await ctx.db.auditLog.count({ where: { shopId: tenant.shop.id, entityId: bill.id, action: "BILL_RESTORED" } }), 0);
    });

    test("bill recycle delete and restore each roll back when their required audit cannot be stored", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 50 });
      const bill = await createPaidBillViaApi(ctx, ownerAuth.accessToken, product, { quantity: 1, ratePerRateUnit: 50 });

      await ctx.db.$executeRawUnsafe(`
        CREATE TRIGGER force_bill_recycle_audit_failure
        BEFORE INSERT ON AuditLog
        WHEN NEW.action = 'BILL_MOVED_TO_RECYCLE_BIN'
        BEGIN
          SELECT RAISE(ABORT, 'forced bill recycle audit failure');
        END
      `);
      let failedDelete;
      try {
        failedDelete = await ctx.post(
          `/api/bills/${bill.id}/delete`,
          { reason: "must roll back" },
          { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin },
        );
      } finally {
        await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_bill_recycle_audit_failure");
      }
      assertFailure(failedDelete, 503);
      assert.equal((await ctx.db.bill.findUniqueOrThrow({ where: { id: bill.id } })).deletedAt, null);

      assertSuccess(await ctx.post(
        `/api/bills/${bill.id}/delete`,
        { reason: "duplicate bill display" },
        { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin },
      ));
      assert.ok((await ctx.db.bill.findUniqueOrThrow({ where: { id: bill.id } })).deletedAt);

      await ctx.db.$executeRawUnsafe(`
        CREATE TRIGGER force_bill_recycle_restore_audit_failure
        BEFORE INSERT ON AuditLog
        WHEN NEW.action = 'BILL_RESTORED_FROM_RECYCLE_BIN'
        BEGIN
          SELECT RAISE(ABORT, 'forced bill recycle restore audit failure');
        END
      `);
      let failedRestore;
      try {
        failedRestore = await ctx.post(
          `/api/bills/${bill.id}/restore`,
          { reason: "must roll back" },
          { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin },
        );
      } finally {
        await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_bill_recycle_restore_audit_failure");
      }
      assertFailure(failedRestore, 503);
      assert.ok((await ctx.db.bill.findUniqueOrThrow({ where: { id: bill.id } })).deletedAt);
      assert.equal(await ctx.db.auditLog.count({
        where: { shopId: tenant.shop.id, entityId: bill.id, action: "BILL_RESTORED_FROM_RECYCLE_BIN" },
      }), 0);
    });

    test("sale return rolls back refund, stock, and accounting when its required audit cannot be stored", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 50 });
      const sale = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, {
        quantity: 2,
        ratePerRateUnit: 50,
        payments: [{ mode: "cash", amount: 100 }],
      }), { token: ownerAuth.accessToken }), 201);
      assert.equal((await ctx.db.product.findUniqueOrThrow({ where: { id: product.id } })).stockBaseQty, 8);

      await ctx.db.$executeRawUnsafe(`
        CREATE TRIGGER force_sale_return_audit_failure
        BEFORE INSERT ON AuditLog
        WHEN NEW.action = 'SALE_RETURN_CREATED'
        BEGIN
          SELECT RAISE(ABORT, 'forced sale return audit failure');
        END
      `);
      let response;
      try {
        response = await ctx.post("/api/bills/returns", {
          refundMode: "cash",
          returnOfBillId: sale.id,
          reason: "must roll back",
          idempotencyKey: "sale-return-audit-rollback",
          clientBillId: "sale-return-audit-rollback",
          items: [{
            originalBillItemId: sale.items[0].id,
            productId: product.id,
            name: product.name,
            quantity: 1,
            enteredUnit: "piece",
            ratePerRateUnit: 50,
            gstRate: 0,
            damaged: false,
          }],
        }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin });
      } finally {
        await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_sale_return_audit_failure");
      }
      assertFailure(response, 503);
      assert.equal(response.body.code, "BILL_AUDIT_WRITE_FAILED");
      assert.equal(await ctx.db.bill.count({ where: { shopId: tenant.shop.id, billType: "sales_return" } }), 0);
      assert.equal((await ctx.db.product.findUniqueOrThrow({ where: { id: product.id } })).stockBaseQty, 8);
      assert.equal(await ctx.db.stockLedger.count({ where: { shopId: tenant.shop.id, action: "return" } }), 0);
      assert.equal(await ctx.db.financialLedger.count({ where: { shopId: tenant.shop.id, sourceType: "sale_return" } }), 0);
      assert.equal(await ctx.db.auditLog.count({ where: { shopId: tenant.shop.id, action: "SALE_RETURN_CREATED" } }), 0);
    });

    test("partial returns reverse invoice discount and GST exactly without refresh-era drift", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, {
        stockBaseQty: 10,
        defaultPricePerRateUnit: 100,
        costPerRateUnit: 60,
        gstRate: 18,
      });
      const sale = assertSuccess(await ctx.post("/api/bills/confirm", {
        ...billPayload(product, {
          quantity: 2,
          ratePerRateUnit: 100,
          gstMode: "exclusive",
          gstRate: 18,
          discount: 20,
          actualAmount: 212.4,
          buyerPaidAmount: 212.4,
          payments: [{ mode: "cash", amount: 212.4 }],
        }),
        reason: "Invoice discount GST return proof",
      }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }), 201);

      assert.equal(sale.subtotal, 200);
      assert.equal(sale.discount, 20);
      assert.equal(sale.gst, 32.4);
      assert.equal(sale.grandTotal, 212.4);

      const returnPayload = (identity) => ({
        refundMode: "cash",
        returnOfBillId: sale.id,
        reason: "Partial discounted sale return",
        idempotencyKey: identity,
        clientBillId: identity,
        items: [{
          originalBillItemId: sale.items[0].id,
          productId: product.id,
          name: product.name,
          quantity: 1,
          enteredUnit: "piece",
          ratePerRateUnit: 100,
          gstRate: 18,
          damaged: false,
        }],
      });

      const firstReturn = assertSuccess(await ctx.post(
        "/api/bills/returns",
        returnPayload("discounted-gst-return-1"),
        { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin },
      ), 201);
      assert.equal(firstReturn.subtotal, -90);
      assert.equal(firstReturn.discount, 0);
      assert.equal(firstReturn.gst, -16.2);
      assert.equal(firstReturn.grandTotal, -106.2);
      assert.equal(firstReturn.items[0].lineTotal, -90);
      assert.equal(firstReturn.items[0].lineDiscount, -10);

      const secondReturn = assertSuccess(await ctx.post(
        "/api/bills/returns",
        returnPayload("discounted-gst-return-2"),
        { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin },
      ), 201);
      assert.equal(secondReturn.subtotal, -90);
      assert.equal(secondReturn.gst, -16.2);
      assert.equal(secondReturn.grandTotal, -106.2);

      const activeReturns = await ctx.db.bill.findMany({
        where: { shopId: tenant.shop.id, returnOfBillId: sale.id, billType: "sales_return", status: "active" },
      });
      assert.equal(activeReturns.reduce((sum, row) => sum + row.subtotal, 0), -sale.subtotal + sale.discount);
      assert.equal(activeReturns.reduce((sum, row) => sum + row.gst, 0), -sale.gst);
      assert.equal(activeReturns.reduce((sum, row) => sum + row.grandTotal, 0), -sale.grandTotal);
      assert.equal((await ctx.db.product.findUniqueOrThrow({ where: { id: product.id } })).stockBaseQty, 10);
      const gstReport = assertSuccess(await ctx.get("/api/reports/gst?range=monthly", { token: ownerAuth.accessToken }));
      assert.equal(gstReport.taxableSales, 0, "full returns must reverse the discounted taxable base exactly");
      assert.equal(gstReport.gstCollected, 0, "full returns must reverse the stored GST exactly");
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
