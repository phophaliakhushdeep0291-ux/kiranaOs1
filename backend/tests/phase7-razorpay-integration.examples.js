import assert from "assert";
import fs from "fs";

function read(file) {
  return fs.readFileSync(file, "utf8");
}

const envSource = read("src/config/env.js");
const appSource = read("src/app.js");
const subscriptionRoutes = read("src/modules/subscription/subscription.routes.js");
const subscriptionSchemas = read("src/modules/subscription/subscription.schemas.js");
const subscriptionController = read("src/modules/subscription/subscription.controller.js");
const subscriptionService = read("src/modules/subscription/subscription.service.js");
const paymentService = read("src/modules/payment-provider/paymentProvider.service.js");
const razorpayProvider = read("src/modules/payment-provider/razorpay.provider.js");
const paymentRoutes = read("src/modules/payment-provider/paymentProvider.routes.js");
const sqliteSchema = read("prisma/schema.prisma");
const postgresSchema = read("prisma-postgres/schema.prisma");
const productionCheck = read("scripts/production-check.js");
const packageJson = JSON.parse(read("package.json"));

for (const key of ["RAZORPAY_ENABLED", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"]) {
  assert(envSource.includes(key), `env.js must parse ${key}`);
  assert(read(".env.example").includes(key), `.env.example must document ${key}`);
}
assert(envSource.includes("required in production when RAZORPAY_ENABLED=true"), "Razorpay secrets must be required in production only when enabled");
assert(productionCheck.includes("RAZORPAY_ENABLED") && productionCheck.includes("RAZORPAY_KEY_SECRET"), "production-check must verify Razorpay env rules");

assert(subscriptionRoutes.includes('"/checkout"'), "subscription checkout endpoint must exist");
assert(subscriptionRoutes.includes('"/verify-payment"'), "payment verification endpoint must exist");
assert(subscriptionSchemas.includes("checkoutSchema") && subscriptionSchemas.includes("verifyPaymentSchema"), "checkout and verify schemas must exist");
assert(subscriptionController.includes("createSubscriptionCheckout") && subscriptionController.includes("verifySubscriptionPayment"), "subscription controller must call payment provider service");

for (const snippet of [
  "createSubscriptionCheckout",
  "RAZORPAY_NOT_CONFIGURED",
  "paymentTransaction.create",
  "status: \"created\"",
  "razorpayKeyId",
  "verifySubscriptionPayment",
  "INVALID_PAYMENT_SIGNATURE",
  "fetchRazorpayPayment",
  "providerPaymentId",
  "status: \"paid\"",
  "activateSubscriptionAfterPayment",
  "idempotent: true",
]) {
  assert(paymentService.includes(snippet), `payment service missing ${snippet}`);
}
assert(!paymentService.includes("RAZORPAY_KEY_SECRET:"), "checkout response/service must not expose Razorpay key secret");
assert(!paymentService.includes("RAZORPAY_WEBHOOK_SECRET:"), "webhook secret must not be exposed");

for (const snippet of [
  "createRazorpayOrder",
  "verifyPaymentSignature",
  "verifyWebhookSignature",
  "timingSafeEqual",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "Basic",
]) {
  assert(razorpayProvider.includes(snippet), `razorpay.provider.js missing ${snippet}`);
}

assert(appSource.includes('app.use("/api/payment-provider/razorpay/webhook", express.raw'), "webhook must use raw body parser before express.json");
assert(paymentRoutes.includes('"/razorpay/webhook"'), "Razorpay webhook route must exist");
for (const snippet of [
  "handleRazorpayWebhook",
  "verifyWebhookSignature",
  "INVALID_WEBHOOK_SIGNATURE",
  "storeProviderEvent",
  "provider_eventId",
  "PAYMENT_WEBHOOK_DUPLICATE",
  "payment.captured",
  "payment.failed",
  "refunded",
  "processedAt",
]) {
  assert(paymentService.includes(snippet), `webhook/payment service missing ${snippet}`);
}
assert(paymentService.includes("signatureVerified: true"), "webhook events must store verified signature flag");
assert(paymentService.includes("Razorpay payment already applied"), "same payment id should not be applied twice");
assert(paymentService.includes("PAYMENT_TRANSACTION_ALREADY_PAID"), "a second payment id must not overwrite a paid transaction");
assert(paymentService.includes("PROVIDER_PAYMENT_ALREADY_USED"), "one provider payment must not be applied to another transaction");
for (const schema of [sqliteSchema, postgresSchema]) {
  assert.match(schema, /model PaymentTransaction[\s\S]*@@unique\(\[provider, providerPaymentId\]\)/, "provider payment idempotency must be database-enforced");
}

for (const action of [
  "SUBSCRIPTION_CHECKOUT_CREATED",
  "PAYMENT_VERIFIED",
  "PAYMENT_FAILED",
  "PAYMENT_WEBHOOK_RECEIVED",
  "PAYMENT_WEBHOOK_DUPLICATE",
  "SUBSCRIPTION_ACTIVATED",
  "SUBSCRIPTION_RENEWED",
  "SUBSCRIPTION_PLAN_CHANGED",
  "INVALID_PAYMENT_SIGNATURE",
  "INVALID_WEBHOOK_SIGNATURE",
]) {
  assert(`${paymentService}\n${subscriptionService}`.includes(action), `missing audit action ${action}`);
}

assert(subscriptionService.includes("activateSubscriptionAfterPayment"), "shared subscription activation function must exist");
assert(subscriptionService.includes("addPeriod(startsAt, billingCycle)"), "activation must use documented billing-cycle period policy");
assert(subscriptionService.includes("samePlan") && subscriptionService.includes("renewed") && subscriptionService.includes("plan_changed"), "renew/change policy must be implemented");

assert(packageJson.scripts.test.includes("phase7-razorpay-integration.examples.js") || packageJson.scripts["test:billing"].includes("phase7-razorpay-integration.examples.js"), "Phase 7 tests must be wired into npm test");

console.log("Phase 7 Razorpay integration examples passed");
