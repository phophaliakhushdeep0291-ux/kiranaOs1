import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertWebhookUrlSyntax, createPinnedLookup, deriveWebhookSecret, hashApiKey, readResponseSnippet, signWebhookPayload } from "../src/modules/integrations/integrations.service.js";
import { createApiKeySchema } from "../src/modules/integrations/integrations.schemas.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const token = "kos_test_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN";
assert.equal(hashApiKey(token).length, 64, "API key hash must be SHA-256 hex");
assert.ok(!hashApiKey(token).includes(token), "hash must not contain plaintext token");
assert.equal(hashApiKey(token), hashApiKey(token), "API key lookup hash must be deterministic");

const secretA = deriveWebhookSecret("endpoint-a");
const secretB = deriveWebhookSecret("endpoint-b");
assert.match(secretA, /^whsec_[A-Za-z0-9_-]+$/);
assert.notEqual(secretA, secretB, "each endpoint must have an isolated signing secret");
assert.equal(
  signWebhookPayload({ endpointId: "endpoint-a", timestamp: "123", body: '{"ok":true}' }),
  signWebhookPayload({ endpointId: "endpoint-a", timestamp: "123", body: '{"ok":true}' }),
  "same signed input must verify deterministically",
);
assert.notEqual(
  signWebhookPayload({ endpointId: "endpoint-a", timestamp: "123", body: '{"ok":true}' }),
  signWebhookPayload({ endpointId: "endpoint-a", timestamp: "124", body: '{"ok":true}' }),
  "timestamp must be covered by the signature",
);

for (const blocked of ["http://localhost/hook", "http://127.0.0.1/hook", "http://10.0.0.8/hook", "http://100.64.0.1/hook", "http://169.254.169.254/latest/meta-data", "http://198.18.0.1/hook", "https://service.local/hook", "https://user:pass@example.com/hook"]) {
  assert.throws(() => assertWebhookUrlSyntax(blocked), undefined, `${blocked} must be rejected`);
}
assert.doesNotThrow(() => assertWebhookUrlSyntax("https://hooks.example.com/kiranaos"));
createPinnedLookup({ address: "203.0.114.10", family: 4 })("different.example", {}, (error, address, family) => {
  assert.equal(error, null);
  assert.equal(address, "203.0.114.10");
  assert.equal(family, 4);
});
assert.equal((await readResponseSnippet(new Response("x".repeat(100_000)), 512)).length, 500, "webhook responses must be read through a bounded stream");
assert.equal(createApiKeySchema.safeParse({ name: "Expired", scopes: ["catalog:read"], expiresAt: new Date(Date.now() - 60_000).toISOString() }).success, false);

const service = read("src/modules/integrations/integrations.service.js");
const routes = read("src/modules/integrations/integrations.routes.js");
const frontend = read("../frontend/src/features/settings/pages/IntegrationsSettingsPage.tsx");
const sqliteSchema = read("prisma/schema.prisma");
const postgresSchema = read("prisma-postgres/schema.prisma");
const metrics = read("src/lib/metrics.js");
const queueNames = read("src/workers/queueNames.js");
const workerRegistry = read("src/workers/queues.js");
const server = read("src/server.js");

assert.match(service, /keyHash:\s*hashApiKey\(secret\)/, "only the key hash should be persisted");
assert.doesNotMatch(service, /data:\s*\{[^}]*secret[,}]/s, "plaintext API keys must not be written to Prisma");
assert.match(service, /dns\.lookup/, "webhook destinations must be resolved before delivery");
assert.match(service, /lookup:\s*createPinnedLookup\(destination\)/, "the validated IP must be pinned into the actual socket connection");
assert.doesNotMatch(service, /fetch\(endpoint\.url/, "webhook delivery must not perform a second unpinned DNS resolution");
assert.match(service, /webhookDelivery\.create[\s\S]*scheduleWebhookDelivery/, "delivery evidence must be persisted before dispatch");
assert.match(service, /addJob[\s\S]*webhooksQueue[\s\S]*DELIVER_WEBHOOK/, "production webhook delivery must use the durable worker queue");
assert.match(service, /\{\s*status:\s*"pending"\s*\}/, "all pending deliveries must be discovered after restart");
assert.match(service, /hasMore[\s\S]*nextCursor/, "public API resources must expose a continuation contract");
assert.match(service, /billType:\s*\{\s*not:\s*"estimate"\s*\}/, "accounting exports must exclude non-posted estimates");
assert.match(routes, /requireIntegrationKey.*validateQuery/s, "public integration resources require API-key authentication");
assert.match(routes, /requireFeature\("api_webhook_later"\)/, "integration mutations must respect plan entitlements");
assert.match(routes, /requireOwnerPin, validate\(createApiKeySchema\)/, "credential creation requires owner intent");
assert.match(routes, /requireOwnerPin, validate\(createWebhookSchema\)/, "endpoint creation requires owner intent");
assert.doesNotMatch(frontend, /crypto\.randomUUID|useSettingsPrefs|apiKey:\s*saved/, "frontend must not mint or persist integration secrets");
assert.match(frontend, /shown only|shown once|cannot be viewed again/i, "one-time secret disclosure must be explicit");
assert.match(frontend, /Automatic expiry/, "API key creation must default to a bounded credential lifetime");
assert.match(frontend, /QueryFailure/, "integration query failures must not masquerade as empty data");
assert.match(frontend, /useInfiniteQuery/, "delivery history must expose pagination instead of silently truncating activity");
assert.match(frontend, /upgrade_required/, "provider readiness must explain plan-locked capabilities");
assert.match(metrics, /integration_api_auth_total/, "API authentication must be observable");
assert.match(metrics, /webhook_delivery_duration_ms/, "webhook delivery latency must be observable");
assert.match(queueNames, /webhooksQueue:\s*"kiranaos:webhooks"/, "webhooks must have a dedicated queue");
assert.match(workerRegistry, /webhooksQueue[\s\S]*handleWebhookJob/, "the webhook worker must be registered");
assert.match(server, /recoverWebhookDeliveries/, "startup must recover persisted webhook deliveries");

for (const model of ["IntegrationApiKey", "WebhookEndpoint", "WebhookDelivery"]) {
  assert.match(sqliteSchema, new RegExp(`model ${model}\\s*\\{`));
  assert.match(postgresSchema, new RegExp(`model ${model}\\s*\\{`));
}
assert.match(sqliteSchema, /model WebhookEndpoint\s*\{[\s\S]*deletedAt\s+DateTime\?/, "SQLite endpoints must be archived rather than deleted");
assert.match(postgresSchema, /model WebhookEndpoint\s*\{[\s\S]*deletedAt\s+DateTime\?/, "Postgres endpoints must be archived rather than deleted");

console.log("phase49 integration maturity examples passed");
