import assert from "node:assert/strict";
import fs from "node:fs";

function read(file) { return fs.readFileSync(file, "utf8"); }
function exists(file) { return fs.existsSync(file); }

for (const file of [
  "src/modules/reminders/reminders.routes.js",
  "src/modules/reminders/reminders.controller.js",
  "src/modules/reminders/reminders.service.js",
  "src/modules/reminders/reminders.schemas.js",
  "src/modules/reminders/reminderTemplates.service.js",
  "src/modules/reminders/reminderFormatter.js",
  "src/modules/reminders/whatsapp.provider.js",
  "src/workers/reminder.worker.js",
  "prisma-postgres/migrations/000006_whatsapp_reminders/migration.sql",
]) assert(exists(file), `${file} must exist`);

const sqliteSchema = read("prisma/schema.prisma");
const pgSchema = read("prisma-postgres/schema.prisma");
for (const model of ["ReminderTemplate", "ReminderLog"]) {
  assert(sqliteSchema.includes(`model ${model}`), `SQLite schema missing ${model}`);
  assert(pgSchema.includes(`model ${model}`), `PostgreSQL schema missing ${model}`);
}
for (const snippet of [
  "shopId",
  "customerId",
  "templateText",
  "providerMessageId",
  "@@index([shopId, active])",
  "@@index([shopId, customerId, createdAt])",
  "@@index([shopId, status, createdAt])",
  "@@index([shopId, channel, createdAt])",
]) assert(sqliteSchema.includes(snippet) && pgSchema.includes(snippet), `schemas missing ${snippet}`);

const migration = read("prisma-postgres/migrations/000006_whatsapp_reminders/migration.sql");
for (const snippet of [
  'CREATE TABLE "ReminderTemplate"',
  'CREATE TABLE "ReminderLog"',
  'ReminderTemplate_shopId_active_idx',
  'ReminderLog_shopId_customerId_createdAt_idx',
  'ReminderLog_shopId_status_createdAt_idx',
  'ReminderLog_shopId_channel_createdAt_idx',
]) assert(migration.includes(snippet), `migration missing ${snippet}`);

const routes = read("src/modules/reminders/reminders.routes.js");
for (const snippet of [
  "requireAuth",
  "requireShop",
  "requireFeature(\"whatsapp_reminders\")",
  "FEATURE_NOT_AVAILABLE",
  "router.get(\"/templates\"",
  "router.post(\"/templates\"",
  "router.patch(\"/templates/:id\"",
  "router.delete(\"/templates/:id\"",
  "router.get(\"/logs\"",
  "router.post(\"/send\"",
  "router.post(\"/send-statement\"",
]) assert(routes.includes(snippet), `reminder routes missing ${snippet}`);
assert(routes.includes("requireRole(\"owner\", \"admin\")"), "template management must be owner/admin only");

const formatter = read("src/modules/reminders/reminderFormatter.js");
for (const snippet of [
  "Friendly udhar reminder",
  "Payment due reminder",
  "Statement summary",
  "customerName",
  "shopName",
  "balance",
  "lastPaymentDate",
  "statementPeriod",
  "UNKNOWN_TEMPLATE_VARIABLE",
  "sanitizeTemplateValue",
]) assert(formatter.includes(snippet), `formatter missing ${snippet}`);

const templates = read("src/modules/reminders/reminderTemplates.service.js");
for (const snippet of [
  "ensureDefaultReminderTemplates",
  "REMINDER_TEMPLATE_CREATED",
  "REMINDER_TEMPLATE_UPDATED",
  "REMINDER_TEMPLATE_DELETED",
  "deletedAt: new Date()",
]) assert(templates.includes(snippet), `template service missing ${snippet}`);

const service = read("src/modules/reminders/reminders.service.js");
for (const snippet of [
  "CUSTOMER_PHONE_REQUIRED",
  "CUSTOMER_HAS_NO_PENDING_UDHAR",
  "REMINDER_COOLDOWN_ACTIVE",
  "overrideCooldown",
  "JOB_QUEUE_DISABLED",
  "SEND_WHATSAPP_REMINDER",
  "customer.udharAmount",
  "db.udharLedger.aggregate",
  "REMINDER_REQUESTED",
  "REMINDER_FAILED",
  "REMINDER_SKIPPED_COOLDOWN",
  "REMINDER_PROVIDER_NOT_CONFIGURED",
  "recordReminderMetric",
]) assert(service.includes(snippet), `reminder service missing ${snippet}`);
assert(!/phone\s*:\s*req\.body|mobile\s*:\s*req\.body/i.test(service), "service must not use arbitrary frontend phone/mobile input");

const provider = read("src/modules/reminders/whatsapp.provider.js");
for (const snippet of [
  "WHATSAPP_PROVIDER_NOT_CONFIGURED",
  "sendWhatsAppMessage",
  "getWhatsAppProviderStatus",
  "graph.facebook.com",
  "api.twilio.com",
  "api.gupshup.io",
  "api.interakt.ai",
  "WHATSAPP_PROVIDER_RESPONSE_INVALID",
  "AbortSignal.timeout",
  "redirect: \"error\"",
]) assert(provider.includes(snippet), `provider missing ${snippet}`);
assert(!/console\.log\([^\n]*(WHATSAPP_API_KEY|WHATSAPP_API_SECRET)/.test(provider), "provider must not log WhatsApp secrets");

const { env: runtimeEnv } = await import("../src/config/env.js");
const { getWhatsAppProviderStatus, sendWhatsAppMessage } = await import("../src/modules/reminders/whatsapp.provider.js");
const originalProviderConfig = Object.fromEntries(Object.keys(runtimeEnv).filter((key) => key.startsWith("WHATSAPP_")).map((key) => [key, runtimeEnv[key]]));
const originalFetch = globalThis.fetch;
const captured = [];
globalThis.fetch = async (url, options) => {
  captured.push({ url: String(url), options });
  const responses = {
    meta: { messages: [{ id: "wamid.runtime-proof" }] },
    twilio: { sid: "SMruntimeproof" },
    gupshup: { status: "submitted", messageId: "gs-runtime-proof" },
    interakt: { result: true, id: "interakt-runtime-proof" },
  };
  return new Response(JSON.stringify(responses[runtimeEnv.WHATSAPP_PROVIDER]), { status: 200, headers: { "content-type": "application/json" } });
};
try {
  Object.assign(runtimeEnv, {
    WHATSAPP_API_KEY: "runtime-api-key",
    WHATSAPP_API_SECRET: "runtime-api-secret",
    WHATSAPP_SENDER_ID: "+919999999999",
    WHATSAPP_BASE_URL: undefined,
    WHATSAPP_TEMPLATE_NAME: undefined,
    WHATSAPP_TEMPLATE_LANGUAGE: "en",
    WHATSAPP_GUPSHUP_APP_NAME: undefined,
    WHATSAPP_DEFAULT_COUNTRY_CODE: "+91",
  });
  const cases = [
    ["meta", { WHATSAPP_BASE_URL: "https://graph.facebook.com/v24.0" }, "graph.facebook.com", "wamid.runtime-proof"],
    ["twilio", {}, "api.twilio.com", "SMruntimeproof"],
    ["gupshup", { WHATSAPP_GUPSHUP_APP_NAME: "kirana-runtime" }, "api.gupshup.io", "gs-runtime-proof"],
    ["interakt", { WHATSAPP_TEMPLATE_NAME: "udhar_reminder" }, "api.interakt.ai", "interakt-runtime-proof"],
  ];
  for (const [providerName, overrides, expectedHost, expectedMessageId] of cases) {
    Object.assign(runtimeEnv, { WHATSAPP_PROVIDER: providerName, WHATSAPP_BASE_URL: undefined, WHATSAPP_GUPSHUP_APP_NAME: undefined, WHATSAPP_TEMPLATE_NAME: undefined }, overrides);
    assert.equal(getWhatsAppProviderStatus().configured, true, `${providerName} should report configured with its required credentials`);
    const result = await sendWhatsAppMessage({ to: "9876543210", message: "Runtime provider proof", shopId: "shop-proof", customerId: "customer-proof", reminderLogId: "reminder-proof" });
    assert.equal(result.success, true, `${providerName} should accept a provider-confirmed request`);
    assert.equal(result.providerMessageId, expectedMessageId);
    assert(captured.at(-1).url.includes(expectedHost), `${providerName} must call its official provider host`);
    assert(!JSON.stringify(result).includes("runtime-api-secret"), "provider credentials must never appear in results");
  }
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  Object.assign(runtimeEnv, { WHATSAPP_PROVIDER: "twilio", WHATSAPP_BASE_URL: undefined });
  const rejected = await sendWhatsAppMessage({ to: "9876543210", message: "Failure proof", shopId: "shop-proof", customerId: "customer-proof", reminderLogId: "reminder-proof" });
  assert.equal(rejected.success, false);
  assert.equal(rejected.code, "WHATSAPP_PROVIDER_HTTP_401");
} finally {
  Object.assign(runtimeEnv, originalProviderConfig);
  globalThis.fetch = originalFetch;
}

const worker = read("src/workers/reminder.worker.js");
for (const snippet of [
  "SEND_WHATSAPP_REMINDER",
  "reminderLogId",
  "sendWhatsAppMessage",
  "markReminderFromProvider",
  "FEATURE_NOT_AVAILABLE",
]) assert(worker.includes(snippet), `reminder worker missing ${snippet}`);
assert(!worker.includes("WHATSAPP_PROVIDER_URL"), "worker must use provider abstraction, not legacy direct env checks");

const metrics = read("src/lib/metrics.js");
for (const snippet of [
  "reminders_requested_total",
  "reminders_sent_total",
  "reminders_failed_total",
  "reminders_skipped_total",
  "whatsapp_provider_errors_total",
  "recordReminderMetric",
]) assert(metrics.includes(snippet), `metrics missing ${snippet}`);
assert(!/recordReminderMetric[\s\S]{0,500}(shopId|customerId|userId|phone|mobile)/.test(metrics), "reminder metrics must not use high-cardinality/PII labels");

const env = read("src/config/env.js");
for (const snippet of [
  "WHATSAPP_PROVIDER",
  "WHATSAPP_API_KEY",
  "WHATSAPP_API_SECRET",
  "WHATSAPP_SENDER_ID",
  "WHATSAPP_TEMPLATE_NAME",
  "WHATSAPP_GUPSHUP_APP_NAME",
  "REMINDER_COOLDOWN_HOURS",
  "required in production when WHATSAPP_PROVIDER",
]) assert(env.includes(snippet), `env config missing ${snippet}`);

const envExample = read(".env.example");
for (const snippet of [
  "WHATSAPP_PROVIDER=disabled",
  "WHATSAPP_API_KEY=",
  "WHATSAPP_API_SECRET=",
  "WHATSAPP_SENDER_ID=",
  "WHATSAPP_BASE_URL=",
  "WHATSAPP_TEMPLATE_NAME=",
  "WHATSAPP_GUPSHUP_APP_NAME=",
  "WHATSAPP_DEFAULT_COUNTRY_CODE=+91",
  "REMINDER_COOLDOWN_HOURS=6",
]) assert(envExample.includes(snippet), `.env.example missing ${snippet}`);

const app = read("src/app.js");
assert(app.includes('app.use("/api/reminders"'), "app must register /api/reminders");

const prodCheck = read("scripts/production-check.js");
for (const snippet of [
  "ReminderTemplate",
  "ReminderLog",
  "whatsapp.provider.js",
  "REMINDER_COOLDOWN_ACTIVE",
  "phase17-whatsapp-reminders.examples.js",
]) assert(prodCheck.includes(snippet), `production-check missing ${snippet}`);

const pkg = JSON.parse(read("package.json"));
assert(pkg.scripts["test:billing"].includes("phase17-whatsapp-reminders.examples.js"), "Phase 17 tests must be wired into npm test");

console.log("Phase 17 WhatsApp reminder examples passed");
