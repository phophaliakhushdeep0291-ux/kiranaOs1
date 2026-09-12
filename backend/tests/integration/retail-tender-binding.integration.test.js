import assert from "node:assert/strict";
import test from "node:test";
import { assertFailure, assertSuccess, createIntegrationContext, resetDatabase } from "./setup.js";
import { billPayload, createProduct, createTenant, login } from "./factories.js";
import { resolveOperationalLocation } from "../../src/modules/stores/location-context.service.js";

test("retail captures are single-use, correctly classified tenders with atomic bill rollback", async (t) => {
  const ctx = await createIntegrationContext();
  if (ctx.skip) { t.skip(ctx.reason); return; }
  try {
    await resetDatabase(ctx.db);
    const tenant = await createTenant(ctx.db);
    const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    const options = { token: auth.accessToken, ownerPin: tenant.ownerPin };
    const location = await resolveOperationalLocation(tenant.shop.id);
    const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 20, defaultPricePerRateUnit: 50 });
    // Synthetic capture records isolate billing guards. Live capture/provider
    // signature verification is covered separately; this is not live bank proof.
    const makeIntent = (checkoutMode, extra = {}) => ctx.db.retailPaymentIntent.create({ data: {
      shopId: tenant.shop.id, locationId: location.id, amountPaise: 5000, currency: "INR",
      provider: checkoutMode === "terminal" ? "pine_labs" : "razorpay", checkoutMode,
      status: "confirmed", providerPaymentId: `test_capture_${checkoutMode}`,
      confirmedAt: new Date(), confirmationSource: "integration_fixture",
      expiresAt: new Date(Date.now() + 60_000), ...extra,
    } });
    const upi = await makeIntent("dynamic_qr");
    const card = await makeIntent("terminal");
    const emptyCapture = await makeIntent("checkout", { providerPaymentId: null });
    const wrongCurrency = await makeIntent("checkout", { currency: "USD", providerPaymentId: "test_usd_capture" });
    const row = (mode, intentId, extra = {}) => ({ mode, amount: 50, retailPaymentIntentId: intentId, ...extra });
    const post = (payments, extra = {}) => ctx.post("/api/bills/confirm", {
      ...billPayload(product, { quantity: payments.length, payments }), ...extra,
    }, options);

    for (const [name, payments, code] of [
      ["UPI cannot be reported as a bank/card tender", [row("bank", upi.id)], "RETAIL_PAYMENT_TENDER_MISMATCH"],
      ["card cannot be reported as UPI", [row("upi", card.id)], "RETAIL_PAYMENT_TENDER_MISMATCH"],
      ["cash cannot silently discard a supplied capture", [row("cash", upi.id)], "RETAIL_PAYMENT_TENDER_MISMATCH"],
      ["duplicate references cannot pay twice in one bill", [row("upi", upi.id), { mode: "upi", amount: 50, retail_payment_intent_id: upi.id }], "RETAIL_PAYMENT_INTENT_DUPLICATE"],
      ["conflicting aliases cannot choose a different capture", [row("upi", upi.id, { retail_payment_intent_id: card.id })], "RETAIL_PAYMENT_INTENT_AMBIGUOUS"],
      ["confirmed status alone is not capture evidence", [row("upi", emptyCapture.id)], "RETAIL_PAYMENT_INTENT_INVALID"],
      ["foreign currency cannot settle an INR bill", [row("upi", wrongCurrency.id)], "RETAIL_PAYMENT_INTENT_INVALID"],
    ]) {
      const failed = assertFailure(await post(payments), 409);
      assert.equal(failed.code, code, name);
      assert.equal(await ctx.db.bill.count({ where: { shopId: tenant.shop.id } }), 0, name);
      assert.equal(await ctx.db.payment.count({ where: { shopId: tenant.shop.id } }), 0, name);
      assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 20, name);
      assert.equal((await ctx.db.retailPaymentIntent.findUnique({ where: { id: upi.id } })).consumedAt, null, name);
    }

    const mixed = [row("upi", upi.id), { mode: "bank", amount: 50, retail_payment_intent_id: card.id }, { mode: "cash", amount: 50 }];
    const identity = { idempotencyKey: "retail-tender-binding-valid-sale" };
    const bill = assertSuccess(await post(mixed, identity), 201);
    assert.equal(bill.grandTotal, 150);
    const stored = await ctx.db.payment.findMany({ where: { billId: bill.id } });
    assert.equal(stored.length, 3);
    assert.equal(stored.find((payment) => payment.retailPaymentIntentId === upi.id)?.mode, "upi");
    assert.equal(stored.find((payment) => payment.retailPaymentIntentId === card.id)?.mode, "bank");
    assert.equal(stored.find((payment) => payment.mode === "cash")?.provider, "manual");
    assert.ok((await ctx.db.retailPaymentIntent.findUnique({ where: { id: upi.id } })).consumedAt);
    assert.ok((await ctx.db.retailPaymentIntent.findUnique({ where: { id: card.id } })).consumedAt);
    const replay = assertSuccess(await post(mixed, identity), 201);
    assert.equal(replay.id, bill.id);
    assert.equal(await ctx.db.payment.count({ where: { shopId: tenant.shop.id } }), 3);
    const reused = assertFailure(await post([row("upi", upi.id)]), 409);
    assert.equal(reused.code, "RETAIL_PAYMENT_INTENT_INVALID");
    assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 17);
  } finally {
    await ctx.close();
  }
});
