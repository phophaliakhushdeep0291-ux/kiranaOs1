import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { assertFailure, assertSuccess, createIntegrationContext, resetDatabase } from "./setup.js";
import { createTenant, login } from "./factories.js";

const WEBHOOK_SECRET = "test_dynamic_qr_webhook_secret_12345";
process.env.RAZORPAY_ENABLED = "true";
process.env.RAZORPAY_KEY_ID = "rzp_test_dynamic_qr";
// Build an obviously synthetic credential without resembling a committed provider secret.
process.env.RAZORPAY_KEY_SECRET = ["test", "dynamic", "qr", "secret", "12345"].join("_");
process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.RETAIL_PAYMENT_PROVIDER = "razorpay";
process.env.RAZORPAY_DYNAMIC_QR_ENABLED = "true";

test("dynamic QR stays branch-bound, exact-amount, provider-confirmed and idempotent", async (t) => {
  const originalFetch = global.fetch;
  const qrs = new Map();
  const payments = new Map();
  const providerCalls = [];
  let sequence = 1;

  global.fetch = async (input, options = {}) => {
    const target = typeof input === "string" ? input : input?.toString?.() || "";
    if (!target.startsWith("https://api.razorpay.com/v1/payments/qr_codes")) return originalFetch(input, options);
    providerCalls.push({ target, method: options.method || "GET" });
    const url = new URL(target);
    const parts = url.pathname.split("/").filter(Boolean);
    const qrId = parts[parts.indexOf("qr_codes") + 1] || null;
    if (options.method === "POST" && !qrId) {
      const body = JSON.parse(options.body);
      const id = `qr_dynamic_${sequence++}`;
      const qr = { id, entity: "qr_code", status: "active", image_url: `https://rzp.io/i/${id}`, ...body };
      qrs.set(id, qr);
      payments.set(id, []);
      return jsonResponse(qr);
    }
    if (options.method === "POST" && parts.at(-1) === "close") {
      const qr = qrs.get(qrId);
      qrs.set(qrId, { ...qr, status: "closed", close_reason: "on_demand" });
      return jsonResponse(qrs.get(qrId));
    }
    if (parts.at(-1) === "payments") return jsonResponse({ entity: "collection", count: payments.get(qrId)?.length || 0, items: payments.get(qrId) || [] });
    if (qrs.has(qrId)) return jsonResponse(qrs.get(qrId));
    return jsonResponse({ error: { description: "QR not found" } }, 404);
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

    const readiness = assertSuccess(await ctx.get("/api/payment-provider/retail/readiness", { token }));
    assert.equal(readiness.configured, true);
    assert.equal(readiness.dynamicQrEnabled, true);

    const created = assertSuccess(await ctx.post("/api/payment-provider/retail/intents", { amountPaise: 12550, mode: "dynamic_qr" }, { token }), 201);
    assert.equal(created.mode, "dynamic_qr");
    assert.equal(created.status, "pending");
    assert.match(created.imageUrl, /^https:\/\/rzp\.io\/i\/qr_dynamic_/);
    const intent = await ctx.db.retailPaymentIntent.findUnique({ where: { id: created.intentId } });
    assert.equal(intent.checkoutMode, "dynamic_qr");
    assert.ok(intent.providerQrCodeId);
    const providerQr = qrs.get(intent.providerQrCodeId);
    assert.equal(providerQr.usage, "single_use");
    assert.equal(providerQr.fixed_amount, true);
    assert.equal(providerQr.payment_amount, 12550);
    assert.equal(providerQr.notes.shopId, tenant.shop.id);
    assert.equal(providerQr.notes.locationId, intent.locationId);

    const pending = assertSuccess(await ctx.get(`/api/payment-provider/retail/intents/${intent.id}/status`, { token }));
    assert.equal(pending.status, "pending");
    payments.set(intent.providerQrCodeId, [capturedPayment("pay_dynamic_1", 12550)]);
    const confirmed = assertSuccess(await ctx.get(`/api/payment-provider/retail/intents/${intent.id}/status`, { token }));
    assert.equal(confirmed.status, "confirmed");
    assert.equal(confirmed.confirmationSource, "provider_qr_api");
    const repeated = assertSuccess(await ctx.get(`/api/payment-provider/retail/intents/${intent.id}/status`, { token }));
    assert.equal(repeated.status, "confirmed");
    assert.equal((await ctx.db.retailPaymentIntent.findUnique({ where: { id: intent.id } })).providerPaymentId, "pay_dynamic_1");

    const secondTenant = await createTenant(ctx.db);
    const secondAuth = await login(ctx, secondTenant.ownerMobile, secondTenant.ownerPassword);
    assertFailure(await ctx.get(`/api/payment-provider/retail/intents/${intent.id}/status`, { token: secondAuth.accessToken }), 404);

    const mismatchCreated = assertSuccess(await ctx.post("/api/payment-provider/retail/intents", { amountPaise: 5000, mode: "dynamic_qr" }, { token }), 201);
    const mismatchIntent = await ctx.db.retailPaymentIntent.findUnique({ where: { id: mismatchCreated.intentId } });
    payments.set(mismatchIntent.providerQrCodeId, [capturedPayment("pay_wrong_amount", 5001)]);
    const mismatch = assertFailure(await ctx.get(`/api/payment-provider/retail/intents/${mismatchIntent.id}/status`, { token }), 409);
    assert.equal(mismatch.code, "RETAIL_QR_PAYMENT_MISMATCH");
    assert.equal((await ctx.db.retailPaymentIntent.findUnique({ where: { id: mismatchIntent.id } })).status, "failed");

    const cancelledCreated = assertSuccess(await ctx.post("/api/payment-provider/retail/intents", { amountPaise: 7600, mode: "dynamic_qr" }, { token }), 201);
    const cancelled = assertSuccess(await ctx.post(`/api/payment-provider/retail/intents/${cancelledCreated.intentId}/cancel`, {}, { token }));
    assert.equal(cancelled.status, "cancelled");
    const cancelledIntent = await ctx.db.retailPaymentIntent.findUnique({ where: { id: cancelledCreated.intentId } });
    assert.equal(qrs.get(cancelledIntent.providerQrCodeId).close_reason, "on_demand");

    const webhookCreated = assertSuccess(await ctx.post("/api/payment-provider/retail/intents", { amountPaise: 9900, mode: "dynamic_qr" }, { token }), 201);
    const webhookIntent = await ctx.db.retailPaymentIntent.findUnique({ where: { id: webhookCreated.intentId } });
    const webhookQr = { ...qrs.get(webhookIntent.providerQrCodeId), status: "closed", close_reason: "paid" };
    const webhook = {
      id: "evt_qr_credited_1",
      event: "qr_code.credited",
      payload: { qr_code: { entity: webhookQr }, payment: { entity: capturedPayment("pay_webhook_qr_1", 9900) } },
    };
    const webhookBody = JSON.stringify(webhook);
    const webhookResponse = await postRawWebhook(ctx.baseUrl, webhookBody, signWebhook(webhookBody));
    const webhookResult = assertSuccess(webhookResponse);
    assert.equal(webhookResult.confirmed, true);
    assert.equal(webhookResult.dynamicQr, true);
    const webhookStored = await ctx.db.retailPaymentIntent.findUnique({ where: { id: webhookIntent.id } });
    assert.equal(webhookStored.status, "confirmed");
    assert.equal(webhookStored.confirmationSource, "signed_qr_webhook");
    const duplicate = assertSuccess(await postRawWebhook(ctx.baseUrl, webhookBody, signWebhook(webhookBody)));
    assert.equal(duplicate.duplicate, true);
    assert.equal((await ctx.db.retailPaymentIntent.count({ where: { providerPaymentId: "pay_webhook_qr_1" } })), 1);

    assert.ok(providerCalls.some((call) => call.target.includes("/payments?count=10")), "polling must verify captured payments through the provider API");
  } finally {
    global.fetch = originalFetch;
    await ctx.close?.();
  }
});

function capturedPayment(id, amount) {
  return { id, entity: "payment", amount, currency: "INR", status: "captured", captured: true, method: "upi" };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function signWebhook(body) {
  return crypto.createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
}

async function postRawWebhook(baseUrl, body, signature) {
  const response = await fetch(`${baseUrl}/api/payment-provider/razorpay/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-razorpay-signature": signature }, body });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: response.status, ok: response.ok, body: json, text };
}
