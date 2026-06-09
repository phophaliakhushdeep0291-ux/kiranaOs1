import assert from "assert/strict";
import { readFileSync } from "fs";

const service = readFileSync("src/modules/payment-provider/paymentProvider.service.js", "utf8");
const controller = readFileSync("src/modules/payment-provider/paymentProvider.controller.js", "utf8");
const routes = readFileSync("src/modules/payment-provider/paymentProvider.routes.js", "utf8");
const sqliteSchema = readFileSync("prisma/schema.prisma", "utf8");
const pgSchema = readFileSync("prisma-postgres/schema.prisma", "utf8");
const pgMigration = readFileSync("prisma-postgres/migrations/000008_payment_webhook_processing_state/migration.sql", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

for (const schema of [sqliteSchema, pgSchema]) {
  for (const snippet of [
    "processingStatus",
    "processingAttempts",
    "processingError",
    "processedResultJson",
    "lastAttemptAt",
    "@@index([shopId, createdAt])",
    "@@index([processingStatus, createdAt])",
  ]) {
    assert.ok(schema.includes(snippet), `PaymentProviderEvent schema missing ${snippet}`);
  }
}

for (const snippet of [
  'ADD COLUMN IF NOT EXISTS "shopId"',
  'ADD COLUMN IF NOT EXISTS "processingStatus"',
  'ADD COLUMN IF NOT EXISTS "processingAttempts"',
  '"PaymentProviderEvent_processingStatus_createdAt_idx"',
]) {
  assert.ok(pgMigration.includes(snippet), `Phase 22 migration missing ${snippet}`);
}

for (const snippet of [
  "beginProviderEventProcessing",
  "markProviderEventProcessed",
  "markProviderEventFailed",
  "isRetryableProviderEvent",
  "PAYMENT_WEBHOOK_RETRY_STARTED",
  "PAYMENT_WEBHOOK_MANUAL_RETRY_STARTED",
  "PAYMENT_PROVIDER_EVENT_NOT_RETRYABLE",
  'processingStatus: \"processing\"',
  "processingAttempts: { increment: 1 }",
]) {
  assert.ok(service.includes(snippet), `payment service missing webhook ops hardening: ${snippet}`);
}

assert.ok(service.includes("listProviderEvents"), "payment provider events must be listable for operations");
assert.ok(service.includes("retryProviderEvent"), "failed payment provider events must be retryable");
assert.ok(service.includes("processedResultJson"), "webhook result should be stored for audit/debugging");
assert.ok(!service.includes("return { stored: true, duplicate: true, processed: false, eventId, eventType };"), "duplicate webhooks must return processing state, not silently hide state");

assert.ok(controller.includes("listEvents"), "controller must expose payment event list");
assert.ok(controller.includes("retryEvent"), "controller must expose payment event retry");
assert.ok(routes.includes('router.get("/events"'), "route must expose authenticated event list");
assert.ok(routes.includes('router.post("/events/:id/retry"'), "route must expose authenticated event retry");
assert.ok(routes.includes('requireRole("owner", "admin")'), "event operations must be owner/admin only");
assert.ok(!routes.includes("payloadJson"), "routes must not expose raw webhook payloads directly");

assert.ok(packageJson.scripts["test:billing"].includes("phase22-payment-webhook-ops.examples.js"), "Phase 22 tests must be wired into npm test");

console.log("Phase 22 payment webhook ops examples passed");
