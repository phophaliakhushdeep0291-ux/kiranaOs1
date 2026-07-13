import assert from "assert";
import fs from "fs";

function read(file) {
  return fs.readFileSync(file, "utf8");
}

const sqliteSchema = read("prisma/schema.prisma");
const pgSchema = read("prisma-postgres/schema.prisma");
const migration = fs.readdirSync("prisma-postgres/migrations", { recursive: true })
  .filter((f) => String(f).endsWith(".sql"))
  .map((f) => read(`prisma-postgres/migrations/${f}`))
  .join("\n");
const planConfig = read("src/modules/subscription/planConfig.js");
const subscriptionService = read("src/modules/subscription/subscription.service.js");
const featureGateService = read("src/modules/feature-gates/featureGate.service.js");
const featureRegistry = read("src/modules/feature-gates/featureRegistry.js");
const deviceService = read("src/modules/devices/devices.service.js");
const paymentProviderService = read("src/modules/payment-provider/paymentProvider.service.js");
const razorpayProvider = read("src/modules/payment-provider/razorpay.provider.js");
const app = read("src/app.js");
const packageJson = JSON.parse(read("package.json"));

for (const schema of [sqliteSchema, pgSchema]) {
  for (const model of ["Plan", "Subscription", "PaymentTransaction", "PaymentProviderEvent", "Device", "DeviceLicense"]) {
    assert(schema.includes(`model ${model}`), `${model} model must exist in both Prisma schemas`);
  }
  assert(schema.includes("@@unique([provider, eventId])"), "PaymentProviderEvent must be idempotent by provider + eventId");
  assert(schema.includes("@@unique([shopId, deviceId])"), "Device must be unique per shop/deviceId");
}

for (const table of ["Plan", "Subscription", "PaymentTransaction", "PaymentProviderEvent", "Device", "DeviceLicense"]) {
  assert(migration.includes(`CREATE TABLE "${table}"`), `PostgreSQL migration must create ${table}`);
}
assert(migration.includes("PaymentProviderEvent_provider_eventId_key"), "Provider event unique index must exist");
assert(migration.includes("Device_shopId_deviceId_key"), "Device unique index must exist");

for (const [code, price] of Object.entries({ starter: 34900, standard: 39900, growth: 59900, pro: 99900 })) {
  assert(planConfig.includes(code), `Plan config must include ${code}`);
  assert(planConfig.includes(String(price)), `Plan config must price ${code} in paise`);
}
assert(planConfig.includes("maxDevices: 2") && planConfig.includes("maxDevices: 10"), "Plan device limits must include Starter at 2 and Business at 10");
assert(planConfig.includes("maxStaff: 0") && planConfig.includes("maxStaff: 20"), "Plan staff limits must be configured");
assert(planConfig.includes("staff_login"), "Growth must include staff_login");
assert(planConfig.includes("whatsapp_reminders"), "Pro must include whatsapp_reminders");

for (const fn of [
  "getCurrentSubscription",
  "getEffectivePlan",
  "activateManualSubscription",
  "changePlan",
  "cancelSubscription",
  "extendGrace",
  "isSubscriptionActive",
  "getSubscriptionStatus",
]) {
  assert(subscriptionService.includes(`function ${fn}`) || subscriptionService.includes(`function ${fn}`) || subscriptionService.includes(`export async function ${fn}`) || subscriptionService.includes(`export function ${fn}`), `${fn} must exist`);
}
assert(subscriptionService.includes("fallback/trial"), "Missing subscription fallback/trial behavior");
assert(subscriptionService.includes("paymentTransaction.create"), "Manual activation must create PaymentTransaction");

for (const snippet of [
  "hasFeature",
  "requireFeatureAccess",
  "requireActiveSubscriptionAccess",
  "requirePlanAtLeastAccess",
  "getPlanLimits",
  "canUseDevice",
  "canAddStaff",
  "getReportRangeLimit",
]) {
  assert(featureGateService.includes(snippet), `Feature gate service missing ${snippet}`);
}
assert(featureRegistry.includes("staff_login") && featureRegistry.includes("growth"), "staff_login must require Growth");
assert(featureRegistry.includes("whatsapp_reminders") && featureRegistry.includes("pro"), "whatsapp_reminders must require Pro");
assert(featureGateService.includes("view_old_data"), "Old data viewing must remain allowed");
assert(featureGateService.includes("SUBSCRIPTION_INACTIVE"), "Expired subscription must block premium features");

for (const snippet of [
  "activateDevice",
  "DEVICE_LIMIT_EXCEEDED",
  "removeDevice",
  "heartbeat",
  "getDeviceLicense",
  "signatureHash",
  "Removed or blocked devices cannot receive active license",
]) {
  assert(deviceService.includes(snippet), `Device service missing ${snippet}`);
}
assert(deviceService.includes("status: \"revoked\""), "Device removal must preserve the row with revoked status");
assert(deviceService.includes("LICENSE_SIGNING_SECRET"), "Device license signing secret must be referenced");

assert(paymentProviderService.includes("storeProviderEvent"), "Payment provider event storage must exist");
assert(paymentProviderService.includes("provider_eventId"), "Provider event idempotency must be handled");
assert(paymentProviderService.includes("sanitizePayload"), "Provider payloads must be sanitized");
assert(paymentProviderService.includes("not activated") || paymentProviderService.includes("activated: false"), "Razorpay placeholder must not activate subscriptions yet");
assert(razorpayProvider.includes("RAZORPAY_WEBHOOK_SECRET"), "Razorpay webhook secret must come from env");

for (const route of [
  'app.use("/api/plans"',
  'app.use("/api/subscription"',
  'app.use("/api/devices"',
  'app.use("/api/payment-provider"',
]) {
  assert(app.includes(route), `app.js missing ${route}`);
}

assert(packageJson.scripts.test.includes("phase6-saas-foundation.examples.js") || packageJson.scripts["test:billing"].includes("phase6-saas-foundation.examples.js"), "Phase 6 tests must be wired into npm test");

console.log("Phase 6 SaaS foundation examples passed");
