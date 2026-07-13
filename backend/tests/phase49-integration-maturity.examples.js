import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertWebhookUrlSyntax, deriveWebhookSecret, hashApiKey, signWebhookPayload } from "../src/modules/integrations/integrations.service.js";

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

for (const blocked of ["http://localhost/hook", "http://127.0.0.1/hook", "http://10.0.0.8/hook", "http://169.254.169.254/latest/meta-data", "https://service.local/hook", "https://user:pass@example.com/hook"]) {
  assert.throws(() => assertWebhookUrlSyntax(blocked), undefined, `${blocked} must be rejected`);
}
assert.doesNotThrow(() => assertWebhookUrlSyntax("https://hooks.example.com/kiranaos"));

const service = read("src/modules/integrations/integrations.service.js");
const routes = read("src/modules/integrations/integrations.routes.js");
const frontend = read("../frontend/src/features/settings/pages/IntegrationsSettingsPage.tsx");
const sqliteSchema = read("prisma/schema.prisma");
const postgresSchema = read("prisma-postgres/schema.prisma");

assert.match(service, /keyHash:\s*hashApiKey\(secret\)/, "only the key hash should be persisted");
assert.doesNotMatch(service, /data:\s*\{[^}]*secret[,}]/s, "plaintext API keys must not be written to Prisma");
assert.match(service, /redirect:\s*"error"/, "webhook redirects must be blocked against SSRF pivots");
assert.match(service, /dns\.lookup/, "webhook destinations must be resolved before delivery");
assert.match(routes, /requireIntegrationKey.*validateQuery/s, "public integration resources require API-key authentication");
assert.match(routes, /requireOwnerPin, validate\(createApiKeySchema\)/, "credential creation requires owner intent");
assert.match(routes, /requireOwnerPin, validate\(createWebhookSchema\)/, "endpoint creation requires owner intent");
assert.doesNotMatch(frontend, /crypto\.randomUUID|useSettingsPrefs|apiKey:\s*saved/, "frontend must not mint or persist integration secrets");
assert.match(frontend, /shown only|shown once|cannot be viewed again/i, "one-time secret disclosure must be explicit");

for (const model of ["IntegrationApiKey", "WebhookEndpoint", "WebhookDelivery"]) {
  assert.match(sqliteSchema, new RegExp(`model ${model}\\s*\\{`));
  assert.match(postgresSchema, new RegExp(`model ${model}\\s*\\{`));
}

console.log("phase49 integration maturity examples passed");
