import test from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { createTenant, createProduct, login, uniqueMobile } from "./factories.js";
import { assertLiveMarket, settingsWithMarketPolicy, LIVE_MARKET } from "../../src/modules/shops/market-policy.js";

test("market identity is enforced at the HTTP boundary without relabeling live data", async (t) => {
  const ctx = await createIntegrationContext();
  if (ctx.skip) { t.skip(ctx.reason); return; }
  try {
    await resetDatabase(ctx.db);
    const tenant = await createTenant(ctx.db);
    const product = await createProduct(ctx.db, tenant.shop.id, { defaultPricePerRateUnit: 105 });
    const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    const options = { token: auth.accessToken, ownerPin: tenant.ownerPin };
    const original = await ctx.db.shop.findUniqueOrThrow({ where: { id: tenant.shop.id } });

    await t.test("rejects market writes atomically, including cosmetic and JSON changes", async () => {
      for (const body of [
        { countryCode: "AE", currencyCode: "AED" },
        { currencyCode: "USD" },
        { settingsJson: JSON.stringify({ region: { countryCode: "AE", currencyCode: "AED" } }) },
        { settingsJson: JSON.stringify({ storeProfile: { country: "UAE", currency: "AED" } }) },
      ]) {
        assertFailure(await ctx.patch("/api/shops", body, options), 409);
        const after = await ctx.db.shop.findUniqueOrThrow({ where: { id: tenant.shop.id } });
        assert.equal(after.settingsJson, original.settingsJson);
        assert.equal((await ctx.db.product.findUniqueOrThrow({ where: { id: product.id } })).defaultPricePerRateUnit, 105);
      }
    });

    await t.test("preserves old-client preference writes and canonicalizes the denomination", async () => {
      const oldPrefs = JSON.parse(original.settingsJson || "{}");
      const saved = assertSuccess(await ctx.patch("/api/shops", { settingsJson: JSON.stringify({ ...oldPrefs, printer: { copies: 2 } }) }, options));
      const prefs = JSON.parse(saved.settingsJson);
      assert.deepEqual(prefs.region, LIVE_MARKET);
      assert.equal(prefs.printer.copies, 2);
      const oldClientAgain = assertSuccess(await ctx.patch("/api/shops", { settingsJson: JSON.stringify({ ...oldPrefs, printer: { copies: 1 } }) }, options));
      assert.deepEqual(JSON.parse(oldClientAgain.settingsJson).region, LIVE_MARKET);
    });

    await t.test("rejects unsupported signup before creating a tenant", async () => {
      const mobile = "+971501234567";
      const input = { shopName: "UAE Preview Only", ownerName: "Test Owner", city: "Dubai", address: "Preview Address", mobile, password: "Password123", countryCode: "AE", currencyCode: "AED" };
      assert.equal(assertFailure(await ctx.post("/api/auth/register", input), 409).code, "MARKET_NOT_LIVE");
      assert.equal(await ctx.db.shop.count({ where: { name: input.shopName } }), 0);
      assert.equal(await ctx.db.user.count({ where: { mobile } }), 0);
    });

    await t.test("legacy signup receives explicit INR identity", async () => {
      const registered = assertSuccess(await ctx.post("/api/auth/register", { shopName: "India Market", ownerName: "Test Owner", city: "Jaipur", address: "Test Street", mobile: uniqueMobile(), password: "Password123" }), 201);
      assert.deepEqual(JSON.parse(registered.shop.settingsJson).region, LIVE_MARKET);
    });
  } finally { await ctx.close(); }
});

test("legacy shops receive a canonical INR accounting contract", () => {
  assert.deepEqual(settingsWithMarketPolicy({ printer: { copies: 2 } }), { printer: { copies: 2 }, region: LIVE_MARKET });
  assert.doesNotThrow(() => assertLiveMarket());
  assert.doesNotThrow(() => assertLiveMarket("IN", "INR"));
});

test("country/currency changes and unimplemented markets fail closed", () => {
  for (const [country, currency] of [["AE", "AED"], ["AE", "INR"], ["IN", "USD"], [null, null], ["US", "USD"]]) {
    assert.throws(() => assertLiveMarket(country, currency), { code: "MARKET_NOT_LIVE" });
  }
  for (const region of [null, "AE", [], { countryCode: "AE" }, { currencyCode: "AED" }, { timeZone: "Asia/Dubai" }, { version: 2 }, { unsupported: true }]) {
    assert.throws(() => settingsWithMarketPolicy({ region }), { code: "MARKET_CHANGE_REQUIRES_MIGRATION" });
  }
  for (const storeProfile of [{ currency: "AED" }, { country: "UAE" }]) {
    assert.throws(() => settingsWithMarketPolicy({ storeProfile }), { code: "MARKET_CHANGE_REQUIRES_MIGRATION" });
  }
});

test("old clients cannot erase the market and stale cosmetic labels are repaired", () => {
  const previous = { storeProfile: { country: "UAE", currency: "AED" }, region: LIVE_MARKET };
  const result = settingsWithMarketPolicy({ storeProfile: { ...previous.storeProfile, name: "Test" } }, previous);
  assert.deepEqual(result.storeProfile, { name: "Test", country: "India", currency: "Indian Rupee (INR)" });
  assert.deepEqual(result.region, LIVE_MARKET);
  assert.deepEqual(settingsWithMarketPolicy({ printer: {} }, previous).region, LIVE_MARKET);
  assert.deepEqual(previous.storeProfile, { country: "UAE", currency: "AED" });
});
