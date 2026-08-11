import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { createProduct, createTenant, login } from "./factories.js";
import { pricingActor } from "../../src/modules/pricing/pricing.controller.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("pricing controls integration skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  async function forceAuditFailure(action, request) {
    const triggerName = `force_${action.toLowerCase()}_audit_failure`;
    await ctx.db.$executeRawUnsafe(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON AuditLog
      WHEN NEW.action = '${action}'
      BEGIN
        SELECT RAISE(ABORT, 'forced pricing audit failure');
      END
    `);
    try {
      return await request();
    } finally {
      await ctx.db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${triggerName}`);
    }
  }

  describe("permanent pricing controls", () => {
    test("requires owner approval and atomically audits settings, rules, and selling units", async () => {
      const tenant = await createTenant(ctx.db, { ownerPin: "1234", planCode: "pro" });
      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      const product = await createProduct(ctx.db, tenant.shop.id, {
        name: "Atomic Pricing Product",
        baseUnit: "piece",
        rateUnit: "piece",
        defaultPricePerRateUnit: 20,
        minPricePerRateUnit: 15,
        costPerRateUnit: 10,
      });
      const approved = { token: auth.accessToken, ownerPin: tenant.ownerPin };
      const rulePayload = {
        name: "Six pack price",
        ruleType: "PRODUCT_QUANTITY_PRICE",
        productId: product.id,
        minQuantity: 6,
        fixedUnitPrice: 18,
      };

      assertFailure(await ctx.post("/api/pricing/rules", rulePayload, { token: auth.accessToken }), 403);
      assert.equal(pricingActor({
        user: { userId: tenant.owner.id, role: "owner", deviceId: null },
        device: { deviceId: "verified-request-device" },
        headers: { "x-device-id": "verified-request-device" },
      }).deviceId, "verified-request-device", "verified request device must survive a legacy unbound session");
      let failed = await forceAuditFailure("PRICING_RULE_CREATED", () => ctx.post("/api/pricing/rules", rulePayload, approved));
      assert.equal(assertFailure(failed, 503).code, "PRICING_AUDIT_WRITE_FAILED");
      assert.equal(await ctx.db.pricingRule.count({ where: { shopId: tenant.shop.id } }), 0);

      const rule = assertSuccess(await ctx.post("/api/pricing/rules", rulePayload, approved), 201);
      assert.equal(rule.fixedUnitPrice, 18);
      failed = await forceAuditFailure("PRICING_RULE_UPDATED", () => ctx.patch(`/api/pricing/rules/${rule.id}`, { fixedUnitPrice: 17 }, approved));
      assert.equal(assertFailure(failed, 503).code, "PRICING_AUDIT_WRITE_FAILED");
      assert.equal((await ctx.db.pricingRule.findUniqueOrThrow({ where: { id: rule.id } })).fixedUnitPrice, 18);
      assert.equal(assertSuccess(await ctx.patch(`/api/pricing/rules/${rule.id}`, { fixedUnitPrice: 17 }, approved)).fixedUnitPrice, 17);

      failed = await forceAuditFailure("PRICING_RULE_DELETED", () => ctx.delete(`/api/pricing/rules/${rule.id}`, approved));
      assert.equal(assertFailure(failed, 503).code, "PRICING_AUDIT_WRITE_FAILED");
      assert.equal((await ctx.db.pricingRule.findUniqueOrThrow({ where: { id: rule.id } })).status, "ACTIVE");
      assert.equal(assertSuccess(await ctx.delete(`/api/pricing/rules/${rule.id}`, approved)).status, "ARCHIVED");

      failed = await forceAuditFailure("SMART_PRICING_SETTINGS_UPDATED", () => ctx.patch("/api/pricing/settings", {
        smartPricingEnabled: false,
        minObservations: 9,
      }, approved));
      assert.equal(assertFailure(failed, 503).code, "PRICING_AUDIT_WRITE_FAILED");
      const settingsAfterFailure = JSON.parse((await ctx.db.shop.findUniqueOrThrow({ where: { id: tenant.shop.id } })).settingsJson || "{}");
      assert.equal(settingsAfterFailure.pricing, undefined);
      assert.equal(assertSuccess(await ctx.patch("/api/pricing/settings", { smartPricingEnabled: false, minObservations: 9 }, approved)).minObservations, 9);

      const defaultUnitPayload = {
        name: "Piece",
        unitType: "piece",
        unitCode: "piece",
        conversionToBase: 1,
        defaultPrice: 22,
        minimumPrice: 16,
        maximumPrice: 25,
        costPrice: 11,
        isDefault: true,
        isActive: true,
      };
      failed = await forceAuditFailure("PRODUCT_SELLING_UNIT_CREATED", () => ctx.post(`/api/pricing/products/${product.id}/units`, defaultUnitPayload, approved));
      assert.equal(assertFailure(failed, 503).code, "PRICING_AUDIT_WRITE_FAILED");
      assert.equal(await ctx.db.productSellingUnit.count({ where: { productId: product.id } }), 0);
      assert.equal((await ctx.db.product.findUniqueOrThrow({ where: { id: product.id } })).defaultPricePerRateUnit, 20, "failed unit audit must also roll back the mirrored product price");

      const defaultUnit = assertSuccess(await ctx.post(`/api/pricing/products/${product.id}/units`, defaultUnitPayload, approved), 201);
      assert.equal((await ctx.db.product.findUniqueOrThrow({ where: { id: product.id } })).defaultPricePerRateUnit, 22);
      failed = await forceAuditFailure("PRODUCT_SELLING_UNIT_UPDATED", () => ctx.patch(`/api/pricing/products/${product.id}/units/${defaultUnit.id}`, { defaultPrice: 24 }, approved));
      assert.equal(assertFailure(failed, 503).code, "PRICING_AUDIT_WRITE_FAILED");
      assert.equal((await ctx.db.productSellingUnit.findUniqueOrThrow({ where: { id: defaultUnit.id } })).defaultPrice, 22);
      assert.equal((await ctx.db.product.findUniqueOrThrow({ where: { id: product.id } })).defaultPricePerRateUnit, 22);
      assert.equal(assertSuccess(await ctx.patch(`/api/pricing/products/${product.id}/units/${defaultUnit.id}`, { defaultPrice: 24 }, approved)).defaultPrice, 24);

      const carton = assertSuccess(await ctx.post(`/api/pricing/products/${product.id}/units`, {
        name: "Carton of 12",
        unitType: "carton",
        unitCode: "carton-12",
        conversionToBase: 12,
        defaultPrice: 250,
        isDefault: false,
        isActive: true,
      }, approved), 201);
      failed = await forceAuditFailure("PRODUCT_SELLING_UNIT_ARCHIVED", () => ctx.delete(`/api/pricing/products/${product.id}/units/${carton.id}`, approved));
      assert.equal(assertFailure(failed, 503).code, "PRICING_AUDIT_WRITE_FAILED");
      assert.equal((await ctx.db.productSellingUnit.findUniqueOrThrow({ where: { id: carton.id } })).isActive, true);
      assert.equal(assertSuccess(await ctx.delete(`/api/pricing/products/${product.id}/units/${carton.id}`, approved)).isActive, false);

      const pricingAudits = await ctx.db.auditLog.findMany({
        where: {
          shopId: tenant.shop.id,
          action: {
            in: [
              "PRICING_RULE_CREATED",
              "PRICING_RULE_UPDATED",
              "PRICING_RULE_DELETED",
              "SMART_PRICING_SETTINGS_UPDATED",
              "PRODUCT_SELLING_UNIT_CREATED",
              "PRODUCT_SELLING_UNIT_UPDATED",
              "PRODUCT_SELLING_UNIT_ARCHIVED",
            ],
          },
        },
        select: { action: true, userId: true, deviceId: true },
      });
      const actions = pricingAudits.map((row) => row.action);
      for (const action of ["PRICING_RULE_CREATED", "PRICING_RULE_UPDATED", "PRICING_RULE_DELETED"]) {
        assert.equal(actions.filter((candidate) => candidate === action).length, 1);
      }
      assert.equal(await ctx.db.auditLog.count({ where: { shopId: tenant.shop.id, action: "SMART_PRICING_SETTINGS_UPDATED" } }), 1);
      assert.equal(await ctx.db.auditLog.count({ where: { shopId: tenant.shop.id, action: { startsWith: "PRODUCT_SELLING_UNIT_" } } }), 4);
      assert.equal(pricingAudits.length, 8);
      for (const audit of pricingAudits) {
        assert.equal(audit.userId, tenant.owner.id, `${audit.action} must retain the approving owner`);
        assert.ok(audit.deviceId, `${audit.action} must retain the originating device`);
      }
    });
  });
}
