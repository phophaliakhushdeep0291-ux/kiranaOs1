import assert from "assert";
import fs from "fs";

function read(file) { return fs.readFileSync(file, "utf8"); }

const envSource = read("src/config/env.js");
const security = read("src/middleware/security.js");
const paymentController = read("src/modules/payment-provider/paymentProvider.controller.js");
const paymentSchema = read("src/modules/payment-provider/paymentProvider.schemas.js");
const subscriptionController = read("src/modules/subscription/subscription.controller.js");
const authService = read("src/modules/auth/auth.service.js");
const authRoutes = read("src/modules/auth/auth.routes.js");
const featureGateService = read("src/modules/feature-gates/featureGate.service.js");
const paymentService = read("src/modules/payment-provider/paymentProvider.service.js");
const syncSchema = read("src/modules/sync/sync.schema.js");
const syncService = read("src/modules/sync/sync.service.js");
const protectedRoutes = [
  "src/modules/bills/bills.routes.js",
  "src/modules/customers/customers.routes.js",
  "src/modules/inventory/inventory.routes.js",
  "src/modules/products/products.routes.js",
  "src/modules/reports/reports.routes.js",
  "src/modules/shops/shops.routes.js",
  "src/modules/suppliers/suppliers.routes.js",
  "src/modules/udhar/udhar.routes.js",
];

for (const key of [
  "API_RATE_LIMIT_WINDOW_MS",
  "API_RATE_LIMIT_MAX",
  "AUTH_RATE_LIMIT_WINDOW_MS",
  "AUTH_RATE_LIMIT_MAX",
  "AI_RATE_LIMIT_WINDOW_MS",
  "AI_RATE_LIMIT_MAX",
]) {
  assert(envSource.includes(key), `env.js must validate ${key}`);
  assert(security.includes(`env.${key}`), `security middleware must read ${key} from validated env`);
}

assert(envSource.includes("ALLOW_MANUAL_SUBSCRIPTION_ACTIVATION"), "manual activation must be controlled by env flag");
assert(envSource.includes("ALLOW_MANUAL_SUBSCRIPTION_ACTIVATION must stay false in production"), "production startup must reject internal subscription overrides");
assert(subscriptionController.includes("MANUAL_SUBSCRIPTION_ACTIVATION_DISABLED"), "subscription manual activation must be disabled by default");
for (const handler of ["changePlan", "extendGrace", "foundingCustomer", "recordOnboardingPurchase"]) {
  const handlerSource = subscriptionController.slice(subscriptionController.indexOf(`function ${handler}`), subscriptionController.indexOf("\n}", subscriptionController.indexOf(`function ${handler}`)) + 2);
  assert(handlerSource.includes("requireInternalSubscriptionOverride"), `${handler} must be disabled outside explicit internal-override mode`);
}
assert(paymentController.includes("MANUAL_SUBSCRIPTION_ACTIVATION_DISABLED"), "provider manual activation must be disabled by default");
assert(!paymentController.includes("req.body.shopId ?? req.shopId"), "manual payment activation must not trust body shopId");
assert(!paymentSchema.includes("shopId: z.string().optional()"), "manual payment schema must not accept tenant shopId from body");

assert(authRoutes.includes('requireFeature("staff_login")'), "staff management routes must be Growth+ gated");
assert(authService.includes("STAFF_LIMIT_EXCEEDED"), "staff invite must enforce plan staff limit in service layer");
assert(authService.includes("OWNER_ROLE_NOT_INVITABLE"), "staff invite must not create another owner");
assert(authService.includes("OWNER_ROLE_TRANSFER_REQUIRED"), "role update must not silently transfer owner role");
assert(featureGateService.includes('role: { in: ["staff", "admin"] }'), "staff limit must count staff and admin users");

for (const file of protectedRoutes) {
  const source = read(file);
  assert(source.includes("requireDeviceActivated()"), `${file} must require activated device for protected shop APIs`);
}

assert(syncSchema.includes("cursors"), "sync pull schema must accept per-entity cursors");
assert(syncService.includes("entityCursors"), "sync pull response must return per-entity cursors");
assert(syncService.includes("hasMoreByEntity"), "sync pull response must return per-entity hasMore flags");
assert(syncService.includes("buildEntityCursorMap"), "sync pull must build independent entity cursor map");

for (const code of [
  "PAYMENT_AMOUNT_MISMATCH",
  "PAYMENT_CURRENCY_MISMATCH",
  "PAYMENT_ORDER_AMOUNT_MISMATCH",
  "PAYMENT_ORDER_CURRENCY_MISMATCH",
  "PAYMENT_WEBHOOK_TRANSACTION_MISSING",
]) {
  assert(paymentService.includes(code), `payment service must harden Razorpay with ${code}`);
}
assert(paymentService.includes("validateRazorpayPaymentAgainstTransaction"), "Razorpay verify/webhook must validate amount/currency/order against local transaction");
assert(paymentService.includes("PAYMENT_TRANSACTION_ALREADY_PAID"), "a paid transaction must reject a different provider payment id");
assert(paymentService.includes("PROVIDER_PAYMENT_ALREADY_USED"), "one provider payment must not activate multiple transactions");

console.log("Phase 18 production hardening examples passed");
