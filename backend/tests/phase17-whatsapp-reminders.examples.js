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
  "WHATSAPP_PROVIDER_NOT_IMPLEMENTED",
  "sendWhatsAppMessage",
  "getWhatsAppProviderStatus",
  "Do not fake sent",
]) assert(provider.includes(snippet), `provider missing ${snippet}`);
assert(!/success:\s*true/.test(provider), "provider must not fake successful WhatsApp sending");
assert(!/console\.log\([^\n]*(WHATSAPP_API_KEY|WHATSAPP_API_SECRET)/.test(provider), "provider must not log WhatsApp secrets");

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
