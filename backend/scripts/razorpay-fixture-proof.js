import crypto from "node:crypto";
import process from "node:process";

// This script is intentionally offline-only. It proves local Razorpay signature
// behavior with deterministic fixtures and never calls Razorpay APIs.
process.env.NODE_ENV ||= "test";
process.env.DATABASE_URL ||= "file:./prisma/test.db";
process.env.JWT_SECRET ||= "razorpay-fixture-proof-jwt-secret-32-characters";
process.env.LICENSE_SIGNING_SECRET ||= "razorpay-fixture-proof-license-secret-32-characters";
process.env.RAZORPAY_ENABLED ||= "true";
process.env.RAZORPAY_KEY_ID ||= "rzp_test_fixture_key";
process.env.RAZORPAY_KEY_SECRET ||= "fixture_key_secret_32_characters_minimum";
process.env.RAZORPAY_WEBHOOK_SECRET ||= "fixture_webhook_secret_32_characters";
process.env.LOG_LEVEL ||= "silent";

function hmacHex(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function assert(condition, message) {
  if (!condition) {
    const error = new Error(message);
    error.code = "RAZORPAY_FIXTURE_PROOF_FAILED";
    throw error;
  }
}

const {
  verifyPaymentSignature,
  verifyWebhookSignature,
  parseWebhookBody,
} = await import("../src/modules/payment-provider/razorpay.provider.js");

const orderId = "order_fixture_phase26";
const paymentId = "pay_fixture_phase26";
const paymentSignature = hmacHex(process.env.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`);

const validPayment = verifyPaymentSignature({
  razorpay_order_id: orderId,
  razorpay_payment_id: paymentId,
  razorpay_signature: paymentSignature,
});
assert(validPayment.verified === true, "valid checkout payment signature should verify");

const invalidPayment = verifyPaymentSignature({
  razorpay_order_id: orderId,
  razorpay_payment_id: `${paymentId}_tampered`,
  razorpay_signature: paymentSignature,
});
assert(invalidPayment.verified === false, "tampered checkout payment signature must fail");

const capturedPayload = {
  event: "payment.captured",
  account_id: "acc_fixture",
  contains: ["payment"],
  payload: {
    payment: {
      entity: {
        id: paymentId,
        entity: "payment",
        amount: 39900,
        currency: "INR",
        status: "captured",
        method: "upi",
        order_id: orderId,
        captured: true,
        notes: { localTransactionId: "txn_fixture_phase26" },
      },
    },
  },
};
const rawCaptured = Buffer.from(JSON.stringify(capturedPayload));
const validWebhookSignature = hmacHex(process.env.RAZORPAY_WEBHOOK_SECRET, rawCaptured);
const validWebhook = verifyWebhookSignature(rawCaptured, validWebhookSignature);
assert(validWebhook.verified === true, "valid webhook raw-body signature should verify");

const invalidWebhook = verifyWebhookSignature(rawCaptured, hmacHex(process.env.RAZORPAY_WEBHOOK_SECRET, Buffer.from(`${rawCaptured}x`)));
assert(invalidWebhook.verified === false, "tampered webhook signature must fail");

const parsed = parseWebhookBody(rawCaptured);
assert(parsed.event === "payment.captured", "webhook parser should parse event type from raw body");
assert(parsed.payload?.payment?.entity?.amount === 39900, "webhook parser should preserve payment amount");
assert(parsed.payload?.payment?.entity?.method === "upi", "webhook parser should preserve the tender method");

let invalidBodyRejected = false;
try {
  parseWebhookBody(Buffer.from("{not-json"));
} catch (error) {
  invalidBodyRejected = error?.code === "INVALID_WEBHOOK_BODY";
}
assert(invalidBodyRejected, "invalid webhook body must be rejected with INVALID_WEBHOOK_BODY");

console.log(JSON.stringify({
  type: "razorpay_fixture_proof_passed",
  checks: [
    "checkout_payment_signature_valid",
    "checkout_payment_signature_tamper_rejected",
    "webhook_raw_body_signature_valid",
    "webhook_raw_body_signature_tamper_rejected",
    "webhook_raw_body_json_parse",
    "invalid_webhook_body_rejected",
  ],
  time: new Date().toISOString(),
}));
