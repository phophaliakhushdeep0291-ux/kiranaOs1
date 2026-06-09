import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createIntegrationContext, resetDatabase, assertSuccess, assertFailure } from "./setup.js";
import { createTenant, login } from "./factories.js";

const RAZORPAY_SECRET = "test_razorpay_secret_12345";
const RAZORPAY_WEBHOOK_SECRET = "test_razorpay_webhook_secret_12345";

process.env.RAZORPAY_ENABLED = "true";
process.env.RAZORPAY_KEY_ID = "rzp_test_kiranaos";
process.env.RAZORPAY_KEY_SECRET = RAZORPAY_SECRET;
process.env.RAZORPAY_WEBHOOK_SECRET = RAZORPAY_WEBHOOK_SECRET;

test("Razorpay checkout, verify, webhook, idempotency, and manual activation flows", async (t) => {
  const originalFetch = global.fetch;
  let orderCounter = 1;
  const razorpayCalls = [];

  global.fetch = async (url, options = {}) => {
    const target = typeof url === "string" ? url : url?.toString?.() || "";
    if (target.startsWith("https://api.razorpay.com/v1/orders") && options.method === "POST") {
      razorpayCalls.push({ target, options });
      const body = JSON.parse(options.body);
      return jsonResponse({
        id: `order_test_${orderCounter++}`,
        entity: "order",
        amount: body.amount,
        currency: body.currency,
        receipt: body.receipt,
        status: "created",
        notes: body.notes,
      });
    }
    if (target.includes("https://api.razorpay.com/v1/payments/")) {
      const paymentId = target.split("/").pop();
      return jsonResponse({
        id: paymentId,
        entity: "payment",
        order_id: "order_test_1",
        amount: 49900,
        currency: "INR",
        status: "captured",
        captured: true,
        notes: {},
      });
    }
    if (target.includes("https://api.razorpay.com/v1/orders/")) {
      const orderId = target.split("/").pop();
      return jsonResponse({ id: orderId, entity: "order", status: "paid", amount: 49900, currency: "INR" });
    }
    return originalFetch(url, options);
  };

  const ctx = await createIntegrationContext();
  if (ctx.skip) {
    global.fetch = originalFetch;
    t.skip(ctx.reason);
    return;
  }

  try {
    await resetDatabase(ctx.db);
    const tenant = await createTenant(ctx.db);
    const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    const token = auth.accessToken;

    const checkoutRes = await ctx.post("/api/subscription/checkout", { planCode: "growth", billingCycle: "monthly", provider: "razorpay" }, { token });
    const checkout = assertSuccess(checkoutRes);
    assert.equal(checkout.provider, "razorpay");
    assert.equal(checkout.razorpayKeyId, "rzp_test_kiranaos");
    assert.equal(checkout.amountPaise, 49900);
    assert.ok(checkout.orderId);
    assert.ok(checkout.transactionId);
    assert.equal(JSON.stringify(checkout).includes(RAZORPAY_SECRET), false);

    const createdTxn = await ctx.db.paymentTransaction.findUnique({ where: { id: checkout.transactionId } });
    assert.equal(createdTxn.status, "created");
    assert.equal(razorpayCalls.length, 1);

    const invalidVerify = await ctx.post("/api/subscription/verify-payment", {
      transactionId: checkout.transactionId,
      razorpay_order_id: checkout.orderId,
      razorpay_payment_id: "pay_test_invalid",
      razorpay_signature: "bad_signature",
    }, { token });
    assertFailure(invalidVerify, 400);
    assert.equal(invalidVerify.body.code, "INVALID_PAYMENT_SIGNATURE");

    const paymentId = "pay_test_valid_1";
    const signature = signPayment(checkout.orderId, paymentId, RAZORPAY_SECRET);
    const verifyRes = await ctx.post("/api/subscription/verify-payment", {
      transactionId: checkout.transactionId,
      razorpay_order_id: checkout.orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
    }, { token });
    const verified = assertSuccess(verifyRes);
    assert.equal(verified.activated, true);

    const subscription = await ctx.db.subscription.findUnique({ where: { shopId: tenant.shop.id } });
    assert.equal(subscription.status, "active");
    assert.equal(subscription.planCode, "growth");
    const paidTxn = await ctx.db.paymentTransaction.findUnique({ where: { id: checkout.transactionId } });
    assert.equal(paidTxn.status, "paid");
    assert.equal(paidTxn.providerPaymentId, paymentId);

    const duplicateVerify = await ctx.post("/api/subscription/verify-payment", {
      transactionId: checkout.transactionId,
      razorpay_order_id: checkout.orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
    }, { token });
    const duplicateData = assertSuccess(duplicateVerify);
    assert.equal(duplicateData.idempotent, true);

    const event = {
      id: "evt_payment_captured_1",
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_webhook_1",
            order_id: checkout.orderId,
            amount: 49900,
            currency: "INR",
            status: "captured",
            created_at: Math.floor(Date.now() / 1000),
            notes: { shopId: tenant.shop.id, planCode: "growth", billingCycle: "monthly", transactionId: checkout.transactionId },
          },
        },
      },
    };

    const invalidWebhook = await postRawWebhook(ctx.baseUrl, event, "wrong");
    assert.equal(invalidWebhook.status, 400);
    assert.equal(invalidWebhook.body.code, "INVALID_WEBHOOK_SIGNATURE");

    const webhookBody = JSON.stringify(event);
    const webhookSig = signWebhook(webhookBody, RAZORPAY_WEBHOOK_SECRET);
    const webhookRes = await postRawWebhook(ctx.baseUrl, webhookBody, webhookSig, true);
    assertSuccess(webhookRes);
    const providerEvent = await ctx.db.paymentProviderEvent.findUnique({ where: { provider_eventId: { provider: "razorpay", eventId: event.id } } });
    assert.ok(providerEvent);
    assert.equal(providerEvent.signatureVerified, true);

    const beforeDuplicateEnd = (await ctx.db.subscription.findUnique({ where: { shopId: tenant.shop.id } })).currentPeriodEnd.getTime();
    const duplicateWebhookRes = await postRawWebhook(ctx.baseUrl, webhookBody, webhookSig, true);
    const duplicateWebhook = assertSuccess(duplicateWebhookRes);
    assert.equal(duplicateWebhook.duplicate, true);
    const afterDuplicateEnd = (await ctx.db.subscription.findUnique({ where: { shopId: tenant.shop.id } })).currentPeriodEnd.getTime();
    assert.equal(afterDuplicateEnd, beforeDuplicateEnd);

    const failureEventBody = JSON.stringify({
      id: "evt_payment_failed_1",
      event: "payment.failed",
      payload: { payment: { entity: { id: "pay_failed_1", status: "failed", notes: { shopId: tenant.shop.id, transactionId: checkout.transactionId } } } },
    });
    const failureRes = await postRawWebhook(ctx.baseUrl, failureEventBody, signWebhook(failureEventBody, RAZORPAY_WEBHOOK_SECRET), true);
    const failure = assertSuccess(failureRes);
    assert.equal(failure.activated, false);

    const manualRes = await ctx.post("/api/subscription/manual-activate", { planCode: "pro", period: "monthly", amountPaise: 69900 }, { token, ownerPin: tenant.ownerPin });
    assertSuccess(manualRes, 201);

    const auditCount = await ctx.db.auditLog.count({ where: { shopId: tenant.shop.id, action: { in: ["SUBSCRIPTION_CHECKOUT_CREATED", "PAYMENT_VERIFIED", "SUBSCRIPTION_ACTIVATED", "PAYMENT_WEBHOOK_RECEIVED"] } } });
    assert.ok(auditCount >= 3);
  } finally {
    global.fetch = originalFetch;
    await ctx.close?.();
  }
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function signPayment(orderId, paymentId, secret) {
  return crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
}

function signWebhook(body, secret) {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

async function postRawWebhook(baseUrl, body, signature, alreadyStringified = false) {
  const payload = alreadyStringified ? body : JSON.stringify(body);
  const response = await fetch(`${baseUrl}/api/payment-provider/razorpay/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-razorpay-signature": signature },
    body: payload,
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: response.status, ok: response.ok, body: json, text };
}
