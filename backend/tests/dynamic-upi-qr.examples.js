import assert from "node:assert/strict";
import fs from "node:fs";

const provider = fs.readFileSync("src/modules/payment-provider/razorpay.provider.js", "utf8");
const service = fs.readFileSync("src/modules/payment-provider/retailPayment.service.js", "utf8");
const routes = fs.readFileSync("src/modules/payment-provider/paymentProvider.routes.js", "utf8");
const schema = fs.readFileSync("prisma/schema.prisma", "utf8");

for (const invariant of ['type: "upi_qr"', 'usage: "single_use"', "fixed_amount: true", "payment_amount: amountPaise", "close_by: closeBy"]) {
  assert.ok(provider.includes(invariant), `dynamic QR provider must enforce ${invariant}`);
}
assert.match(service, /RAZORPAY_DYNAMIC_QR_ENABLED/, "dynamic QR needs an explicit account capability flag");
assert.match(service, /validateRetailQrPayment/, "provider QR payments must pass deterministic binding checks");
assert.match(service, /RETAIL_QR_MULTIPLE_PAYMENTS/, "multiple captured payments on a single-use QR must fail closed");
assert.match(service, /confirmationSource, failureReason: null/, "confirmation provenance must be persisted");
assert.match(routes, /retail\/intents\/:id\/status/, "cashier must be able to poll provider confirmation");
assert.match(routes, /retail\/intents\/:id\/cancel/, "cashier must be able to close an unused QR");
assert.match(schema, /checkoutMode\s+String\s+@default\("checkout"\)/, "intent must distinguish checkout and dynamic QR modes");
assert.match(schema, /providerQrCodeId\s+String\?\s+@unique/, "provider QR id must be unique");

// Printing the QR must never widen what the QR itself guarantees.
assert.match(routes, /retail\/intents\/:id\/qr-bitmap/, "a counter printer must be able to fetch the QR grid");
assert.match(service, /RETAIL_QR_NOT_COLLECTABLE/, "a settled, cancelled or expired QR must not be printable");
assert.match(service, /safeRazorpayQrImageUrl\(intent\.providerQrImageUrl\)/, "only the provider's trusted image host may be fetched");
assert.match(service, /redirect: "error"/, "the provider image fetch must not follow redirects off the trusted host");
assert.ok(
  /getRetailPaymentQrBitmap[\s\S]*?extractQrModules/.test(service),
  "the printed QR must be decoded from the provider image, never generated locally",
);

console.log("Dynamic UPI QR source contracts passed");
