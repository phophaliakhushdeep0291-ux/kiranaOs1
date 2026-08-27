import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "file:./prisma/payment-credentials-test.db";
process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const { encryptPaymentCredentials, decryptPaymentCredentials } = await import("../src/modules/payment-provider/paymentCredentials.crypto.js");
const { verifyPaymentSignature, verifyWebhookSignature } = await import("../src/modules/payment-provider/razorpay.provider.js");
const crypto = await import("node:crypto");

const credentials = { keyId: "rzp_test_example", keySecret: "secret-value", webhookSecret: "webhook-value" };
const context = "payment-provider:shop_1:razorpay";
const encrypted = encryptPaymentCredentials(credentials, context);
assert.ok(!encrypted.includes(credentials.keySecret));
assert.deepEqual(decryptPaymentCredentials(encrypted, context), credentials);
assert.throws(() => decryptPaymentCredentials(encrypted, "payment-provider:shop_2:razorpay"), /could not be decrypted/i);

const paymentInput = { razorpay_order_id: "order_1", razorpay_payment_id: "pay_1" };
paymentInput.razorpay_signature = crypto.createHmac("sha256", credentials.keySecret).update("order_1|pay_1").digest("hex");
assert.equal(verifyPaymentSignature(paymentInput, credentials).verified, true);
const body = Buffer.from('{"event":"payment.captured"}');
const webhookSignature = crypto.createHmac("sha256", credentials.webhookSecret).update(body).digest("hex");
assert.equal(verifyWebhookSignature(body, webhookSignature, credentials).verified, true);

console.log("Payment credential encryption examples passed");
