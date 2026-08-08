import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { billPayload, createProduct, createTenant, login } from "./factories.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("subscription/device integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  async function ownerCtx(overrides = {}) {
    const tenant = await createTenant(ctx.db, overrides);
    const ownerAuth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    return { tenant, ownerAuth };
  }

  describe("subscription and device integration", () => {
    test("plans endpoint returns the three public plans and hides Legacy Standard", async () => {
      const plans = assertSuccess(await ctx.get("/api/plans"));
      assert.deepEqual(plans.map((p) => p.code), ["starter", "growth", "pro"]);
      assert.deepEqual(plans.map((p) => p.priceMonthlyPaise), [4900, 59900, 99900]);
    });

    test("current subscription returns fallback/trial for shop without subscription", async () => {
      const { ownerAuth } = await ownerCtx({ planCode: null });
      const current = assertSuccess(await ctx.get("/api/subscription/current", { token: ownerAuth.accessToken }));
      assert.equal(current.planCode, "starter");
      assert.equal(current.status, "trial");
      assert.equal(current.source, "fallback/trial");
    });

    test("manual activation creates active subscription and payment transaction", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const result = assertSuccess(await ctx.post("/api/subscription/manual-activate", {
        planCode: "growth",
        period: "monthly",
      }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }), 201);
      assert.equal(result.subscription.planCode, "growth");
      assert.equal(result.subscription.status, "active");
      const paymentCount = await ctx.db.paymentTransaction.count({ where: { shopId: tenant.shop.id } });
      assert.equal(paymentCount, 1);
    });

    test("grandfathers an existing subscription's original price and feature set", async () => {
      const { tenant, ownerAuth } = await ownerCtx({ planCode: "starter" });
      const oldFeatures = ["basic_billing", "csv_import_export", "legacy_shop_feature"];
      await ctx.db.subscription.update({ where: { shopId: tenant.shop.id }, data: {
        lockedPriceMonthlyPaise: 34900, lockedPriceYearlyPaise: 299900,
        entitledFeaturesJson: JSON.stringify(oldFeatures),
      }});
      await ctx.get("/api/plans"); // reseed the new public catalog
      const current = assertSuccess(await ctx.get("/api/subscription/current", { token: ownerAuth.accessToken }));
      assert.equal(current.plan.priceMonthlyPaise, 34900);
      assert.equal(current.plan.priceYearlyPaise, 299900);
      assert.deepEqual(current.plan.features, oldFeatures);
    });

    test("founding period expires through grace into its intended paid plan without data loss", async () => {
      const { tenant, ownerAuth } = await ownerCtx({ planCode: "starter" });
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "Founding catalog item" });
      const endsAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
      const founding = assertSuccess(await ctx.post("/api/subscription/founding-customer", {
        intendedPaidPlanCode: "growth", endsAt,
      }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }), 201);
      assert.equal(founding.provider, "founding");
      assert.equal(founding.intendedPaidPlanCode, "growth");
      const past = new Date(Date.now() - 10_000);
      await ctx.db.subscription.update({ where: { shopId: tenant.shop.id }, data: { trialEndsAt: past, currentPeriodEnd: past, graceEndsAt: past } });
      const expired = assertSuccess(await ctx.get("/api/subscription/current", { token: ownerAuth.accessToken }));
      assert.equal(expired.active, false);
      assert.equal(expired.intendedPaidPlanCode, "growth");
      assert.ok(await ctx.db.product.findUnique({ where: { id: product.id } }));
      const paid = assertSuccess(await ctx.post("/api/subscription/manual-activate", {
        planCode: "growth", period: "yearly",
      }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }), 201);
      assert.equal(paid.subscription.planCode, "growth");
      assert.equal(await ctx.db.product.count({ where: { shopId: tenant.shop.id } }), 1);
    });

    test("expired subscription can still complete a sale and export its data", async () => {
      const { tenant, ownerAuth } = await ownerCtx({ planCode: "starter" });
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10 });
      const past = new Date(Date.now() - 10_000);
      await ctx.db.subscription.update({ where: { shopId: tenant.shop.id }, data: { status: "expired", currentPeriodEnd: past, graceEndsAt: past } });
      const sale = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product), { token: ownerAuth.accessToken }), 201);
      assert.ok(sale.id);
      const exported = await ctx.get("/api/reports/export/bills", { token: ownerAuth.accessToken, headers: { "x-owner-pin": tenant.ownerPin } });
      assert.equal(exported.status, 200, JSON.stringify(exported.body));
      assert.equal(await ctx.db.bill.count({ where: { shopId: tenant.shop.id } }), 1);
    });

    test("device activation enforces plan maxDevices and removed devices stop counting", async () => {
      const { tenant, ownerAuth } = await ownerCtx({ planCode: null });
      const d1 = assertSuccess(await ctx.post("/api/devices/activate", { deviceId: "device-1", deviceName: "Counter 1" }, { token: ownerAuth.accessToken }), 201);
      assert.equal(d1.deviceId, "device-1");
      const secondAuth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      const d2 = assertSuccess(await ctx.post("/api/devices/activate", { deviceId: "device-2", deviceName: "Counter 2" }, { token: secondAuth.accessToken }), 201);
      assert.equal(d2.deviceId, "device-2");
      const thirdAuth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      const over = assertFailure(await ctx.post("/api/devices/activate", { deviceId: "device-3", deviceName: "Counter 3" }, { token: thirdAuth.accessToken }), 403);
      assert.equal(over.code, "DEVICE_LIMIT_EXCEEDED");
      // ownerAuth's session is bound to device-1 (it activated it), so removing that slot is
      // "remove the device you're on" — which now requires the explicit removeCurrentDevice flag.
      assertSuccess(await ctx.request("DELETE", "/api/devices/device-1", {
        token: ownerAuth.accessToken,
        ownerPin: tenant.ownerPin,
        headers: { "x-device-id": "device-1" },
        body: { removeCurrentDevice: true },
      }));
      const d3 = assertSuccess(await ctx.post("/api/devices/activate", { deviceId: "device-3", deviceName: "Counter 3" }, { token: thirdAuth.accessToken }), 201);
      assert.equal(d3.deviceId, "device-3");
    });

    test("heartbeat updates lastActiveAt and license returns plan/features", async () => {
      const { ownerAuth } = await ownerCtx({ planCode: null });
      await ctx.post("/api/devices/activate", { deviceId: "device-1", deviceName: "Counter 1" }, { token: ownerAuth.accessToken });
      const hb = assertSuccess(await ctx.post("/api/devices/heartbeat", { deviceId: "device-1" }, { token: ownerAuth.accessToken }));
      assert.equal(hb.deviceId, "device-1");
      assert.ok(hb.lastActiveAt);
      const license = assertSuccess(await ctx.get("/api/devices/license?deviceId=device-1", { token: ownerAuth.accessToken }));
      assert.equal(license.planCode, "starter");
      assert.ok(license.features.includes("basic_billing"));
      assert.equal(license.maxDevices, 2);
    });

    test("razorpay webhook without a valid signature is rejected", async () => {
      const response = await ctx.post("/api/payment-provider/razorpay/webhook", {
        id: "evt_test_1",
        event: "payment.captured",
        payload: { payment: { entity: { id: "pay_test_1" } } },
      });
      assert.equal(response.status, 400, JSON.stringify(response.body));
      assert.equal(response.body.code, "INVALID_WEBHOOK_SIGNATURE");
      const stored = await ctx.db.paymentProviderEvent.count({ where: { provider: "razorpay", eventId: "evt_test_1" } });
      assert.equal(stored, 0);
    });
  });
}
