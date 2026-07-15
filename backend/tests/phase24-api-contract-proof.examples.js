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
assert.ok(endpoints.includes("GET /api/payment-provider/events"));
assert.ok(endpoints.includes("POST /api/payment-provider/events/:id/retry"));

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
  const matching = contract.endpoints.filter((endpoint) => endpoint.path.startsWith(prefix));
  assert.ok(matching.length > 0, `Expected contract coverage for ${prefix}`);
  assert.ok(matching.every((endpoint) => endpoint.authRequired && endpoint.deviceRequired), `${prefix} endpoints must require auth + device`);
}

const webhook = contract.endpoints.find((endpoint) => endpoint.path === "/api/payment-provider/razorpay/webhook");
assert.equal(webhook.rawBodySignature, true, "Razorpay webhook must use raw-body signature semantics");
assert.equal(webhook.authRequired, false, "Razorpay webhook cannot use JWT auth");

const syncPull = contract.endpoints.find((endpoint) => endpoint.path === "/api/sync/pull");
for (const field of ["sync.protocol", "sync.nextServerSeq", "sync.serverVersion", "sync.hasMore"]) {
  assert.ok(syncPull.responseMustInclude.includes(field), `Sync pull must document ${field}`);
}
assert.match(syncPull.purpose, /legacy/i, "Sync pull must document legacy entity-cursor compatibility");

const verifyPayment = contract.endpoints.find((endpoint) => endpoint.path === "/api/subscription/verify-payment");
for (const required of ["signature", "orderId", "paymentId", "amount", "currency", "localTransaction"]) {
  assert.ok(verifyPayment.paymentVerification.includes(required), `verify-payment must require ${required}`);
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
