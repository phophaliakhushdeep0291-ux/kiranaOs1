import assert from "assert";
import fs from "fs";

function read(file) {
  return fs.readFileSync(file, "utf8");
}

const pkg = JSON.parse(read("package.json"));
assert.ok(pkg.scripts["proof:ops"], "proof:ops script must exist");
assert.ok(pkg.scripts["razorpay:fixtures"], "razorpay:fixtures script must exist");
assert.ok(pkg.scripts["worker:proof"], "worker:proof script must exist");

const suite = read("scripts/production-proof-suite.js");
for (const snippet of [
  "prod:check",
  "contract:check",
  "razorpay:fixtures",
  "contract:smoke",
  "smoke:test",
  "worker:proof",
  "proof:postgres",
  "PROOF_REQUIRE_LIVE",
  "PROOF_REQUIRE_POSTGRES",
  "PROOF_REQUIRE_WORKER",
]) {
  assert.ok(suite.includes(snippet), `production proof suite must include ${snippet}`);
}

const workerProof = read("scripts/prove-worker-runtime.js");
for (const snippet of [
  "kiranaos_redis_worker_production_proof",
  "redis-worker-production-proof-latest.json",
  "getWorkerHeartbeats",
  "WORKER_HEALTHCHECK",
  "waitUntilFinished",
  "urlRetained: false",
  '"--porcelain", "--", "backend"',
  "backendSourceFingerprintSha256",
  '"diff", "--binary", "HEAD", "--", "backend"',
  "WORKER_PROOF_SOURCE_CHANGED",
]) {
  assert.ok(workerProof.includes(snippet), `worker proof must include ${snippet}`);
}

const razorpayFixture = read("scripts/razorpay-fixture-proof.js");
for (const snippet of [
  "verifyPaymentSignature",
  "verifyWebhookSignature",
  "parseWebhookBody",
  "payment.captured",
  "tampered",
  "INVALID_WEBHOOK_BODY",
]) {
  assert.ok(razorpayFixture.includes(snippet), `razorpay fixture proof must include ${snippet}`);
}

const paymentRoutes = read("src/modules/payment-provider/paymentProvider.routes.js");
assert.ok(paymentRoutes.includes("requireDeviceActivated"), "payment provider admin ops must import requireDeviceActivated");
for (const route of ["/events", "/events/:id/retry", "/manual/activate"]) {
  assert.ok(paymentRoutes.includes(route), `payment provider route must include ${route}`);
}
assert.ok(/router\.get\("\/events",[\s\S]*requireDeviceActivated\(\)/.test(paymentRoutes), "list provider events must require active device");
assert.ok(/router\.post\("\/events\/:id\/retry",[\s\S]*requireDeviceActivated\(\)/.test(paymentRoutes), "retry provider event must require active device");
assert.ok(/router\.post\("\/manual\/activate",[\s\S]*requireDeviceActivated\(\)/.test(paymentRoutes), "manual activation must require active device");

const contract = JSON.parse(read("contracts/api-contract.v1.json"));
assert.ok(contract.updatedForPhase === 26 || String(contract.updatedForPhase).includes("26") || String(contract.updatedForPhase).includes("48"), "contract should preserve production proof phase metadata or newer patch metadata");
for (const path of ["/api/payment-provider/events", "/api/payment-provider/events/:id/retry", "/api/payment-provider/manual/activate"]) {
  const endpoint = contract.endpoints.find((item) => item.path === path);
  assert.ok(endpoint?.authRequired, `${path} must require auth`);
  assert.ok(endpoint?.deviceRequired, `${path} must require device`);
}

const docs = read("docs/OPERATIONAL_PROOF.md");
for (const phrase of ["npm run proof:ops", "PostgreSQL proof", "Worker proof", "Razorpay fixture proof", "Strict modes"]) {
  assert.ok(docs.includes(phrase), `operational proof docs must mention ${phrase}`);
}

const envExample = read(".env.example");
for (const key of ["PROOF_BASE_URL", "PROOF_REQUIRE_LIVE", "PROOF_REQUIRE_POSTGRES", "PROOF_REQUIRE_WORKER"]) {
  assert.ok(envExample.includes(`${key}=`), `.env.example must document ${key}`);
}

console.log("Phase 26 operational proof examples passed");
