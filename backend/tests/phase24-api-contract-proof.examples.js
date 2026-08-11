import fs from "fs";
import path from "path";
import assert from "assert";

const root = process.cwd();
const contract = JSON.parse(fs.readFileSync(path.join(root, "contracts/api-contract.v1.json"), "utf8"));
const docs = fs.readFileSync(path.join(root, "docs/API_CONTRACT.md"), "utf8");
const e2eDocs = fs.readFileSync(path.join(root, "docs/E2E_PRODUCTION_PROOF.md"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const endpoints = contract.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`);

assert.equal(contract.version, "v1");
assert.equal(contract.basePath, "/api");
assert.ok(endpoints.length >= 60, "Contract should cover the main API surface");
assert.ok(endpoints.includes("POST /api/auth/login"));
assert.ok(endpoints.includes("POST /api/devices/activate"));
assert.ok(endpoints.includes("GET /api/devices/license"));
assert.ok(endpoints.includes("POST /api/bills/confirm"));
assert.ok(endpoints.includes("GET /api/sync/status"));
assert.ok(endpoints.includes("GET /api/sync/conflicts"));
assert.ok(endpoints.includes("POST /api/sync/conflicts/report"));
assert.ok(endpoints.includes("POST /api/sync/resolve-conflict"));
assert.ok(endpoints.includes("GET /api/sync/pull"));
assert.ok(endpoints.includes("GET /api/jobs/workers"));
assert.ok(endpoints.includes("GET /api/jobs/backups"));
assert.ok(endpoints.includes("POST /api/jobs/backups"));
assert.ok(endpoints.includes("GET /api/jobs/backups/:id/download"));
assert.ok(endpoints.includes("POST /api/ai/transcribe"));
assert.ok(endpoints.includes("GET /api/reminders/status"));
assert.ok(endpoints.includes("GET /api/reminders/webhooks/meta"));
assert.ok(endpoints.includes("POST /api/reminders/webhooks/:provider"));
assert.ok(endpoints.includes("GET /api/payment-provider/events"));
assert.ok(endpoints.includes("POST /api/payment-provider/events/:id/retry"));
assert.ok(endpoints.includes("GET /api/payment-provider/retail/readiness"));
assert.ok(endpoints.includes("POST /api/payment-provider/retail/intents"));
assert.ok(endpoints.includes("GET /api/payment-provider/retail/intents/:id/status"));
assert.ok(endpoints.includes("POST /api/payment-provider/retail/intents/:id/cancel"));

for (const prefix of [
  "/api/products",
  "/api/customers",
  "/api/bills",
  "/api/inventory",
  "/api/reports",
  "/api/sync",
  "/api/jobs",
  "/api/reminders",
  "/api/ai",
]) {
  const matching = contract.endpoints.filter((endpoint) => endpoint.path.startsWith(prefix) && !endpoint.providerAuthenticated);
  assert.ok(matching.length > 0, `Expected contract coverage for ${prefix}`);
  assert.ok(matching.every((endpoint) => endpoint.authRequired && endpoint.deviceRequired), `${prefix} endpoints must require auth + device`);
}

for (const path of ["/api/reminders/webhooks/meta", "/api/reminders/webhooks/:provider"]) {
  const endpoint = contract.endpoints.find((item) => item.path === path);
  assert.equal(endpoint.providerAuthenticated, true, `${path} must be provider authenticated`);
  assert.equal(endpoint.authRequired, false, `${path} must not require a user JWT`);
  assert.equal(endpoint.deviceRequired, false, `${path} must not require a shop device`);
}

const webhook = contract.endpoints.find((endpoint) => endpoint.path === "/api/payment-provider/razorpay/webhook");
assert.equal(webhook.rawBodySignature, true, "Razorpay webhook must use raw-body signature semantics");
assert.equal(webhook.authRequired, false, "Razorpay webhook cannot use JWT auth");

const dynamicQrStatus = contract.endpoints.find((endpoint) => endpoint.path === "/api/payment-provider/retail/intents/:id/status");
for (const guarantee of ["captured UPI", "tenant and branch", "multiple captured", "idempotent"]) {
  assert.ok(dynamicQrStatus.integrityGuarantees.some((item) => item.includes(guarantee)), `dynamic QR status must guarantee ${guarantee}`);
}

const syncPull = contract.endpoints.find((endpoint) => endpoint.path === "/api/sync/pull");
for (const field of ["sync.protocol", "sync.nextServerSeq", "sync.serverVersion", "sync.hasMore"]) {
  assert.ok(syncPull.responseMustInclude.includes(field), `Sync pull must document ${field}`);
}
assert.match(syncPull.purpose, /legacy/i, "Sync pull must document legacy entity-cursor compatibility");

const verifyPayment = contract.endpoints.find((endpoint) => endpoint.path === "/api/subscription/verify-payment");
for (const required of ["signature", "orderId", "paymentId", "amount", "currency", "localTransaction"]) {
  assert.ok(verifyPayment.paymentVerification.includes(required), `verify-payment must require ${required}`);
}

const confirmBill = contract.endpoints.find((endpoint) => endpoint.path === "/api/bills/confirm");
for (const guarantee of ["recomputed by the server", "same transaction as the bill", "conditional atomic claim", "cancellation and restoration"]) {
  assert.ok(confirmBill.transactionGuarantees.some((item) => item.includes(guarantee)), `Bill confirmation must guarantee ${guarantee}`);
}

const transcribeAudio = contract.endpoints.find((endpoint) => endpoint.path === "/api/ai/transcribe");
for (const field of ["data.transcript", "data.model", "data.provider"]) {
  assert.ok(transcribeAudio.responseMustInclude.includes(field), `Audio transcription must return ${field}`);
}
assert.ok(
  transcribeAudio.securityGuarantees.some((guarantee) => guarantee.includes("removed")),
  "Audio transcription must delete its temporary upload after every outcome",
);

const aiCommand = contract.endpoints.find((endpoint) => endpoint.path === "/api/ai/parse-command");
for (const field of [
  "data.permissionAllowed",
  "data.safety.schemaValid",
  "data.safety.grounded",
  "data.safety.effectiveConfidence",
  "data.safety.reasons",
  "data.safety.requiresManualFallback",
]) {
  assert.ok(aiCommand.responseMustInclude.includes(field), "AI command response must document " + field);
}
for (const phrase of ["strict schema", "tenant catalogue", "fails closed", "never writes"]) {
  assert.ok(aiCommand.safetyGuarantees.some((guarantee) => guarantee.includes(phrase)), "AI safety contract must guarantee " + phrase);
}

const reminderStatus = contract.endpoints.find((endpoint) => endpoint.path === "/api/reminders/status");
for (const field of ["data.providerSendConfigured", "data.providerConfigured", "data.webhookConfigured", "data.queueEnabled", "data.workerHealthy", "data.operational", "data.code"]) {
  assert.ok(reminderStatus.responseMustInclude.includes(field), "Reminder status response must document " + field);
}

for (const phrase of ["x-device-id", "Authorization", "entityCursors", "owner PIN", "shopId"]) {
  assert.ok(docs.includes(phrase), `API docs must mention ${phrase}`);
}

for (const phrase of ["owner onboarding", "billing and stock", "offline-first sync", "subscription/payment", "worker proof", "staff/session security"]) {
  assert.ok(e2eDocs.includes(phrase), `E2E proof doc must include ${phrase}`);
}

assert.ok(packageJson.scripts["contract:check"], "package.json must expose contract:check");
assert.ok(packageJson.scripts["contract:smoke"], "package.json must expose contract:smoke");

console.log("Phase 24 API contract proof examples passed");
